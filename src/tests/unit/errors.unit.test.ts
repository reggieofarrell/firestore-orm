/**
 * Strategy: unit tests for custom error classes and formatted diagnostics.
 * Issue #46: WriteOutcomeError contract — four outcome variants, stable name/message, cause identity.
 */
import { z } from 'zod';
import {
  ConflictError,
  FirestoreIndexError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
  WriteOutcomeError,
  type WriteOutcome,
} from '../../core/Errors.js';

describe('ORM error classes', () => {
  it('should set NotFoundError name and message', () => {
    const error = new NotFoundError('missing doc');
    expect(error.name).toBe('NotFoundError');
    expect(error.message).toBe('missing doc');
  });

  it('should format ValidationError message from Zod issues', () => {
    const schema = z.object({ email: z.string().email() });
    const result = schema.safeParse({ email: 'bad' });
    if (result.success) throw new Error('expected failure');

    const error = new ValidationError(result.error.issues);
    expect(error.name).toBe('ValidationError');
    expect(error.message).toContain('email');
    expect(error.issues).toHaveLength(1);
  });

  it('should set ConflictError name and message', () => {
    const error = new ConflictError('duplicate');
    expect(error.name).toBe('ConflictError');
    expect(error.message).toBe('duplicate');
  });

  it('should set PreconditionFailedError name and message', () => {
    // Message-only, matching NotFoundError/ConflictError — no structured version fields, because the
    // server's version numbers are emulator-specific and must never become part of the contract.
    const error = new PreconditionFailedError('stale write');
    expect(error.name).toBe('PreconditionFailedError');
    expect(error.message).toBe('stale write');
    expect(error).toBeInstanceOf(Error);
  });

  it('should expose FirestoreIndexError metadata and formatted guidance', () => {
    const error = new FirestoreIndexError('https://example.com/index', ['status', 'createdAt']);

    expect(error.name).toBe('FirestoreIndexError');
    expect(error.indexUrl).toBe('https://example.com/index');
    expect(error.fields).toEqual(['status', 'createdAt']);

    const formatted = error.toString();
    expect(formatted).toContain('FIRESTORE INDEX REQUIRED');
    expect(formatted).toContain('status, createdAt');
    expect(formatted).toContain('https://example.com/index');
  });

  describe('WriteOutcomeError (issue #46)', () => {
    const cause = new Error('hook boom');

    const variants: WriteOutcome[] = [
      {
        state: 'not-committed',
        phase: 'before-hook',
        hook: { event: 'beforeCreate', execution: 'direct', retryable: false },
      },
      {
        state: 'partially-committed',
        phase: 'commit',
        committedWrites: 500,
        totalWrites: 501,
      },
      {
        state: 'committed',
        phase: 'after-hook',
        hook: { event: 'afterCreate', execution: 'direct', retryable: false },
      },
      {
        state: 'committed',
        phase: 'read-back',
      },
    ];

    it.each(variants)('should expose stable name, message, and cause for %#', outcome => {
      const error = new WriteOutcomeError(outcome, cause);
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(WriteOutcomeError);
      expect(error.name).toBe('WriteOutcomeError');
      expect(error.cause).toBe(cause);
      expect(error.outcome).toEqual(outcome);
      // Messages are stable and must not embed the cause text (HTTP/log safety).
      expect(error.message).not.toContain('hook boom');
      expect(error.message.length).toBeGreaterThan(0);
    });

    it('should keep cause outside outcome so JSON of outcome cannot leak it', () => {
      const error = new WriteOutcomeError(variants[0], cause);
      const serialized = JSON.stringify(error.outcome);
      expect(serialized).not.toContain('cause');
      expect(serialized).not.toContain('hook boom');
    });
  });
});
