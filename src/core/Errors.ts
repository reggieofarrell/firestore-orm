import z from 'zod';

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
 * Useful for enforcing uniqueness constraints or business rules.
 *
 * @example
 * // In your application code
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
