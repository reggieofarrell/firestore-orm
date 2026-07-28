/**
 * Collection-group queries: reading every collection that shares an id, at any depth.
 *
 * A collection group is **not** a collection. `Firestore.collectionGroup(id)` returns a `Query`, not
 * a `CollectionReference` — there is no `.doc(id)`, no `.add()`, and no single parent — so this
 * module deliberately exposes a **read-only** surface rather than a second `FirestoreRepository`.
 *
 * The identity consequence drives the whole design: document ids are unique only within one
 * collection, so `users/u1/posts/p1` and `users/u2/posts/p1` are two different documents that both
 * report `id: 'p1'`. Results are therefore {@link CollectionGroupDocument}s carrying the full `path`
 * and the containing `parentPath`. See ADR-0024.
 */
import {
  CollectionGroup,
  DocumentReference,
  FieldPath,
  Filter,
  Firestore,
  Query,
  QueryDocumentSnapshot,
  WhereFilterOp,
} from 'firebase-admin/firestore';
import type { CollectionGroupDocument } from './DocumentId.js';
import type { ReadConverter } from './FirestoreRepository.js';
import {
  createFilterFactoryCore,
  FirestoreQueryBuilderBase,
  type CompositeFilterHints,
  type QueryFilterFactoryBase,
} from './QueryBuilder.js';
import { parseFirestoreError } from './ErrorParser.js';
import { validateDocumentPath } from '../utils/documentId.js';
import type { DeepPartial, FieldPaths, OmitId } from '../utils/pathTypes.js';

const GROUP_FILTER_HINTS: CompositeFilterHints = {
  factoryMethods: 'f.where / f.wherePath / f.and / f.or',
  scope: 'the collection group',
};

/**
 * Builds a validated document-name (`FieldPath.documentId()`) filter for a **collection group**.
 *
 * The collection-group counterpart of the collection's leaf-id filter: Firestore compares
 * `documentId()` against the document's FULL resource path here, so the operand is a path
 * (`users/u1/posts/p1`) or an already-resolved `DocumentReference`. A bare id is rejected by the
 * Admin SDK itself ("must result in a valid document path … odd number of segments"), and the
 * per-segment checks are the same server-side boundary the leaf-id gate provides — a `..` or
 * reserved `__…__` segment inside the path otherwise reaches Firestore and fails as
 * `INVALID_ARGUMENT`.
 *
 * Validation is applied **per operand**, not to the array as a whole, so a mixed
 * `['users/u1/posts/p1', someDocRef]` still has its string operand checked.
 *
 * @param references - `'reject'` for {@link FirestoreCollectionGroupQueryBuilder.wherePath}, whose
 *   signature promises a path string or a `DocumentReference`, so any other operand is a contract
 *   violation and gets the `InvalidDocumentIdError` boundary. `'allow'` for
 *   `where(FieldPath.documentId(), …)`, whose operand type is `unknown`, so non-string operands pass
 *   through while string operands are still validated.
 */
function documentPathFilter(
  op: WhereFilterOp,
  value: unknown,
  allowLegacyDatastoreIds: boolean,
  references: 'allow' | 'reject',
): Filter {
  const operands = Array.isArray(value) ? value : [value];
  for (const operand of operands) {
    // An already-resolved DocumentReference carries a real, in-database path — there is no untrusted
    // string to parse, and it is the operand form that cannot be malformed.
    if (operand instanceof DocumentReference) continue;
    if (references === 'allow' && typeof operand !== 'string') continue;
    validateDocumentPath(operand, 'wherePath value', { allowLegacyDatastoreIds });
  }
  return Filter.where(FieldPath.documentId(), op, value);
}

/**
 * Schema-aware factory for composite filters on a **collection group**, handed to the callback of
 * {@link FirestoreCollectionGroupQueryBuilder.whereFilter}.
 *
 * Identical to {@link QueryFilterFactory} except for the document-name helper: a collection group
 * matches on the full document path, so this exposes `wherePath(...)` rather than `whereId(...)`.
 * Offering `whereId` here would be actively wrong — the Admin SDK rejects a bare id operand on a
 * collection-group query.
 *
 * @example
 * const posts = await postGroup.query()
 *   .whereFilter(f =>
 *     f.or(f.where('status', '==', 'published'), f.wherePath('==', 'users/u1/posts/p1')),
 *   )
 *   .get();
 *
 * @template S - see {@link QueryFilterFactoryBase} for why this is invariant (`in out`).
 */
