import { parseFirestoreError } from './ErrorParser.js';
import { HookEvent, ID } from './FirestoreRepository.js';
import { FirestoreDocument } from './DocumentId.js';
import { ValidationError } from './Errors.js';
import { UpdateInput } from './Validation.js';
import { DeepPartial, FieldPaths, NumericFieldPaths } from '../utils/pathTypes.js';
import { validateDocumentId } from '../utils/documentId.js';
import { deepFreeze } from '../utils/safeObject.js';
import {
  AggregateField,
  CollectionReference,
  DocumentReference,
  FieldPath,
  Filter,
  Firestore,
  Query,
  QueryDocumentSnapshot,
  QuerySnapshot,
  WhereFilterOp,
} from 'firebase-admin/firestore';
import { z } from 'zod';

type FirestoreWriteBatch = (
  actions: ((batch: FirebaseFirestore.WriteBatch) => void)[],
) => Promise<void>;
type RunHook = (event: HookEvent, data: any) => Promise<void>;
type ValidateUpdate<W> = (data: UpdateInput<W>) => UpdateInput<W>;

/**
 * Defines the repository-owned `id` as non-writable/non-configurable on a before-hook payload so a
 * hook may mutate documented `data` fields but cannot repoint identity or forge the id a later hook
 * observes (review R2). Mirrors `FirestoreRepository.withReadonlyId`.
 */
function withReadonlyId<O extends Record<string, any>>(obj: O, id: ID): O {
  Object.defineProperty(obj, 'id', {
    value: id,
    writable: false,
    configurable: false,
    enumerable: true,
  });
  return obj;
}

export type PaginatedResult<T extends object> = {
  items: FirestoreDocument<T>[];
  nextCursor: string | null;
  hasMore: boolean;
};

/**
 * The source-agnostic half of the composite-filter factories: field conditions and the `and`/`or`
 * groups, shared by {@link QueryFilterFactory} (single collection) and `CollectionGroupFilterFactory`
 * (collection group). The two differ only in their document-name helper, because a collection
 * matches on the leaf id and a collection group matches on the full document path.
 *
 * Not re-exported from the package root — consumers name the concrete factory their builder hands
 * them.
 *
 * @template S - the repository's **stored** data shape (without the synthetic `id`). Declared
 *   **invariant** (`in out`) deliberately. `S` appears only inside the deferred conditional type
 *   `FieldPaths<S>`, and TypeScript cannot measure variance through that, so with no annotation it
 *   falls back to accepting BOTH directions: a predicate annotated with an unrelated repository's
 *   shape — or one that kept `id` in the shape and could then query the synthetic `id` as a stored
 *   field path — was silently accepted, defeating the typo protection this type exists to provide.
 *   (Verified: property syntax is bivariant here too, so this is not the usual method-parameter
 *   bivariance; a control factory parameterized by a plain string union IS measured contravariantly.)
 *   Invariance requires the annotated shape to match the repository's stored shape exactly, so use
 *   `StoredDataOf<typeof repo>` (or `Omit<Stored, 'id'>`) rather than the raw model. Variance
 *   annotations require TypeScript 4.7+; the documented floor is 5.5+ (ADR-0016).
 */
export interface QueryFilterFactoryBase<in out S extends object> {
  /**
   * A single field condition — the composite-filter counterpart of
   * {@link FirestoreQueryBuilder.where}. `field` is a typed stored field path (or a `FieldPath`);
   * `value` stays `unknown` because a `readConverter` can make the stored representation differ from
   * the read model.
   */
  where(field: FieldPaths<S> | FieldPath, op: WhereFilterOp, value: unknown): Filter;
  /** Conjunction — every given filter must match. Requires at least one filter. */
  and(...filters: Filter[]): Filter;
  /** Disjunction — at least one given filter must match. Requires at least one filter. */
  or(...filters: Filter[]): Filter;
}

/**
 * Schema-aware factory for composite query filters, handed to the callback of
 * {@link FirestoreQueryBuilder.whereFilter}. Mirrors the Admin SDK's `Filter` statics, but the field
 * paths are typed against the repository's **stored** shape (so a typo is a compile error) and
 * `whereId` runs the same validated document-id boundary as {@link FirestoreQueryBuilder.whereId}.
 *
 * The factory is stateless and its methods return plain SDK `Filter` values, so a group can be
 * extracted into a reusable predicate. Name the shape with `StoredDataOf<typeof repo>` — it already
 * resolves to the repository's stored data without the synthetic `id`:
 *
 * @example
 * const publishedOrMine =
 *   (uid: string) => (f: QueryFilterFactory<StoredDataOf<typeof postRepo>>) =>
 *     f.or(f.where('status', '==', 'published'), f.where('authorId', '==', uid));
 *
 * await postRepo.query().whereFilter(publishedOrMine(uid)).get();
 *
 * @template S - see {@link QueryFilterFactoryBase} for why this is invariant (`in out`).
 */
export interface QueryFilterFactory<in out S extends object> extends QueryFilterFactoryBase<S> {
  /**
   * A document-name condition via `FieldPath.documentId()` — the composite-filter counterpart of
   * {@link FirestoreQueryBuilder.whereId}, with the same `InvalidDocumentIdError` boundary and the
   * same operator restrictions (array-contains operators are intentionally excluded).
   */
  whereId(op: '<' | '<=' | '==' | '!=' | '>=' | '>', value: string): Filter;
  whereId(op: 'in' | 'not-in', value: readonly string[]): Filter;
}

/**
 * Source-specific wording used by `FirestoreQueryBuilderBase.applyCompositeFilter` diagnostics. A
 * dropped-whole filter widens a collection query to one collection but a group query to **every**
 * collection with that id at any depth, so the two messages must not be interchangeable.
 *
 * Package-internal by convention — exported because it appears in a protected member's signature
 * (and so survives `stripInternal` in the emitted `.d.ts`), but not re-exported from the package
 * root.
 */
export type CompositeFilterHints = {
  /** The factory methods to name in the "callback must return a filter" error. */
  readonly factoryMethods: string;
  /** What an empty filter would widen the query to, e.g. `'the collection'`. */
  readonly scope: string;
};

const COLLECTION_FILTER_HINTS: CompositeFilterHints = {
  factoryMethods: 'f.where / f.whereId / f.and / f.or',
  scope: 'the collection',
};

/**
 * Builds a validated document-name (`FieldPath.documentId()`) filter. Shared by
 * {@link FirestoreQueryBuilder.whereId} and the {@link QueryFilterFactory} so both surfaces apply
 * one identical id boundary — `Query.where(field, op, value)` internally does exactly this
 * (`filter = Filter.where(...)`), so routing both through a `Filter` changes no SDK behavior.
 *
 * Validation is applied **per operand**, not to the array as a whole: a mixed
 * `['__id7__', someDocRef]` must still have its id STRING checked rather than skipping the gate
 * because one element is not a string.
 *
 * @param references - `'reject'` for `whereId(...)`, whose signature promises id strings, so a
 *   non-string operand is a contract violation and gets the `InvalidDocumentIdError` boundary.
 *   `'allow'` for `where(FieldPath.documentId(), …)`, whose operand type is `unknown` and where
 *   Firestore also accepts an already-resolved `DocumentReference` — not an untrusted id string to
 *   parse, so non-string operands pass through while string operands are still validated.
 */
