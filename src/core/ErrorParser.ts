import {
  ConflictError,
  FirestoreIndexError,
  NotFoundError,
  PreconditionFailedError,
} from './Errors.js';

/**
 * Classifies a thrown value into a library error, normalizing Firestore status codes across their
 * numeric gRPC form and their string status-name form. Accepts `unknown` and never throws while
 * classifying — `null`, `undefined`, and primitives are wrapped in a plain `Error` rather than
 * dereferenced.
 */
export function parseFirestoreError(error: unknown): Error {
  // Non-object inputs (null/undefined/primitives) cannot carry a Firestore code and are never Error
  // instances — normalize to a plain Error without dereferencing.
  if (!error || typeof error !== 'object') {
    return new Error(String(error ?? 'Unknown error'));
  }

  const err = error as { code?: unknown; message?: unknown; details?: unknown };
  const message = typeof err.message === 'string' ? err.message : undefined;

  // not-found: numeric gRPC code 5 or the equivalent string status.
  if (err.code === 5 || err.code === 'not-found') {
    return new NotFoundError(message || 'Document not found');
  }

  // Missing-index errors surface as FAILED_PRECONDITION — numeric gRPC code 9 or the string status.
  //
  // ORDERING INVARIANT (do not reorder): Firestore overloads FAILED_PRECONDITION for two unrelated
  // conditions — a missing composite index, and a failed write precondition. The index check is the
  // NARROWER test (it additionally requires the 'requires an index' marker in `details`), so it must
  // stay strictly ABOVE the blanket code-9 branch below. Moving the blanket branch up would silently
  // reclassify every missing-index error as a precondition failure, turning an actionable
  // FirestoreIndexError (with its console creation URL) into a generic 412. A unit test pins this
  // ordering — see errorParser.unit.test.ts.
  const isFailedPrecondition = err.code === 9 || err.code === 'failed-precondition';
  if (
    isFailedPrecondition &&
    typeof err.details === 'string' &&
    err.details.includes('requires an index')
  ) {
    const indexUrl = extractIndexUrl(err.details);
    const fields = extractFields(err.details);
    return new FirestoreIndexError(indexUrl, fields);
  }

  // already-exists: a create-only write (`createWithId` / `bulkCreateWithIds` /
  // `createWithIdInTransaction`, all backed by the SDK's `create()`) lost the race, or the id was
  // already taken. Reuses the existing ConflictError so the write collision keeps its established
  // HTTP 409 mapping rather than inventing a second conflict type.
  if (err.code === 6 || err.code === 'already-exists') {
    return new ConflictError(message || 'Document already exists');
  }

  // failed-precondition (non-index, checked above): a `lastUpdateTime` precondition did not hold —
  // the document changed (or was removed) since the version the caller read.
  //
  // Classification is on the STATUS CODE only, never on the server message: emulator messages are
  // Datastore-flavored ("the stored version (…) does not match the required base version (…)") and
  // differ from production, so message-sniffing would be a false-green locally.
  //
  // Note what is deliberately NOT normalized here: a `lastUpdateTime` in the FUTURE returns
  // INVALID_ARGUMENT (gRPC 3), not 9. That is a malformed token (clock skew / fabricated value)
  // rather than a lost race, and telling code-3 variants apart would require message-sniffing — so
  // code 3 falls through unclassified.
  if (isFailedPrecondition) {
    return new PreconditionFailedError(message || 'Write precondition failed');
  }

  // Preserve the original Error (stack/type); wrap any non-Error object shape.
  return error instanceof Error ? error : new Error(message || 'Unknown error');
}

function extractIndexUrl(details: string): string {
  const match = details.match(/https:\/\/console\.firebase\.google\.com[^\s]+/);
  return match ? match[0] : '';
}

function extractFields(details: string): string[] {
  const fieldMatches = details.match(/on fields \[(.*?)\]/);
  if (fieldMatches) {
    return fieldMatches[1].split(',').map(f => f.trim());
  }
  return ['multiple fields'];
}
