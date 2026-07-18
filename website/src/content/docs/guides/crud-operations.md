---
title: 'CRUD Operations'
description: 'Create, read, update, delete, and bulk variants on FirestoreRepository.'
---

Create, read, update, upsert, and delete documents — and run batched bulk writes — through the
repository API.

## Single-document operations

Every write strips any `id` from the payload: the document id comes from the auto-generated
Firestore id on `create`/`bulkCreate`, or from the `id` argument you pass to `update`, `patch`,
`upsert`, and `delete`.

```typescript
// CREATE — returns the created document as `T & { id }`
const user = await userRepo.create({
  name: 'Alice',
  email: 'alice@example.com',
});

// READ
const user = await userRepo.getById('user-123'); // (T & { id }) | null
const strictUser = await userRepo.getByIdOrThrow('user-123'); // Throws NotFoundError when missing
const users = await userRepo.getAll(); // Fetch all docs
const usersByEmail = await userRepo.findByField('email', 'alice@example.com'); // All matches
const oneUserByEmail = await userRepo.getOneByField('email', 'alice@example.com'); // First match or null
const strictUserByEmail = await userRepo.getOneByFieldOrThrow('email', 'alice@example.com'); // See below

// UPDATE (default return is { id: 'user-123' })
await userRepo.update('user-123', {
  name: 'Alice Updated',
});

// UPDATE AND RETURN DOCUMENT
const updatedUser = await userRepo.update(
  'user-123',
  { name: 'Alice Updated Again' },
  { returnDoc: true },
);

// UPDATE WITH MERGE (deep-merges nested objects instead of replacing them wholesale)
await userRepo.update('user-123', { profile: { nickname: 'Ally' } } as any, { merge: true });

// PATCH (always merges — there is no merge option, only { returnDoc? })
await userRepo.patch('user-123', { name: 'Alice Patched' });

// UPSERT (create if doesn't exist, update if exists)
await userRepo.upsert('user-123', {
  name: 'Alice',
  email: 'alice@example.com',
});

// UPSERT AND RETURN DOCUMENT
const upsertedUser = await userRepo.upsert(
  'user-123',
  { name: 'Alice', email: 'alice@example.com' },
  { returnDoc: true },
);

// DELETE
await userRepo.delete('user-123'); // Hard delete; throws NotFoundError if the doc is missing
```

### Read methods

| Method                             | Returns                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `getById(id)`                      | `(T & { id }) \| null`                                                        |
| `getByIdOrThrow(id)`               | `T & { id }` — throws `NotFoundError` when the doc is missing                 |
| `getAll()`                         | All documents in the collection                                               |
| `findByField(field, value)`        | Array of all matching documents                                               |
| `getOneByField(field, value)`      | First match, or `null` when there are none                                    |
| `getOneByFieldOrThrow(field, val)` | Single match — throws `NotFoundError` on zero, `ConflictError` on two or more |

### Update vs. patch

- `update(id, data, options?)` accepts `{ merge?, returnDoc? }`. It is always a **partial** update —
  unspecified top-level fields are left unchanged. By default a nested object in the payload
  replaces that field's stored value wholesale; pass `{ merge: true }` to deep-merge nested objects
  instead (they are flattened to dot-paths, so sibling nested fields are preserved).
- `patch(id, data, options?)` accepts `{ returnDoc? }` **only** — `patch` always merges, so there is
  no `merge` option to set.

Both dot-notation and nested-object updates are supported; see
[Dot-notation nested updates](./dot-notation/) for the merge semantics of paths like
`'profile.nickname'`.

## Bulk Operations

Bulk operations use Firestore batch writes and commit in batches of 500 operations. The ORM
automatically chunks operations if you exceed this limit, so you can pass arrays of any size.

```typescript
// Bulk create — returns the created documents as `(T & { id })[]`
const users = await userRepo.bulkCreate([
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob', email: 'bob@example.com' },
  { name: 'Charlie', email: 'charlie@example.com' },
]);

// Bulk update (returns [{ id: 'user-1' }, { id: 'user-2' }])
await userRepo.bulkUpdate([
  { id: 'user-1', data: { status: 'active' } },
  { id: 'user-2', data: { status: 'inactive' } },
]);

// Bulk patch (always merges each document)
await userRepo.bulkPatch([
  { id: 'user-1', data: { lastSeenAt: Date.now() } },
  { id: 'user-2', data: { lastSeenAt: Date.now() } },
]);

// Bulk delete — returns the count of documents that actually existed (not the input length)
const deletedCount = await userRepo.bulkDelete(['user-1', 'user-2', 'user-3']);
```

**Performance Tip**: For simple bulk updates on query results, use `query().update()` instead:

```typescript
// More efficient - single query + batched writes
await orderRepo.query().where('status', '==', 'pending').update({ status: 'shipped' });

// Less efficient - fetches all IDs first, then updates
const orders = await orderRepo.query().where('status', '==', 'pending').get();
await orderRepo.bulkUpdate(orders.map(o => ({ id: o.id, data: { status: 'shipped' } })));
```

Note that `query().update()` and `query().delete()` do **not** run
[lifecycle hooks](./lifecycle-hooks/); use the per-document or bulk repository methods when you need
hook side effects.
