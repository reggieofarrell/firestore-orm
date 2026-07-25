/**
 * Strategy: unit-test the runtime document-id / path-segment validators (ADR-0018 / review B1) as
 * pure logic — no Firestore, no emulator.
 *
 * Verification points:
 *  - valid ids (incl. dots-in-name, spaces, unicode) are accepted and returned unchanged;
 *  - Firestore's illegal segments are rejected with a stable InvalidDocumentIdError reason:
 *    empty, "/", ".", "..", the reserved __.*__ namespace, > 1500 UTF-8 bytes, lone surrogates;
 *  - collection paths must have an odd number of valid segments, and full DOCUMENT paths an even
 *    number (the collection-group document-name operand form — issue #31).
 */
import {
  validateDocumentId,
  validateCollectionSegment,
  validateCollectionPath,
  validateDocumentPath,
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

describe('validateDocumentPath', () => {
  it('accepts even-segment document paths and returns them unchanged', () => {
    for (const path of ['users/u1', 'users/u1/posts/p1', 'a/b/c/d/e/f']) {
      expect(validateDocumentPath(path)).toBe(path);
    }
  });

  it('rejects a bare document id — the mistake a collection-group query invites', () => {
    // Ids are not unique across a group, so Firestore matches documentId() on the FULL path. The
    // Admin SDK's own error here is opaque; this one names the fix.
    expect(() => validateDocumentPath('p1')).toThrow(InvalidDocumentIdError);
    expect(() => validateDocumentPath('p1')).toThrow(/even number of segments/);
    expect(() => validateDocumentPath('p1')).toThrow(/not a bare document id/);
  });

  it.each<[string, unknown, InvalidDocumentIdError['reason']]>([
    ['a non-string', 42, 'not_string'],
    ['an empty string', '', 'empty'],
    ['an odd segment count', 'users/u1/posts', 'contains_slash'],
    // Leading/trailing slashes are silently normalized by the SDK; the ORM rejects the ambiguity.
    ['a leading slash', '/users/u1/posts/p1', 'contains_slash'],
    ['a trailing slash (odd count)', 'users/u1/', 'contains_slash'],
    ['a trailing slash (even count)', 'users/u1/posts/', 'empty'],
    ['a reserved segment', 'posts/__evil__', 'reserved_namespace'],
    ['a dot segment', 'posts/..', 'reserved_dot_segment'],
    ['a reserved COLLECTION segment', '__evil__/p1', 'reserved_namespace'],
  ])('rejects %s with reason %s', (_label, path, reason) => {
    expect(() => validateDocumentPath(path)).toThrow(InvalidDocumentIdError);
    try {
      validateDocumentPath(path);
    } catch (err) {
      expect((err as InvalidDocumentIdError).reason).toBe(reason);
    }
  });

  it('applies allowLegacyDatastoreIds to DOCUMENT segments only', () => {
    expect(() => validateDocumentPath('posts/__id7__')).toThrow(InvalidDocumentIdError);
    expect(
      validateDocumentPath('posts/__id7__', 'document path', { allowLegacyDatastoreIds: true }),
    ).toBe('posts/__id7__');
    // A collection segment never gets the exception.
    expect(() =>
      validateDocumentPath('__id7__/p1', 'document path', { allowLegacyDatastoreIds: true }),
    ).toThrow(InvalidDocumentIdError);
  });

  it('uses the caller-supplied label in its messages', () => {
    expect(() => validateDocumentPath('p1', 'wherePath value')).toThrow(/^wherePath value must/);
  });
});
