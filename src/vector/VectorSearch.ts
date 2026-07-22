import { FieldValue, Query } from 'firebase-admin/firestore';
import { FirestoreDocument } from '../core/DocumentId.js';
import { areFiniteVectorComponents, genuineVectorComponents } from '../utils/vectorValue.js';

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
   *
   * Prefer a string **literal** for precise result typing (see {@link DistanceFieldResult}): a
   * literal is added as a numeric property and replaces any colliding model field. `'id'` is
   * rejected (the repository overlays the document id, which would overwrite the distance). A
   * non-literal `string` yields a conservative result type rather than typing every field as number.
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
  T extends object,
  DistanceField extends string | undefined = undefined,
> = DistanceField extends string
  ? DistanceFieldResult<FirestoreDocument<T>, DistanceField>
  : FirestoreDocument<T>;

const VECTOR_DISTANCE_MEASURES = new Set<string>(Object.values(VectorDistanceMeasure));

/**
 * Detects a Firestore vector write value produced by `FieldValue.vector()`.
 */
export function isVectorFieldValue(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  // Only a GENUINE VectorValue (instanceof the constructor `FieldValue.vector()` produces) is
  // accepted; a forged plain `{ _values: [...] }` map — even with spoofed toArray()/isEqual() —
  // keeps `Object.prototype` and is rejected, so it cannot masquerade as a vector sentinel, bypass
  // schema validation, and be stored as an ordinary map (review T2 / finding B7). Components come
  // from the public `toArray()` and must be finite — a `FieldValue.vector([Infinity])` is authentic
  // but invalid and is rejected here.
  const components = genuineVectorComponents(value);
  if (components !== null) {
    return areFiniteVectorComponents(components);
  }

  // Defensive fallback for SDK shapes that model a vector as a `FieldValue` subclass whose
  // serialization names it (rather than a standalone `VectorValue`).
  if (value instanceof FieldValue) {
    const serialized = String(value.toString()).toLowerCase();
    return serialized.includes('vector');
  }

  return false;
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
 * Ensures the connected Firestore SDK supports the **object-form** `findNearest({ ... })` this
 * library issues (see {@link VectorQueryBuilder}), which requires `@google-cloud/firestore >= 7.10`
 * (guaranteed by `firebase-admin >= 13`; on `firebase-admin 12` only when the resolved
 * `@google-cloud/firestore` is `>= 7.10`).
 *
 * Detection is **capability-based**, not error-based. It (1) rejects a totally absent `findNearest`
 * (`<= 7.5`), then (2) probes the object form by constructing a throwaway `findNearest` with valid
 * minimal arguments. The positional-only `7.6`–`7.9` signature rejects a single object argument, so
 * the probe throws there and a deterministic compatibility error is surfaced; `7.10+` constructs the
 * probe and returns. Because this runs BEFORE the real `findNearest` call, a genuine construction
 * error from the real call (e.g. an invalid vector field path on a supported SDK) is **not** relabeled
 * as a version incompatibility — it propagates as an ordinary SDK error (review R1). The probe builds
 * a throwaway query object only (no I/O); the builder's guards ensure the query reaching this point
 * is findNearest-compatible, so on a supported SDK the valid-args probe constructs.
 */
export function assertVectorSearchSupported(query: Query<unknown>): void {
  const findNearest = (query as Query<unknown> & { findNearest?: unknown }).findNearest;
  if (typeof findNearest !== 'function') {
    throw new Error(
      'Vector search is not available: the installed Firestore SDK does not expose findNearest(). ' +
        'The object-form findNearest() this library uses requires @google-cloud/firestore >= 7.10 ' +
        '(guaranteed by firebase-admin >= 13; on firebase-admin 12 only when the resolved ' +
        '@google-cloud/firestore is >= 7.10). Upgrade firebase-admin (or @google-cloud/firestore).',
    );
  }

  try {
    // Capability probe with valid minimal args on a throwaway query (result discarded, no I/O). The
    // positional-only 7.6-7.9 signature rejects this single object argument and throws here.
    (query as unknown as { findNearest(options: Record<string, unknown>): unknown }).findNearest({
      vectorField: '__firestore_orm_vector_support_probe__',
      queryVector: [0],
      limit: 1,
      distanceMeasure: VectorDistanceMeasure.EUCLIDEAN,
    });
  } catch (error) {
    const compat = new Error(
      'Vector search requires the object-form findNearest(), i.e. @google-cloud/firestore >= 7.10 ' +
        '(guaranteed by firebase-admin >= 13; on firebase-admin 12 only when the resolved ' +
        '@google-cloud/firestore is >= 7.10). The installed SDK rejected the object form — ' +
        '@google-cloud/firestore 7.6-7.9 expose a positional-only findNearest. Upgrade to >= 7.10.',
    );
    (compat as { cause?: unknown }).cause = error;
    throw compat;
  }
}
