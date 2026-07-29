---
title: 'Real-time & Listeners'
description:
  'Subscribe to live updates — listenOne for a single document and query onSnapshot for a result
  set.'
---

FirestoreORM exposes real-time surfaces at two levels: `listenOne` / `listenOneDetailed` for a single
document, and the query builder's `onSnapshot` / `onSnapshotDetailed` for a live result set. Simple
listeners deliver fully-typed `FirestoreDocument<T>` arrays or values; detailed listeners add mapped
`docChanges()` semantics and snapshot provenance.

## Listen to a single document

`repo.listenOne(id, callback, onError?)` subscribes to one document by id and returns an
**unsubscribe function** synchronously. The callback fires with the current `FirestoreDocument<T>`
on every change.

```typescript
const unsubscribe = userRepo.listenOne(
  'user-123',
  user => {
    console.log('User changed:', user.name);
    updateProfileView(user);
  },
  error => {
    console.error('Listen error:', error);
  },
);

// Stop listening when done
unsubscribe();
```

### `listenOneDetailed`

`repo.listenOneDetailed(id, callback, onError?)` delivers `{ doc, metadata }` on every change — the
same provenance fields as `getById(id, { withMetadata: true })`. Returns an unsubscribe function
synchronously.

When the document is **deleted**, the call routes to `onError(new NotFoundError(...))` (mirrors
`listenOne`) rather than invoking the callback with a nullable document. The underlying deletion
snapshot has no `createTime` / `updateTime` to build metadata from.

```typescript
const unsubscribe = userRepo.listenOneDetailed(
  'user-123',
  ({ doc, metadata }) => {
    console.log(doc.name, metadata.updateTime.toDate());
  },
  error => {
    if (error instanceof NotFoundError) {
      // Document was deleted — tear down UI state.
    }
  },
);
```

See [FirestoreRepository](/firestore-orm/reference/repository/) for signatures.

## Listen to a query

`query().onSnapshot(callback, onError?)` subscribes to a live query result set. Unlike `listenOne`,
it resolves to a **Promise** of the unsubscribe function. The callback receives the full set of
matching documents on every change.

```typescript
const unsubscribe = await orderRepo
  .query()
  .where('status', '==', 'active')
  .onSnapshot(
    orders => {
      console.log(`Active orders: ${orders.length}`);
      updateDashboard(orders);
    },
    error => {
      console.error('Snapshot error:', error);
    },
  );

// Stop listening when done
unsubscribe();
```

### `onSnapshotDetailed`

`query().onSnapshotDetailed(callback, onError?)` resolves to an unsubscribe function and delivers a
`DetailedQuerySnapshot<R>` on every emission:

- `docs` — every document currently matching the query, in query order
- `changes` — what changed since the previous emission (`DetailedDocumentChange<R>` entries)
- `size`, `empty`, `readTime`

The **first** emission reports every matching document as `type: 'added'` with `oldIndex: -1` and
`newIndex` set to its position. Later emissions carry `modified` and `removed` entries with the
index semantics Firestore reports (`oldIndex === newIndex` for in-place edits; indices shift when
the query order changes).

```typescript
const unsubscribe = await orderRepo
  .query()
  .where('status', '==', 'active')
  .onSnapshotDetailed(snapshot => {
    for (const change of snapshot.changes) {
      if (change.type === 'added') {
        addRow(change.doc);
      } else if (change.type === 'modified') {
        updateRow(change.doc);
      } else if (change.type === 'removed') {
        // ⚠️ change.doc still carries last-known data — branch on type, not exists.
        removeRow(change.doc.id);
      }
    }
  });
```

:::caution
For a `removed` change, `change.doc` and `change.metadata` describe the document **as it last was**.
The underlying snapshot still reports `exists: true` with final `createTime` / `updateTime`. Branch
on `change.type`, never on `change.doc` or snapshot existence. `metadata.readTime` is the emission's
read time, not a deletion timestamp — Firestore does not report one.
:::

`onSnapshotDetailed()` **cannot** be combined with `select()`: Firestore does not allow a real-time
listener on a field-masked query, so the builder throws locally with a clear error. Listen without
`select()` and project inside your callback, or use `get()` / `stream()` for a one-time projected
read. See [Queries](/firestore-orm/guides/working-with-data/queries/) for the full builder.

## Cost

Real-time listeners charge you for every document that matches your query on the initial snapshot,
plus additional reads each time a matching document changes. Use narrow filters, and consider
polling for less critical data — see
[Performance & Cost](/firestore-orm/guides/designing/performance/).
