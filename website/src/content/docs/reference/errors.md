---
title: 'Error Handling'
description: 'Error classes, when they throw, and the parseFirestoreError normalizer.'
---

Typed error classes for validation, not-found, conflict, failed-precondition, malformed-id, and
missing-index failures, plus the `parseFirestoreError` normalizer. The drop-in Express middleware
that maps these to HTTP responses lives in
[Express integration](/firestore-orm/guides/integrations/express/).

## Overview

The ORM throws a small set of typed errors so you can branch on failure cause instead of parsing
strings. Every error extends the built-in `Error`, so `instanceof` checks work as expected:

```typescript
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  PreconditionFailedError,
  FirestoreIndexError,
  InvalidDocumentIdError,
  WriteOutcomeError,
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
  } else if (error instanceof ConflictError) {
    // A create-only write lost the race for that id
    console.log('Document already exists');
  } else if (error instanceof PreconditionFailedError) {
    // Someone else wrote the document since we read it — re-read and retry
    console.log('Stale write — document changed underneath us');
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
`upsert`, and their transaction/query-builder equivalents). On `bulkWrite`, the same failure arrives
**inside** `BulkWriteResult.error` for that item rather than rejecting the whole call.

Properties:

- `issues: ZodIssue[]` — the array of underlying Zod validation issues (each has `path` and
  `message`)
- `message: string` — a formatted summary built from the issues (each rendered as `path: message`,
  comma-joined), e.g. `email: Invalid email address, age: Too small: expected number to be >0`. The
  message text is produced by Zod, so it varies by Zod version and any custom messages you set.

### `InvalidDocumentIdError`

Thrown when a document id is malformed. Every id-taking surface validates its id before touching
Firestore — `repo.id(raw)`, `getById`, `update`, `patch`, `upsert`, `delete`, the `bulk*` methods,
their `*InTransaction` equivalents, `whereId`, and `whereFilter`'s `f.whereId` — and rejects an id
that contains `/`, is `.` or `..`, is wrapped in `__…__`, is empty, or exceeds 1500 bytes. On
`bulkWrite`, a malformed id is reported per item in `BulkWriteResult.error` (siblings still write);
`recursiveDelete` still throws this error for a bad `id`. See
[Document Identity](/firestore-orm/guides/concepts/document-identity/).

Properties:

- `reason: InvalidDocumentIdReason` — a discriminant describing why the id was rejected
- `message: string` — error description

### `NotFoundError`

Thrown when a document that must exist is missing. Specifically:

- the `*OrThrow` reads — `getByIdOrThrow(id)` and `getOneByFieldOrThrow(field, value)` (the latter
  when **no** document matches)
- `delete(id)` on a document that does not exist — including when a `lastUpdateTime` precondition
  was supplied, because the existence pre-read runs before the guarded write

It is also the normalized form of a raw Firestore `not-found` error (see `parseFirestoreError`). On
`bulkWrite`, a backend `not-found` (e.g. `update` on a missing id) lands in that item's
`BulkWriteResult.error` rather than throwing for the whole call.

Properties:

- `message: string` — error description, e.g. `Document with id user-123 not found`

### `ConflictError`

Thrown when:

- a **create-only** write loses — `createWithId`, `bulkCreateWithIds`, or
  `createWithIdInTransaction` targeting an ID that already exists. This is the normalized form of a
  raw Firestore `already-exists` error (gRPC code `6`), and the check is atomic on the backend, so
  of two concurrent creates on one ID exactly one wins and the other gets this error.
- `getOneByFieldOrThrow(field, value)` matches **more than one** document — the method expects
  exactly one.

It is also a convenient error to throw yourself when enforcing uniqueness or other business rules in
application code. On `bulkWrite`, a colliding `create` / `set` surfaces as that item's
`BulkWriteResult.error` (`ConflictError`) while siblings may still land.

Properties:

- `message: string` — error description

### `PreconditionFailedError`

Thrown when a write's `lastUpdateTime` precondition did not hold — the document was modified (or
removed) by someone else since the version you read. This is the lost-update signal for optimistic
concurrency, and it is the normalized form of a raw Firestore `failed-precondition` error (gRPC code
`9`) that is not a missing-index error.

The rejected write is never applied, so the stored document is exactly what the other writer left —
a retry against a freshly-read token is always safe. See
[Conditional writes](/firestore-orm/guides/working-with-data/crud-operations/#conditional-writes).
On `bulkWrite`, the same error arrives inside `BulkWriteResult.error` for that item.

Two neighbouring cases are deliberately **not** this error:

- a create-only collision is `ConflictError` (gRPC `6`), not a precondition failure;
- a **missing** document is `NotFoundError` only when no precondition was supplied. With a
  `lastUpdateTime`, Firestore reports the absent document as stored version 0, so
  `update(id, data, { lastUpdateTime })` on a deleted document raises `PreconditionFailedError`.
  (`delete(id, { lastUpdateTime })` still raises `NotFoundError`, because `delete` performs its own
  existence pre-read first.)

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

## Write outcomes (`WriteOutcomeError`)

Outcome-sensitive write failures — a `before*` / `after*` hook threw, a later fixed-batch chunk
failed after earlier chunks committed, or a postcommit `{ returnDoc: true }` read/converter failed —
surface as **`WriteOutcomeError`**. The original failure is preserved as `cause`. Ordinary
validation, malformed-id, not-found, conflict, and precondition errors remain their existing
top-level classes when no write committed and no hook is the failed phase.

`outcome` is a discriminated union (cause is **not** inside `outcome`, so HTTP serialization stays
safe):

| `state`               | `phase`        | Meaning                                                               |
| --------------------- | -------------- | --------------------------------------------------------------------- |
| `not-committed`       | `before-hook`  | A `before*` hook failed; no write for this call                       |
| `partially-committed` | `commit`       | Some fixed-batch writes committed (`committedWrites` / `totalWrites`) |
| `committed`           | `after-hook`   | Write committed; an `after*` hook failed                              |
| `committed`           | `read-back`    | Write committed; `{ returnDoc: true }` converter/read failed          |

```typescript
try {
  await userRepo.create(data);
} catch (error) {
  if (error instanceof WriteOutcomeError) {
    switch (error.outcome.state) {
      case 'not-committed':
        // safe to retry the whole create
        break;
      case 'partially-committed':
        console.log(error.outcome.committedWrites, error.outcome.totalWrites);
        break;
      case 'committed':
        // data is persisted — handle after-hook / read-back separately
        break;
    }
  }
}
```

Key side effects by a business / write identity stored atomically with the data — not by
`HookContext.attempt` (diagnostic only). Durable after-hook delivery is tracked as
[#80](https://github.com/reggieofarrell/firestore-orm/issues/80).

`parseFirestoreError` **preserves** an existing `WriteOutcomeError` unchanged before SDK
normalization.

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
- an `already-exists` error (gRPC code `6`) → `ConflictError`
- any other `failed-precondition` error (gRPC code `9`) → `PreconditionFailedError`
- any other `Error` → returned unchanged; a non-`Error` value (a string or plain object) is wrapped
  in a new `Error`

The index-required branch is checked **before** the general code-`9` branch, so a missing-index
failure is still a `FirestoreIndexError` and never a `PreconditionFailedError`. Both the numeric
code (`6`, `9`) and the string form (`'already-exists'`, `'failed-precondition'`) are recognized.

<!-- prettier-ignore -->
:::caution[Breaking change in v3]
Before this mapping existed, an `already-exists` or non-index `failed-precondition` error passed
through `parseFirestoreError` unchanged and reached your `catch` as a raw Firestore `Error`. Code
that inspected `error.code` on those raw errors must now branch on `ConflictError` /
`PreconditionFailedError` instead.
:::

## Mapping errors to HTTP responses

The ORM ships a pre-built Express middleware that maps these error classes to HTTP status codes and
JSON bodies. It is published from the optional `@reggieofarrell/firestore-orm/express` subpath and
is documented, with the full status-code and response-body tables, in
[Express integration](/firestore-orm/guides/integrations/express/#error-handling-middleware).
