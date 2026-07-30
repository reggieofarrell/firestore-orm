import z from 'zod';
import type { HookContext, HookEvent } from './Hooks.js';

/**
 * Discriminated persistence outcome carried by {@link WriteOutcomeError}.
 *
 * Outcome is derived from **control-flow position** at the failure site (before-hook, commit
 * chunking, after-hook, or postcommit read-back) — never inferred from the cause's class. Ordinary
 * precommit failures (validation, malformed id, first-chunk conflict, SDK errors with zero
 * successful writes) remain their existing top-level error classes and are not wrapped here.
 *
 * - `not-committed` / `before-hook` — a `before*` hook threw; no write was applied for this call.
 * - `partially-committed` / `commit` — one or more fixed-batch chunks committed, then a later chunk
 *   (or action-building after prior success) failed. `committedWrites` counts successful document
 *   write actions; `totalWrites` is the call's action count.
 * - `committed` / `after-hook` — the write committed, then an `after*` hook threw. Side effects are
 *   in-process and not durable across process crash.
 * - `committed` / `read-back` — the write committed, then a `{ returnDoc: true }` converter/read
 *   failed. The document is persisted; only the returned model is unavailable.
 */
export type WriteOutcome =
  | {
      readonly state: 'not-committed';
      readonly phase: 'before-hook';
      readonly hook: HookContext<HookEvent>;
    }
  | {
      readonly state: 'partially-committed';
      readonly phase: 'commit';
      readonly committedWrites: number;
      readonly totalWrites: number;
    }
  | {
      readonly state: 'committed';
      readonly phase: 'after-hook';
      readonly hook: HookContext<HookEvent>;
    }
  | {
      readonly state: 'committed';
      readonly phase: 'read-back';
    };

/**
 * Stable, non-cause-derived messages for each {@link WriteOutcome} variant so HTTP adapters and
 * logs can surface a predictable string without embedding sensitive cause text.
 */
function messageForWriteOutcome(outcome: WriteOutcome): string {
  switch (outcome.state) {
    case 'not-committed':
      return `Write did not commit: before-hook '${outcome.hook.event}' failed`;
    case 'partially-committed':
      return (
        `Write partially committed: ${outcome.committedWrites} of ${outcome.totalWrites} ` +
        'document writes succeeded before commit failure'
      );
    case 'committed':
      if (outcome.phase === 'after-hook') {
        return `Write committed but after-hook '${outcome.hook.event}' failed`;
      }
      return 'Write committed but postcommit read-back failed';
  }
}

/**
 * Outcome-sensitive write failure: a hook threw, a later fixed-batch chunk failed after earlier
 * chunks committed, or a postcommit `{ returnDoc: true }` read/converter failed.
 *
 * The original failure is preserved as {@link cause} (normalized through {@link parseFirestoreError}
 * at construction sites). `cause` lives on the Error instance — **not** inside {@link outcome} —
 * so Express/JSON serialization of `outcome` cannot leak sensitive cause details.
 *
 * @example
 * try {
 *   await userRepo.create(data);
 * } catch (error) {
 *   if (error instanceof WriteOutcomeError) {
 *     switch (error.outcome.state) {
 *       case 'not-committed':
 *         // Firestore write did not commit. Earlier before-hooks may still have delivered
 *         // external side effects — retry only with an idempotent business/write identity.
 *         break;
 *       case 'partially-committed':
 *         // inspect error.outcome.committedWrites / totalWrites
 *         break;
 *       case 'committed':
 *         // data is persisted; handle after-hook / read-back separately
 *         break;
 *     }
 *   }
 * }
 */
export class WriteOutcomeError extends Error {
  readonly outcome: WriteOutcome;
  /**
   * Original failure (normalized through {@link parseFirestoreError} at construction sites).
   * Declared explicitly because this package targets ES2020 lib, which does not yet type
   * `Error.cause` / `ErrorOptions`.
   */
  readonly cause: Error;

  constructor(outcome: WriteOutcome, cause: Error) {
    super(messageForWriteOutcome(outcome));
    this.name = 'WriteOutcomeError';
    this.outcome = outcome;
    this.cause = cause;
  }
}

/**
 * Error thrown when a requested document is not found in Firestore.
 * Typically thrown by getById, update, delete operations.
 *
 * @example
 * try {
 *   await userRepo.update('non-existent-id', { name: 'John' });
 * } catch (error) {
 *   if (error instanceof NotFoundError) {
 *     console.log('User not found');
 *   }
 * }
 */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * Error thrown when Zod schema validation fails.
 * Contains detailed information about which fields failed validation.
 *
 * @example
 * try {
 *   await userRepo.create({ name: '', email: 'invalid' });
 * } catch (error) {
 *   if (error instanceof ValidationError) {
 *     console.log(error.message); // "name: String must not be empty, email: Invalid email"
 *     error.issues.forEach(issue => {
 *       console.log(`${issue.path}: ${issue.message}`);
 *     });
 *   }
 * }
 */
export class ValidationError extends Error {
  constructor(public issues: z.core.$ZodIssue[]) {
    super('Validation failed');
    this.name = 'ValidationError';

    this.message = issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(', ');
  }
}

