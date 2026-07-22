import { z } from 'zod';
import { VECTOR_MAX_DIMENSIONS } from './VectorSearch.js';
import { areFiniteVectorComponents, genuineVectorComponents } from '../utils/vectorValue.js';
import type { VectorValueLike } from '../utils/pathTypes.js';

/**
 * Zod schema for a vector embedding field on create/update payloads.
 * Accepts plain number arrays (tests, pre-write transforms) and genuine `FieldValue.vector()` values.
 *
 * The same constraints apply to BOTH representations: non-empty, all-finite components, no more than
 * Firestore's maximum embedding dimension, and — when `dimensions` is given — exactly that length. A
 * native vector's components are read from its public `toArray()`, so a native vector cannot bypass
 * the dimension/finite checks a plain array is held to (review T3). A forged plain `{ _values }` map
 * is not a genuine `VectorValue`, so it falls through to the array path and is rejected (finding B7).
 *
 * @param dimensions - When provided, values must have exactly this many components. Must itself be a
 *   positive integer no greater than Firestore's maximum embedding dimension.
 */
export function vectorEmbeddingSchema(dimensions?: number) {
  if (
    dimensions !== undefined &&
    (!Number.isInteger(dimensions) || dimensions <= 0 || dimensions > VECTOR_MAX_DIMENSIONS)
  ) {
    throw new Error(
      `vectorEmbeddingSchema() dimensions must be a positive integer <= ${VECTOR_MAX_DIMENSIONS}.`,
    );
  }

  return z.custom<number[] | VectorValueLike>(
    value => {
      // Components from a genuine VectorValue (via toArray()) or a plain number[]; anything else
      // (incl. a forged { _values } map) yields null and is rejected.
      const components = genuineVectorComponents(value) ?? (Array.isArray(value) ? value : null);

      // Number.isFinite rejects NaN AND +/-Infinity (Number.isNaN would let infinities through).
      if (!areFiniteVectorComponents(components)) {
        return false;
      }

      // Firestore rejects embeddings above its maximum component count; enforce it on input for both
      // representations rather than deferring to the backend.
      if (components.length > VECTOR_MAX_DIMENSIONS) {
        return false;
      }

      if (dimensions !== undefined && components.length !== dimensions) {
        return false;
      }

      return true;
    },
    {
      message:
        dimensions === undefined
          ? 'Expected a non-empty finite number array or FieldValue.vector() value ' +
            `(at most ${VECTOR_MAX_DIMENSIONS} components).`
          : `Expected a number array or FieldValue.vector() value with exactly ${dimensions} ` +
            'finite components.',
    },
  );
}
