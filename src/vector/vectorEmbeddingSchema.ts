import { z } from 'zod';
import { isVectorFieldValue } from './VectorSearch.js';

/**
 * Zod schema for a vector embedding field on create/update payloads.
 * Accepts plain number arrays (tests, pre-write transforms) and `FieldValue.vector()` sentinels.
 *
 * @param dimensions - When provided, plain arrays must match this exact length.
 */
export function vectorEmbeddingSchema(dimensions?: number) {
  return z.custom<number[] | ReturnType<typeof Object>>(
    value => {
      if (isVectorFieldValue(value)) {
        return true;
      }

      if (!Array.isArray(value) || value.length === 0) {
        return false;
      }

      if (value.some(entry => typeof entry !== 'number' || Number.isNaN(entry))) {
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
