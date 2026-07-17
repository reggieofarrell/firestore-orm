# Performance

How firestore-orm operations map to Firestore billing, what each call costs under the hood,
cost-optimization patterns, and rough latency benchmarks.

[← Documentation index](./README.md) · [Project README](../../README.md)

## Understanding Performance Costs

### Firestore Pricing Model

Firestore charges for:

1. **Document reads** - Every document returned from a query
2. **Document writes** - Every create, update, or delete
3. **Document deletes** - Separate charge from writes
4. **Storage** - Data stored in your database
5. **Network egress** - Data transferred out of Google Cloud

### Operation Costs

| Operation                  | Cost                                         | Notes                                     |
| -------------------------- | -------------------------------------------- | ----------------------------------------- |
| `getById()`                | 1 read                                       | Single document lookup                    |
| `query().limit(100).get()` | 100 reads                                    | Reads up to 100 documents                 |
| `query().get()`            | 1 read per result                            | Charges for every matched document        |
| `query().count()`          | 1 read per 1000 docs                         | Aggregation query (cheaper than fetching) |
| `create()`                 | 1 write                                      | Single write operation                    |
| `bulkCreate(100)`          | 100 writes                                   | Batched but still counts as 100 writes    |
| `update()`                 | 1 write                                      | Even if updating one field                |
| `delete()`                 | 1 delete                                     | Permanently removes document              |
| `query().update()`         | 1 write per match                            | Efficient batch update                    |
| `onSnapshot()`             | 1 read per doc initially + 1 read per change | Real-time listener costs                  |

### What Happens Under the Hood

**Simple Query**

```typescript
const users = await userRepo.query().where('status', '==', 'active').limit(10).get();
```

1. Firestore executes the query with the `status` filter and `limit(10)`
2. Returns up to 10 documents
3. **Cost**: 10 reads (or fewer if less than 10 matches)

**Pagination**

```typescript
const { items, nextCursor, hasMore } = await userRepo
  .query()
  .orderBy('createdAt', 'desc')
  .paginate(20, cursor);
```

1. Requires at least one `orderBy()` clause for stable paging
2. If `cursor` provided, decodes cursor and fetches that document first (1 read)
3. Executes query with `limit(pageSize + 1)` to detect whether more pages exist
4. Returns up to `pageSize` items plus `hasMore` and `nextCursor`
5. **Cost** (page size 20): up to 21 query reads (+1 extra cursor lookup read when cursor provided)

**Bulk Create**

```typescript
await userRepo.bulkCreate(users); // 500 users
```

1. Validates all 500 documents against schema
2. Splits into batches of 500 operations (Firestore limit)
3. Commits each batch sequentially
4. **Cost**: 500 writes

**Query Update**

```typescript
await orderRepo.query().where('status', '==', 'pending').update({ status: 'shipped' }); // 150 matches
```

1. Executes query to find matching documents (150 reads)
2. Batches updates in groups of 500
3. Commits all updates
4. **Cost**: 150 reads + 150 writes

**Delete**

```typescript
await userRepo.delete(userId);
```

1. Fetches document to verify existence (1 read)
2. Deletes the document (1 delete)
3. **Cost**: 1 read + 1 delete

**Transaction**

```typescript
await accountRepo.runInTransaction(async (tx, repo) => {
  const from = await repo.getForUpdateInTransaction(tx, 'acc-1');
  const to = await repo.getForUpdateInTransaction(tx, 'acc-2');

  await repo.updateInTransaction(tx, 'acc-1', { balance: from.balance - 100 });
  await repo.updateInTransaction(tx, 'acc-2', { balance: to.balance + 100 });
});
```

1. Reads both documents within transaction (2 reads)
2. Locks both documents until transaction completes
3. Commits both updates atomically (2 writes)
4. **Cost**: 2 reads + 2 writes

### Cost Optimization Tips

1. **Use `count()` instead of fetching when you only need quantity**

   ```typescript
   // ✅ Efficient
   const total = await userRepo.query().where('status', '==', 'active').count();

   // ❌ Expensive
   const users = await userRepo.query().where('status', '==', 'active').get();
   const total = users.length;
   ```

2. **Limit query results**

   ```typescript
   // Always add reasonable limits
   await userRepo.query().limit(100).get();
   ```

3. **Use `exists()` for presence checks**

   ```typescript
   // ✅ Reads at most 1 document
   const hasOrders = await orderRepo.query().where('userId', '==', userId).exists();

   // ❌ Reads all matching documents
   const orders = await orderRepo.query().where('userId', '==', userId).get();
   const hasOrders = orders.length > 0;
   ```

4. **Select specific fields to reduce bandwidth**

   ```typescript
   // Reduces network transfer (still charges for full document read)
   const emails = await userRepo.query().select('email').get();
   ```

5. **Be cautious with real-time listeners**

   ```typescript
   // Charges for every document on initial load + every change
   // Use narrow filters
   await orderRepo
     .query()
     .where('userId', '==', userId)
     .where('status', '==', 'active')
     .onSnapshot(callback);
   ```

## Performance Benchmarks

Based on testing with Firebase Admin SDK:

| Operation         | Documents          | Time   | Notes                              |
| ----------------- | ------------------ | ------ | ---------------------------------- |
| `create()`        | 1                  | ~50ms  | Single document write              |
| `bulkCreate()`    | 100                | ~300ms | Batched writes                     |
| `bulkCreate()`    | 500                | ~800ms | Single batch                       |
| `bulkCreate()`    | 1000               | ~1.6s  | Split into 2 batches               |
| `getById()`       | 1                  | ~30ms  | Cached locally after first read    |
| `query().get()`   | 100                | ~100ms | Includes network + deserialization |
| `query().count()` | 10,000             | ~200ms | Aggregation query                  |
| `update()`        | 1                  | ~50ms  | Partial update                     |
| `bulkUpdate()`    | 100                | ~350ms | Batched updates                    |
| `transaction`     | 2 reads + 2 writes | ~100ms | Atomic operation                   |

**Notes:**

- Network latency varies by region
- Firestore has built-in caching for frequently accessed docs
- Use `limit()` and pagination for large collections
