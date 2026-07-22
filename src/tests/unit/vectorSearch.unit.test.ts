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

  it('should reject distanceThreshold 0 (silently dropped by the SDK serializer)', () => {
    // The installed @google-cloud/firestore serializer omits a zero threshold via a truthiness
    // check, which would broaden the query to all neighbors — reject it loudly instead.
    for (const distanceMeasure of Object.values(VectorDistanceMeasure)) {
      expect(() =>
        validateFindNearestOptions({ ...validOptions, distanceMeasure, distanceThreshold: 0 }),
      ).toThrow(/distanceThreshold cannot be 0/i);
    }
  });

  it('should reject a negative distanceThreshold for EUCLIDEAN and COSINE only', () => {
    expect(() =>
      validateFindNearestOptions({
        ...validOptions,
        distanceMeasure: 'EUCLIDEAN',
        distanceThreshold: -0.5,
      }),
    ).toThrow(/cannot be negative for EUCLIDEAN/i);

    expect(() =>
      validateFindNearestOptions({
        ...validOptions,
        distanceMeasure: 'COSINE',
        distanceThreshold: -0.5,
      }),
    ).toThrow(/cannot be negative for COSINE/i);

    // DOT_PRODUCT similarity can be negative, so a negative threshold is legitimate.
    expect(() =>
      validateFindNearestOptions({
        ...validOptions,
        distanceMeasure: 'DOT_PRODUCT',
        distanceThreshold: -0.5,
      }),
    ).not.toThrow();

    // A positive threshold remains valid for every measure.
    expect(() =>
      validateFindNearestOptions({ ...validOptions, distanceThreshold: 0.5 }),
    ).not.toThrow();
  });

  describe('isVectorFieldValue', () => {
    it('should detect a genuine FieldValue.vector() write value', () => {
      expect(isVectorFieldValue(FieldValue.vector([1, 2, 3]))).toBe(true);
    });

    it('should REJECT the reviewer forge: a plain object with spoofed toArray()/isEqual() (T2)', () => {
      // Authenticity is nominal (instanceof the VectorValue constructor), NOT method-presence. This
      // is the exact adversarial value from the review: a plain object that keeps Object.prototype,
      // carries _values, and has non-enumerable toArray/isEqual. Firestore would serialize it as an
      // ordinary map, so it must NOT pass vector recognition.
      const forge: Record<string, unknown> = { _values: [1, 2] };
      Object.defineProperties(forge, {
        toArray: { value: () => [1, 2] },
        isEqual: { value: () => false },
      });
      expect(isVectorFieldValue(forge)).toBe(false);
    });

    it('should REJECT a forged { _values } map (not a genuine VectorValue) (B7)', () => {
      // A hand-built map shaped like a vector is not an instanceof the VectorValue constructor, so it
      // cannot masquerade as a vector sentinel, bypass schema validation, and be persisted as a map.
      expect(isVectorFieldValue({ _values: [0.1, 0.2, 0.3] })).toBe(false);
      expect(isVectorFieldValue({ _values: [] })).toBe(false);
      expect(isVectorFieldValue({ _values: [1, Number.NaN] })).toBe(false);
      expect(isVectorFieldValue({ _values: ['a'] })).toBe(false);
      expect(isVectorFieldValue({ _values: [Infinity] })).toBe(false);
    });

    it('should reject a genuine VectorValue whose components are non-finite (Infinity / -Infinity)', () => {
      // Authentic but invalid: a genuine VectorValue carrying a non-finite component is rejected on
      // the finiteness check (read from its public toArray()), not accepted just because it is real.
      expect(isVectorFieldValue(FieldValue.vector([Infinity]))).toBe(false);
      expect(isVectorFieldValue(FieldValue.vector([1, -Infinity, 3]))).toBe(false);
    });

    it('should reject primitives and plain objects', () => {
      expect(isVectorFieldValue(null)).toBe(false);
      expect(isVectorFieldValue(undefined)).toBe(false);
      expect(isVectorFieldValue('vector')).toBe(false);
      expect(isVectorFieldValue({ foo: 'bar' })).toBe(false);
    });

    it('should REJECT a forged object that only stringifies to vector (T2)', () => {
      // An object with isEqual()+toString()-says-"vector" is not an instanceof the VectorValue
      // constructor, so it is rejected (the old toString heuristic that accepted it is gone).
      const forgedSentinel = {
        isEqual: () => true,
        toString: () => 'FieldValue.vector([1,2,3])',
      };
      expect(isVectorFieldValue(forgedSentinel)).toBe(false);
    });
  });

  it('should accept an SDK whose object-form findNearest probe constructs (>= 7.10)', () => {
    // findNearest accepts the object-form probe (returns a query) → supported, no throw.
    const supportedQuery = { findNearest: () => ({ get: async () => ({ docs: [] }) }) };
    expect(() => assertVectorSearchSupported(supportedQuery as never)).not.toThrow();
  });

  it('should throw a >= 7.10 message when findNearest is totally absent (<= 7.5)', () => {
    expect(() => assertVectorSearchSupported({} as never)).toThrow(/not available/i);
    expect(() => assertVectorSearchSupported({} as never)).toThrow(
      /@google-cloud\/firestore >= 7\.10/,
    );
    expect(() => assertVectorSearchSupported({} as never)).toThrow(/object-form findNearest/i);
  });

  it('should throw the object-form compatibility error when findNearest is positional-only (7.6-7.9) (R1)', () => {
    // Simulate the positional-only signature: findNearest(vectorField, queryVector, options) rejects a
    // single object argument (vectorField must be a string/FieldPath). The capability probe hits this.
    const positionalOnly = {
      findNearest: (vectorField: unknown) => {
        if (typeof vectorField !== 'string') {
          throw new Error('Value for argument "vectorField" is not a valid field path.');
        }
        return { get: async () => ({ docs: [] }) };
      },
    };
    expect(() => assertVectorSearchSupported(positionalOnly as never)).toThrow(
      /object-form findNearest/i,
    );
    expect(() => assertVectorSearchSupported(positionalOnly as never)).toThrow(
      /@google-cloud\/firestore >= 7\.10/,
    );
    expect(() => assertVectorSearchSupported(positionalOnly as never)).toThrow(/positional-only/i);
  });

  it('should NOT relabel a supported-SDK input error: the guard passes when the object form works (R1)', () => {
    // Object-form IS supported — the valid-args probe constructs — so the guard does not throw, even
    // though a later real call with a bad field path would. The bad-arg error is thus left to
    // propagate from the real findNearest, not relabeled here as a version incompatibility.
    const supported = {
      findNearest: (arg: unknown) => {
        const opts = arg as { vectorField?: unknown };
        if (typeof opts?.vectorField === 'string' && opts.vectorField.includes('..')) {
          throw new Error('Value for argument "vectorField" is not a valid field path.');
        }
        return { get: async () => ({ docs: [] }) };
      },
    };
    expect(() => assertVectorSearchSupported(supported as never)).not.toThrow();
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
        expect(result.error.issues[0]?.message).toMatch(/exactly 2 finite components/i);
      }
    });
  });
});
