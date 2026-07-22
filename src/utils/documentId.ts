/**
 * Runtime validation for Firestore document ids and path segments.
 *
 * `CollectionReference.doc(path)` accepts a slash-separated *document path*, not just an id, so a
 * caller-supplied id containing `/` (or an even total of segments) can address a document OUTSIDE the
 * repository's configured collection. The Admin SDK authenticates via IAM and bypasses Firestore
 * Security Rules, so this repository-level check is a real server-side boundary. Every externally
 * supplied id / collection segment / subcollection name is validated here before any `.doc(...)`,
 * `.collection(...)`, read, write, or hook.
 *
 * The rules mirror Firestore's own documented id/segment constraints so valid ids (dots inside a
 * name, spaces, unicode) are never over-rejected — only genuinely illegal segments are:
 *   - non-empty; not `.` or `..`; no `/`; not matching the reserved `__.*__` namespace;
 *   - ≤ 1500 UTF-8 bytes; well-formed UTF-16 (no lone surrogates).
 * See https://firebase.google.com/docs/firestore/quotas.
 */
import { InvalidDocumentIdError } from '../core/Errors.js';

const RESERVED_NAMESPACE = /^__.*__$/;
/**
 * Numeric entity ids imported from Cloud Datastore surface in Firestore as `__id[0-9]+__`. These are
 * legitimate *document* names for existing documents even though the `__.*__` namespace is otherwise
 * reserved. Addressing them is gated behind an explicit opt-in (see `allowLegacyDatastoreIds`) so the
 * default validator is not silently weakened. See https://firebase.google.com/docs/firestore/quotas.
 */
const LEGACY_DATASTORE_ID = /^__id[0-9]+__$/;
const MAX_SEGMENT_BYTES = 1500;

/** Options accepted by the segment validators. */
export type ValidateSegmentOptions = {
  /**
   * Permit the documented `__id[0-9]+__` Datastore-import document-name form (document segments only;
   * collection segments always reject the reserved namespace). Off by default.
   */
  allowLegacyDatastoreIds?: boolean;
};

/**
 * True when `value` is a well-formed UTF-16 string (every surrogate is part of a valid pair). The
 * ES2020 `lib` target this package compiles against does not declare `String.prototype.isWellFormed`,
 * so this is implemented directly rather than via a cast to a newer runtime method.
 */
function isWellFormed(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate — must be followed by a low surrogate.
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      // Lone low surrogate.
      return false;
    }
  }
  return true;
}

/**
 * Validates that `value` is a single, legal Firestore path segment (used for both document ids and
 * collection segments — they share the same character rules). Returns the value on success; throws
 * {@link InvalidDocumentIdError} with a stable `reason` otherwise.
 *
 * @param value - The candidate segment (usually caller-supplied / untrusted)
 * @param label - What is being validated, for the error message (e.g. `document id`, `subcollection name`)
 */
export function validatePathSegment(
  value: unknown,
  label: string,
  opts: ValidateSegmentOptions = {},
): string {
  if (typeof value !== 'string') {
    throw new InvalidDocumentIdError(`${label} must be a string.`, 'not_string');
  }
  if (value === '') {
    throw new InvalidDocumentIdError(`${label} must not be empty.`, 'empty');
  }
  if (value.includes('/')) {
    throw new InvalidDocumentIdError(
      `${label} must be a single path segment and cannot contain "/" (received ${JSON.stringify(value)}).`,
      'contains_slash',
    );
  }
  if (value === '.' || value === '..') {
    throw new InvalidDocumentIdError(`${label} cannot be "." or "..".`, 'reserved_dot_segment');
  }
  // Reserved `__.*__` namespace — except the documented `__id[0-9]+__` Datastore-import form when the
  // caller explicitly opts in (document segments only).
  if (
    RESERVED_NAMESPACE.test(value) &&
    !(opts.allowLegacyDatastoreIds && LEGACY_DATASTORE_ID.test(value))
  ) {
    throw new InvalidDocumentIdError(
      `${label} cannot match the reserved "__.*__" namespace (received ${JSON.stringify(value)}).`,
      'reserved_namespace',
    );
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_SEGMENT_BYTES) {
    throw new InvalidDocumentIdError(
      `${label} exceeds the ${MAX_SEGMENT_BYTES}-byte Firestore limit.`,
      'too_long',
    );
  }
  if (!isWellFormed(value)) {
    throw new InvalidDocumentIdError(
      `${label} contains invalid UTF-16 (a lone surrogate).`,
      'invalid_utf8',
    );
  }
  return value;
}

/** Validates a caller-supplied document id. Alias of {@link validatePathSegment} for readability. */
export function validateDocumentId(
  value: unknown,
  label = 'document id',
  opts: ValidateSegmentOptions = {},
): string {
  return validatePathSegment(value, label, opts);
}

/**
 * Validates a subcollection / collection name (one collection segment). Collection segments always
 * reject the reserved namespace — the `allowLegacyDatastoreIds` exception is document-id-only.
 */
export function validateCollectionSegment(value: unknown, label = 'collection name'): string {
  return validatePathSegment(value, label);
}

/**
 * Validates a full collection path (`col`, `col/doc/col`, …): an ODD number of non-empty segments,
 * each a legal path segment. Used at repository construction so an illegal base path fails fast. The
 * `allowLegacyDatastoreIds` exception applies only to the document segments (odd indices).
 */
export function validateCollectionPath(path: string, opts: ValidateSegmentOptions = {}): string {
  if (typeof path !== 'string' || path === '') {
    throw new InvalidDocumentIdError('collection path must be a non-empty string.', 'empty');
  }
  const segments = path.split('/');
  if (segments.length % 2 === 0) {
    throw new InvalidDocumentIdError(
      `collection path must have an odd number of segments (a collection, not a document): "${path}".`,
      'contains_slash',
    );
  }
  segments.forEach((segment, index) => {
    const isCollectionSegment = index % 2 === 0;
    validatePathSegment(
      segment,
      isCollectionSegment ? 'collection segment' : 'document segment',
      isCollectionSegment ? {} : opts,
    );
  });
  return path;
}
