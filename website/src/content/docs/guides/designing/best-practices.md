---
title: 'Best Practices'
description: 'Recommended patterns for production use of FirestoreORM repositories and queries.'
---

Patterns and conventions for building maintainable, efficient applications with firestore-orm.

These recommendations cover repository lifecycle, query efficiency, data hygiene, and hook design.
Each one includes a working example and the reasoning behind it.

## 1. Initialize repositories once

Create repository instances once and reuse them throughout your application. Don't create new
instances inside every function.

```typescript
// ❌ Bad - Creates a new instance every time
export function getUserRepository() {
  return FirestoreRepository.withSchema(db, 'users', userSchema);
}

// ✅ Good - Single instance, reused everywhere
export const userRepo = FirestoreRepository.withSchema(db, 'users', userSchema);
```

**Why:** Repository construction is lightweight, but recreating instances repeatedly is unnecessary
and makes hook management inconsistent — hooks registered with `on()` live on the instance, so a
fresh instance loses every listener you attached to the previous one.

## 2. Organize repositories in a centralized module

Keep all repository instances and their shared hooks in one module so wiring stays discoverable and
each collection has a single source of truth.

```typescript
// repositories/index.ts
import { db } from '../config/firebase';
import { FirestoreRepository } from '@reggieofarrell/firestore-orm';
import * as schemas from '../schemas';

export const userRepo = FirestoreRepository.withSchema(db, 'users', schemas.userSchema);

export const orderRepo = FirestoreRepository.withSchema(db, 'orders', schemas.orderSchema);

export const productRepo = FirestoreRepository.withSchema(db, 'products', schemas.productSchema);

// Setup common hooks
userRepo.on('afterCreate', async user => {
  await auditLog.record('user_created', user);
});

orderRepo.on('afterCreate', async order => {
  await notificationService.sendOrderConfirmation(order);
});
```

## 3. Use cursor-based pagination over offset

For large datasets, cursor-based pagination is significantly more efficient than offset pagination.
`paginate(pageSize, cursor?)` requires a prior `orderBy()` and returns
`{ items, nextCursor, hasMore }`; pass the previous page's `nextCursor` back in to advance.

```typescript
// ✅ Good - Cursor-based (scales well)
const { items, nextCursor, hasMore } = await userRepo
  .query()
  .orderBy('createdAt', 'desc')
  .paginate(20, lastCursor);

// ❌ Avoid - Offset-based (expensive for large page numbers)
const result = await userRepo.query().orderBy('createdAt', 'desc').offsetPaginate(100, 20); // Skip 1980 docs to reach page 100
```

**Why:** Offset pagination requires Firestore to scan and skip every document before your offset,
while cursor pagination jumps directly to the starting position. See
[Queries](/firestore-orm/guides/working-with-data/queries/) for the full pagination API.

## 4. Use query updates for bulk operations

When updating multiple documents based on a condition, use `query().update()` instead of fetching
and then updating.

```typescript
// ✅ Good - Single query, batched writes
await orderRepo
  .query()
  .where('status', '==', 'pending')
  .where('createdAt', '<', cutoffDate)
  .update({ status: 'expired' });

// ❌ Less efficient - Two operations
const orders = await orderRepo
  .query()
  .where('status', '==', 'pending')
  .where('createdAt', '<', cutoffDate)
  .get();

await orderRepo.bulkUpdate(orders.map(o => ({ id: o.id, data: { status: 'expired' } })));
```

**Note:** `query().update()` and `query().delete()` run the **bulk** lifecycle hooks
(`beforeBulkUpdate`/`afterBulkUpdate`, `beforeBulkDelete`/`afterBulkDelete`), not the per-document
`before/afterUpdate` hooks. If you rely on per-document `beforeUpdate`/`afterUpdate` side effects,
use per-document `update` instead. See
[Lifecycle hooks](/firestore-orm/guides/concepts/lifecycle-hooks/).

