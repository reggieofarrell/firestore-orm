/**
 * Strategy: unit-test the runtime document-id / path-segment validators (ADR-0018 / review B1) as
 * pure logic — no Firestore, no emulator.
 *
 * Verification points:
 *  - valid ids (incl. dots-in-name, spaces, unicode) are accepted and returned unchanged;
 *  - Firestore's illegal segments are rejected with a stable InvalidDocumentIdError reason:
 *    empty, "/", ".", "..", the reserved __.*__ namespace, > 1500 UTF-8 bytes, lone surrogates;
 *  - collection paths must have an odd number of valid segments.
 */
import {
  validateDocumentId,
  validateCollectionSegment,
  validateCollectionPath,
} from '../../utils/documentId.js';
import { InvalidDocumentIdError } from '../../core/Errors.js';

describe('validateDocumentId', () => {
  it('accepts normal ids and returns them unchanged', () => {
    for (const id of ['user-123', 'a.b', 'a b', 'café', 'A_B-1', '0'.repeat(1500)]) {
      expect(validateDocumentId(id)).toBe(id);
    }
  });

  it.each<[string, string, InvalidDocumentIdError['reason']]>([
    ['empty string', '', 'empty'],
    ['slash', 'alice/private/secret', 'contains_slash'],
    ['single dot', '.', 'reserved_dot_segment'],
    ['double dot', '..', 'reserved_dot_segment'],
    ['reserved namespace', '__name__', 'reserved_namespace'],
    ['reserved datastore id', '__id7__', 'reserved_namespace'],
  ])('rejects %s with reason %s', (_label, id, reason) => {
    expect(() => validateDocumentId(id)).toThrow(InvalidDocumentIdError);
    try {
      validateDocumentId(id);
    } catch (err) {
      expect((err as InvalidDocumentIdError).reason).toBe(reason);
    }
  });

  it('rejects a non-string id', () => {
    expect(() => validateDocumentId(123 as unknown as string)).toThrow(/must be a string/i);
  });

  it('rejects ids over 1500 UTF-8 bytes', () => {
    // A 4-byte emoji × 400 = 1600 bytes > 1500.
    expect(() => validateDocumentId('😀'.repeat(400))).toThrow(/1500-byte/i);
  });

  it('rejects a lone surrogate (invalid UTF-16)', () => {
    expect(() => validateDocumentId('\uD800')).toThrow(/invalid UTF-16/i);
  });
});

describe('allowLegacyDatastoreIds opt-in (review A5)', () => {
  it('rejects the __id[0-9]+__ Datastore-import form by default', () => {
    expect(() => validateDocumentId('__id7__')).toThrow(InvalidDocumentIdError);
    try {
      validateDocumentId('__id7__');
    } catch (err) {
      expect((err as InvalidDocumentIdError).reason).toBe('reserved_namespace');
    }
  });

  it('accepts the __id[0-9]+__ form when the caller opts in', () => {
    expect(validateDocumentId('__id7__', 'document id', { allowLegacyDatastoreIds: true })).toBe(
      '__id7__',
    );
    expect(
      validateDocumentId('__id1234567890__', 'document id', { allowLegacyDatastoreIds: true }),
    ).toBe('__id1234567890__');
  });

  it('still rejects other reserved-namespace ids even with the opt-in (narrow exception)', () => {
    // Near-misses of the __id[0-9]+__ shape are NOT the Datastore-import form → still reserved even
    // with the opt-in (requires at least one digit and no trailing characters).
    for (const nearMiss of ['__name__', '__id__', '__id7x__', '__ID7__']) {
      expect(() =>
        validateDocumentId(nearMiss, 'document id', { allowLegacyDatastoreIds: true }),
      ).toThrow(/reserved/i);
    }
  });

  it('never relaxes the reserved namespace for collection segments', () => {
    // The opt-in is document-id-only: a collection path applies it to document segments (odd
    // indices) but never to collection segments (even indices).
    expect(() =>
      validateCollectionPath('__id7__/doc/orders', { allowLegacyDatastoreIds: true }),
    ).toThrow(/reserved/i);
    // …while the document segment (index 1) accepts the legacy form under the opt-in.
    expect(validateCollectionPath('users/__id7__/orders', { allowLegacyDatastoreIds: true })).toBe(
      'users/__id7__/orders',
    );
  });
});

describe('validateCollectionSegment', () => {
  it('accepts a normal collection name and rejects a slash-bearing one', () => {
    expect(validateCollectionSegment('orders')).toBe('orders');
    expect(() => validateCollectionSegment('orders/x')).toThrow(InvalidDocumentIdError);
  });
});

describe('validateCollectionPath', () => {
  it('accepts odd-segment collection paths', () => {
    expect(validateCollectionPath('users')).toBe('users');
    expect(validateCollectionPath('users/u1/orders')).toBe('users/u1/orders');
  });

  it('rejects an even-segment (document) path', () => {
    expect(() => validateCollectionPath('users/u1')).toThrow(/odd number of segments/i);
  });

  it('rejects an empty path', () => {
    expect(() => validateCollectionPath('')).toThrow(InvalidDocumentIdError);
  });

  it('rejects a path with an illegal segment', () => {
    expect(() => validateCollectionPath('users/__bad__/orders')).toThrow(/reserved/i);
  });
});
