/**
 * Strategy: unit tests for vector search validation helpers and SDK feature detection.
 */
import { FieldValue } from 'firebase-admin/firestore';
import {
  assertVectorSearchSupported,
  FindNearestOptions,
  isVectorFieldValue,
  validateFindNearestOptions,
  VECTOR_MAX_DIMENSIONS,
  VECTOR_MAX_LIMIT,
  VectorDistanceMeasure,
} from '../../vector/VectorSearch.js';
import { vectorEmbeddingSchema } from '../../vector/vectorEmbeddingSchema.js';

describe('VectorSearch utilities', () => {
  const validOptions: FindNearestOptions<Record<string, unknown>> = {
    vectorField: 'embedding',
    queryVector: [0.1, 0.2, 0.3],
    limit: 10,
    distanceMeasure: 'EUCLIDEAN',
  };

  it('should accept valid findNearest options', () => {
    expect(() => validateFindNearestOptions(validOptions)).not.toThrow();
  });

  it('should accept all supported distance measures', () => {
    for (const distanceMeasure of Object.values(VectorDistanceMeasure)) {
      expect(() =>
        validateFindNearestOptions({
          ...validOptions,
          distanceMeasure,
        }),
      ).not.toThrow();
    }
  });

  it('should accept optional distanceResultField and distanceThreshold', () => {
    expect(() =>
      validateFindNearestOptions({
        ...validOptions,
        distanceResultField: 'vectorDistance',
        distanceThreshold: 0.25,
      }),
    ).not.toThrow();
  });

  it('should reject null or non-object options', () => {
    expect(() => validateFindNearestOptions(null as never)).toThrow(/requires an options object/i);
    expect(() => validateFindNearestOptions('bad' as never)).toThrow(/requires an options object/i);
  });

  it('should reject missing or invalid vectorField values', () => {
    expect(() =>
      validateFindNearestOptions({
        ...validOptions,
        vectorField: '' as 'embedding',
      }),
    ).toThrow(/non-empty string vectorField/i);

    expect(() =>
      validateFindNearestOptions({
        ...validOptions,
        vectorField: 42 as never,
      }),
    ).toThrow(/non-empty string vectorField/i);
  });

  it('should reject empty queryVector arrays', () => {
    expect(() =>
      validateFindNearestOptions({
        ...validOptions,
        queryVector: [],
      }),
    ).toThrow(/non-empty number array/i);
  });

  it('should reject non-array queryVector values', () => {
    expect(() =>
      validateFindNearestOptions({
        ...validOptions,
        queryVector: 'not-an-array' as never,
      }),
    ).toThrow(/non-empty number array/i);
  });

  it('should reject query vectors containing NaN or non-numbers', () => {
    expect(() =>
      validateFindNearestOptions({
        ...validOptions,
        queryVector: [1, Number.NaN, 3],
      }),
    ).toThrow(/finite numbers/i);

    expect(() =>
      validateFindNearestOptions({
        ...validOptions,
        queryVector: [1, 'two' as never, 3],
      }),
    ).toThrow(/finite numbers/i);
  });

  it('should reject non-positive or non-integer limits', () => {
    expect(() =>
      validateFindNearestOptions({
        ...validOptions,
        limit: 0,
      }),
    ).toThrow(/positive integer/i);

    expect(() =>
      validateFindNearestOptions({
        ...validOptions,
        limit: 1.5,
      }),
    ).toThrow(/positive integer/i);
  });

  it('should reject limits above the Firestore maximum', () => {
    expect(() =>
      validateFindNearestOptions({
        ...validOptions,
        limit: VECTOR_MAX_LIMIT + 1,
      }),
    ).toThrow(/cannot exceed 1000/i);
  });

  it('should reject query vectors above the dimension cap', () => {
    expect(() =>
      validateFindNearestOptions({
        ...validOptions,
        queryVector: Array.from({ length: VECTOR_MAX_DIMENSIONS + 1 }, () => 0.1),
      }),
    ).toThrow(/maximum supported dimension/i);
  });

  it('should reject invalid distance measures', () => {
    expect(() =>
      validateFindNearestOptions({
        ...validOptions,
        distanceMeasure: 'MANHATTAN' as 'EUCLIDEAN',
      }),
    ).toThrow(/distanceMeasure must be one of/i);
  });

  it('should reject invalid or empty distanceResultField values', () => {
    expect(() =>
      validateFindNearestOptions({
        ...validOptions,
        distanceResultField: 42 as never,
      }),
    ).toThrow(/distanceResultField must be a non-empty string/i);

    expect(() =>
      validateFindNearestOptions({
        ...validOptions,
        distanceResultField: '   ',
      }),
    ).toThrow(/distanceResultField must be a non-empty string/i);
  });

  it('should reject invalid distanceThreshold values', () => {
    expect(() =>
      validateFindNearestOptions({
        ...validOptions,
        distanceThreshold: Number.NaN,
      }),
    ).toThrow(/distanceThreshold must be a finite number/i);

    expect(() =>
      validateFindNearestOptions({
        ...validOptions,
        distanceThreshold: '0.5' as never,
      }),
    ).toThrow(/distanceThreshold must be a finite number/i);
  });

  describe('isVectorFieldValue', () => {
    it('should detect FieldValue.vector() write values', () => {
      expect(isVectorFieldValue(FieldValue.vector([1, 2, 3]))).toBe(true);
    });

    it('should detect structural vector values with _values arrays', () => {
      expect(isVectorFieldValue({ _values: [0.1, 0.2, 0.3] })).toBe(true);
    });

    it('should reject empty _values arrays and invalid entries', () => {
      expect(isVectorFieldValue({ _values: [] })).toBe(false);
      expect(isVectorFieldValue({ _values: [1, Number.NaN] })).toBe(false);
      expect(isVectorFieldValue({ _values: ['a'] })).toBe(false);
    });

    it('should reject vectors containing non-finite components (Infinity / -Infinity)', () => {
      // A _values-shaped value is judged solely on finiteness — a shaped-but-infinite vector must
      // NOT fall through to the looser instanceof/toString heuristics and be wrongly accepted.
      expect(isVectorFieldValue(FieldValue.vector([Infinity]))).toBe(false);
      expect(isVectorFieldValue(FieldValue.vector([1, -Infinity, 3]))).toBe(false);
      expect(isVectorFieldValue({ _values: [Infinity] })).toBe(false);
      expect(isVectorFieldValue({ _values: [1, Number.POSITIVE_INFINITY] })).toBe(false);
    });

    it('should reject primitives and plain objects', () => {
      expect(isVectorFieldValue(null)).toBe(false);
      expect(isVectorFieldValue(undefined)).toBe(false);
      expect(isVectorFieldValue('vector')).toBe(false);
      expect(isVectorFieldValue({ foo: 'bar' })).toBe(false);
    });

    it('should accept sentinel-like objects that stringify to vector', () => {
      const sentinelLike = {
        isEqual: () => true,
        toString: () => 'FieldValue.vector([1,2,3])',
      };
      expect(isVectorFieldValue(sentinelLike)).toBe(true);
    });

    it('should reject sentinel-like objects missing required methods', () => {
      expect(isVectorFieldValue({ toString: () => 'vector' })).toBe(false);
      expect(isVectorFieldValue({ isEqual: () => true })).toBe(false);
    });
  });

  it('should detect findNearest support on query objects', () => {
    const supportedQuery = { findNearest: () => ({ get: async () => ({ docs: [] }) }) };
    expect(() => assertVectorSearchSupported(supportedQuery as never)).not.toThrow();
  });

  it('should throw when findNearest is unavailable', () => {
    expect(() => assertVectorSearchSupported({} as never)).toThrow(/not available/i);
  });

  describe('vectorEmbeddingSchema', () => {
    it('should validate vectorEmbeddingSchema for arrays and sentinels', () => {
      const schema = vectorEmbeddingSchema(3);
      expect(schema.safeParse([1, 2, 3]).success).toBe(true);
      expect(schema.safeParse(FieldValue.vector([1, 2, 3])).success).toBe(true);
      expect(schema.safeParse([1, 2]).success).toBe(false);
    });

    it('should accept any-length arrays when dimensions are omitted', () => {
      const schema = vectorEmbeddingSchema();
      expect(schema.safeParse([1, 2, 3, 4]).success).toBe(true);
      expect(schema.safeParse([]).success).toBe(false);
      expect(schema.safeParse([1, Number.NaN]).success).toBe(false);
      expect(schema.safeParse('not-an-array').success).toBe(false);
    });

    it('should reject non-finite values in both array and FieldValue.vector() sentinel forms', () => {
      const schema = vectorEmbeddingSchema();
      expect(schema.safeParse([1, Infinity, 3]).success).toBe(false);
      expect(schema.safeParse([1, -Infinity]).success).toBe(false);
      // Regression: the sentinel path must not short-circuit to success before the finite check.
      expect(schema.safeParse(FieldValue.vector([Infinity])).success).toBe(false);
      expect(schema.safeParse(FieldValue.vector([1, -Infinity])).success).toBe(false);
    });

    it('should use dimension-specific error messages', () => {
      const schema = vectorEmbeddingSchema(2);
      const result = schema.safeParse([1]);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toMatch(/exactly 2 values/i);
      }
    });
  });
});
