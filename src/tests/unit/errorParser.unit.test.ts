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

  it('should return the original error when not a known Firestore code', () => {
    const original = new Error('permission denied');
    expect(parseFirestoreError(original)).toBe(original);
  });
});
