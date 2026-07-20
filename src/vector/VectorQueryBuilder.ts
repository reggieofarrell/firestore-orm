import { parseFirestoreError } from '../core/ErrorParser.js';
import { FirestoreQueryBuilder, getQueryRef } from '../core/QueryBuilder.js';
import { ID } from '../core/FirestoreRepository.js';
import { DeepPartial, FieldPaths } from '../utils/pathTypes.js';
import { FieldPath, QueryDocumentSnapshot, WhereFilterOp } from 'firebase-admin/firestore';
import {
  assertVectorSearchSupported,
  DistanceFieldResult,
  FindNearestOptions,
  validateFindNearestOptions,
} from './VectorSearch.js';

/**
 * Minimal vector query surface used because firebase-admin does not re-export VectorQuery.
 */
type FirestoreVectorQuery<T> = {
  get(): Promise<{
    docs: Array<QueryDocumentSnapshot<T>>;
  }>;
};

/**
 * Query builder extension that adds Firestore KNN vector similarity search.
 * Wraps the core {@link FirestoreQueryBuilder} and delegates standard filters
 * until `findNearest()` transitions the query into vector mode.
 */
export class VectorQueryBuilder<T extends { id?: string }, R = T & { id: ID }> {
  private vectorQuery: FirestoreVectorQuery<T> | null = null;
  // Whether select() has been called. Tracked explicitly (not via selectedFields.length) so an
  // ID-only projection — select() with zero fields — still counts as an active projection.
  private projectionActive = false;
  // Fields passed to select(), retained so findNearest() can re-apply the mask including the
  // computed distanceResultField (a field mask otherwise drops the computed distance).
  private selectedFields: (FieldPaths<T> | FieldPath)[] = [];

  // Accepts a core builder with any write model `W` / result shape `R`; vector queries do not expose
  // update(). Non-readonly because select() reassigns it (core select() is immutable — see select()).
  constructor(private coreBuilder: FirestoreQueryBuilder<T, any, any>) {}

  /**
   * Throws when vector mode is active and a standard query mutator is invoked.
   */
  private assertNotVectorMode(methodName: string): void {
    if (this.vectorQuery) {
      throw new Error(
        `${methodName}() cannot be called after findNearest(). ` +
          'Vector queries do not support standard query chaining beyond select().',
      );
    }
  }

  /**
   * Throws for operations Firestore does not support on vector queries.
   */
  private rejectInVectorMode(methodName: string): never {
    throw new Error(
      `${methodName}() is not supported on vector queries. ` +
        'Firestore vector search does not support this operation.',
    );
  }

  /**
   * Add a where clause before executing a vector search pre-filter.
   */
  where(field: FieldPaths<T> | FieldPath, op: WhereFilterOp, value: unknown): this {
    this.assertNotVectorMode('where');
    this.coreBuilder.where(field, op, value);
    return this;
  }

  /**
   * Select specific fields before findNearest(). The projection narrows the result shape and
   * composes through findNearest() (fields projected away become compile errors when accessed).
   *
   * Do NOT list `distanceResultField` here — it is a computed output field appended by
   * findNearest(), not a stored document field, and it is added to the result type automatically
   * when you configure it on findNearest().
   */
  select(
    ...fields: (FieldPaths<T> | FieldPath)[]
  ): VectorQueryBuilder<T, DeepPartial<T> & { id: ID }> {
    if (this.vectorQuery) {
      throw new Error('select() cannot be called after findNearest().');
    }
    // Immutable transition (mirrors core select()): return a NEW wrapper around the projected core
    // builder instead of mutating and re-casting `this`. Mutating in place left any pre-select vector
    // alias statically typed for the full model while its shared runtime query was projected — the
    // same unsoundness core select() was changed to remove. The retained fields let findNearest()
    // widen the mask to include the computed distance field; projectionActive is set even for an
    // ID-only (zero-field) projection.
    const next = new VectorQueryBuilder<T, DeepPartial<T> & { id: ID }>(
      this.coreBuilder.select(...fields),
    );
    next.projectionActive = true;
    next.selectedFields = fields;
    return next;
  }

