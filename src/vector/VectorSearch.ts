import { FieldValue, Query } from 'firebase-admin/firestore';
import { ID } from '../core/FirestoreRepository.js';
import { hasFiniteVectorValues, hasVectorValuesShape } from '../utils/vectorValue.js';

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
 * Result shape when a computed distance field named `DF` is added to a base result `R`.
 *
 * - **Literal `DF`** (e.g. `'score'`): the distance **replaces** any colliding key
 *   (`Omit<R, DF> & Record<DF, number>`) — matching Firestore's runtime overwrite — rather than
 *   intersecting (which would collapse a collision to `never`).
 * - **Literal `'id'`** (reserved; rejected at runtime): resolves to `never` so the type cannot
 *   describe a result the runtime validator forbids.
 * - **Broad `string`** (a non-literal field name, e.g. from a variable): conservative — `id` keeps
 *   its ID type (a successful call can never use the rejected `'id'`), every other known field is
 *   `R[K] | number` (the runtime name may collide with any one), and arbitrary keys are `unknown`.
 *   It never promises that all known fields became numbers. Pass a string **literal** for precise
 *   per-field typing.
 */
export type DistanceFieldResult<R, DF extends string> = string extends DF
  ? { [K in keyof R]: K extends 'id' ? R[K] : R[K] | number } & Record<string, unknown>
  : 'id' extends DF
    ? never
    : Omit<R, DF> & Record<DF, number>;

/**
 * Document shape returned from vector search, optionally including a computed distance field. See
 * {@link DistanceFieldResult} for the collision/reserved-`id`/broad-`string` rules.
 */
export type VectorSearchResult<
  T,
  DistanceField extends string | undefined = undefined,
> = DistanceField extends string
  ? DistanceFieldResult<T & { id: ID }, DistanceField>
  : T & { id: ID };

const VECTOR_DISTANCE_MEASURES = new Set<string>(Object.values(VectorDistanceMeasure));

/**
 * Detects a Firestore vector write value produced by `FieldValue.vector()`.
 */
export function isVectorFieldValue(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  // A value carrying a `VectorValue`-shaped `_values` array is judged SOLELY on that array: it is a
  // valid vector sentinel only when every component is a finite number. This is terminal — a
  // shaped-but-invalid vector (e.g. containing Infinity) must be rejected here, not fall through to
  // the looser `instanceof FieldValue` / `toString` heuristics below (which would wrongly accept it).
  if (hasVectorValuesShape(value)) {
    return hasFiniteVectorValues(value);
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

  if (typeof options.vectorField !== 'string' || options.vectorField.trim() === '') {
    throw new Error('findNearest() requires a non-empty string vectorField.');
  }

  if (!Array.isArray(options.queryVector) || options.queryVector.length === 0) {
    throw new Error('findNearest() requires queryVector to be a non-empty number array.');
  }

  if (options.queryVector.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
    // Number.isFinite rejects NaN AND +/-Infinity (Number.isNaN would let infinities through).
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
    (typeof options.distanceResultField !== 'string' || options.distanceResultField.trim() === '')
  ) {
    throw new Error('findNearest() distanceResultField must be a non-empty string when provided.');
  }

  // `id` is reserved: the repository overlays `{ id: doc.id }` on every result, which would overwrite
  // the computed distance with the string document id (losing the distance entirely). Reject it so
  // the promised numeric distance field cannot silently disappear.
  if (options.distanceResultField?.trim() === 'id') {
    throw new Error(
      'findNearest() distanceResultField cannot be "id": the repository overlays the document id on ' +
        'every result, which would overwrite the computed distance. Use a different field name.',
    );
  }

  if (options.distanceThreshold !== undefined) {
    if (
      typeof options.distanceThreshold !== 'number' ||
      !Number.isFinite(options.distanceThreshold)
    ) {
      // Number.isFinite rejects NaN AND +/-Infinity.
      throw new Error('findNearest() distanceThreshold must be a finite number when provided.');
    }

    // Reject 0: the installed @google-cloud/firestore serializer drops a zero distanceThreshold via a
    // truthiness check (`threshold ? { value } : undefined`), so it would be silently omitted from
    // the query and broaden the result to all nearest neighbors instead of applying the bound. Fail
    // loudly rather than change the query behind the caller's back.
    if (options.distanceThreshold === 0) {
      throw new Error(
        'findNearest() distanceThreshold cannot be 0: the installed Firestore SDK serializer drops a ' +
          'zero threshold, which would silently broaden the query to all nearest neighbors. Use a ' +
          'small positive epsilon for a near-exact match, or omit distanceThreshold.',
      );
    }

    // EUCLIDEAN and COSINE distances are non-negative, so a negative threshold is meaningless and
    // would match nothing (or behave unpredictably). Negative thresholds are only meaningful for
    // DOT_PRODUCT, where the similarity score can be negative.
    if (
      (options.distanceMeasure === VectorDistanceMeasure.EUCLIDEAN ||
        options.distanceMeasure === VectorDistanceMeasure.COSINE) &&
      options.distanceThreshold < 0
    ) {
      throw new Error(
        `findNearest() distanceThreshold cannot be negative for ${options.distanceMeasure} ` +
          '(distances are non-negative). Negative thresholds are only meaningful for DOT_PRODUCT.',
      );
    }
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
