---
title: 'Real-time & Listeners'
description:
  'Subscribe to live updates — listenOne for a single document and query onSnapshot for a result
  set.'
---

FirestoreORM exposes two real-time surfaces: `listenOne(...)` for a single document, and the query
builder's `onSnapshot(...)` for a live result set. Both deliver fully-typed `FirestoreDocument<T>`
values and return an unsubscribe handle.

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

See [FirestoreRepository](/firestore-orm/reference/repository/) for the `listenOne` signature.

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

`onSnapshot()` **cannot** be combined with `select()`: Firestore does not allow a real-time listener
on a field-masked query, so the builder throws locally with a clear error. Listen without `select()`
and project inside your callback, or use `get()` / `stream()` for a one-time projected read. See
[Queries](/firestore-orm/guides/working-with-data/queries/) for the full builder.

## Cost

Real-time listeners charge you for every document that matches your query on the initial snapshot,
plus additional reads each time a matching document changes. Use narrow filters, and consider
polling for less critical data — see
[Performance & Cost](/firestore-orm/guides/designing/performance/).