function documentIdFilter(
  op: WhereFilterOp,
  value: unknown,
  allowLegacyDatastoreIds: boolean,
  references: 'allow' | 'reject',
): Filter {
  const operands = Array.isArray(value) ? value : [value];
  for (const operand of operands) {
    if (references === 'allow' && typeof operand !== 'string') continue;
    validateDocumentId(operand, 'whereId value', { allowLegacyDatastoreIds });
  }
  return Filter.where(FieldPath.documentId(), op, value);
}

/**
 * True only for `FieldPath.documentId()` — the document-NAME sentinel. A string field path is never
 * the document name (a stored field literally called `id` is ordinary data), so only the `FieldPath`
 * form can address it.
 */
export function isDocumentIdPath(field: unknown): field is FieldPath {
  return field instanceof FieldPath && FieldPath.documentId().isEqual(field);
}

/**
 * Builds the `where` / `and` / `or` members every filter factory shares, bound to one source's
 * document-name filter and wording. The concrete factories add their own document-name helper
 * (`whereId` for a collection, `wherePath` for a collection group).
 *
 * Package-internal; not re-exported from the package root.
 *
 * @param nameFilter - The source's validated `FieldPath.documentId()` filter builder.
 * @param scope - What an empty group would widen the query to, for the rejection message.
 */
export function createFilterFactoryCore<S extends object>(
  nameFilter: (op: WhereFilterOp, value: unknown, references: 'allow' | 'reject') => Filter,
  scope: string,
): QueryFilterFactoryBase<S> {
  /**
   * Rejects an empty `and()` / `or()` group. The SDK does not: `_parseCompositeFilter` drops
   * sub-filters that reduce to nothing and `Query.where()` returns the query UNCHANGED for a filter
   * with zero conditions, so `f.or()` would silently widen the query to **every document in the
   * source** rather than failing. That silent broadening is rejected here instead.
   */
  const assertNonEmptyFilterGroup = (name: 'and' | 'or', filters: readonly Filter[]): void => {
    if (filters.length === 0) {
      throw new Error(
        `f.${name}() requires at least one filter. Firestore silently DROPS an empty composite ` +
          `filter — the query would match every document in ${scope} instead of narrowing it. ` +
          `If the group is built dynamically, check for an empty list before calling f.${name}().`,
      );
    }
  };

  return {
    where: (field, op, value) =>
      // `f.where(FieldPath.documentId(), …)` addresses the document NAME, so it must clear the same
      // boundary as the factory's document-name helper rather than reaching the SDK unvalidated (the
      // SDK blocks path traversal but accepts the reserved `__…__` namespace the validators gate).
      isDocumentIdPath(field)
        ? nameFilter(op, value, 'allow')
        : Filter.where(field as string | FieldPath, op, value),
    and: (...filters) => {
      assertNonEmptyFilterGroup('and', filters);
      return Filter.and(...filters);
    },
    or: (...filters) => {
      assertNonEmptyFilterGroup('or', filters);
      return Filter.or(...filters);
    },
  };
}

/**
 * Creates the {@link QueryFilterFactory} for one `whereFilter()` call, bound to the builder's
 * `allowLegacyDatastoreIds` setting so `f.whereId(...)` honors the repository's id policy.
 */
function createQueryFilterFactory<S extends object>(
  allowLegacyDatastoreIds: boolean,
): QueryFilterFactory<S> {
  const nameFilter = (op: WhereFilterOp, value: unknown, references: 'allow' | 'reject'): Filter =>
    documentIdFilter(op, value, allowLegacyDatastoreIds, references);
  return {
    ...createFilterFactoryCore<S>(nameFilter, COLLECTION_FILTER_HINTS.scope),
    whereId: (op: WhereFilterOp, value: string | readonly string[]) =>
      nameFilter(op, value, 'reject'),
  };
}

/**
 * @template T - **read data** (no `id`); terminal reads return {@link FirestoreDocument}`<T>`.
 * @template W - **write model** (for `update`).
 * @template S - **stored data** — the source of query FIELD PATHS (`where` / `orderBy` / `select` /
 *   aggregations). Defaults to `T`. Query operand VALUES stay `unknown` in v3 (typed operands are
 *   deferred — see ADR-0018); document-name queries use `whereId` / `orderById`.
 * @template R - the current result shape of terminal reads. Defaults to `FirestoreDocument<T>`;
 *   `select(...)` narrows it to `FirestoreDocument<DeepPartial<T>>` (nested map properties optional
 *   too) so fields projected away — at any depth — become compile errors when accessed.
 */

/**
 * The source-agnostic **read** surface shared by every ORM query builder.
 *
 * Everything here works identically whether the underlying `Query` came from a single
 * `CollectionReference` or from `Firestore.collectionGroup(id)`. The four things that genuinely
 * differ are abstract: how a result snapshot becomes the result shape ({@link toResult}), what
 * "belongs to this query's source" means for a pagination cursor
 * ({@link assertCursorBelongsToSource}), how a `FieldPath.documentId()` operand is validated
 * ({@link documentNameFilter} — a leaf id for a collection, a full document path for a group), and
 * the wording hints for composite-filter diagnostics ({@link compositeFilterHints}).
 *
 * The split exists so that {@link FirestoreQueryBuilder}'s destructive terminals (`update` /
 * `delete`) are **absent from the type** of a collection-group builder rather than present and
 * throwing: their bulk hooks are keyed by `id`, which is not unique across a collection group.
 * See `FirestoreCollectionGroupQueryBuilder` and ADR-0024.
 *
 * Not re-exported from the package root — consumers name the concrete subclasses.
 *
 * @template T - **read data** (no `id`).
 * @template S - **stored data** — the source of query FIELD PATHS.
 * @template R - the current result shape of terminal reads.
 */
export abstract class FirestoreQueryBuilderBase<T extends object, S extends object, R> {
  protected query: Query<any>;
  protected hasOrderBy = false;
  // True once select() has applied a field mask. A projected query cannot be used with onSnapshot()
  // (Firestore rejects field-masked listeners), so this is used to guard that combination locally.
  protected hasSelect = false;

  protected constructor(
    protected readonly baseQuery: Query<any>,
    protected readonly db: Firestore,
    protected readonly allowLegacyDatastoreIds: boolean,
  ) {
    this.query = baseQuery;
  }

  /**
   * Maps one result snapshot to this builder's result shape, overlaying repository-owned identity
   * over the document's own data. The single place every terminal read materializes a row.
   */
  protected abstract toResult(doc: QueryDocumentSnapshot<any>): R;

