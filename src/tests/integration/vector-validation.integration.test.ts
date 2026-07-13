/**
 * Strategy: emulator integration tests that exercise vector helper validation paths
 * and schema edge cases used by the vector extension at runtime.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import {
  isVectorFieldValue,
  validateFindNearestOptions,
  vectorEmbeddingSchema,
  VectorDistanceMeasure,
  VECTOR_MAX_DIMENSIONS,
  VECTOR_MAX_LIMIT,
} from '../../vector/index.js';
import { getIntegrationDb } from './helpers/firestoreIntegrationHarness.js';

describe('Vector validation integration', () => {
  const db = getIntegrationDb();

  const findNearestBase = {
    vectorField: 'embedding',
    queryVector: [1, 0, 0],
    limit: 1,
    distanceMeasure: VectorDistanceMeasure.EUCLIDEAN,
  } as const;

  describe('validateFindNearestOptions', () => {
    it('should accept valid options and optional distance fields', () => {
      expect(() => validateFindNearestOptions(findNearestBase)).not.toThrow();
      expect(() =>
        validateFindNearestOptions({
          ...findNearestBase,
          distanceResultField: 'vectorDistance',
          distanceThreshold: 0.5,
        }),
      ).not.toThrow();
    });

    it('should reject null or invalid option objects', () => {
      expect(() => validateFindNearestOptions(null as never)).toThrow(/options object/i);
      expect(() => validateFindNearestOptions(undefined as never)).toThrow(/options object/i);
    });

    it('should reject invalid vectorField values', () => {
      expect(() =>
        validateFindNearestOptions({
          ...findNearestBase,
          vectorField: '' as 'embedding',
        }),
      ).toThrow(/vectorField/i);
    });

    it('should reject empty or invalid queryVector values', () => {
      expect(() =>
        validateFindNearestOptions({
          ...findNearestBase,
          queryVector: [],
        }),
      ).toThrow(/non-empty number array/i);

      expect(() =>
        validateFindNearestOptions({
          ...findNearestBase,
          queryVector: [1, Number.NaN],
        }),
      ).toThrow(/finite numbers/i);
    });

    it('should reject invalid limits and oversized vectors', () => {
      expect(() =>
        validateFindNearestOptions({
          ...findNearestBase,
          limit: 0,
        }),
      ).toThrow(/positive integer/i);

      expect(() =>
        validateFindNearestOptions({
          ...findNearestBase,
          limit: VECTOR_MAX_LIMIT + 1,
        }),
      ).toThrow(/cannot exceed 1000/i);

      expect(() =>
        validateFindNearestOptions({
          ...findNearestBase,
          queryVector: Array.from({ length: VECTOR_MAX_DIMENSIONS + 1 }, () => 0.1),
        }),
      ).toThrow(/maximum supported dimension/i);
    });

    it('should reject invalid distance measures and optional field types', () => {
      expect(() =>
        validateFindNearestOptions({
          ...findNearestBase,
          distanceMeasure: 'INVALID' as 'EUCLIDEAN',
        }),
      ).toThrow(/distanceMeasure must be one of/i);

      expect(() =>
        validateFindNearestOptions({
          ...findNearestBase,
          distanceResultField: 42 as never,
        }),
      ).toThrow(/distanceResultField must be a string/i);

      expect(() =>
        validateFindNearestOptions({
          ...findNearestBase,
          distanceThreshold: Number.NaN,
        }),
      ).toThrow(/distanceThreshold must be a finite number/i);
    });
  });

  describe('isVectorFieldValue', () => {
    it('should detect vector sentinels and structural vector values', () => {
      expect(isVectorFieldValue(FieldValue.vector([1, 2, 3]))).toBe(true);
      expect(isVectorFieldValue({ _values: [0.1, 0.2, 0.3] })).toBe(true);
    });

    it('should reject invalid vector-like values', () => {
      expect(isVectorFieldValue(null)).toBe(false);
      expect(isVectorFieldValue({ _values: [] })).toBe(false);
      expect(isVectorFieldValue({ _values: [Number.NaN] })).toBe(false);
      expect(isVectorFieldValue({ foo: 'bar' })).toBe(false);
    });

    it('should accept sentinel-like objects that stringify to vector', () => {
      const sentinelLike = {
        isEqual: () => true,
        toString: () => 'FieldValue.vector([1,2,3])',
      };
      expect(isVectorFieldValue(sentinelLike)).toBe(true);
    });
  });

  describe('vectorEmbeddingSchema', () => {
    it('should validate dimensioned schemas against arrays and sentinels', () => {
      const schema = vectorEmbeddingSchema(3);
      expect(schema.safeParse([1, 2, 3]).success).toBe(true);
      expect(schema.safeParse(FieldValue.vector([1, 2, 3])).success).toBe(true);
      expect(schema.safeParse([1, 2]).success).toBe(false);
      expect(schema.safeParse([1, Number.NaN, 3]).success).toBe(false);
    });

    it('should validate schemas without fixed dimensions', () => {
      const schema = vectorEmbeddingSchema();
      expect(schema.safeParse([1, 2, 3, 4]).success).toBe(true);
      expect(schema.safeParse([]).success).toBe(false);
    });

    it('should reject invalid embeddings through schema-validated repository writes', async () => {
      const schema = z.object({
        id: z.string(),
        name: z.string(),
        embedding: vectorEmbeddingSchema(3),
      });
      const repo = FirestoreRepository.withSchema(db, 'test_vectors_schema_invalid', schema);

      await expect(
        repo.create({
          name: 'invalid-embedding',
          embedding: [1, 2] as never,
        }),
      ).rejects.toThrow();

      const docs = await repo.query().get();
      if (docs.length > 0) {
        await repo.bulkDelete(docs.map(doc => doc.id));
      }
    });
  });
});
