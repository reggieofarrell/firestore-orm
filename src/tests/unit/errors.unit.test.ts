/**
 * Strategy: unit tests for custom error classes and formatted diagnostics.
 */
import { z } from 'zod';
import {
  ConflictError,
  FirestoreIndexError,
  NotFoundError,
  ValidationError,
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
});
