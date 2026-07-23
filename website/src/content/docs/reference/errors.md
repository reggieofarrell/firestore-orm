---
title: 'Error Handling'
description: 'Error classes, when they throw, and the parseFirestoreError normalizer.'
---

Typed error classes for validation, not-found, conflict, malformed-id, and missing-index failures,
plus the `parseFirestoreError` normalizer. The drop-in Express middleware that maps these to HTTP
responses lives in [Express integration](/firestore-orm/guides/integrations/express/).

## Overview

The ORM throws a small set of typed errors so you can branch on failure cause instead of parsing
strings. Every error extends the built-in `Error`, so `instanceof` checks work as expected:

```typescript
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  FirestoreIndexError,
  InvalidDocumentIdError,
} from '@reggieofarrell/firestore-orm';

try {
  await userRepo.create(invalidData);
} catch (error) {
  if (error instanceof ValidationError) {
    // Handle validation errors
    error.issues.forEach(issue => {
      console.log(`${issue.path}: ${issue.message}`);
    });
  } else if (error instanceof InvalidDocumentIdError) {
    // Handle a malformed document id
    console.log(`Invalid document id (${error.reason})`);
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

- `issues: ZodIssue[]` — the array of underlying Zod validation issues (each has `path` and
  `message`)
- `message: string` — a formatted summary built from the issues (each rendered as `path: message`,
  comma-joined), e.g. `email: Invalid email address, age: Too small: expected number to be >0`. The
  message text is produced by Zod, so it varies by Zod version and any custom messages you set.

### `InvalidDocumentIdError`

Thrown when a document id is malformed. Every id-taking surface validates its id before touching
Firestore — `repo.id(raw)`, `getById`, `update`, `patch`, `upsert`, `delete`, the `bulk*` methods,
their `*InTransaction` equivalents, and `whereId` — and rejects an id that contains `/`, is `.` or
`..`, is wrapped in `__…__`, is empty, or exceeds 1500 bytes. See
[Document Identity](/firestore-orm/guides/concepts/document-identity/).

Properties:

- `reason: InvalidDocumentIdReason` — a discriminant describing why the id was rejected
- `message: string` — error description

### `NotFoundError`

Thrown when a document that must exist is missing. Specifically:

- the `*OrThrow` reads — `getByIdOrThrow(id)` and `getOneByFieldOrThrow(field, value)` (the latter
  when **no** document matches)
- `delete(id)` on a document that does not exist

It is also the normalized form of a raw Firestore `not-found` error (see `parseFirestoreError`).

Properties:

- `message: string` — error description, e.g. `Document with id user-123 not found`

### `ConflictError`

Thrown by `getOneByFieldOrThrow(field, value)` when **more than one** document matches the field
value — the method expects exactly one. It is also a convenient error to throw yourself when
enforcing uniqueness or other business rules in application code.

Properties:

- `message: string` — error description

### `FirestoreIndexError`

Thrown when a query requires a composite index that does not exist yet. The error carries the
Firebase console URL that creates the required index automatically.

Properties:

- `indexUrl: string` — URL to create the required index
- `fields: string[]` — the fields that require indexing
- `toString(): string` — returns a formatted, human-readable message with the index URL and setup
  instructions

## Normalizing raw Firestore errors

```typescript
import { parseFirestoreError } from '@reggieofarrell/firestore-orm';
```

**`parseFirestoreError(error: unknown): Error`**

Normalizes a raw error thrown by the Firestore SDK into one of the ORM's typed errors. The
repository and query builder call this internally on every operation, so you normally never invoke
it directly — the errors you catch are already normalized. It maps:

- a Firestore `not-found` error (gRPC code `5`) → `NotFoundError`
- an index-required error (gRPC code `9` whose details mention `requires an index`) →
  `FirestoreIndexError`, with `indexUrl` and `fields` extracted from the error details
- any other `Error` → returned unchanged; a non-`Error` value (a string or plain object) is wrapped
  in a new `Error`

## Mapping errors to HTTP responses

The ORM ships a pre-built Express middleware that maps these error classes to HTTP status codes and
JSON bodies. It is published from the optional `@reggieofarrell/firestore-orm/express` subpath and
is documented, with the full status-code and response-body tables, in
[Express integration](/firestore-orm/guides/integrations/express/#error-handling-middleware).
