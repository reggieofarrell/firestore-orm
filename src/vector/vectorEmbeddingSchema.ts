import { z } from 'zod';
import { isVectorFieldValue, VECTOR_MAX_DIMENSIONS } from './VectorSearch.js';

/**
 * Zod schema for a vector embedding field on create/update payloads.
 * Accepts plain number arrays (tests, pre-write transforms) and `FieldValue.vector()` sentinels.
 *
 * @param dimensions - When provided, plain arrays must match this exact length. Must itself be a
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

  return z.custom<number[] | ReturnType<typeof Object>>(
    value => {
      if (isVectorFieldValue(value)) {
        return true;
      }

      if (!Array.isArray(value) || value.length === 0) {
        return false;
      }

      // Number.isFinite rejects NaN AND +/-Infinity (Number.isNaN would let infinities through).
      if (value.some(entry => typeof entry !== 'number' || !Number.isFinite(entry))) {
        return false;
      }

      if (dimensions !== undefined && value.length !== dimensions) {
        return false;
      }

      return true;
    },
    {
      message:
        dimensions === undefined
          ? 'Expected a non-empty number array or FieldValue.vector() sentinel.'
          : `Expected a number array with exactly ${dimensions} values or FieldValue.vector().`,
    },
  );
}
