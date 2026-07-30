/**
 * Strategy: pure unit tests for parseFirestoreError — no Firestore emulator.
 * Verifies NotFoundError mapping, FirestoreIndexError extraction, and passthrough.
 *
 * Issue #33 additions: conditional-write classification (gRPC 6 → ConflictError, non-index gRPC 9 →
 * PreconditionFailedError), the branch-ORDERING regression guard that keeps missing-index errors
 * ahead of the blanket code-9 branch, and the deliberate non-normalization of gRPC 3.
 *
 * Classification is asserted on the status CODE only — never on server message text, which is
 * Datastore-flavored in the emulator and differs from production.
 */
import {
  ConflictError,
  FirestoreIndexError,
  NotFoundError,
  PreconditionFailedError,
  WriteOutcomeError,
} from '../../core/Errors.js';
import { parseFirestoreError } from '../../core/ErrorParser.js';

describe('parseFirestoreError', () => {
  it('should map Firestore not-found code 5 to NotFoundError', () => {
    const parsed = parseFirestoreError({ code: 5, message: 'No document to update' });
    expect(parsed).toBeInstanceOf(NotFoundError);
    expect(parsed.message).toBe('No document to update');
  });

  it('should map string not-found code to NotFoundError', () => {
    const parsed = parseFirestoreError({ code: 'not-found' });
    expect(parsed).toBeInstanceOf(NotFoundError);
    expect(parsed.message).toBe('Document not found');
  });

  it('should map index-required errors to FirestoreIndexError', () => {
    const details =
      'The query requires an index. You can create it here: https://console.firebase.google.com/v1/r/project/demo/firestore/indexes?create_composite=abc on fields [status, createdAt]';
    const parsed = parseFirestoreError({ code: 9, details });

    expect(parsed).toBeInstanceOf(FirestoreIndexError);
    const indexError = parsed as FirestoreIndexError;
    expect(indexError.indexUrl).toContain('console.firebase.google.com');
    expect(indexError.fields).toEqual(['status', 'createdAt']);
  });

  it('should use fallback fields when index error details omit field list', () => {
    const parsed = parseFirestoreError({
      code: 9,
      details: 'The query requires an index',
    });

    expect(parsed).toBeInstanceOf(FirestoreIndexError);
    expect((parsed as FirestoreIndexError).fields).toEqual(['multiple fields']);
    expect((parsed as FirestoreIndexError).indexUrl).toBe('');
  });

  it('should map the string status "failed-precondition" to FirestoreIndexError', () => {
    const details =
      'The query requires an index. Create it at https://console.firebase.google.com/x on fields [a, b]';
    const parsed = parseFirestoreError({ code: 'failed-precondition', details });
    expect(parsed).toBeInstanceOf(FirestoreIndexError);
    expect((parsed as FirestoreIndexError).fields).toEqual(['a', 'b']);
  });

  it('should not treat a failed-precondition without an index message as an index error', () => {
    // Code 9 without the 'requires an index' marker is a write-precondition failure (#33), not a
    // missing-index error — assert the positive classification so a future reorder cannot leave
    // this as a silent fallthrough again.
    const parsed = parseFirestoreError({ code: 9, details: 'some other precondition' });
    expect(parsed).not.toBeInstanceOf(FirestoreIndexError);
    expect(parsed).toBeInstanceOf(PreconditionFailedError);
  });

  describe('conditional writes (issue #33)', () => {
    it('should map numeric ALREADY_EXISTS code 6 to ConflictError', () => {
      const parsed = parseFirestoreError({ code: 6, message: 'entity already exists' });
      expect(parsed).toBeInstanceOf(ConflictError);
      expect(parsed.message).toBe('entity already exists');
    });

    it('should map the string status "already-exists" to ConflictError', () => {
      const parsed = parseFirestoreError({ code: 'already-exists' });
      expect(parsed).toBeInstanceOf(ConflictError);
      expect(parsed.message).toBe('Document already exists');
    });

    it('should map numeric FAILED_PRECONDITION code 9 to PreconditionFailedError', () => {
      const parsed = parseFirestoreError({ code: 9, message: 'version mismatch' });
      expect(parsed).toBeInstanceOf(PreconditionFailedError);
      expect(parsed.message).toBe('version mismatch');
    });

    it('should map the string status "failed-precondition" to PreconditionFailedError', () => {
      const parsed = parseFirestoreError({ code: 'failed-precondition' });
      expect(parsed).toBeInstanceOf(PreconditionFailedError);
      expect(parsed.message).toBe('Write precondition failed');
    });

    /**
     * ORDERING REGRESSION GUARD (trap T2). Firestore overloads FAILED_PRECONDITION for both a
     * missing composite index and a failed write precondition. The narrower index check must stay
     * strictly ABOVE the blanket code-9 branch; if the branches are ever swapped, this test fails
     * because an actionable FirestoreIndexError (carrying the console creation URL) would silently
     * become a generic PreconditionFailedError.
     */
    it('keeps missing-index classification ahead of the blanket code-9 branch', () => {
      const details =
        'The query requires an index. You can create it here: https://console.firebase.google.com/v1/r/project/demo/firestore/indexes?create_composite=abc on fields [status, createdAt]';
      const parsed = parseFirestoreError({ code: 9, details });

      expect(parsed).toBeInstanceOf(FirestoreIndexError);
      expect(parsed).not.toBeInstanceOf(PreconditionFailedError);
      expect((parsed as FirestoreIndexError).indexUrl).toContain('console.firebase.google.com');
    });

    it('keeps the same ordering for the string failed-precondition status', () => {
      const details =
        'The query requires an index. Create it at https://console.firebase.google.com/x on fields [a, b]';
      const parsed = parseFirestoreError({ code: 'failed-precondition', details });

      expect(parsed).toBeInstanceOf(FirestoreIndexError);
      expect(parsed).not.toBeInstanceOf(PreconditionFailedError);
    });

    it('leaves code 5 classified as NotFoundError (baseline unchanged)', () => {
      const parsed = parseFirestoreError({ code: 5, message: 'no entity to update' });
      expect(parsed).toBeInstanceOf(NotFoundError);
      expect(parsed).not.toBeInstanceOf(PreconditionFailedError);
    });

    /**
     * Trap T4: a `lastUpdateTime` in the FUTURE returns INVALID_ARGUMENT (gRPC 3), not 9. That is a
     * malformed token rather than a lost race, and distinguishing code-3 variants would require
     * message-sniffing — so code 3 is deliberately NOT normalized and passes through untouched.
     */
    it('does not normalize INVALID_ARGUMENT code 3 (future lastUpdateTime)', () => {
      const original = Object.assign(new Error('invalid argument'), { code: 3 });
      const parsed = parseFirestoreError(original);

      expect(parsed).toBe(original);
      expect(parsed).not.toBeInstanceOf(PreconditionFailedError);
      expect(parsed).not.toBeInstanceOf(ConflictError);
    });
  });

  it('should return the original error when not a known Firestore code', () => {
    const original = new Error('permission denied');
    expect(parseFirestoreError(original)).toBe(original);
  });

  // Robustness: classifying must never throw, whatever the input shape (accepts `unknown`).
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string primitive', 'boom'],
    ['a number primitive', 42],
    ['a boolean primitive', true],
    ['a plain object with no code', { message: 'weird' }],
    ['an object with a non-string details for an index code', { code: 9, details: 12345 }],
  ])('normalizes %s into an Error without throwing', (_label, input) => {
    let parsed: Error;
    expect(() => {
      parsed = parseFirestoreError(input);
    }).not.toThrow();
    expect(parsed!).toBeInstanceOf(Error);
  });

  it('preserves the original Error instance for a plain object that is an Error', () => {
    const original = new Error('boom');
    expect(parseFirestoreError(original)).toBe(original);
  });

  it('preserves WriteOutcomeError unchanged (issue #46)', () => {
    // Nested repository/query catches call parseFirestoreError; unwrapping would erase the outcome.
    const cause = new Error('after hook failed');
    const original = new WriteOutcomeError(
      {
        state: 'committed',
        phase: 'after-hook',
        hook: { event: 'afterCreate', execution: 'direct', retryable: false },
      },
      cause,
    );
    expect(parseFirestoreError(original)).toBe(original);
  });
});
