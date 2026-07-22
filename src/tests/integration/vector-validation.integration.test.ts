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
  withVectorSearch,
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

    it('should reject empty or whitespace-only vectorField values', () => {
      expect(() =>
        validateFindNearestOptions({
          ...findNearestBase,
          vectorField: '' as 'embedding',
        }),
      ).toThrow(/vectorField/i);

      expect(() =>
        validateFindNearestOptions({
          ...findNearestBase,
          vectorField: '   ' as 'embedding',
        }),
      ).toThrow(/vectorField/i);
    });

    it('should reject empty, NaN, or infinite queryVector values', () => {
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

      // Number.isFinite (not Number.isNaN) also rejects +/-Infinity.
      expect(() =>
        validateFindNearestOptions({
          ...findNearestBase,
          queryVector: [1, Number.POSITIVE_INFINITY],
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
      ).toThrow(/distanceResultField must be a non-empty string/i);

      // Empty / whitespace-only distance-result field names are rejected.
      expect(() =>
        validateFindNearestOptions({
          ...findNearestBase,
          distanceResultField: '   ',
        }),
      ).toThrow(/distanceResultField must be a non-empty string/i);

      expect(() =>
        validateFindNearestOptions({
          ...findNearestBase,
          distanceThreshold: Number.NaN,
        }),
      ).toThrow(/distanceThreshold must be a finite number/i);

      // Number.isFinite also rejects +/-Infinity thresholds.
      expect(() =>
        validateFindNearestOptions({
          ...findNearestBase,
          distanceThreshold: Number.POSITIVE_INFINITY,
        }),
      ).toThrow(/distanceThreshold must be a finite number/i);
    });
  });

  describe('isVectorFieldValue', () => {
    it('should detect a genuine FieldValue.vector() sentinel', () => {
      expect(isVectorFieldValue(FieldValue.vector([1, 2, 3]))).toBe(true);
    });

    it('should REJECT a forged { _values } map that is not a genuine VectorValue (B7)', () => {
      // A hand-built map is not an instanceof the VectorValue constructor, so it must not be treated
      // as a vector sentinel — otherwise it would bypass schema validation.
      expect(isVectorFieldValue({ _values: [0.1, 0.2, 0.3] })).toBe(false);
    });

    it('should REJECT the reviewer forge with spoofed non-enumerable toArray()/isEqual() (T2)', () => {
      const forge: Record<string, unknown> = { _values: [1, 2] };
      Object.defineProperties(forge, {
        toArray: { value: () => [1, 2] },
        isEqual: { value: () => false },
      });
      expect(isVectorFieldValue(forge)).toBe(false);
    });

    it('should reject invalid vector-like values', () => {
      expect(isVectorFieldValue(null)).toBe(false);
      expect(isVectorFieldValue({ _values: [] })).toBe(false);
      expect(isVectorFieldValue({ _values: [Number.NaN] })).toBe(false);
      expect(isVectorFieldValue({ foo: 'bar' })).toBe(false);
    });

    it('should reject a genuine vector sentinel with non-finite components', () => {
      // The sentinel path (not just plain arrays) must reject +/-Infinity.
      expect(isVectorFieldValue(FieldValue.vector([Infinity]))).toBe(false);
      expect(isVectorFieldValue(FieldValue.vector([1, -Infinity, 3]))).toBe(false);
    });

    it('should REJECT a forged object that merely stringifies to vector (no toArray) (B7)', () => {
      const forgedSentinel = {
        isEqual: () => true,
        toString: () => 'FieldValue.vector([1,2,3])',
      };
      expect(isVectorFieldValue(forgedSentinel)).toBe(false);
    });
  });

  describe('vectorEmbeddingSchema', () => {
    it('should validate dimensioned schemas against arrays and sentinels', () => {
      const schema = vectorEmbeddingSchema(3);
      expect(schema.safeParse([1, 2, 3]).success).toBe(true);
      expect(schema.safeParse(FieldValue.vector([1, 2, 3])).success).toBe(true);
      expect(schema.safeParse([1, 2]).success).toBe(false);
      expect(schema.safeParse([1, Number.NaN, 3]).success).toBe(false);
      // Number.isFinite (not Number.isNaN) also rejects +/-Infinity components.
      expect(schema.safeParse([1, Number.POSITIVE_INFINITY, 3]).success).toBe(false);
      // The FieldValue.vector() sentinel path must reject infinities too (not short-circuit).
      expect(schema.safeParse(FieldValue.vector([1, Infinity, 3])).success).toBe(false);
    });

    it('should reject an invalid dimensions argument', () => {
      expect(() => vectorEmbeddingSchema(0)).toThrow(/positive integer/i);
      expect(() => vectorEmbeddingSchema(-1)).toThrow(/positive integer/i);
      expect(() => vectorEmbeddingSchema(2.5)).toThrow(/positive integer/i);
      expect(() => vectorEmbeddingSchema(10_000)).toThrow(/positive integer/i);
    });

    it('should validate schemas without fixed dimensions', () => {
      const schema = vectorEmbeddingSchema();
      expect(schema.safeParse([1, 2, 3, 4]).success).toBe(true);
      expect(schema.safeParse([]).success).toBe(false);
    });

    it('should reject a forged { _values } map at the schema level (B7)', () => {
      const schema = vectorEmbeddingSchema(3);
      // A genuine sentinel and a plain array pass; a hand-built { _values } map does NOT (it is not
      // a genuine VectorValue, so it falls through to the array path and is rejected).
      expect(schema.safeParse(FieldValue.vector([1, 2, 3])).success).toBe(true);
      expect(schema.safeParse({ _values: [1, 2, 3] }).success).toBe(false);
    });

    it('should enforce the exact dimension on native vectors, not just arrays (T3)', () => {
      const schema = vectorEmbeddingSchema(3);
      // A native 2-component vector must fail a fixed 3-dimension schema, exactly like a 2-element
      // array — the native path must not short-circuit past the dimension check.
      expect(schema.safeParse([1, 2]).success).toBe(false);
      expect(schema.safeParse(FieldValue.vector([1, 2])).success).toBe(false);
      expect(schema.safeParse(FieldValue.vector([1, 2, 3])).success).toBe(true);
    });

    it('should enforce VECTOR_MAX_DIMENSIONS on both arrays and native vectors (T3)', () => {
      const schema = vectorEmbeddingSchema();
      const oversized = Array.from({ length: VECTOR_MAX_DIMENSIONS + 1 }, () => 0.1);
      expect(schema.safeParse(oversized).success).toBe(false);
      expect(schema.safeParse(FieldValue.vector(oversized)).success).toBe(false);
      // The maximum itself is accepted.
      const atMax = Array.from({ length: VECTOR_MAX_DIMENSIONS }, () => 0.1);
      expect(schema.safeParse(FieldValue.vector(atMax)).success).toBe(true);
    });

    it('should reject invalid embeddings through schema-validated repository writes', async () => {
      const schema = z.object({
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

      // B7 end-to-end: a forged { _values } map must be rejected on write, not silently persisted
      // as an ordinary map that later reads back as a non-vector.
      await expect(
        repo.create({
          name: 'forged-embedding',
          embedding: { _values: [1, 2, 3] } as never,
        }),
      ).rejects.toThrow();

      // T2 end-to-end: the reviewer forge (spoofed non-enumerable toArray()/isEqual()) is likewise
      // rejected before persistence, not written as an ordinary map.
      const forge: Record<string, unknown> = { _values: [1, 2, 3] };
      Object.defineProperties(forge, {
        toArray: { value: () => [1, 2, 3] },
        isEqual: { value: () => false },
      });
      await expect(
        repo.create({ name: 'forged-methods-embedding', embedding: forge as never }),
      ).rejects.toThrow();

      // T3 end-to-end: a native vector of the wrong dimension is rejected on write (does not bypass
      // the fixed-dimension schema).
      await expect(
        repo.create({ name: 'wrong-dim-native', embedding: FieldValue.vector([1, 2]) as never }),
      ).rejects.toThrow();

      // Nothing above was persisted.
      const docs = await repo.query().get();
      expect(docs).toHaveLength(0);
      if (docs.length > 0) {
        await repo.bulkDelete(docs.map(doc => doc.id));
      }
    });
  });

  describe('object-form compatibility error classification (R1)', () => {
    it('does not relabel a supported-SDK bad-field-path error as a version incompatibility', () => {
      // The installed SDK (>= 7.10) DOES support the object form, so the capability probe passes and
      // the guard does not throw. A genuinely invalid Firestore field path must then surface as an
      // ordinary path/input error from the real findNearest — NOT the ">= 7.10 upgrade" compat error.
      const wrapped = withVectorSearch(new FirestoreRepository(db, 'test_vectors_r1'));
      const attempt = () =>
        wrapped.vectorQuery().findNearest({
          vectorField: 'invalid..path' as never,
          queryVector: [1, 2, 3],
          limit: 1,
          distanceMeasure: VectorDistanceMeasure.COSINE,
        });

      // It throws a field-path error...
      expect(attempt).toThrow(/field path/i);
      // ...and specifically NOT the version-incompatibility guidance.
      expect(attempt).not.toThrow(/>= 7\.10/);
    });
  });
});