  /**
   * Rejects a decoded pagination cursor whose document does not belong to this query's source.
   *
   * A forged or foreign cursor must never be dereferenced: without this, pagination could probe
   * arbitrary documents in the same database and disclose their existence. Firestore itself does
   * NOT enforce it — a `startAfter()` with an out-of-source snapshot was verified to succeed
   * silently and return the whole result set.
   */
  protected abstract assertCursorBelongsToSource(docRef: DocumentReference): void;

  /**
   * Builds the validated document-NAME (`FieldPath.documentId()`) filter for this source. A
   * collection compares against the leaf document id; a collection group compares against the full
   * document path.
   */
  protected abstract documentNameFilter(
    op: WhereFilterOp,
    value: unknown,
    references: 'allow' | 'reject',
  ): Filter;

  /** Source-specific wording for {@link applyCompositeFilter} diagnostics. */
  protected abstract get compositeFilterHints(): CompositeFilterHints;

  /**
   * Applies a composite filter produced by a `whereFilter(...)` callback, with the two guards that
   * cannot be expressed in the type system. Shared by every builder; the public `whereFilter` on
   * each subclass differs only in which factory it hands the callback.
   */
  protected applyCompositeFilter(filter: unknown): this {
    const hints = this.compositeFilterHints;

    // The compiler cannot catch this: the SDK's `Filter` is an abstract class whose only members are
    // STATIC, so its instance type is structurally empty (`{}`) and ANY non-nullish return value is
    // assignable (asserted in query-paths.type-test.ts). This guard is about DIAGNOSTICS, not
    // correctness — `Query.where()` discriminates its overloads with `instanceof Filter`, and the
    // field-path overload it falls through to rejects every non-filter value we probed (`'status'` →
    // `Value for argument "opStr" is invalid`, `{}`/`42`/`null` → `not a valid field path`). So the
    // SDK never builds a silently-wrong query; it just reports an opaque argument error that names
    // neither whereFilter nor the factory. Only the value's TYPE is echoed — a filter carries caller
    // values that may be sensitive.
    if (!(filter instanceof Filter)) {
      throw new Error(
        'whereFilter() callback must return a filter built with the provided factory ' +
          `(${hints.factoryMethods}), or a firebase-admin \`Filter\`; received ` +
          `${filter === null ? 'null' : typeof filter}. If you built the filter from a direct ` +
          '`@google-cloud/firestore` install, import `Filter` from `firebase-admin/firestore` ' +
          'instead — two copies of the SDK are not interchangeable.',
      );
    }

    // Defense in depth for the prebuilt-Filter escape hatch: the SDK returns the query UNCHANGED when
    // a filter reduces to zero conditions ENTIRELY (see assertNonEmptyFilterGroup), so reference
    // equality is an exact, internals-free test for "this filter was silently dropped whole".
    //
    // Scope, precisely: this does NOT catch a PARTIALLY empty prebuilt filter. `_parseCompositeFilter`
    // drops empty sub-groups at any depth, so `Filter.or(Filter.and(), x)` silently becomes `x`
    // (narrowing what should match everything) and `Filter.and(Filter.or(), x)` also becomes `x`
    // (widening what should match nothing) — both verified on the emulator, and both produce a NEW
    // query object, so nothing here can see them. The factory's construction-site guard closes this
    // for filters built through `f.and()`/`f.or()`; a caller assembling raw SDK filters owns it.
    // Fails open if a future SDK stops returning `this`.
    const next = this.query.where(filter);
    if (next === this.query) {
      throw new Error(
        'whereFilter() received a filter with no conditions, which Firestore silently drops — the ' +
          `query would match every document in ${hints.scope}. Provide at least one condition.`,
      );
    }
    this.query = next;
    return this;
  }

  /**
   * Encodes a query document into an opaque cursor string.
   * The cursor stores the full Firestore document path so pagination
   * is resilient across collections and subcollections.
   *
   * @param doc - The Firestore document snapshot to encode
   * @returns Base64url-encoded cursor payload
   */
  private encodeCursor(doc: QueryDocumentSnapshot<any>): string {
    const payload = { path: doc.ref.path };
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
  }

  /**
   * Decodes a cursor into a Firestore document snapshot for startAfter().
   * Throws when the encoded document no longer exists to avoid silently
   * restarting pagination from the beginning.
   *
   * @param cursor - Base64url-encoded cursor payload
   * @returns Document snapshot represented by the cursor
   */
  private async decodeCursor(cursor: string): Promise<QueryDocumentSnapshot<any>> {
    let docRef: FirebaseFirestore.DocumentReference;
    try {
      const json = Buffer.from(cursor, 'base64url').toString('utf8');
      const payload = JSON.parse(json) as { path?: unknown };
      if (typeof payload.path !== 'string' || payload.path === '') {
        throw new Error('missing path');
      }
      docRef = this.db.doc(payload.path);
    } catch {
      // Never echo the decoded path — it is caller-supplied and untrusted.
      throw new Error('Invalid pagination cursor.');
    }

    // Bind the cursor to THIS query's source: a forged/foreign cursor pointing at a document
    // outside it must not be dereferenced (which would let pagination probe arbitrary documents in
    // the same database, disclosing their existence via timing/error behavior). What "outside"
    // means differs per source — see the concrete implementations.
    this.assertCursorBelongsToSource(docRef);

    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      throw new Error(
        'Pagination cursor no longer points to an existing document (it may have been deleted ' +
          'between page requests).',
      );
    }