  /**
   * Configure a Firestore nearest-neighbor vector search.
   */
  findNearest<K extends Extract<keyof T, string>, DF extends string | undefined = undefined>(
    options: FindNearestOptions<T, K> & { distanceResultField?: DF },
  ): VectorQueryBuilder<T, DF extends string ? DistanceFieldResult<R, DF> : R> {
    if (this.vectorQuery) {
      throw new Error('findNearest() can only be called once per query.');
    }

    validateFindNearestOptions({
      ...options,
      vectorField: String(options.vectorField),
    });

    // When a projection (select) is active and a computed distance field is configured, widen the
    // field mask to include the distance field — Firestore drops the computed distance from a
    // field-masked result unless the mask names it. Callers never name it in select() (it is not a
    // stored/schema field); we add it here so it survives the projection and appears in the result.
    // Keyed on projectionActive (not selectedFields.length) so an ID-only projection — select() with
    // zero fields — still gets the distance field it was promised (mask becomes [distanceResultField]).
    if (options.distanceResultField !== undefined && this.projectionActive) {
      this.coreBuilder = this.coreBuilder.select(
        ...this.selectedFields,
        options.distanceResultField as unknown as FieldPaths<T>,
      );
    }

    const query = getQueryRef(this.coreBuilder);
    assertVectorSearchSupported(query);

    this.vectorQuery = query.findNearest({
      vectorField: String(options.vectorField),
      queryVector: [...options.queryVector],
      limit: options.limit,
      distanceMeasure: options.distanceMeasure,
      ...(options.distanceResultField !== undefined
        ? { distanceResultField: options.distanceResultField }
        : {}),
      ...(options.distanceThreshold !== undefined
        ? { distanceThreshold: options.distanceThreshold }
        : {}),
    }) as FirestoreVectorQuery<T>;

    // Runtime is unchanged; the return type carries the configured distanceResultField into the
    // CURRENT result shape `R` (so a prior select() projection is preserved) via DistanceFieldResult:
    // a literal field REPLACES any colliding key with the numeric distance; reserved 'id' resolves to
    // never; a broad `string` degrades to a conservative shape (see DistanceFieldResult).
    return this as unknown as VectorQueryBuilder<
      T,
      DF extends string ? DistanceFieldResult<R, DF> : R
    >;
  }

  /**
   * Execute the vector query and return all matching documents.
   */
  async get(): Promise<R[]> {
    if (!this.vectorQuery) {
      throw new Error('get() on a vector query requires findNearest() to be called first.');
    }

    try {
      const snapshot = await this.vectorQuery.get();
      return snapshot.docs.map((doc: QueryDocumentSnapshot<T>) => ({
        ...(doc.data() as T),
        id: doc.id,
      })) as unknown as R[];
    } catch (error: unknown) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Return the single nearest document or null when no matches exist.
   */
  async getOne(): Promise<R | null> {
    const results = await this.get();
    return results[0] ?? null;
  }

  /**
   * Guarded — orderBy is not supported on vector query builders.
   */
  orderBy(): this {
    if (this.vectorQuery) {
      this.rejectInVectorMode('orderBy');
    }
    throw new Error(
      'orderBy() is not supported on VectorQueryBuilder. ' +
        'Apply pre-filters with where() before findNearest().',
    );
  }

  /**
   * Guarded — real-time listeners are not supported for vector queries.
   */
  async onSnapshot(): Promise<never> {
    if (this.vectorQuery) {
      this.rejectInVectorMode('onSnapshot');
    }
    this.rejectInVectorMode('onSnapshot');
  }

  /**
   * Guarded — streaming is not supported for vector queries.
   */
  stream(): never {
    if (this.vectorQuery) {
      this.rejectInVectorMode('stream');
    }
    this.rejectInVectorMode('stream');
  }
}
