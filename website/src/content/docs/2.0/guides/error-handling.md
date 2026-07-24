---
title: Error Handling
description: Error classes, when they throw, parseFirestoreError, and the
  Express error middleware.
slug: 2.0/guides/error-handling
---

Typed error classes for validation, not-found, conflict, and missing-index failures, plus a drop-in
Express middleware that maps them to HTTP responses.

## Overview

The ORM throws a small set of typed errors so you can branch on failure cause instead of parsing
strings. Every error extends the built-in `Error`, so `instanceof` checks work as expected:

```typescript
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  FirestoreIndexError,
} from '@reggieofarrell/firestore-orm';

try {
  await userRepo.create(invalidData);
} catch (error) {
  if (error instanceof ValidationError) {
    // Handle validation errors
    error.issues.forEach(issue => {
      console.log(`${issue.path}: ${issue.message}`);
    });
  } else if (error instanceof NotFoundError) {
    // Handle not found
    console.log('Document not found');
  } else if (error instanceof FirestoreIndexError) {
    // Handle missing composite index
    console.log(error.toString()); // Includes link to create index
  }
}
```

Raw Firestore errors (for example a missing composite index) are normalized into these classes by
`parseFirestoreError` before they reach your `catch` block — see
[Normalizing raw Firestore errors](#normalizing-raw-firestore-errors) below.

## Error classes

### `ValidationError`

Thrown when Zod schema validation fails on a write (`create`, `bulkCreate`, `update`, `patch`,
`upsert`, and their transaction/query-builder equivalents).

Properties:

* `issues: ZodIssue[]` — the array of underlying Zod validation issues (each has `path` and
  `message`)
* `message: string` — a formatted summary built from the issues (each rendered as `path: message`,
  comma-joined), e.g. `email: Invalid email address, age: Too small: expected number to be >0`. The
  message text is produced by Zod, so it varies by Zod version and any custom messages you set.

### `NotFoundError`

Thrown when a document that must exist is missing. Specifically:

* the `*OrThrow` reads — `getByIdOrThrow(id)` and `getOneByFieldOrThrow(field, value)` (the latter
  when **no** document matches)
* `delete(id)` on a document that does not exist

It is also the normalized form of a raw Firestore `not-found` error (see `parseFirestoreError`).

Properties:

* `message: string` — error description, e.g. `Document with id user-123 not found`

### `ConflictError`

Thrown by `getOneByFieldOrThrow(field, value)` when **more than one** document matches the field
value — the method expects exactly one. It is also a convenient error to throw yourself when
enforcing uniqueness or other business rules in application code.

Properties:

* `message: string` — error description

### `FirestoreIndexError`

Thrown when a query requires a composite index that does not exist yet. The error carries the
Firebase console URL that creates the required index automatically.

Properties:

* `indexUrl: string` — URL to create the required index
* `fields: string[]` — the fields that require indexing
* `toString(): string` — returns a formatted, human-readable message with the index URL and setup
  instructions

## Normalizing raw Firestore errors

```typescript
import { parseFirestoreError } from '@reggieofarrell/firestore-orm';
```

**`parseFirestoreError(error: any): Error`**

Normalizes a raw error thrown by the Firestore SDK into one of the ORM's typed errors. The
repository and query builder call this internally on every operation, so you normally never invoke
it directly — the errors you catch are already normalized. It maps:

* a Firestore `not-found` error (gRPC code `5`) → `NotFoundError`
* an index-required error (gRPC code `9` whose details mention `requires an index`) →
  `FirestoreIndexError`, with `indexUrl` and `fields` extracted from the error details
* anything else → returned unchanged

## Express error handler

The ORM includes a pre-built Express middleware for consistent error responses:

```typescript
import { errorHandler } from '@reggieofarrell/firestore-orm';
import express from 'express';

const app = express();

// ... your routes

// Register as last middleware
app.use(errorHandler);
```

This automatically maps errors to HTTP status codes:

* `ValidationError` → 400 Bad Request
* `NotFoundError` → 404 Not Found
* `ConflictError` → 409 Conflict
* `FirestoreIndexError` → 404 Not Found (with index URL)
* Others → 500 Internal Server Error

For a fuller Express integration walkthrough, see [Framework integration](/firestore-orm/2.0/guides/framework-integration/).

### Middleware reference

**`errorHandler(err: any, req: Request, res: Response, next: NextFunction): void`**

Express middleware for handling repository errors. Register it as the **last** middleware, after all
routes, and call `next(error)` from your route handlers (or throw and let an async wrapper forward
it) so it can process the error.

Maps errors to HTTP status codes and JSON bodies:

| Error                 | Status | Response body                                                       |
| --------------------- | ------ | ------------------------------------------------------------------- |
| `ValidationError`     | 400    | `{ error: 'ValidationError', details: issues }`                     |
| `NotFoundError`       | 404    | `{ error: 'NotFoundError', message }`                               |
| `FirestoreIndexError` | 404    | `{ error: 'Query needs to be index', message, url: indexUrl }`      |
| `ConflictError`       | 409    | `{ error: 'ConflictError', message }`                               |
| Anything else         | 500    | `{ error: 'InternalServerError', message: 'Something went wrong' }` |

The generic 500 branch intentionally hides the underlying message so internal details are not leaked
to clients.