    return snapshot as QueryDocumentSnapshot<any>;
  }

  /**
   * Validates a pagination input is a positive, finite integer, rejecting `0`, negatives,
   * non-integers, `NaN`, and `Infinity` up front (which would otherwise produce nonsensical offsets
   * / page counts or fail later in less predictable ways).
   */
  private assertPositiveInt(name: string, value: number): void {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive integer (received ${String(value)}).`);
    }
  }

  /**
   * Add a where clause to filter documents.
   * Supports various operators based on field type.
   *
   * The `field` is a schema-aware field path (typo-checked), but `value` is intentionally typed as
   * `unknown` rather than the field's type: a `readConverter` can make the application model (`T`)
   * differ from the value actually stored in Firestore, so the stored comparison value cannot be
   * derived from `T` in general. Callers are responsible for passing a value matching the STORED
   * representation.
   *
   * @param field - The field path to filter on (typed) or a `FieldPath`
   * @param op - The comparison operator
   * @param value - The value to compare against (matches the stored representation)
   *
   * @example
   * // Basic equality
   * await userRepo.query()
   *   .where('status', '==', 'active')
   *   .get();
   *
   * @example
   * // Comparison operators
   * await productRepo.query()
   *   .where('price', '>', 100)
   *   .where('stock', '>=', 10)
   *   .get();
   *
   * @example
   * // Array operations
   * await postRepo.query()
   *   .where('tags', 'array-contains', 'javascript')
   *   .get();
   *
   * @example
   * // In/Not-in queries
   * await orderRepo.query()
   *   .where('status', 'in', ['pending', 'processing'])
   *   .get();
   *
   * @returns The query builder instance
   */
  where(field: FieldPaths<Omit<S, 'id'>> | FieldPath, op: WhereFilterOp, value: unknown): this {
    // A `FieldPath.documentId()` operand is a document NAME, so it clears the same validated
    // boundary as the source's document-name method; every other field path is ordinary stored data
    // and passes straight through. Keeps one policy across `where`, the document-name method, and
    // the whereFilter factory.
    this.query = isDocumentIdPath(field)
      ? this.query.where(this.documentNameFilter(op, value, 'allow'))
      : this.query.where(field as string | FieldPath, op, value);
    return this;
  }

  /**
   * Order query results by a specific field.
   * Can be chained for multi-field sorting.
   *
   * @param field - The field to sort by
   * @param direction - Sort direction: 'asc' (default) or 'desc'
   *
   * @example
   * // Sort users by creation date, newest first
   * const recentUsers = await userRepo.query()
   *   .orderBy('createdAt', 'desc')
   *   .limit(10)
   *   .get();
   *
   * @example
   * // Multi-field sorting
   * const products = await productRepo.query()
   *   .orderBy('category', 'asc')
   *   .orderBy('price', 'desc')
   *   .get();
   *
   * @returns The query builder instance
   */
  orderBy(field: FieldPaths<Omit<S, 'id'>> | FieldPath, direction: 'asc' | 'desc' = 'asc'): this {
    this.query = this.query.orderBy(field as string | FieldPath, direction);
    // Cursor pagination depends on deterministic ordering across pages.
    // We track explicit ordering so paginate() can enforce this guarantee.
    this.hasOrderBy = true;
    return this;
  }

  /**
   * Limit the number of documents returned.
   * Useful for pagination and performance optimization.
   *
   * @param n - Maximum number of documents to return
   *
   * @example
   * // Get top 5 products by price
   * const topProducts = await productRepo.query()
   *   .orderBy('price', 'desc')
   *   .limit(5)
   *   .get();
   *
   * @example
   * // First page of results
   * const firstPage = await userRepo.query()
   *   .orderBy('createdAt', 'desc')
   *   .limit(20)
   *   .get();
   *
   * @returns The query builder instance
   */
  limit(n: number): this {
    this.query = this.query.limit(n);
    return this;
  }

  /**
   * Count documents matching the query.
   * More efficient than fetching all documents when you only need the count.
   *
   * @returns Number of documents matching the query
   *
   * @example
   * // Count active users
   * const activeCount = await userRepo.query()
   *   .where('status', '==', 'active')
   *   .count();
   *
   * @example
   * // Count orders in date range
   * const orderCount = await orderRepo.query()
   *   .where('createdAt', '>=', startDate)
   *   .where('createdAt', '<=', endDate)
   *   .count();
   */
  async count(): Promise<number> {
    try {
      const snapshot = await this.query.count().get();
      return snapshot.data().count;
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Paginate through query results using cursor-based pagination.
   * More efficient than offset pagination for large datasets.
   *
   * @param pageSize - Number of items per page
   * @param cursor - Opaque cursor string returned by the previous page
   * @returns Object with items, next cursor, and hasMore flag
   *
   * @example
   * // First page
   * const firstPage = await productRepo.query()
   *   .where('category', '==', 'electronics')
   *   .orderBy('price', 'desc')
   *   .paginate(20);
   *
   * @example
   * // Next page
   * const nextPage = await productRepo.query()
   *   .where('category', '==', 'electronics')
   *   .orderBy('price', 'desc')
   *   .paginate(20, firstPage.nextCursor);
   */
  async paginate(
    pageSize: number,
    cursor?: string | null,
  ): Promise<{ items: R[]; nextCursor: string | null; hasMore: boolean }> {
    try {
      this.assertPositiveInt('pageSize', pageSize);

      if (!this.hasOrderBy) {
        throw new Error(
          'paginate() requires at least one orderBy() call for stable cursor pagination',
        );
      }

      let finalQuery = this.query;

      if (cursor) {
        const cursorDoc = await this.decodeCursor(cursor);
        finalQuery = finalQuery.startAfter(cursorDoc);
      }

      // Fetch one extra document so we can reliably tell whether
      // more pages exist without requiring a follow-up request.
      finalQuery = finalQuery.limit(pageSize + 1);
      const snapshot: QuerySnapshot = await finalQuery.get();
      const hasMore = snapshot.docs.length > pageSize;
      const pageDocs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs;
      const items = pageDocs.map(doc => this.toResult(doc));

      const last = pageDocs[pageDocs.length - 1];
      const nextCursor = hasMore && last ? this.encodeCursor(last) : null;

      return { items, nextCursor, hasMore };
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Paginate using offset/limit (traditional pagination).
   * Less efficient than cursor pagination for large datasets.
   *
   * @param page - Page number (1-based)
   * @param pageSize - Number of items per page
   * @returns Paginated results with metadata
   *
   * @example
   * // Get page 2 with 20 items per page
   * const results = await userRepo.query()
   *   .where('role', '==', 'customer')
   *   .orderBy('createdAt', 'desc')
   *   .offsetPaginate(2, 20);
   *
   * console.log(`Page ${results.page} of ${results.totalPages}`);
   * console.log(`Showing ${results.items.length} of ${results.total} total`);
   */
  async offsetPaginate(
    page: number,
    pageSize: number,
  ): Promise<{
    items: R[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  }> {
    try {
      this.assertPositiveInt('page', page);
      this.assertPositiveInt('pageSize', pageSize);

      const total = await this.count();
      const offset = (page - 1) * pageSize;

      let finalQuery = this.query;
      finalQuery = finalQuery.offset(offset).limit(pageSize);

      const snapshot = await finalQuery.get();
      const items = snapshot.docs.map(doc => this.toResult(doc));

      return {
        items,
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      };
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Get a single document matching the query.
   * Returns null if no documents match.
   *
   * @returns The first matching document or null
   *
   * @example
   * // Find user by email
   * const user = await userRepo.query()
   *   .where('email', '==', 'john@example.com')
   *   .getOne();
   *
   * @example
   * // Get the cheapest product in category
   * const cheapest = await productRepo.query()
   *   .where('category', '==', 'books')
   *   .orderBy('price', 'asc')
   *   .getOne();
   */
  async getOne(): Promise<R | null> {
    try {
      // Build a local limited query instead of calling this.limit(1), which would mutate this.query
      // and permanently limit any later use of the same builder.
      const snapshot = await this.query.limit(1).get();
      const doc = snapshot.docs[0];
      return doc ? this.toResult(doc) : null;
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Check if any documents match the query.
   * More efficient than count() when you only need to know if results exist.
   *
   * @returns True if at least one document matches
   *
   * @example
   * // Check if email is already taken
   * const emailExists = await userRepo.query()
   *   .where('email', '==', newEmail)
   *   .exists();
   *
   * @example
   * // Check if user has any orders
   * const hasOrders = await orderRepo.query()
   *   .where('userId', '==', userId)
   *   .exists();
   */
  async exists(): Promise<boolean> {
    try {
      // Local limited count — do not mutate this.query via this.limit(1) (see getOne()).
      const snapshot = await this.query.limit(1).count().get();
      return snapshot.data().count > 0;
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Calculate the sum for a numeric field using Firestore's native aggregation query.
   * This executes on the Firestore backend and returns only the aggregate result.
   *
   * @param field - The numeric field to sum
   * @returns The summed value for matching documents
   *
   * @example
   * // Calculate total revenue for completed orders
   * const totalRevenue = await orderRepo.query()
   *   .where('status', '==', 'completed')
   *   .sum('total');
   */
  async sum(field: NumericFieldPaths<Omit<S, 'id'>> | FieldPath): Promise<number> {
    try {
      const snapshot = await this.query
        .aggregate({ sum: AggregateField.sum(field as string | FieldPath) })
        .get();

      // Firestore can return null when no matching numeric values exist.
      // Normalize to 0 to preserve expected numeric behavior for callers.
      return snapshot.data().sum ?? 0;
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Calculate the average for a numeric field using Firestore's native aggregation query.
   * This executes on the Firestore backend and returns only the aggregate result.
   *
   * @param field - The numeric field to average
   * @returns The average value for matching documents, or `null` when there are no numeric values
   *   to average (an empty match set). This is distinct from an average that genuinely computes to
   *   `0` — callers must handle `null` explicitly.
   *
   * @example
   * // Calculate average product rating
   * const avgRating = await reviewRepo.query()
   *   .where('productId', '==', productId)
   *   .average('rating'); // number | null
   */
  async average(field: NumericFieldPaths<Omit<S, 'id'>> | FieldPath): Promise<number | null> {
    try {
      const snapshot = await this.query
        .aggregate({ average: AggregateField.average(field as string | FieldPath) })
        .get();

      // Firestore (and the Admin SDK's AggregateField.average typing) returns null when there are
      // no numeric values to average. Return it verbatim so "no values" (null) stays distinct from
      // "the average is 0" — collapsing them with `?? 0` would invent data (ADR-0020).
      return snapshot.data().average;
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Get all distinct values for a specific field.
   * Useful for generating filter options or analyzing data distribution.
   *
   * LIMITATION — scalar values only: distinctness is computed with a JavaScript `Set`, which uses
   * reference identity for objects. Structured/reference Firestore values (maps, arrays,
   * `Timestamp`, `GeoPoint`, `DocumentReference`) are therefore deduplicated by identity, not by
   * semantic equality, so two equal-but-distinct-object values are reported as separate. Use this
   * only for scalar fields (string/number/boolean), or dedupe structured values yourself.
   *
   * **Reads the document's own field, never a repository identity overlay** (review M1). Unlike the
   * terminals that materialize whole rows, this reads `doc.data()[field]` directly, so on a
   * collection-group query `distinctValues('path')` returns the distinct values of a *stored* field
   * literally named `path` — not the document paths that `get()` reports as `row.path`. That is
   * deliberate: it is the only surface that can still read a field the identity overlay shadows, so
   * restricting the key space would close the sole escape hatch for exactly the data users would be
   * trying to recover. Identity-named keys are only reachable here when the model declares them,
   * which `collectionGroup()` rejects for schema-validated repositories.
   *
   * @param field - The (top-level) field to get distinct values from
   * @returns Array of unique values
   *
   * @example
   * // Get all product categories
   * const categories = await productRepo.query()
   *   .distinctValues('category');
   *
   * @example
   * // Get all order statuses in use
   * const statuses = await orderRepo.query()
   *   .where('createdAt', '>', lastMonth)
   *   .distinctValues('status');
   */
  async distinctValues<K extends keyof Omit<T, 'id'>>(field: K): Promise<T[K][]> {
    // Typed against the READ model (review A9): this terminal reads `doc.data()`, which is the
    // converter-applied read shape `T`, not the stored shape `S` — a converter can rename a stored
    // field, so typing against `S` would let a correctly-typed call read an absent read-model
    // property. `id` is excluded (it is repository metadata, not stored/read data).
    if (this.hasSelect) {
      // A projected (select) query only materializes the selected fields, so distinct over an
      // unselected field would silently observe nothing. Reject the combination locally (review D2).
      throw new Error(
        'distinctValues() is not supported after select(): a projected query does not materialize ' +
          'unselected fields. Call distinctValues() on an unprojected query.',
      );
    }
    try {
      const snapshot = await this.query.get();
      const values = snapshot.docs.map(doc => doc.data()[field as string]);
      // Drop only `undefined` (an absent field), not `null`: `null` is a real, stored, distinct
      // field value and must survive deduplication. A loose `!= undefined` would also strip `null`
      // (since `null == undefined`), conflating "field absent" with "field is null" (ADR-0020, B9).
      return [...new Set(values)].filter(val => val !== undefined) as T[K][];
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Stream query results as an async generator.
   * Memory efficient for processing large datasets.
   *
   * @yields Documents one at a time
   *
   * @example
   * // Process all users without loading into memory
   * for await (const user of userRepo.query().stream()) {
   *   await sendEmail(user.email);
   *   console.log(`Processed user ${user.id}`);
   * }
   *
   * @example
   * // Export data to CSV
   * const csvStream = createWriteStream('users.csv');
   * for await (const user of userRepo.query()
   *   .where('subscribed', '==', true)
   *   .stream()) {
   *   csvStream.write(`${user.name},${user.email}\n`);
   * }
   */
  async *stream(): AsyncGenerator<R> {
    try {
      // Use the Admin SDK's native query stream so documents are yielded incrementally as they
      // arrive, rather than buffering the entire result set via get(). Node readable streams are
      // async-iterable, so `for await` drives them directly; per-document conversion and error
      // semantics are preserved.
      const source = this.query.stream() as AsyncIterable<QueryDocumentSnapshot<any>>;
      for await (const doc of source) {
        yield this.toResult(doc);
      }
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Subscribe to real-time updates for documents matching the query.
   * Callback is triggered whenever matching documents are added, modified, or removed.
   *
   * @param callback - Function called with updated results
   * @param onError - Optional error handler
   * @returns Unsubscribe function to stop listening
   *
   * @example
   * // Monitor active orders in real-time
   * const unsubscribe = await orderRepo.query()
   *   .where('status', '==', 'active')
   *   .onSnapshot(
   *     (orders) => {
   *       console.log(`Active orders: ${orders.length}`);
   *       updateDashboard(orders);
   *     },
   *     (error) => console.error('Snapshot error:', error)
   *   );
   *
   * // Later: stop listening
   * unsubscribe();
   */
  async onSnapshot(
    callback: (items: R[]) => void,
    onError?: (error: Error) => void,
  ): Promise<() => void> {
    // Firestore does not allow a real-time listener on a query with a field mask. Reject the
    // combination locally with a clear error instead of deferring an opaque failure to the SDK.
    if (this.hasSelect) {
      throw new Error(
        'onSnapshot() is not supported after select(): Firestore does not allow real-time ' +
          'listeners on a projected (field-masked) query. Listen without select() and project ' +
          'in your callback, or use get()/stream() for a one-time projected read.',
      );
    }

    try {
      return this.query.onSnapshot(
        snapshot => {
          const items = snapshot.docs.map(doc => this.toResult(doc));
          callback(items);
        },
        error => {
          // Normalize async stream errors through the same error parser as one-time reads
          // (get/stream) and listenOne, so the same query surfaces one error type whether it is
          // read once or listened to.
          if (onError) onError(parseFirestoreError(error));
        },
      );
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Paginate with total count included.
   * Combines paginate() and count() in a single method.
   *
   * @param pageSize - Number of items per page
   * @param cursor - Opaque cursor string returned by the previous page
   * @returns Paginated results with total count
   *
   * @example
   * // Get paginated results with progress info
   * const { items, nextCursor, hasMore, total } = await productRepo.query()
   *   .where('inStock', '==', true)
   *   .paginateWithCount(20, lastCursor);
   *
   * console.log(`Showing ${items.length} of ${total} products`);
   */
  async paginateWithCount(
    pageSize: number,
    cursor?: string | null,
  ): Promise<{ items: R[]; nextCursor: string | null; hasMore: boolean; total: number }> {
    try {
      const total = await this.count();
      const result = await this.paginate(pageSize, cursor);
      return { ...result, total };
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Returns the underlying Firestore query for package-internal composition.
   * @internal Used by `@reggieofarrell/firestore-orm/vector`.
   */
  getUnderlyingQuery(): Query<any> {
    return this.query;
  }

  /**
   * Execute the query and return all matching documents.
   * This is the main method to retrieve query results.
   *
   * @returns Array of documents matching the query
   *
   * @example
   * // Simple query
   * const activeUsers = await userRepo.query()
   *   .where('status', '==', 'active')
   *   .get();
   *
   * @example
   * // Complex query with multiple conditions
   * const results = await orderRepo.query()
   *   .where('status', '==', 'pending')
   *   .where('total', '>', 100)
   *   .where('createdAt', '>=', startOfDay)
   *   .orderBy('createdAt', 'desc')
   *   .limit(50)
   *   .get();
   */
  async get(): Promise<R[]> {
    try {
      const snapshot: QuerySnapshot = await this.query.get();
      return snapshot.docs.map(doc => this.toResult(doc));
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }
}

/**
 * Query builder for a single **collection** (or subcollection) — the builder returned by
 * `FirestoreRepository.query()`.
 *
 * Adds the collection-only surface on top of {@link FirestoreQueryBuilderBase}: document-name
 * queries by leaf id (`whereId` / `orderById`), the whole-collection `collectionCount()`, and the
 * destructive `update()` / `delete()` terminals with their bulk hooks.
 *
 * @template T - **read data** (no `id`); terminal reads return {@link FirestoreDocument}`<T>`.
 * @template W - **write model** (for `update`).
 * @template S - **stored data** — the source of query FIELD PATHS (`where` / `orderBy` / `select` /
 *   aggregations). Defaults to `T`. Query operand VALUES stay `unknown` in v3 (typed operands are
 *   deferred — see ADR-0018); document-name queries use `whereId` / `orderById`.
 * @template R - the current result shape of terminal reads. Defaults to `FirestoreDocument<T>`;
 *   `select(...)` narrows it to `FirestoreDocument<DeepPartial<T>>` (nested map properties optional
 *   too) so fields projected away — at any depth — become compile errors when accessed.
 */
export class FirestoreQueryBuilder<
  T extends object,
  W extends object = T,
  S extends object = T,
  R = FirestoreDocument<T>,
> extends FirestoreQueryBuilderBase<T, S, R> {
  constructor(
    baseQuery: Query<any>,
    private collectionRef: CollectionReference<any>,
    db: Firestore,
    private commitInChunks: FirestoreWriteBatch,
    private runHooks: RunHook,
    private validateUpdate?: ValidateUpdate<W>,
    allowLegacyDatastoreIds = false,
  ) {
    super(baseQuery, db, allowLegacyDatastoreIds);
  }

  /** A collection read result is the document data plus the authoritative leaf document id. */
  protected toResult(doc: QueryDocumentSnapshot<any>): R {
    return { ...(doc.data() as T), id: doc.id } as unknown as R;
  }

  /**
   * Binds a cursor to THIS collection: a forged/foreign cursor pointing at a document in another
   * collection must not be dereferenced.
   */
  protected assertCursorBelongsToSource(docRef: DocumentReference): void {
    if (docRef.parent.path !== this.collectionRef.path) {
      throw new Error('Invalid pagination cursor for this collection.');
    }
  }

  /** In a single collection, the document name is the leaf id. */
  protected documentNameFilter(
    op: WhereFilterOp,
    value: unknown,
    references: 'allow' | 'reject',
  ): Filter {
    return documentIdFilter(op, value, this.allowLegacyDatastoreIds, references);
  }

  protected get compositeFilterHints(): CompositeFilterHints {
    return COLLECTION_FILTER_HINTS;
  }

  /**
   * Removes top-level undefined keys from update payloads.
   * This keeps update behavior consistent with repository update semantics.
   */
  private sanitizeUpdateData(data: UpdateInput<W>): UpdateInput<W> {
    const entries = Object.entries(data as Record<string, any>).filter(
      ([, value]) => value !== undefined,
    );
    return Object.fromEntries(entries) as UpdateInput<W>;
  }

  /**
   * Rejects an empty update payload, matching the repository update surfaces so every update path
   * shares one policy.
   */
  private assertNonEmptyUpdatePayload(payload: Record<string, any>): void {
    if (Object.keys(payload).length === 0) {
      throw new ValidationError([
        {
          code: 'custom',
          path: [],
          message:
            'Update payload is empty — no fields to write after validation. Provide at least one ' +
            'field to update (use delete() to remove a document).',
        } as z.core.$ZodIssue,
      ]);
    }
  }

  /**
   * Add a **composite** filter — nested `AND` / `OR` boolean expressions, which chained `where()`
   * calls (an implicit top-level AND) cannot express.
   *
   * The callback receives a schema-aware {@link QueryFilterFactory}: `f.where(...)` takes the same
   * typed stored field paths as {@link where} at every nesting depth, and `f.whereId(...)` applies
   * the same validated document-id boundary as {@link whereId}. A prebuilt Admin SDK `Filter` may be
   * returned directly (`f => myFilter`) as an escape hatch — it is applied verbatim, without the
   * typed-path or id validation the factory provides.
   *
   * Composes with everything else on the builder: a `whereFilter()` is AND-ed with any chained
   * `where()` clauses, and works with `orderBy`/`limit`, `select`, the aggregations, pagination,
   * `stream()`, `onSnapshot()`, the `update()`/`delete()` terminals, and vector prefilters.
   *
   * ⚠️ **An inequality inside an `or()` branch drops documents that are MISSING that field — even
   * documents matched by a DIFFERENT branch.** Firestore adds an implicit `orderBy` for every
   * inequality field (`<`, `<=`, `>`, `>=`, `!=`) collected across the *flattened* filter tree, and a
   * document without an ordered field cannot appear. (`not-in` is an inequality too, but it can never
   * appear inside an `OR` — Firestore rejects that combination outright.) So an OR query can return
   * **fewer** rows than one of its own disjuncts, and `count()` agrees — it is not a read-path artifact:
   *
   * ```
   * where('kind', '==', 'x')                              → 4 docs
   * whereFilter(f => f.or(f.where('score', '>', 5),
   *                       f.where('kind', '==', 'x')))    → 3 docs  ← a `kind: 'x'` doc has no `score`
   * ```
   *
   * This also affects the destructive `update()` / `delete()` terminals, which would silently skip
   * those documents. Safe shapes inside `or()`: equality, `in`, and `array-contains` /
   * `array-contains-any`; and `f.whereId(...)` with a comparison operator, which is exempt because
   * Firestore skips `documentId()` when adding implicit orders and a document name always exists.
   * If you need an inequality branch, ensure the field is always written (e.g. a default at create
   * time), or run the branches as separate queries and merge by `id`.
   *
   * Firestore enforces its own limits on the **server** and the ORM does not duplicate them (a local
   * copy would risk rejecting a query the backend accepts, and the counts multiply across clauses the
   * callback cannot see). Non-exhaustively: at most 30 disjunctions after normalization (an ANDed pair
   * of 6-value `in` filters is already 36), `in` accepts at most 30 values, at most one
   * `array-contains` **per disjunction**, and one `!=` / `not-in` **per query** — which also counts
   * `!= null` / `!= NaN`. A `not-in` anywhere in the query is incompatible with any `OR`, including a
   * `not-in` from a chained `where()` outside this callback. All surface as `INVALID_ARGUMENT`. A
   * composite query may also require a composite index.
   *
   * @param build - Callback that composes and returns the filter
   *
   * @example
   * // status == 'published' OR (authorId == me AND visibility == 'private')
   * const posts = await postRepo.query()
   *   .whereFilter(f =>
   *     f.or(
   *       f.where('status', '==', 'published'),
   *       f.and(f.where('authorId', '==', uid), f.where('visibility', '==', 'private')),
   *     ),
   *   )
   *   .orderBy('createdAt', 'desc')
   *   .get();
   *
   * @example
   * // Combined with a chained where(): deleted == false AND (a OR b)
   * await postRepo.query()
   *   .where('deleted', '==', false)
   *   .whereFilter(f => f.or(f.where('pinned', '==', true), f.whereId('in', featuredIds)))
   *   .get();
   *
   * @returns The query builder instance
   */
  whereFilter(build: (f: QueryFilterFactory<Omit<S, 'id'>>) => Filter): this {
    return this.applyCompositeFilter(
      build(createQueryFilterFactory<Omit<S, 'id'>>(this.allowLegacyDatastoreIds)),
    );
  }

  /**
   * Select specific fields to reduce bandwidth and improve performance.
   * Returns partial documents with only the specified fields.
   *
   * @param fields - Fields to include in the result
   *
   * @example
   * // Get only name and email for users
   * const users = await userRepo.query()
   *   .select('name', 'email')
   *   .get();
   *
   * @example
   * // Combine with where clause
   * const activeUserEmails = await userRepo.query()
   *   .where('status', '==', 'active')
   *   .select('email')
   *   .get();
   *
   * @returns The query builder instance
   */
  select(
    ...fields: (FieldPaths<Omit<S, 'id'>> | FieldPath)[]
  ): FirestoreQueryBuilder<T, W, S, FirestoreDocument<DeepPartial<T>>> {
    // Return a NEW builder rather than mutating and re-casting `this`. Mutating in place left any
    // pre-select alias of this builder statically typed for the full model while its shared runtime
    // query had a projection applied — an unsound gap. A fresh builder narrows the result type at
    // exactly the reference the projection applies to; the original builder is untouched.
    const next = new FirestoreQueryBuilder<T, W, S, FirestoreDocument<DeepPartial<T>>>(
      this.baseQuery,
      this.collectionRef,
      this.db,
      this.commitInChunks,
      this.runHooks,
      this.validateUpdate,
      // Carry the repository's id policy across the projection: without it the replacement builder
      // fell back to the `false` default, so a post-select whereId()/whereFilter(f.whereId(...)) on a
      // repository that opted into legacy Datastore ids wrongly threw InvalidDocumentIdError.
      this.allowLegacyDatastoreIds,
    );
    next.query = this.query.select(...(fields as (string | FieldPath)[]));
    next.hasOrderBy = this.hasOrderBy;
    next.hasSelect = true;
    return next;
  }

  /**
   * Filter by the native Firestore **document id** (the document name), via `FieldPath.documentId()`.
   *
   * This is the correct way to query by id — distinct from `where('id', ...)`, which would query a
   * *stored* field named `id` (not a valid field path, since `id` is repository metadata). Operands
   * are validated with the same `InvalidDocumentIdError` boundary as CRUD ids (review A7); only the
   * document-id-meaningful operators are accepted (comparison for a single id, `in`/`not-in` for an
   * id array — array-contains operators are intentionally excluded).
   *
   * @example
   * await userRepo.query().whereId('==', 'user-123').getOne();
   * await userRepo.query().whereId('in', ['a', 'b', 'c']).get();
   */
  whereId(op: '<' | '<=' | '==' | '!=' | '>=' | '>', value: string): this;
  whereId(op: 'in' | 'not-in', value: readonly string[]): this;
  whereId(op: WhereFilterOp, value: string | readonly string[]): this {
    this.query = this.query.where(
      documentIdFilter(op, value, this.allowLegacyDatastoreIds, 'reject'),
    );
    return this;
  }

  /**
   * Order by the native Firestore **document id** (the document name), via `FieldPath.documentId()` —
   * the id-aware counterpart to `orderBy(...)`. Useful as a stable tiebreaker for cursor pagination.
   *
   * ⚠️ `'desc'` cannot be a query's ONLY ordering: Firestore rejects a bare descending document-name
   * scan with `FAILED_PRECONDITION: Firestore does not support descending key scans`. Add any
   * equality `where(...)` clause or a preceding `orderBy(...)` and it works. Ascending is
   * unrestricted.
   *
   * @example
   * await userRepo.query().orderById().paginate(20);
   *
   * @example
   * // Descending needs a companion clause.
   * await userRepo.query().where('status', '==', 'active').orderById('desc').get();
   */
  orderById(direction: 'asc' | 'desc' = 'asc'): this {
    this.query = this.query.orderBy(FieldPath.documentId(), direction);
    this.hasOrderBy = true;
    return this;
  }

  /**
   * Count every document in the collection, ignoring the builder's `where` clauses.
   *
   * Named `collectionCount()` (not `totalCount()`) precisely because it counts the whole
   * collection and disregards any filters chained onto this builder — use {@link QueryBuilder.count}
   * for a query-aware count that honors the `where`/`orderBy` chain.
   *
   * @returns Total number of documents in the collection
   *
   * @example
   * // Get total user count (ignores any where clauses)
   * const total = await userRepo.query().collectionCount();
   */
  async collectionCount(): Promise<number> {
    try {
      const snapshot = await this.collectionRef.count().get();
      return snapshot.data().count;
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Update all documents matching the query.
   * Supports dot notation for nested field updates.
   *
   * @param data - Partial document data (supports dot notation)
   * @returns Number of documents updated
   *
   * @example
   * // Regular update
   * await ordersRepo.query()
   *   .where('status', '==', 'pending')
   *   .update({ status: 'shipped' });
   *
   * @example
   * // Dot notation for nested fields
   * await usersRepo.query()
   *   .where('role', '==', 'admin')
   *   .update({
   *     'settings.notifications': true,
   *     'profile.verified': true
   *   });
   *
   * @example
   * // Mixed updates
   * await ordersRepo.query()
   *   .where('category', '==', 'electronics')
   *   .update({
   *     discount: 0.1,
   *     'metadata.updated': new Date().toISOString()
   *   });
   */
  async update(data: UpdateInput<W>): Promise<number> {
    try {
      const snapshot = await this.query.get();

      if (snapshot.empty) {
        // Honor the empty-update contract even with zero matches (ADR-0014): validate + sanitize the
        // caller payload and reject if it reduces to nothing, so `{}`, all-`undefined`, and
        // schema-stripped payloads throw regardless of whether any document matched. A valid,
        // non-empty payload against a zero-match query still returns 0 (no rows to write).
        const validData = this.validateUpdate ? this.validateUpdate(data) : data;
        const sanitizedData = this.sanitizeUpdateData(validData);
        this.assertNonEmptyUpdatePayload(sanitizedData as Record<string, any>);
        return 0;
      }

      const updates = snapshot.docs.map(doc =>
        // Freeze each entry wrapper (review S3) so a hook cannot REPLACE `entry.data` (which the repo
        // bulk path silently drops) — only in-place `entry.data.field = …` mutation is honored, the
        // same contract on both surfaces. `id` is non-writable; the referenced `data` stays mutable.
        Object.freeze(
          withReadonlyId(
            { id: doc.id, data: { ...(data as Record<string, any>) } as UpdateInput<W> },
            doc.id,
          ),
        ),
      );

      // Stable pre-hook work list (review A1): each matched doc's authoritative ref + id is paired
      // with its update ENTRY before the hook runs. A beforeBulkUpdate hook may mutate an entry's
      // `data` in place (per-doc customization), but reordering/splicing/replacing the array or
      // changing an `id` cannot redirect which doc receives which data or suppress a write — the loop
      // iterates THIS list, taking the target from the snapshot and the data from the captured entry.
      const work = snapshot.docs.map((doc, index) => ({
        ref: doc.ref,
        id: doc.id,
        entry: updates[index],
      }));

      // Freeze the array the hook sees (review R2): membership/order is immutable and each entry's
      // `id` is non-writable, while `data` stays mutable (shared with `work`) so documented per-doc
      // data mutation still reaches the write.
      Object.freeze(updates);
      await this.runHooks('beforeBulkUpdate', updates);
      const actions: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];
      const writtenIds: ID[] = [];

      for (const { ref, id, entry } of work) {
        const validData = this.validateUpdate ? this.validateUpdate(entry.data) : entry.data;
        const sanitizedData = this.sanitizeUpdateData(validData);
        // Reject an empty patch (consistent with the repository update surfaces). Because the same
        // data is applied to every matched doc, this is uniform across the result set.
        this.assertNonEmptyUpdatePayload(sanitizedData as Record<string, any>);
        actions.push(batch => batch.update(ref, sanitizedData as any));
        writtenIds.push(id);
      }

      await this.commitInChunks(actions);
      // Freeze the whole envelope (review R2): a first hook cannot reassign `ids` to a forged array
      // that a second hook would then observe.
      await this.runHooks(
        'afterBulkUpdate',
        Object.freeze({ ids: Object.freeze([...writtenIds]) }),
      );
      return writtenIds.length;
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        throw new ValidationError(error.issues);
      }
      throw parseFirestoreError(error);
    }
  }

  /**
   * Permanently delete all documents matching the query.
   * This is a hard delete - documents cannot be recovered.
   *
   * @returns Number of documents deleted
   *
   * @example
   * // Delete all cancelled orders older than 30 days
   * const deletedCount = await orderRepo.query()
   *   .where('status', '==', 'cancelled')
   *   .where('createdAt', '<', thirtyDaysAgo)
   *   .delete();
   *
   * @example
   * // Delete all test users
   * await userRepo.query()
   *   .where('email', 'array-contains', '@test.com')
   *   .delete();
   */
  async delete(): Promise<number> {
    // Destructive-after-projection guard (review D2): a projected query only materializes the
    // selected fields, so the delete hooks would observe incomplete documents. Reject locally.
    if (this.hasSelect) {
      throw new Error(
        'delete() is not supported after select(): a projected query would pass incomplete ' +
          'documents to the beforeBulkDelete/afterBulkDelete hooks. Call delete() on an unprojected ' +
          'query.',
      );
    }
    try {
      const snapshot = await this.query.get();
      if (snapshot.empty) return 0;

      // Delete targets come from the snapshot refs (never from hook-observed data). The event arrays
      // are frozen (each document frozen too) so a hook cannot splice/reorder/repoint them, and the
      // count comes from the snapshot; before/after get separate frozen event objects (review A1).
      const deleteRefs = snapshot.docs.map(doc => doc.ref);
      const capturedIds = Object.freeze(snapshot.docs.map(doc => doc.id));
      // deepFreeze (not shallow) so a beforeBulkDelete hook cannot mutate NESTED document data that a
      // later afterBulkDelete hook observes (review R2). Delete documents are observe-only.
      const docsData = Object.freeze(
        snapshot.docs.map(doc => deepFreeze({ ...(doc.data() as T), id: doc.id })),
      ) as readonly FirestoreDocument<T>[];
      const deletedCount = snapshot.size;

      await this.runHooks(
        'beforeBulkDelete',
        Object.freeze({ ids: capturedIds, documents: docsData }),
      );

      const actions = deleteRefs.map(
        ref => (batch: FirebaseFirestore.WriteBatch) => batch.delete(ref),
      );

      await this.commitInChunks(actions);
      await this.runHooks(
        'afterBulkDelete',
        Object.freeze({ ids: capturedIds, documents: docsData }),
      );
      return deletedCount;
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }
}

/**
 * Returns the underlying Firestore Query for package-internal composition.
 * Used by the vector search extension (`@reggieofarrell/firestore-orm/vector`).
 */
export function getQueryRef(builder: FirestoreQueryBuilder<any, any, any, any>): Query<any> {
  return builder.getUnderlyingQuery();
}