export interface CollectionGroupFilterFactory<
  in out S extends object,
> extends QueryFilterFactoryBase<S> {
  /**
   * A document-name condition via `FieldPath.documentId()` — the composite-filter counterpart of
   * {@link FirestoreCollectionGroupQueryBuilder.wherePath}, with the same `InvalidDocumentIdError`
   * boundary and the same operator restrictions (array-contains operators are intentionally
   * excluded). Operands are FULL document paths or `DocumentReference`s, not bare ids.
   */
  wherePath(op: '<' | '<=' | '==' | '!=' | '>=' | '>', value: string | DocumentReference): Filter;
  wherePath(op: 'in' | 'not-in', value: readonly (string | DocumentReference)[]): Filter;
}

/**
 * Creates the {@link CollectionGroupFilterFactory} for one `whereFilter()` call, bound to the
 * builder's `allowLegacyDatastoreIds` setting so `f.wherePath(...)` honors the repository's id
 * policy on the document segments of the path.
 */
function createCollectionGroupFilterFactory<S extends object>(
  allowLegacyDatastoreIds: boolean,
): CollectionGroupFilterFactory<S> {
  const nameFilter = (op: WhereFilterOp, value: unknown, references: 'allow' | 'reject'): Filter =>
    documentPathFilter(op, value, allowLegacyDatastoreIds, references);
  return {
    ...createFilterFactoryCore<S>(nameFilter, GROUP_FILTER_HINTS.scope),
    wherePath: (
      op: WhereFilterOp,
      value: string | DocumentReference | readonly (string | DocumentReference)[],
    ) => nameFilter(op, value, 'reject'),
  };
}

/**
 * Read-only query builder for a Firestore **collection group** — every collection with the same id,
 * at any depth (including a same-named root collection).
 *
 * Shares the whole read surface with {@link FirestoreQueryBuilder} via
 * {@link FirestoreQueryBuilderBase}. What differs:
 *
 * - **Results carry full-path identity** ({@link CollectionGroupDocument}): `id` alone is ambiguous
 *   across a group, so every row also carries `path` and `parentPath`.
 * - **`wherePath` / `orderByPath` replace `whereId` / `orderById`** — Firestore compares
 *   `documentId()` against the full document path in a group query.
 * - **`groupCount()` replaces `collectionCount()`** — the unfiltered count spans the whole group.
 * - **No `update()` / `delete()`.** They are absent from the type, not present and throwing: the
 *   bulk hooks they run are keyed by `id` (`{ ids }`, `{ ids, documents }`), which is not unique
 *   across a group, so every registered hook would observe ambiguous identity. Use the Admin SDK
 *   directly for group-wide writes — see the Scope & Capabilities guide.
 *
 * **Indexes.** Firestore's automatic single-field indexes are *collection*-scoped. A
 * collection-group query that filters or orders on a field needs an explicitly created
 * **collection-group-scoped** index in production even for a single `where(...)`; the emulator does
 * not enforce this, so a query that passes locally can fail deployed with `FirestoreIndexError`.
 *
 * @template T - **read data** (no `id`); terminal reads return {@link CollectionGroupDocument}`<T>`.
 * @template S - **stored data** — the source of query FIELD PATHS. Defaults to `T`.
 * @template R - the current result shape of terminal reads. Defaults to
 *   `CollectionGroupDocument<T>`; `select(...)` narrows it to
 *   `CollectionGroupDocument<DeepPartial<T>>`.
 */
export class FirestoreCollectionGroupQueryBuilder<
  T extends object,
  S extends object = T,
  R = CollectionGroupDocument<T>,
