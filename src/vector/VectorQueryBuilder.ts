import { parseFirestoreError } from '../core/ErrorParser.js';
import { FirestoreQueryBuilder, getQueryRef } from '../core/QueryBuilder.js';
import { ID } from '../core/FirestoreRepository.js';
import { FieldPaths } from '../utils/pathTypes.js';
import { FieldPath, QueryDocumentSnapshot, WhereFilterOp } from 'firebase-admin/firestore';
import {
  assertVectorSearchSupported,
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

  // Accepts a core builder with any write model `W`; vector queries do not expose update().
  constructor(private readonly coreBuilder: FirestoreQueryBuilder<T, any>) {}

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
   * Select specific fields before findNearest().
   * When using distanceResultField, include that field name in select().
   */
  select(...fields: (FieldPaths<T> | FieldPath)[]): VectorQueryBuilder<T, Partial<T> & { id: ID }> {
    if (this.vectorQuery) {
      throw new Error('select() cannot be called after findNearest().');
    }
    this.coreBuilder.select(...fields);
    // Runtime is unchanged; the return type narrows the result shape (fields projected away become
    // compile errors when accessed).
    return this as unknown as VectorQueryBuilder<T, Partial<T> & { id: ID }>;
  }

  /**
   * Configure a Firestore nearest-neighbor vector search.
   */
  findNearest<K extends Extract<keyof T, string>>(options: FindNearestOptions<T, K>): this {
    if (this.vectorQuery) {
      throw new Error('findNearest() can only be called once per query.');
    }

    validateFindNearestOptions({
      ...options,
      vectorField: String(options.vectorField),
    });

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

    return this;
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
