/**
 * Strategy: unit tests for FirestoreRepository.validate() / safeValidate() — explicit
 * read-boundary validators that parse already-read values through schemas.read.
 * These methods do no Firestore I/O, so tests use a stub db and withSchema / plain
 * constructors. Verifies:
 *   1. no schema → plain Error for both methods (config mistake, not ValidationError);
 *   2. valid single / array → returns parsed data;
 *   3. invalid single → ValidationError / { success: false };
 *   4. invalid array → validate throws on first bad; safeValidate returns mixed results;
 *   5. schema with transform/coerce → returned value is parsed output, not input;
 *   6. undeclared keys → stripped from the returned/parsed value (as on the write paths).
 * Coverage of FirestoreRepository.ts is enforced by the integration gate; the emulator
 * round-trip lives in repository-validate.integration.test.ts.
 */
import { z } from 'zod';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import { ValidationError } from '../../core/Errors.js';

// validate / safeValidate never touch the db — a bare stub is sufficient.
const db = {} as any;

const userSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  age: z.number().int().positive().optional(),
});

type User = z.infer<typeof userSchema>;

describe('FirestoreRepository.validate / safeValidate', () => {
  describe('when no schema is configured', () => {
    const repo = new FirestoreRepository<{ id: string; name: string }>(db, 'users');

    it('validate throws a plain Error (not ValidationError)', () => {
      expect(() => repo.validate({ id: 'u1', name: 'Alice' })).toThrow(
        /validate\(\) requires a schema/,
      );
      expect(() => repo.validate({ id: 'u1', name: 'Alice' })).not.toThrow(ValidationError);
    });

    it('safeValidate throws a plain Error (config mistake still throws)', () => {
      expect(() => repo.safeValidate({ id: 'u1', name: 'Alice' })).toThrow(
        /safeValidate\(\) requires a schema/,
      );
      expect(() => repo.safeValidate({ id: 'u1', name: 'Alice' })).not.toThrow(ValidationError);
    });
  });

  describe('validate (throwing)', () => {
    const repo = FirestoreRepository.withSchema(db, 'users', userSchema);

    it('returns the parsed single document when valid', () => {
      const input: User = { id: 'u1', name: 'Alice', age: 30 };
      expect(repo.validate(input)).toEqual(input);
    });

    it('returns the parsed array when every element is valid', () => {
      const input: User[] = [
        { id: 'u1', name: 'Alice' },
        { id: 'u2', name: 'Bob', age: 25 },
      ];
      expect(repo.validate(input)).toEqual(input);
    });

    it('throws ValidationError for an invalid single document', () => {
      expect(() => repo.validate({ id: 'u1', name: '' } as User)).toThrow(ValidationError);
    });

    it('throws ValidationError on the first bad element in an array (all-or-nothing)', () => {
      const mixed: User[] = [
        { id: 'u1', name: 'Alice' },
        { id: 'u2', name: '' }, // invalid — name too short
        { id: 'u3', name: 'Carol' },
      ];
      expect(() => repo.validate(mixed)).toThrow(ValidationError);
    });

    it('returns the Zod-transformed/coerced value, not the raw input', () => {
      // Coerce string → number so the parsed output differs from the input shape.
      const coerceSchema = z.object({
        id: z.string(),
        count: z.coerce.number(),
      });
      const coerceRepo = FirestoreRepository.withSchema(db, 'counts', coerceSchema);
      const parsed = coerceRepo.validate({ id: 'c1', count: '42' as unknown as number });
      expect(parsed).toEqual({ id: 'c1', count: 42 });
      expect(typeof parsed.count).toBe('number');
    });

    it('strips keys not declared in the read schema (drifted stored doc)', () => {
      const withExtra = { id: 'u1', name: 'Alice', legacyField: 'drop me' } as unknown as User;
      const parsed = repo.validate(withExtra);
      expect(parsed).toEqual({ id: 'u1', name: 'Alice' });
      expect('legacyField' in parsed).toBe(false);
    });
  });

  describe('safeValidate (non-throwing on data mismatch)', () => {
    const repo = FirestoreRepository.withSchema(db, 'users', userSchema);

    it('returns { success: true, data } for a valid single document', () => {
      const input: User = { id: 'u1', name: 'Alice' };
      const result = repo.safeValidate(input);
      expect(result).toEqual({ success: true, data: input });
    });

    it('returns { success: false, error: ValidationError } for an invalid single document', () => {
      const result = repo.safeValidate({ id: 'u1', name: '' } as User);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(ValidationError);
        expect(result.error.issues.length).toBeGreaterThan(0);
      }
    });

    it('returns one SafeResult per array element (mixed success/failure)', () => {
      const mixed: User[] = [
        { id: 'u1', name: 'Alice' },
        { id: 'u2', name: '' },
        { id: 'u3', name: 'Carol' },
      ];
      const results = repo.safeValidate(mixed);
      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ success: true, data: mixed[0] });
      expect(results[1].success).toBe(false);
      if (!results[1].success) {
        expect(results[1].error).toBeInstanceOf(ValidationError);
      }
      expect(results[2]).toEqual({ success: true, data: mixed[2] });

      // Callers can drop bad docs without losing the whole batch.
      const ok = results.filter(r => r.success).map(r => r.data);
      expect(ok).toEqual([mixed[0], mixed[2]]);
    });

    it('returns the Zod-transformed/coerced value on success', () => {
      const coerceSchema = z.object({
        id: z.string(),
        count: z.coerce.number(),
      });
      const coerceRepo = FirestoreRepository.withSchema(db, 'counts', coerceSchema);
      const result = coerceRepo.safeValidate({ id: 'c1', count: '7' as unknown as number });
      expect(result).toEqual({ success: true, data: { id: 'c1', count: 7 } });
    });

    it('strips keys not declared in the read schema on success', () => {
      const withExtra = { id: 'u1', name: 'Alice', legacyField: 'drop me' } as unknown as User;
      const result = repo.safeValidate(withExtra);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ id: 'u1', name: 'Alice' });
        expect('legacyField' in result.data).toBe(false);
      }
    });
  });
});
