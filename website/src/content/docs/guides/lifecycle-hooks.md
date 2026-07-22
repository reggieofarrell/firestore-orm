---
title: 'Lifecycle Hooks'
description: 'before*/after* lifecycle hooks, payloads, and ordering around validated writes.'
---

Inject custom logic at specific points in the data lifecycle — auditing, enrichment, validation, and
cleanup — without cluttering your business logic.

## Overview

Hooks let you observe and shape writes as they flow through the repository. Register them with
`on(event, fn)`; the callback may be synchronous or `async` (the repository awaits it). A single
event can carry multiple listeners, and they run in registration order.

```typescript
userRepo.on('afterCreate', async user => {
  await auditLog.record('user_created', user);
});
```

## Hook execution order

- `before*` hooks run first and can enrich or normalize the payload before schema validation.
- The validated payload is the one persisted to Firestore.
- `after*` hooks run only after a successful write.
- Bulk operations fire the corresponding `beforeBulk*` / `afterBulk*` events with the same ordering
  guarantees.

Because `before*` runs before validation, it is the correct place to fill in defaults, coerce
values, or reject a write early. See [CRUD operations](./crud-operations/) for the write methods
these hooks wrap.

## Available hooks

- **Single operations**: `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`,
  `beforeDelete`, `afterDelete`
- **Bulk operations**: `beforeBulkCreate`, `afterBulkCreate`, `beforeBulkUpdate`, `afterBulkUpdate`,
  `beforeBulkDelete`, `afterBulkDelete`

## Hook payloads

| Event                                  | Payload                                                   |
| -------------------------------------- | --------------------------------------------------------- |
| `beforeCreate`                         | The create payload (before validation)                    |
| `afterCreate`                          | The created document, including the generated `id`        |
| `beforeUpdate`                         | The update payload plus the target `id` (`data & { id }`) |
| `afterUpdate`                          | `{ id }`                                                  |
| `beforeDelete` / `afterDelete`         | The full persisted document (`{ ...data, id }`)           |
| `beforeBulkCreate` / `afterBulkCreate` | An array of created documents (each including `id`)       |
| `beforeBulkUpdate`                     | `{ id, data }[]`                                          |
| `afterBulkUpdate`                      | `{ ids: string[] }`                                       |
| `beforeBulkDelete` / `afterBulkDelete` | `{ ids: string[]; documents: (T & { id })[] }`            |

Delete hooks (single and bulk) receive the full persisted document(s) as they existed before
deletion, so cleanup logic has access to every field, not just the `id`.

### Hook payload immutability

Hook payloads protect identity and accounting:

- **Identity is read-only.** The `id` / `ids` on a payload cannot be repointed by a hook, and the
  event envelopes and bulk arrays are frozen — a hook cannot reorder, splice, or replace entries to
  redirect or suppress a write.
- **Before-update hooks may mutate data _in place_** (`entry.data.someField = …`) but may not
  replace the whole `data` object.
- **Delete payloads are observe-only and deep-frozen**, so a `beforeDelete`/`beforeBulkDelete` hook
  cannot forge nested data that a later `afterDelete`/`afterBulkDelete` hook (or an audit/outbox
  consumer) then observes. **Limitation:** a class-instance field value returned by a
  `readConverter` (e.g. a mutable `Date`, `Map`, or custom class) is not cloned or frozen — treat
  such values as observe-only by convention.

## Examples

```typescript
// Log all user creations
userRepo.on('afterCreate', async user => {
  console.log(`User created: ${user.id}`);
  await auditLog.record('user_created', user);
});

// Send welcome email
userRepo.on('afterCreate', async user => {
  await sendWelcomeEmail(user.email);
});

// Validate business rules before update
orderRepo.on('beforeUpdate', data => {
  if (data.status === 'shipped' && !data.trackingNumber) {
    throw new Error('Tracking number required for shipped orders');
  }
});

// Enrich create payload before validation (e.g., timestamps/defaults)
orderRepo.on('beforeCreate', data => {
  data.createdAt = new Date().toISOString();
  data.updatedAt = new Date().toISOString();
});

// Clean up related data after deletion
userRepo.on('afterDelete', async user => {
  await orderRepo.query().where('userId', '==', user.id).delete();
});
```

In the last example, `query().delete()` is a query-level bulk write that does **not** fire delete
hooks (see below) — which is exactly what you want here, since it avoids re-triggering cleanup logic
recursively.

## Query-level writes run the bulk hooks

`query().update(data)` runs `beforeBulkUpdate` and `afterBulkUpdate`; `query().delete()` runs
`beforeBulkDelete` and `afterBulkDelete`. `beforeBulkUpdate` may mutate the update payload before it
is validated and written, `afterBulkUpdate` receives `{ ids }` for the written documents, and the
bulk-delete hooks receive `{ ids, documents }`. The per-document `before/afterUpdate` and
`before/afterDelete` hooks do **not** run on query-level writes — use the single-document methods
when you need those. See [Queries](./queries/).

## When hooks do not run

Hooks are wired into the per-document and bulk methods on the repository. One path differs from that
standard flow:

- **Transactions — `before*` only.** Inside `runInTransaction((tx, repo) => { ... })`, the
  transaction-scoped `repo`'s write helpers (`createInTransaction`, `updateInTransaction`,
  `patchInTransaction`, `deleteInTransaction`) **do** run their `before*` hooks (before validation
  and the staged write). Their `after*` hooks do **not** run — the transaction has not committed
  while the callback executes, so post-commit side effects belong after `runInTransaction` resolves.
  See [Transactions](./transactions/).