> extends FirestoreQueryBuilderBase<T, S, R> {
  /**
   * Constructed by `FirestoreCollectionGroup.query()`; not intended to be instantiated directly.
   *
   * @param groupQuery - The unfiltered group query (converter-applied when the repository has a
   *   `readConverter`). Retained by the base as `baseQuery` and used by {@link groupCount}.
   * @param collectionIdValue - The group's collection id, used to bind pagination cursors.
   */
  constructor(
    groupQuery: Query<any>,
    private readonly collectionIdValue: string,
    db: Firestore,
    allowLegacyDatastoreIds = false,
  ) {
    super(groupQuery, db, allowLegacyDatastoreIds);
  }

  /**
   * A group read result is the document data plus **full-path** identity. `id` is kept for
   * continuity with single-collection reads, but `path` is the identity that is actually unique
   * here. Identity is overlaid after the data, so a same-named stored field is shadowed — see
   * {@link CollectionGroupDocument}.
   */
  protected toResult(doc: QueryDocumentSnapshot<any>): R {
    return {
      ...(doc.data() as T),
      id: doc.id,
      path: doc.ref.path,
      parentPath: doc.ref.parent.path,
    } as unknown as R;
  }

  /**
   * Binds a cursor to THIS collection group. Membership is by collection id, not by an exact parent
   * path — the whole point of a group is that its documents live under many different parents.
   *
   * Typed `startAfter(foreignSnapshot)` on a group is **not** membership-rejected: the SDK uses the
   * snapshot's `orderBy` field values as the cursor (which may yield empty or a suffix). Opaque
   * `paginate` cursors still re-fetch by path, so this membership check remains the forged-token
   * gate for path-only pagination tokens.
   */
  protected assertCursorBelongsToSource(docRef: DocumentReference): void {
    if (docRef.parent.id !== this.collectionIdValue) {
      throw new Error('Invalid pagination cursor for this collection group.');
    }
  }

  /** In a collection group, the document name is the full document path. */
  protected documentNameFilter(
    op: WhereFilterOp,
    value: unknown,
    references: 'allow' | 'reject',
  ): Filter {
    return documentPathFilter(op, value, this.allowLegacyDatastoreIds, references);
  }

  protected get compositeFilterHints(): CompositeFilterHints {
    return GROUP_FILTER_HINTS;
  }

  /**
   * Filter by the native Firestore **document name**, which in a collection-group query is the
   * document's FULL path — the group counterpart of `whereId(...)`.
   *
   * Ids are not unique across a group, so a bare id is meaningless here and the Admin SDK rejects
   * it. Pass a full document path (`'users/u1/posts/p1'`) or a `DocumentReference`. String operands
   * clear the same `InvalidDocumentIdError` boundary as every other id/path the ORM accepts, applied
   * to each segment.
   *
   * A path that is well-formed but does not belong to this group simply matches nothing — Firestore
   * reports no error for it.
   *
   * @example
   * await postGroup.query().wherePath('==', 'users/u1/posts/p1').getOne();
   * await postGroup.query().wherePath('in', [db.doc('users/u1/posts/p1')]).get();
   */
  wherePath(op: '<' | '<=' | '==' | '!=' | '>=' | '>', value: string | DocumentReference): this;
  wherePath(op: 'in' | 'not-in', value: readonly (string | DocumentReference)[]): this;
  wherePath(
    op: WhereFilterOp,
    value: string | DocumentReference | readonly (string | DocumentReference)[],
  ): this {
    this.query = this.query.where(
      documentPathFilter(op, value, this.allowLegacyDatastoreIds, 'reject'),
    );
    return this;
  }

  /**
   * Order by the native Firestore **document name** — in a collection group, the full document
   * path. The group counterpart of `orderById(...)`, and a stable tiebreaker for cursor pagination.
   *
   * Ordering is lexicographic over the full path, so results group by parent as a side effect.
   *
   * ⚠️ `'desc'` cannot be a query's ONLY ordering: Firestore rejects a bare descending document-name
   * scan with `FAILED_PRECONDITION: Firestore does not support descending key scans`. Add any
   * equality `where(...)` clause or a preceding `orderBy(...)` and it works. Ascending is
   * unrestricted. (Not group-specific — `orderById('desc')` behaves the same way.)
   *
   * @example
   * await postGroup.query().orderByPath().paginate(20);
   */
  orderByPath(direction: 'asc' | 'desc' = 'asc'): this {
    this.query = this.query.orderBy(FieldPath.documentId(), direction);
    this.hasOrderBy = true;
    return this;
  }

  /**
   * Add a **composite** (nested `AND` / `OR`) filter — the group counterpart of
   * {@link FirestoreQueryBuilder.whereFilter}, with all the same semantics and caveats.
   *
   * The callback receives a {@link CollectionGroupFilterFactory}, which exposes `f.wherePath(...)`
   * instead of `f.whereId(...)` because a group matches on the full document path.
   *
   * ⚠️ Inherits the inequality caveat: an inequality (`<`, `<=`, `>`, `>=`, `!=`) inside an `or()`
   * branch excludes documents that are missing that field, including documents matched by a
   * *different* branch, because Firestore adds an implicit `orderBy` for every inequality field in
   * the flattened filter tree. Prefer equality / `in` / `array-contains` branches. Server-side
   * limits (30 disjunctions after normalization, one `!=` / `not-in` per query, `not-in`
   * incompatible with any `OR`, …) apply unchanged and surface as `INVALID_ARGUMENT`.
   *
   * @example
   * const posts = await postGroup.query()
   *   .whereFilter(f => f.or(f.where('status', '==', 'published'), f.where('pinned', '==', true)))
   *   .get();
   */
  whereFilter(build: (f: CollectionGroupFilterFactory<OmitId<S>>) => Filter): this {
    return this.applyCompositeFilter(
      build(createCollectionGroupFilterFactory<OmitId<S>>(this.allowLegacyDatastoreIds)),
    );
  }

  /**
   * Project only the given fields. Mirrors {@link FirestoreQueryBuilder.select}: returns a **new**
   * builder (the original is untouched) whose terminal reads are typed
   * `CollectionGroupDocument<DeepPartial<T>>`, so a field projected away at any depth is a compile
   * error to access without a guard.
   *
   * Path identity survives a projection — `path` / `parentPath` come from the snapshot reference,
   * not from the field mask.
   */
  select(
    ...fields: (FieldPaths<OmitId<S>> | FieldPath)[]
  ): FirestoreCollectionGroupQueryBuilder<T, S, CollectionGroupDocument<DeepPartial<T>>> {
    const next = new FirestoreCollectionGroupQueryBuilder<
      T,
      S,
      CollectionGroupDocument<DeepPartial<T>>
    >(this.baseQuery, this.collectionIdValue, this.db, this.allowLegacyDatastoreIds);
    next.query = this.query.select(...(fields as (string | FieldPath)[]));
    next.hasOrderBy = this.hasOrderBy;
    // Carry limitToLast across the projection — same silent-drop hazard as the collection builder.
    next.hasLimitToLast = this.hasLimitToLast;
    next.hasSelect = true;
    return next;
  }

  /**
   * Count every document in the collection **group**, ignoring this builder's `where` clauses — the
   * group counterpart of `collectionCount()`. Use `count()` for the query-aware count.
   *
   * Named for what it actually spans: this counts documents in every collection with this id, at
   * every depth, including a same-named root collection.
   */
  async groupCount(): Promise<number> {
    try {
      const snapshot = await this.baseQuery.count().get();
      return snapshot.data().count;
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }
}

/**
 * A handle on one Firestore **collection group**, obtained from
 * `FirestoreRepository.collectionGroup()`. It carries the originating repository's read model,
 * stored (query-path) model, `readConverter`, and `allowLegacyDatastoreIds` policy, so a group query
 * is typed and validated exactly like a query on the repository's own collection.
 *
 * The handle is stateless and reusable; {@link query} returns a fresh builder each call, exactly as
 * `repo.query()` does.
 *
 * @example
 * // Every `posts` subcollection, across every user.
 * const postGroup = userRepo.subcollection('u1', 'posts', postSchema).collectionGroup();
 *
 * const published = await postGroup
 *   .query()
 *   .where('status', '==', 'published')
 *   .orderBy('createdAt', 'desc')
 *   .limit(20)
 *   .get();
 *
 * published[0].path; // 'users/u7/posts/abc' — the identity that is unique here
 *
 * @template T - **read data** (no `id`).
 * @template S - **stored data** — the source of query field paths.
 */
export class FirestoreCollectionGroup<T extends object, S extends object = T> {
  /**
   * Constructed by `FirestoreRepository.collectionGroup()`; not intended to be instantiated
   * directly.
   *
   * @param group - The collection group, already converter-applied when the repository has a
   *   `readConverter`.
   */
  constructor(
    private readonly group: CollectionGroup<any>,
    private readonly collectionIdValue: string,
    private readonly db: Firestore,
    private readonly readConverter: ReadConverter<T> | undefined,
    private readonly allowLegacyDatastoreIds: boolean,
  ) {}

  /**
   * The collection id this group spans — the last segment of the originating repository's
   * collection path.
   */
  get collectionId(): string {
    return this.collectionIdValue;
  }

  /**
   * Create a read-only query builder over the group. Returns a fresh builder each call.
   */
  query(): FirestoreCollectionGroupQueryBuilder<T, S> {
    return new FirestoreCollectionGroupQueryBuilder<T, S>(
      this.group,
      this.collectionIdValue,
      this.db,
      this.allowLegacyDatastoreIds,
    );
  }

  /**
   * Reconstruct a group-typed document from a raw Firestore snapshot — the collection-group
   * counterpart of `FirestoreRepository.fromSnapshot()`, and the way back into the read model from
   * the raw Admin SDK.
   *
   * Most useful for a Firestore trigger on a wildcard path (`users/{uid}/posts/{postId}`), where the
   * leaf id alone does not identify the document. Applies the repository's `readConverter` when one
   * is configured, then overlays full-path identity from `snapshot.ref`. Does no Firestore I/O and
   * returns `null` when the snapshot does not exist.
   *
   * **The snapshot must belong to this group** — its containing collection id must match. A snapshot
   * from anywhere else would otherwise be reshaped into a perfectly well-typed
   * `CollectionGroupDocument` carrying that outsider's `path`, which is precisely the
   * membership/identity mistake this API exists to prevent (a trigger wired to the wrong path would
   * look correct and silently lie). This is the same boundary
   * {@link FirestoreCollectionGroupQueryBuilder.assertCursorBelongsToSource} applies to pagination
   * cursors, and it costs one comparison — no I/O.
   *
   * @throws {Error} If the snapshot's collection id is not this group's.
   *
   * @example
   * export const onPostWritten = onDocumentCreated('users/{uid}/posts/{postId}', event => {
   *   const post = event.data && postGroup.fromSnapshot(event.data);
   *   if (!post) return;
   *   console.log(post.path); // 'users/u1/posts/p1'
   * });
   */
  fromSnapshot(snapshot: FirebaseFirestore.DocumentSnapshot): CollectionGroupDocument<T> | null {
    if (!snapshot.exists) return null;
    if (snapshot.ref.parent.id !== this.collectionIdValue) {
      throw new Error(
        `fromSnapshot() received a snapshot from "${snapshot.ref.parent.id}", which is not part of ` +
          `the "${this.collectionIdValue}" collection group. A collection-group document is ` +
          'identified by its full path, so reshaping an out-of-group snapshot would produce a ' +
          'well-typed result carrying the wrong identity. Check the trigger/query path, or use the ' +
          "owning repository's fromSnapshot().",
      );
    }
    const data = this.readConverter
      ? this.readConverter(snapshot as FirebaseFirestore.QueryDocumentSnapshot)
      : (snapshot.data() as T);
    // Double cast because `CollectionGroupDocument` is a DISTRIBUTIVE conditional over `T` (see its
    // docs), which TypeScript cannot relate to a concrete object literal under an unresolved `T`.
    // The overlay order below is the contract: identity is written last and wins.
    return {
      ...(data as T),
      id: snapshot.id,
      path: snapshot.ref.path,
      parentPath: snapshot.ref.parent.path,
    } as unknown as CollectionGroupDocument<T>;
  }
}
