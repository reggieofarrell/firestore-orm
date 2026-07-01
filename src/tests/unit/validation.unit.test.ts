/**
 * Strategy: unit tests for sentinel-aware validation helpers in Validation.ts.
 * Verifies FieldValue detection, sentinel path collection, and makeValidator behavior.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import {
  collectSentinelPaths,
  isFieldValueSentinel,
  makeValidator,
} from '../../core/Validation.js';

describe('Validation utilities', () => {
  describe('isFieldValueSentinel', () => {
    it('should detect FieldValue serverTimestamp instances', () => {
      expect(isFieldValueSentinel(FieldValue.serverTimestamp())).toBe(true);
    });

    it('should return false for plain objects and primitives', () => {
      expect(isFieldValueSentinel({ foo: 'bar' })).toBe(false);
      expect(isFieldValueSentinel('text')).toBe(false);
      expect(isFieldValueSentinel(null)).toBe(false);
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
  });
});
