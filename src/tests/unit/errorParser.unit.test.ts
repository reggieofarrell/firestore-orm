/**
 * Strategy: pure unit tests for parseFirestoreError — no Firestore emulator.
 * Verifies NotFoundError mapping, FirestoreIndexError extraction, and passthrough.
 */
import { FirestoreIndexError, NotFoundError } from '../../core/Errors.js';
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
    const parsed = parseFirestoreError({ code: 9, details: 'some other precondition' });
    expect(parsed).not.toBeInstanceOf(FirestoreIndexError);
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
});
