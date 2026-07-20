import { FirestoreIndexError, NotFoundError } from './Errors.js';

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
