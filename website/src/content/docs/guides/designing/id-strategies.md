---
title: 'ID Strategies'
description:
  'Choose between auto-generated, deterministic, and shared document ids — and how to write each
  with the repository.'
---

The Firestore document name is your document's identity (see
[Document Identity](/firestore-orm/guides/concepts/document-identity/)). Choosing how that name is
assigned is a modeling decision. This page covers the three common strategies and how to write each.

## Auto-generated ids (the default)

Let Firestore assign a random id. Use `create(data)` — it generates the id and returns `{ id }` (or
the document with `{ returnDoc: true }`). This is the right default for entities with no natural key
(users created by sign-up, orders, events):

```typescript
const { id } = await orderRepo.create({ total: 42, status: 'pending' });
```

If you need the id **before** writing — e.g. to reference it from another document in the same
request — mint one with `repo.newId()` and write under it with `upsert`:

```typescript
const orderId = orderRepo.newId();
await invoiceRepo.upsert(invoiceId, { orderId }); // reference it first
await orderRepo.upsert(orderId, { total: 42, status: 'pending' });
```

## Deterministic / static ids

When a document has a natural key — a slug, an external system's id, a singleton config document —
use that value as the id and write with **`upsert(id, data)`** (create-or-overwrite). This makes the
write idempotent (re-running it doesn't create duplicates) and lets you fetch the document without a
query:

```typescript
// A singleton config document at a fixed id
await configRepo.upsert('app-config', { featureFlags: { darkMode: true } });

// A record keyed by an external id
await productRepo.upsert(`sku-${sku}`, { name, price });
```

Validate any externally-sourced id at the boundary with `repo.id(rawKey)` before using it as a
document name — see [Document Identity](/firestore-orm/guides/concepts/document-identity/).

## Shared ids across collections

To model a 1:1 relationship, store two documents under the **same id** in different collections (a
`users/{uid}` profile and a `userSettings/{uid}` document). Reads become direct `getById(uid)`
lookups on either collection — no query, no join. Write the secondary document with `upsert(uid, …)`
so it lands at the shared id.

## Choosing

| Strategy       | Write method       | Use when                                              |
| -------------- | ------------------ | ----------------------------------------------------- |
| Auto-generated | `create(data)`     | No natural key; the common case                       |
| Deterministic  | `upsert(id, data)` | A natural key / slug / external id; idempotent writes |
| Singleton      | `upsert(id, data)` | Exactly one document (config, counters)               |
| Shared (1:1)   | `upsert(id, data)` | A parallel document keyed by another collection's id  |

See [CRUD Operations](/firestore-orm/guides/working-with-data/crud-operations/) for the full write
surface and [FirestoreRepository](/firestore-orm/reference/repository/) for signatures.
