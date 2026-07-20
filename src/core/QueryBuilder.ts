import { parseFirestoreError } from './ErrorParser.js';
import { HookEvent, ID } from './FirestoreRepository.js';
import { ValidationError } from './Errors.js';
import { UpdateInput } from './Validation.js';
import { DeepPartial, FieldPaths, NumericFieldPaths } from '../utils/pathTypes.js';
import {
  AggregateField,
  CollectionReference,
  FieldPath,
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

export type PaginatedResult<T extends { id?: string }> = {
  items: (T & { id: ID })[];
  nextCursor: string | null;
  hasMore: boolean;
};

/**
 * @template T - The document (read model) type
 * @template W - The write model type (for `update`)
 * @template R - The current result shape of terminal reads. Defaults to the full `T & { id }`;
 *   `select(...)` narrows it to `DeepPartial<T> & { id }` (nested map properties optional too) so
 *   fields projected away — at any depth — become compile errors when accessed (Firestore returns
 *   only the selected fields at runtime).
 */
export class FirestoreQueryBuilder<T extends { id?: string }, W = T, R = T & { id: ID }> {
  private query: Query<any>;
  private hasOrderBy = false;
  // True once select() has applied a field mask. A projected query cannot be used with onSnapshot()
  // (Firestore rejects field-masked listeners), so this is used to guard that combination locally.
  private hasSelect = false;

  constructor(
    private baseQuery: Query<any>,
    private collectionRef: CollectionReference<any>,
    private db: Firestore,
    private commitInChunks: FirestoreWriteBatch,
    private runHooks: RunHook,
    private validateUpdate?: ValidateUpdate<W>,
  ) {
    this.query = baseQuery;
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

    // Bind the cursor to THIS collection: a forged/foreign cursor pointing at a document in another
    // collection must not be dereferenced (which would let pagination probe arbitrary documents in
    // the same database, disclosing their existence via timing/error behavior).
    if (docRef.parent.path !== this.collectionRef.path) {
      throw new Error('Invalid pagination cursor for this collection.');
    }

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
  where(field: FieldPaths<T> | FieldPath, op: WhereFilterOp, value: unknown): this {
    this.query = this.query.where(field as string | FieldPath, op, value);
    return this;
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
    ...fields: (FieldPaths<T> | FieldPath)[]
  ): FirestoreQueryBuilder<T, W, DeepPartial<T> & { id: ID }> {
    // Return a NEW builder rather than mutating and re-casting `this`. Mutating in place left any
    // pre-select alias of this builder statically typed for the full model while its shared runtime
    // query had a projection applied — an unsound gap. A fresh builder narrows the result type at
    // exactly the reference the projection applies to; the original builder is untouched.
    const next = new FirestoreQueryBuilder<T, W, DeepPartial<T> & { id: ID }>(
      this.baseQuery,
      this.collectionRef,
      this.db,
      this.commitInChunks,
      this.runHooks,
      this.validateUpdate,
    );
    next.query = this.query.select(...(fields as (string | FieldPath)[]));
    next.hasOrderBy = this.hasOrderBy;
    next.hasSelect = true;
    return next;
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

      const updates = snapshot.docs.map(doc => ({
        id: doc.id,
        data: { ...(data as Record<string, any>) } as UpdateInput<W>,
      }));

      await this.runHooks('beforeBulkUpdate', updates);
      const updatesById = new Map(updates.map(update => [update.id, update.data]));
      const actions: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];
      const writtenIds: ID[] = [];

      for (const doc of snapshot.docs) {
        const updateData = updatesById.get(doc.id);
        if (!updateData) continue;

        const validData = this.validateUpdate ? this.validateUpdate(updateData) : updateData;
        const sanitizedData = this.sanitizeUpdateData(validData);
        // Reject an empty patch (consistent with the repository update surfaces). Because the same
        // data is applied to every matched doc, this is uniform across the result set.
        this.assertNonEmptyUpdatePayload(sanitizedData as Record<string, any>);
        actions.push(batch => batch.update(doc.ref, sanitizedData as any));
        writtenIds.push(doc.id);
      }

      await this.commitInChunks(actions);
      await this.runHooks('afterBulkUpdate', { ids: writtenIds });
      return writtenIds.length;
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        throw new ValidationError(error.issues);
      }
      throw parseFirestoreError(error);
    }
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
  orderBy(field: FieldPaths<T> | FieldPath, direction: 'asc' | 'desc' = 'asc'): this {
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
    try {
      const docsData: (T & { id: ID })[] = [];
      const snapshot = await this.query.get();

      if (snapshot.empty) return 0;
      for (const doc of snapshot.docs) docsData.push({ ...(doc.data() as T), id: doc.id });

      const ids = docsData.map(doc => doc.id);
      await this.runHooks('beforeBulkDelete', { ids, documents: docsData });

      const actions: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];
      for (const doc of snapshot.docs) actions.push(batch => batch.delete(doc.ref));

      await this.commitInChunks(actions);
      await this.runHooks('afterBulkDelete', { ids, documents: docsData });
      return snapshot.size;
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
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
   * Get total count of all documents in the collection.
   * Ignores any where clauses and counts directly from the base collection.
   *
   * @returns Total number of documents in the collection
   *
   * @example
   * // Get total user count
   * const total = await userRepo.query().totalCount();
   */
  async totalCount(): Promise<number> {
    try {
      const snapshot = await this.collectionRef.count().get();
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
      const items = pageDocs.map(doc => ({
        ...(doc.data() as T),
        id: doc.id,
      })) as unknown as R[];

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
      const items = snapshot.docs.map(doc => ({
        ...(doc.data() as T),
        id: doc.id,
      })) as unknown as R[];

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
    const results = await this.limit(1).get();
    return results[0] || null;
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
    const count = await this.limit(1).count();
    return count > 0;
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
  async sum(field: NumericFieldPaths<T> | FieldPath): Promise<number> {
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
   * @returns The average value for matching documents
   *
   * @example
   * // Calculate average product rating
   * const avgRating = await reviewRepo.query()
   *   .where('productId', '==', productId)
   *   .average('rating');
   */
  async average(field: NumericFieldPaths<T> | FieldPath): Promise<number> {
    try {
      const snapshot = await this.query
        .aggregate({ average: AggregateField.average(field as string | FieldPath) })
        .get();

      // Firestore can return null when no matching numeric values exist.
      // Normalize to 0 to preserve expected numeric behavior for callers.
      return snapshot.data().average ?? 0;
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
  async distinctValues<K extends keyof T>(field: K): Promise<T[K][]> {
    try {
      const snapshot = await this.query.get();
      const values = snapshot.docs.map(doc => doc.data()[field as string]);
      return [...new Set(values)].filter(val => val != undefined) as T[K][];
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
        yield { ...(doc.data() as T), id: doc.id } as unknown as R;
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
          const items = snapshot.docs.map(doc => ({
            ...(doc.data() as T),
            id: doc.id,
          })) as unknown as R[];
          callback(items);
        },
        error => {
          if (onError) onError(error);
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
      return snapshot.docs.map(doc => ({ ...(doc.data() as T), id: doc.id })) as unknown as R[];
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }
}

/**
 * Returns the underlying Firestore Query for package-internal composition.
 * Used by the vector search extension (`@reggieofarrell/firestore-orm/vector`).
 */
export function getQueryRef<T extends { id?: string }, W = T>(
  builder: FirestoreQueryBuilder<T, W>,
): Query<any> {
  return builder.getUnderlyingQuery();
}