## 5. Add timestamps consistently

Always add `createdAt` and `updatedAt` timestamps to track the data lifecycle. Note that the schema
does not declare a top-level `id` — the repository sources `doc.id` from the document name.

```typescript
const userSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// On create
await userRepo.create({
  ...data,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

// On update
await userRepo.update(id, {
  ...data,
  updatedAt: new Date().toISOString(),
});
```

If you prefer to store native Firestore timestamps instead of ISO strings, see
[Timestamps](/firestore-orm/guides/concepts/timestamps/) for the millisecond converter and the
hook-based write conversion pattern.

## 6. Handle composite index errors gracefully

Firestore requires composite indexes for certain query combinations. The ORM surfaces a
`FirestoreIndexError` with a clear message and a link to create the missing index.

```typescript
try {
  const results = await orderRepo
    .query()
    .where('status', '==', 'pending')
    .where('total', '>', 100)
    .orderBy('createdAt', 'desc')
    .get();
} catch (error) {
  if (error instanceof FirestoreIndexError) {
    console.log(error.toString());
    // Logs a formatted message with a link to create the index.
    // Click the link, wait 1-2 minutes for the index to build, then retry the query.
  }
}
```

See [Error handling](/firestore-orm/reference/errors/) for the full error taxonomy and
[Troubleshooting](/firestore-orm/reference/troubleshooting/) for index-related tips.

## 7. Use transactions for critical operations

Any operation requiring consistency across multiple documents should use a transaction.
`runInTransaction` passes a transaction-scoped repository; do all reads with
`getForUpdateInTransaction` before any writes.

```typescript
// ✅ Atomic transfer
await accountRepo.runInTransaction(async (tx, repo) => {
  const from = await repo.getForUpdateInTransaction(tx, fromId);
  const to = await repo.getForUpdateInTransaction(tx, toId);

  // getForUpdateInTransaction returns FirestoreDocument<Account> | null — guard before use.
  if (!from || !to) {
    throw new Error('Account not found');
  }

  if (from.balance < amount) {
    throw new Error('Insufficient funds');
  }

  await repo.updateInTransaction(tx, fromId, {
    balance: from.balance - amount,
  });

  await repo.updateInTransaction(tx, toId, {
    balance: to.balance + amount,
  });
});
```

See [Transactions](/firestore-orm/guides/working-with-data/transactions/) for the complete
transaction-scoped API.

## 8. Use streaming for large data exports

When processing large datasets (exports, migrations, batch jobs), use `query().stream()` to iterate
lazily and avoid loading everything into memory.

```typescript
// ✅ Memory efficient
const csvStream = createWriteStream('users.csv');
csvStream.write('name,email,status\n');

for await (const user of userRepo.query().stream()) {
  csvStream.write(`${user.name},${user.email},${user.status}\n`);
}

csvStream.end();
```

## 9. Structure hooks for reusability

Keep hooks focused and modular. Avoid putting complex business logic directly inside a hook —
delegate to a dedicated service so the logic stays testable.

```typescript
// ✅ Good - Focused, testable
class UserNotificationService {
  async sendWelcomeEmail(user: User) {
    // Email logic here
  }
}

const notificationService = new UserNotificationService();

userRepo.on('afterCreate', async user => {
  await notificationService.sendWelcomeEmail(user);
});

// ❌ Bad - Business logic coupled to the hook
userRepo.on('afterCreate', async user => {
  const template = await db.collection('templates').doc('welcome').get();
  const emailService = new EmailService(config);
  await emailService.send({
    to: user.email,
    subject: template.data().subject,
    body: template.data().body.replace('{{name}}', user.name),
  });
  await db.collection('email_logs').add({ userId: user.id, type: 'welcome' });
});
```

See [Lifecycle hooks](/firestore-orm/guides/concepts/lifecycle-hooks/) for the full event list and
payload shapes.
