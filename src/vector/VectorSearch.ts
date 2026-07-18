import { FieldValue, Query } from 'firebase-admin/firestore';
import { ID } from '../core/FirestoreRepository.js';

/**
 * Supported Firestore vector distance measures for KNN similarity search.
 */
export const VectorDistanceMeasure = {
  EUCLIDEAN: 'EUCLIDEAN',
  COSINE: 'COSINE',
  DOT_PRODUCT: 'DOT_PRODUCT',
} as const;

export type VectorDistanceMeasureValue =
  (typeof VectorDistanceMeasure)[keyof typeof VectorDistanceMeasure];

/** Maximum embedding dimension Firestore supports per vector index. */
export const VECTOR_MAX_DIMENSIONS = 2048;

/** Maximum number of documents a single nearest-neighbor query may return. */
export const VECTOR_MAX_LIMIT = 1000;

/**
 * Options for a Firestore KNN vector similarity search.
 */
export type FindNearestOptions<
  T,
  K extends Extract<keyof T, string> = Extract<keyof T, string>,
> = Readonly<{
  /**
   * Top-level document field containing the stored vector embedding. Firestore vector indexes are
   * defined on top-level fields, so this is constrained to `T`'s own string keys; use a cast for a
   * nested or unschematized field.
   */
  vectorField: K;
  /** Query embedding used to rank nearest neighbors. */
  queryVector: ReadonlyArray<number>;
  /** Maximum documents to return (1–1000). */
  limit: number;
  /** Distance measure used by Firestore for ranking. */
  distanceMeasure: VectorDistanceMeasureValue;
  /**
   * Optional result field name where Firestore writes the computed distance per document.
   * Requires `@google-cloud/firestore` >= 7.10.0 (bundled with firebase-admin >= 13).
   */
  distanceResultField?: string;
  /**
   * Optional similarity threshold filter.
   * Requires `@google-cloud/firestore` >= 7.10.0 (bundled with firebase-admin >= 13).
   */
  distanceThreshold?: number;
}>;

/**
 * Document shape returned from vector search, optionally including a computed distance field.
 */
export type VectorSearchResult<T, DistanceField extends string | undefined = undefined> = (T & {
  id: ID;
}) &
  (DistanceField extends string ? Record<DistanceField, number> : Record<string, never>);

const VECTOR_DISTANCE_MEASURES = new Set<string>(Object.values(VectorDistanceMeasure));

/**
 * Detects a Firestore vector write value produced by `FieldValue.vector()`.
 */
export function isVectorFieldValue(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const vectorValue = value as { _values?: unknown };
  if (
    Array.isArray(vectorValue._values) &&
    vectorValue._values.length > 0 &&
    vectorValue._values.every(entry => typeof entry === 'number' && !Number.isNaN(entry))
  ) {
    return true;
  }

  if (value instanceof FieldValue) {
    const serialized = String(value.toString()).toLowerCase();
    return serialized.includes('vector');
  }

  const sentinel = value as { isEqual?: unknown; toString?: unknown };
  if (typeof sentinel.isEqual !== 'function' || typeof sentinel.toString !== 'function') {
    return false;
  }

  const serialized = String(sentinel.toString()).toLowerCase();
  return serialized.includes('vector');
}

/**
 * Validates nearest-neighbor options before delegating to the Firestore SDK.
 */
export function validateFindNearestOptions(
  options: FindNearestOptions<Record<string, unknown>>,
): void {
  if (!options || typeof options !== 'object') {
    throw new Error('findNearest() requires an options object.');
  }

  if (!options.vectorField || typeof options.vectorField !== 'string') {
    throw new Error('findNearest() requires a non-empty string vectorField.');
  }

  if (!Array.isArray(options.queryVector) || options.queryVector.length === 0) {
    throw new Error('findNearest() requires queryVector to be a non-empty number array.');
  }

  if (options.queryVector.some(value => typeof value !== 'number' || Number.isNaN(value))) {
    throw new Error('findNearest() requires queryVector to contain only finite numbers.');
  }

  if (options.queryVector.length > VECTOR_MAX_DIMENSIONS) {
    throw new Error(
      `findNearest() queryVector exceeds the maximum supported dimension of ${VECTOR_MAX_DIMENSIONS}.`,
    );
  }

  if (!Number.isInteger(options.limit) || options.limit <= 0) {
    throw new Error('findNearest() requires limit to be a positive integer.');
  }

  if (options.limit > VECTOR_MAX_LIMIT) {
    throw new Error(`findNearest() limit cannot exceed ${VECTOR_MAX_LIMIT}.`);
  }

  if (!VECTOR_DISTANCE_MEASURES.has(options.distanceMeasure)) {
    throw new Error(
      `findNearest() distanceMeasure must be one of: ${[...VECTOR_DISTANCE_MEASURES].join(', ')}.`,
    );
  }

  if (
    options.distanceResultField !== undefined &&
    typeof options.distanceResultField !== 'string'
  ) {
    throw new Error('findNearest() distanceResultField must be a string when provided.');
  }

  if (
    options.distanceThreshold !== undefined &&
    (typeof options.distanceThreshold !== 'number' || Number.isNaN(options.distanceThreshold))
  ) {
    throw new Error('findNearest() distanceThreshold must be a finite number when provided.');
  }
}

/**
 * Ensures the connected Firestore SDK exposes vector search APIs.
 */
export function assertVectorSearchSupported(query: Query<unknown>): void {
  const findNearest = (query as Query<unknown> & { findNearest?: unknown }).findNearest;
  if (typeof findNearest !== 'function') {
    throw new Error(
      'Vector search is not available in the installed firebase-admin SDK. ' +
        'Upgrade to firebase-admin >= 12 (basic findNearest) or >= 13 ' +
        '(distanceResultField and distanceThreshold).',
    );
  }
}
