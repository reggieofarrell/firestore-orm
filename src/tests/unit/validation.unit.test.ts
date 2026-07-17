/**
 * Strategy: unit tests for sentinel-aware validation helpers in Validation.ts.
 * Verifies FieldValue detection, sentinel path collection, and makeValidator behavior.
 */
import { FieldValue, FieldPath, GeoPoint, Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import {
  collectSentinelPaths,
  isFieldValueSentinel,
  makeValidator,
  whichFieldValue,
  zSentinel,
  zNumberWrite,
  zArrayWrite,
  zDateWrite,
  withDelete,
} from '../../core/Validation.js';

describe('Validation utilities', () => {
  describe('isFieldValueSentinel', () => {
    it('should detect FieldValue serverTimestamp instances', () => {
      expect(isFieldValueSentinel(FieldValue.serverTimestamp())).toBe(true);
    });

    it('should detect FieldValue.vector instances', () => {
      expect(isFieldValueSentinel(FieldValue.vector([1, 2, 3]))).toBe(true);
    });

    it('should return false for plain objects and primitives', () => {
      expect(isFieldValueSentinel({ foo: 'bar' })).toBe(false);
      expect(isFieldValueSentinel('text')).toBe(false);
      expect(isFieldValueSentinel(null)).toBe(false);
    });

    it('should return false for Timestamp / GeoPoint / FieldPath lookalikes', () => {
      expect(isFieldValueSentinel(Timestamp.now())).toBe(false);
      expect(isFieldValueSentinel(new GeoPoint(1, 2))).toBe(false);
      expect(isFieldValueSentinel(new FieldPath('a', 'b'))).toBe(false);
    });
  });

  describe('whichFieldValue', () => {
    it('classifies each admin sentinel kind via the methodName getter', () => {
      expect(whichFieldValue(FieldValue.serverTimestamp())).toBe('serverTimestamp');
      expect(whichFieldValue(FieldValue.delete())).toBe('delete');
      expect(whichFieldValue(FieldValue.increment(1))).toBe('increment');
      expect(whichFieldValue(FieldValue.arrayUnion('a'))).toBe('arrayUnion');
      expect(whichFieldValue(FieldValue.arrayRemove('a'))).toBe('arrayRemove');
      expect(whichFieldValue(FieldValue.vector([1, 2, 3]))).toBe('vector');
    });

    it('returns unknown for non-sentinels and Timestamp/GeoPoint lookalikes', () => {
      expect(whichFieldValue('x')).toBe('unknown');
      expect(whichFieldValue({ foo: 1 })).toBe('unknown');
      expect(whichFieldValue(null)).toBe('unknown');
      expect(whichFieldValue(Timestamp.now())).toBe('unknown');
      expect(whichFieldValue(new GeoPoint(1, 2))).toBe('unknown');
    });
  });

  describe('per-field sentinel combinators', () => {
    it('zNumberWrite accepts number and increment, rejects other kinds/types', () => {
      const schema = zNumberWrite();
      expect(schema.safeParse(5).success).toBe(true);
      expect(schema.safeParse(FieldValue.increment(2)).success).toBe(true);
      expect(schema.safeParse(FieldValue.arrayUnion('x')).success).toBe(false);
      expect(schema.safeParse(FieldValue.serverTimestamp()).success).toBe(false);
      expect(schema.safeParse(FieldValue.delete()).success).toBe(false);
      expect(schema.safeParse('nope').success).toBe(false);
    });

    it('zNumberWrite({ allowDelete }) additionally accepts delete', () => {
      const schema = zNumberWrite({ allowDelete: true });
      expect(schema.safeParse(FieldValue.delete()).success).toBe(true);
      expect(schema.safeParse(FieldValue.increment(1)).success).toBe(true);
      expect(schema.safeParse(FieldValue.arrayUnion('x')).success).toBe(false);
    });

    it('zArrayWrite accepts array and arrayUnion/arrayRemove, rejects increment', () => {
      const schema = zArrayWrite(z.string());
      expect(schema.safeParse(['a', 'b']).success).toBe(true);
      expect(schema.safeParse(FieldValue.arrayUnion('a')).success).toBe(true);
      expect(schema.safeParse(FieldValue.arrayRemove('a')).success).toBe(true);
      expect(schema.safeParse(FieldValue.increment(1)).success).toBe(false);
      expect(schema.safeParse(FieldValue.serverTimestamp()).success).toBe(false);
    });

    it('zDateWrite accepts Date and serverTimestamp, rejects increment/number', () => {
      const schema = zDateWrite();
      expect(schema.safeParse(new Date()).success).toBe(true);
      expect(schema.safeParse(FieldValue.serverTimestamp()).success).toBe(true);
      expect(schema.safeParse(FieldValue.increment(1)).success).toBe(false);
      expect(schema.safeParse(123).success).toBe(false);
    });

    it('withDelete widens a base schema to also accept delete()', () => {
      const schema = withDelete(z.string());
      expect(schema.safeParse('hello').success).toBe(true);
      expect(schema.safeParse(FieldValue.delete()).success).toBe(true);
      expect(schema.safeParse(FieldValue.increment(1)).success).toBe(false);
    });

    it('zSentinel matches only the named kinds', () => {
      const schema = zSentinel('serverTimestamp');
      expect(schema.safeParse(FieldValue.serverTimestamp()).success).toBe(true);
      expect(schema.safeParse(FieldValue.increment(1)).success).toBe(false);
      expect(schema.safeParse('x').success).toBe(false);
    });
  });

  describe('collectSentinelPaths', () => {
    it('should collect nested sentinel paths', () => {
      const paths = collectSentinelPaths({
        name: 'Alice',
        profile: {
          updatedAt: FieldValue.serverTimestamp(),
        },
        tags: [FieldValue.arrayUnion('a')],
      });

      expect(paths).toEqual(
        expect.arrayContaining([
          ['profile', 'updatedAt'],
          ['tags', 0],
        ]),
      );
    });

    it('should collect FieldValue.vector sentinel paths', () => {
      const paths = collectSentinelPaths({
        name: 'Vector Doc',
        embedding: FieldValue.vector([1, 2, 3]),
      });

      expect(paths).toEqual(expect.arrayContaining([['embedding']]));
    });
  });

  describe('makeValidator', () => {
    const userSchema = z.object({
      id: z.string(),
      name: z.string().min(1),
      score: z.number().min(0),
      createdAt: z.string(),
    });

    it('should strip id from create schema and validate create payloads', () => {
      const validator = makeValidator(userSchema);
      expect(validator.schemas.create.shape).not.toHaveProperty('id');

      const parsed = validator.parseCreate({
        name: 'Valid',
        score: 1,
        createdAt: new Date().toISOString(),
      });

      expect(parsed.name).toBe('Valid');
    });

    it('should allow sentinel-only validation failures on create', () => {
      const validator = makeValidator(userSchema);
      const parsed = validator.parseCreate({
        name: 'Sentinel User',
        score: FieldValue.increment(1) as unknown as number,
        createdAt: FieldValue.serverTimestamp() as unknown as string,
      });

      expect(parsed.name).toBe('Sentinel User');
    });

    it('should throw when non-sentinel fields fail validation on create', () => {
      const validator = makeValidator(userSchema);
      expect(() =>
        validator.parseCreate({
          name: '',
          score: -1,
          createdAt: 'not-a-date',
        }),
      ).toThrow();
    });

    it('should parse partial update payloads', () => {
      const validator = makeValidator(userSchema);
      const parsed = validator.parseUpdate({ name: 'Updated Only' });
      expect(parsed).toEqual({ name: 'Updated Only' });
    });

    it('should honor a custom update schema when provided', () => {
      const updateSchema = userSchema.pick({ name: true });
      const validator = makeValidator(userSchema, updateSchema);

      expect(() => validator.parseUpdate({ score: 99 })).toThrow();
      expect(validator.parseUpdate({ name: 'Allowed' })).toEqual({ name: 'Allowed' });
    });

    it('should allow vector sentinel-only validation failures on update', () => {
      const vectorSchema = z.object({
        id: z.string(),
        name: z.string().min(1),
        embedding: z.array(z.number()).min(3),
      });
      const validator = makeValidator(vectorSchema);

      const parsed = validator.parseUpdate({
        embedding: FieldValue.vector([1, 2, 3]) as unknown as number[],
      });

      expect(parsed.embedding).toBeDefined();
    });

    it('should throw when vector sentinel is paired with invalid non-sentinel fields on update', () => {
      const vectorSchema = z.object({
        id: z.string(),
        name: z.string().min(1),
        embedding: z.array(z.number()).min(3),
      });
      const validator = makeValidator(vectorSchema);

      expect(() =>
        validator.parseUpdate({
          name: '',
          embedding: FieldValue.vector([1, 2, 3]) as unknown as number[],
        }),
      ).toThrow();
    });
  });

  describe('sentinelPolicy', () => {
    const schema = z.object({
      id: z.string(),
      name: z.string().min(1),
      createdAt: z.string(),
    });

    it('permissive (default) waives a wrong-kind sentinel on a plain field', () => {
      const validator = makeValidator(schema);
      const parsed = validator.parseUpdate({
        createdAt: FieldValue.increment(5) as unknown as string,
      });
      expect((parsed as { createdAt?: unknown }).createdAt).toBeDefined();
    });

    it('strict rejects any sentinel on a plain (non-combinator) field', () => {
      const validator = makeValidator(schema, undefined, { sentinelPolicy: 'strict' });
      expect(() =>
        validator.parseUpdate({ createdAt: FieldValue.increment(5) as unknown as string }),
      ).toThrow();
    });

    it('strict enforces per-field sentinel approval via combinators', () => {
      const strictSchema = z.object({
        id: z.string(),
        loginCount: zNumberWrite(),
        tags: zArrayWrite(z.string()),
      });
      const validator = makeValidator(strictSchema, undefined, { sentinelPolicy: 'strict' });

      // approved sentinels pass
      expect(
        validator.parseUpdate({ loginCount: FieldValue.increment(1) as unknown as number }),
      ).toBeDefined();
      expect(
        validator.parseUpdate({ tags: FieldValue.arrayUnion('x') as unknown as string[] }),
      ).toBeDefined();

      // wrong-kind sentinels rejected
      expect(() =>
        validator.parseUpdate({ loginCount: FieldValue.arrayUnion('x') as unknown as number }),
      ).toThrow();
      expect(() =>
        validator.parseUpdate({ tags: FieldValue.increment(1) as unknown as string[] }),
      ).toThrow();
    });

    it('strict still accepts valid plain values', () => {
      const strictSchema = z.object({ id: z.string(), loginCount: zNumberWrite() });
      const validator = makeValidator(strictSchema, undefined, { sentinelPolicy: 'strict' });
      expect(validator.parseCreate({ loginCount: 3 })).toEqual({ loginCount: 3 });
    });
  });

  describe('sentinel path scoping (exact-leaf)', () => {
    it('does not let a nested sentinel excuse an ancestor type error', () => {
      const schema = z.object({ id: z.string(), profile: z.string() });
      const validator = makeValidator(schema);
      expect(() =>
        validator.parseUpdate({
          profile: { updatedAt: FieldValue.serverTimestamp() } as unknown as string,
        }),
      ).toThrow();
    });
  });
});