/**
 * Error thrown when an operation conflicts with existing data.
 *
 * The library itself raises this for create-only collisions — `createWithId`,
 * `bulkCreateWithIds`, and `createWithIdInTransaction` when the target id already exists. That is
 * the normalized form of Firestore's `ALREADY_EXISTS` status (gRPC code 6), mapped to HTTP **409**
 * by the Express adapter. It is also a convenient error to throw yourself when enforcing uniqueness
 * or other business rules in application code.
 *
 * @example
 * // Library-raised: a create-only write lost the race
 * try {
 *   await userRepo.createWithId('external-id-123', { name: 'Ada' });
 * } catch (error) {
 *   if (error instanceof ConflictError) {
 *     console.log('That id is already taken');
 *   }
 * }
 *
 * @example
 * // Application-raised uniqueness check
 * const existingUser = await userRepo.findByField('email', email);
 * if (existingUser.length > 0) {
 *   throw new ConflictError('Email already exists');
 * }
 */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/**
 * Error thrown when a Firestore query requires a composite index that doesn't exist.
 * Includes the URL to automatically create the required index.
 *
 * @example
 * try {
 *   await userRepo.query()
 *     .where('status', '==', 'active')
 *     .where('createdAt', '>', yesterday)
 *     .orderBy('createdAt')
 *     .get();
 * } catch (error) {
 *   if (error instanceof FirestoreIndexError) {
 *     console.log(error.toString()); // Formatted message with index URL
 *     console.log('Fields:', error.fields);
 *     console.log('Create index at:', error.indexUrl);
 *   }
 * }
 */
export class FirestoreIndexError extends Error {
  constructor(
    public indexUrl: string,
    public fields: string[],
  ) {
    super('Query requires a Firestore index');
    this.name = 'FirestoreIndexError';
  }

  toString(): string {
    return `
╔════════════════════════════════════════════════════════════════╗
║           FIRESTORE INDEX REQUIRED                             ║
╚════════════════════════════════════════════════════════════════╝

Your query requires a composite index that doesn't exist yet.

Fields requiring index: ${this.fields.join(', ')}

To fix this:
1. Click the link below to create the index automatically
2. Wait 1-2 minutes for the index to build
3. Run your query again

Create Index: ${this.indexUrl}

Note: This is a one-time setup per query pattern.
        `.trim();
  }
}

/**
 * Error thrown when a write's `lastUpdateTime` precondition did not hold — the document was modified
 * (or removed) by someone else since the version the caller read. This is the lost-update signal for
 * optimistic-concurrency (compare-and-set) writes.
 *
 * Normalized from Firestore's `FAILED_PRECONDITION` status (gRPC code 9) by
 * {@link parseFirestoreError}, and mapped to HTTP **412 Precondition Failed** by the Express adapter.
 * The failing write is never applied — the stored document is left exactly as the other writer left
 * it, so a retry is always safe.
 *
 * Note the two neighboring cases this is deliberately NOT used for:
 * - a create-only collision (`createWithId` on an id that already exists) is `ALREADY_EXISTS`
 *   (gRPC 6) and surfaces as {@link ConflictError} → HTTP 409;
 * - a *missing* document is only a {@link NotFoundError} when no precondition was supplied. With a
 *   `lastUpdateTime`, Firestore reports the missing document as a failed precondition (stored
 *   version 0), so `update(id, data, { lastUpdateTime })` on a deleted document raises this error
 *   rather than `NotFoundError`.
 *
 * @example
 * // Retry-on-conflict read-modify-write loop
 * for (let attempt = 0; attempt < 3; attempt++) {
 *   const current = await userRepo.getByIdWithUpdateTime('user-123');
 *   if (!current) throw new NotFoundError('User is gone');
 *
 *   try {
 *     await userRepo.update(
 *       current.doc.id,
 *       { loginCount: (current.doc.loginCount ?? 0) + 1 },
 *       { lastUpdateTime: current.updateTime },
 *     );
 *     break;
 *   } catch (error) {
 *     // Someone else wrote first — re-read and try again against the newer version.
 *     if (!(error instanceof PreconditionFailedError)) throw error;
 *   }
 * }
 */
export class PreconditionFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreconditionFailedError';
  }
}

/**
 * A stable, machine-readable reason for an invalid Firestore document id or path segment.
 */
export type InvalidDocumentIdReason =
  | 'not_string'
  | 'empty'
  | 'contains_slash'
  | 'reserved_dot_segment'
  | 'reserved_namespace'
  | 'too_long'
  | 'invalid_utf8';

/**
 * Error thrown when a caller-supplied document id, collection segment, or subcollection name is not a
 * single valid Firestore path segment.
 *
 * This is a real server-side boundary: the Admin SDK bypasses Firestore Security Rules (access is
 * governed by IAM), so `CollectionReference.doc(id)` — which accepts a slash-separated *path* — would
 * otherwise let a slash-containing id address a document outside the repository's collection. The
 * repository validates every externally-supplied id/segment before any read, write, or hook runs.
 *
 * @example
 * try {
 *   await userRepo.getById(req.params.id); // untrusted route param
 * } catch (error) {
 *   if (error instanceof InvalidDocumentIdError) {
 *     res.status(400).json({ error: 'Invalid id', reason: error.reason });
 *   }
 * }
 */
export class InvalidDocumentIdError extends Error {
  constructor(
    message: string,
    public reason: InvalidDocumentIdReason,
  ) {
    super(message);
    this.name = 'InvalidDocumentIdError';
  }
}
