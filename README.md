# @reggieofarrell/firestore-orm

A type-safe, thoroughly tested, feature-rich Firestore ORM built for the Firebase Admin SDK.
Designed to make backend Firestore development actually enjoyable.

[![npm version](https://img.shields.io/npm/v/@reggieofarrell/firestore-orm.svg)](https://www.npmjs.com/package/@reggieofarrell/firestore-orm)
[![Coverage](https://img.shields.io/badge/coverage-dual%20gated-brightgreen.svg)](#coverage-thresholds)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

## Table of Contents

- [About This Project](#about-this-project)
- [Fork & Attribution](#fork--attribution)
- [Why FirestoreORM?](#why-firestoreorm)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [Complete Feature Guide](#complete-feature-guide)
- [Dot Notation for Nested Updates](#dot-notation-for-nested-updates)
- [Framework Integration](#framework-integration)
- [Best Practices](#best-practices)
- [Understanding Performance Costs](#understanding-performance-costs)
- [Real-World Examples](#real-world-examples)
- [API Reference](#api-reference)
- [Testing Strategy](#testing-strategy)
- [Contributing](#contributing)
- [License](#license)

## About This Project

`@reggieofarrell/firestore-orm` is a maintained fork and continuation of the original
[spacelabs-firestoreorm](https://github.com/HBFLEX/spacelabs-firestoreorm) (v1.0.0) project. It
keeps the same core goal: make backend Firestore development in Node.js type-safe, productive, and
production-ready.

If you've built with Firestore on the server, you probably recognize the recurring pain points:

- Repetitive CRUD boilerplate across collections
- Inconsistent pagination and query patterns
- Runtime composite-index failures that only show up in production
- Validation and lifecycle hooks bolted on ad hoc
- Update semantics that fight Firestore's native field-path behavior

This package addresses those problems with a repository pattern, Zod validation, lifecycle hooks, a
chainable query builder, transaction helpers, subcollection support, dot-notation updates, and
Firestore-native write semantics (including `FieldValue` sentinels).

This fork includes a significant refactor focused on:

- Firestore-native update behavior instead of client-side merge reconstruction
- Sentinel-aware schema validation for atomic writes
- Clearer hook contracts and write ordering (`before*` -> validation -> write -> `after*`)
- Optional Firestore converter support
- Jest unit + emulator integration suites with **dual path-specific coverage gates** (integration
  owns ORM core; merged LCOV is not gated)

## Fork & Attribution

This project is derived from work originally created by **Happy Banda
([HBFL3Xx](https://github.com/HBFLEX))** and published as
[`@spacelabstech/firestoreorm`](https://www.npmjs.com/package/@spacelabstech/firestoreorm) from the
repository [HBFLEX/spacelabs-firestoreorm](https://github.com/HBFLEX/spacelabs-firestoreorm).

That upstream project is licensed under the **MIT License** (Copyright (c) 2025 HBFL3Xx). This fork
preserves that license and copyright notice, adds copyright for subsequent modifications, and
continues development under the `@reggieofarrell/firestore-orm` package name.

If you are migrating from the original package, replace `@spacelabstech/firestoreorm` imports with
`@reggieofarrell/firestore-orm` and review the API Reference for current method contracts.

Report issues for this fork at
[reggieofarrell/firestore-orm issues](https://github.com/reggieofarrell/firestore-orm/issues).

Thank you to Happy and the original contributors for the foundation this fork builds on.

## Why FirestoreORM?

### Built for Real Production Use

- **Type-Safe Everything** - Full TypeScript support with intelligent inference
- **Zod Validation** - Schema validation that integrates seamlessly with your data layer
- **Explicit Delete Semantics** - Keep data lifecycle behavior clear and predictable
- **Lifecycle Hooks** - Add logging, analytics, or side effects without cluttering your business
  logic
- **Powerful Query Builder** - Intuitive, chainable queries with pagination, aggregation, and
  streaming
- **Vector Search Extension** - Opt-in KNN similarity search via
  `@reggieofarrell/firestore-orm/vector` ([guide](docs/vector-search.md))
- **Transaction Support** - ACID guarantees for critical operations
- **Subcollection Support** - Navigate document hierarchies naturally
- **Dot Notation Updates** - Update nested fields without replacing entire objects
- **Zero Vendor Lock-In** - Built on Firebase Admin SDK; works with any Node.js framework

### Framework Agnostic

Works seamlessly with:

- Express.js
- NestJS (with DTOs and dependency injection)
- Fastify
- Koa
- Next.js API routes
- Any Node.js environment

## Installation

```bash
npm install @reggieofarrell/firestore-orm firebase-admin zod
```

```bash
yarn add @reggieofarrell/firestore-orm firebase-admin zod
```

```bash
pnpm add @reggieofarrell/firestore-orm firebase-admin zod
```

### Peer Dependencies

- `firebase-admin`: ^12.0.0 || ^13.0.0 (vector extension: >= 12 basic, >= 13 recommended)
- `zod`: ^3.25.0 || ^4.0.0

> **2.0.0** is the first release version for this maintained package under
> `@reggieofarrell/firestore-orm`. See [CHANGELOG.md](CHANGELOG.md) for migration notes from
> `@spacelabstech/firestoreorm`.

## Quick Start

### 1. Initialize Firebase Admin

```typescript
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const app = initializeApp({
  credential: cert('./serviceAccountKey.json'),
});

export const db = getFirestore(app);
```

### 2. Define Your Schema

```typescript
import { z } from 'zod';

export const userSchema = z.object({
  id: z.string(), // required on read models returned by the repository
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  age: z.number().int().positive().optional(),
  status: z.enum(['active', 'inactive', 'suspended']).default('active'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type User = z.infer<typeof userSchema>;
```

### 3. Create Your Repository

```typescript
import { FirestoreRepository } from '@reggieofarrell/firestore-orm';
import { db } from './firebase';
import { userSchema, User } from './schemas';

export const userRepo = FirestoreRepository.withSchema<User>(db, 'users', userSchema);
```

### 4. Start Building

```typescript
// Create a user
const user = await userRepo.create({
  name: 'John Doe',
  email: 'john@example.com',
  age: 30,
  status: 'active',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

// Query users
const activeUsers = await userRepo
  .query()
  .where('status', '==', 'active')
  .where('age', '>', 18)
  .orderBy('createdAt', 'desc')
  .limit(10)
  .get();

// Update a user (returns { id } by default)
const { id: updatedUserId } = await userRepo.update(user.id, {
  status: 'inactive',
  updatedAt: new Date().toISOString(),
});

// Delete user
await userRepo.delete(user.id);
```

## Core Concepts

### Repository Pattern

The repository abstracts Firestore operations behind a clean, consistent API. Each collection gets
its own repository instance.

```typescript
// Initialize once, use everywhere
const userRepo = FirestoreRepository.withSchema<User>(db, 'users', userSchema);
const orderRepo = FirestoreRepository.withSchema<Order>(db, 'orders', orderSchema);
const productRepo = new FirestoreRepository<Product>(db, 'products'); // Without validation
```

### Firestore Converters

FirestoreORM supports Firestore `withConverter(...)` through optional repository converter
arguments. This is useful when you need custom serialization/deserialization rules.

```typescript
import { FirestoreDataConverter } from 'firebase-admin/firestore';

const userConverter: FirestoreDataConverter<User> = {
  toFirestore: user => ({
    ...user,
    createdAt: user.createdAt.toISOString(),
  }),
  fromFirestore: snapshot => {
    const data = snapshot.data();
    return {
      ...data,
      createdAt: new Date(data.createdAt),
    } as User;
  },
};

// Converter + schema validation together
const userRepo = FirestoreRepository.withSchema<User>(db, 'users', userSchema, userConverter);
```

Converter behavior is instance-local by design:

- Parent repositories and subcollections do not share converters automatically.
- Pass a converter explicitly to each `subcollection(...)` call that needs converter behavior.

### Delete Behavior

Deletes are explicit hard deletes. Calling `delete()` removes the document from Firestore
immediately.

```typescript
await userRepo.delete('user-123');
```

### Schema Validation

Validation happens automatically before any write operation using Zod schemas.

```typescript
const userSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().int().positive().optional(),
});

const userRepo = FirestoreRepository.withSchema<User>(db, 'users', userSchema);

try {
  await userRepo.create({
    name: '',
    email: 'not-an-email',
    age: -5,
  });
} catch (error) {
  if (error instanceof ValidationError) {
    console.log(error.issues);
    // [
    //   { path: ['name'], message: 'String must not be empty' },
    //   { path: ['email'], message: 'Invalid email' },
    //   { path: ['age'], message: 'Must be positive' }
    // ]
  }
}
```

**Validation Behavior**:

- Include a required top-level `id` field in schemas passed to `withSchema(...)`
- `create()` validates against an internal write schema derived from `schema.omit({ id: true })`
- `update()` validates against an internal update schema derived from
  `schema.omit({ id: true }).partial()`
- top-level `id` is ignored/stripped from create/update/patch payloads before validation and writes
- only the document-level top-level `id` is stripped; nested IDs (for example `items[].id`) are
  treated as normal domain data
- Write operations follow this sequence: `before*` hook -> validation -> Firestore write -> `after*`
  hook
- Validation errors are thrown after `before*` hooks run and before any Firestore write occurs
- Firestore `FieldValue` sentinels are supported in write payloads; sentinel-valued paths are
  skipped during schema validation while non-sentinel paths are still validated

**Accessing Derived Schemas**:

```typescript
const userRepo = FirestoreRepository.withSchema<User>(db, 'users', userSchema);

// Canonical read schema (includes required id)
const readSchema = userRepo.schemas?.read;

// Internal write schemas used by repository validation
const createSchema = userRepo.schemas?.create; // userSchema without id
const updateSchema = userRepo.schemas?.update; // create schema made partial
```

### Lifecycle Hooks

Hooks allow you to inject custom logic at specific points in the data lifecycle without cluttering
your business logic.

**Hook Execution Order**:

- `before*` hooks can enrich or normalize payloads before schema validation
- The validated payload is the one persisted to Firestore
- `after*` hooks run only after successful writes
- `query().update()` uses `beforeBulkUpdate` / `afterBulkUpdate` with the same ordering guarantees

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

**Available Hooks**:

- Single operations: `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, `beforeDelete`,
  `afterDelete`
- Bulk operations: `beforeBulkCreate`, `afterBulkCreate`, `beforeBulkUpdate`, `afterBulkUpdate`,
  `beforeBulkDelete`, `afterBulkDelete`

**Hook Payloads**:

- `beforeCreate` / `afterCreate`: receive create payload (`afterCreate` includes generated `id`)
- `beforeUpdate`: receives update payload + `id`
- `afterUpdate`: receives `{ id }`
- `beforeDelete` / `afterDelete`: receive the deleted document (`T & { id }`)
- `beforeBulkCreate` / `afterBulkCreate`: receive an array of created documents with `id`
- `beforeBulkUpdate`: receives `{ id, data }[]`
- `afterBulkUpdate`: receives `{ ids: string[] }`
- `beforeBulkDelete` / `afterBulkDelete`: receive `{ ids: string[]; documents: (T & { id })[] }`

### Query Builder

The query builder provides a fluent, type-safe interface for complex queries.

```typescript
const results = await orderRepo
  .query()
  .where('status', '==', 'pending')
  .where('total', '>', 100)
  .where('createdAt', '>=', startOfMonth)
  .orderBy('total', 'desc')
  .limit(50)
  .get();
```

**Performance Note**: Firestore charges you per document read. Use `limit()` and pagination to
control costs on large collections.

### Vector Search (Extension)

Vector similarity search is **opt-in** — import from `@reggieofarrell/firestore-orm/vector` and wrap
your repository with `withVectorSearch()`. The core `FirestoreQueryBuilder` is unchanged.

**Full guide:** [docs/vector-search.md](docs/vector-search.md)

```typescript
import { withVectorSearch } from '@reggieofarrell/firestore-orm/vector';
import { FieldValue } from 'firebase-admin/firestore';

const vectorRepo = withVectorSearch(articleRepo);

await vectorRepo.create({
  title: 'Article',
  embedding: FieldValue.vector([0.1, 0.2, 0.3]),
});

const results = await vectorRepo
  .query()
  .findNearest({
    vectorField: 'embedding',
    queryVector: [0.1, 0.2, 0.3],
    limit: 10,
    distanceMeasure: 'COSINE',
  })
  .get();
```

Use a **top-level `embedding` field** (not nested) for reliable emulator testing and simpler index
configuration.

## Complete Feature Guide

### CRUD Operations

```typescript
// CREATE
const user = await userRepo.create({
  name: 'Alice',
  email: 'alice@example.com',
});

// READ
const user = await userRepo.getById('user-123');
const strictUser = await userRepo.getByIdOrThrow('user-123'); // Throws NotFoundError when missing
const users = await userRepo.getAll(); // Fetch all docs
const usersByEmail = await userRepo.findByField('email', 'alice@example.com');
const oneUserByEmail = await userRepo.getOneByField('email', 'alice@example.com'); // First match or null
const strictUserByEmail = await userRepo.getOneByFieldOrThrow('email', 'alice@example.com'); // Throws on zero or multiple matches

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

// UPDATE WITH MERGE (preserves unspecified fields)
await userRepo.update('user-123', { 'profile.nickname': 'Ally' } as any, { merge: true });

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
await userRepo.delete('user-123'); // Hard delete
```

### Bulk Operations

Bulk operations use Firestore batch writes (max 500 operations per batch). The ORM automatically
chunks operations if you exceed this limit.

```typescript
// Bulk create
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

// Bulk delete
await userRepo.bulkDelete(['user-1', 'user-2', 'user-3']);
```

**Performance Tip**: For simple bulk updates on query results, use `query().update()` instead:

```typescript
// More efficient - single query + batched writes
await orderRepo.query().where('status', '==', 'pending').update({ status: 'shipped' });

// Less efficient - fetches all IDs first, then updates
const orders = await orderRepo.query().where('status', '==', 'pending').get();
await orderRepo.bulkUpdate(orders.map(o => ({ id: o.id, data: { status: 'shipped' } })));
```

### Advanced Queries

```typescript
// Filtering
const results = await userRepo
  .query()
  .where('age', '>', 18)
  .where('status', 'in', ['active', 'verified'])
  .where('tags', 'array-contains', 'premium')
  .get();

// Sorting
const sorted = await productRepo.query().orderBy('price', 'desc').orderBy('name', 'asc').get();

// Pagination (cursor-based, recommended)
// orderBy() is required for stable cursor pagination
const { items, nextCursor, hasMore } = await userRepo
  .query()
  .orderBy('createdAt', 'desc')
  .paginate(20);

// Next page
const nextPage = await userRepo.query().orderBy('createdAt', 'desc').paginate(20, nextCursor);

// Offset pagination (less efficient for large datasets)
const page2 = await userRepo.query().orderBy('createdAt', 'desc').offsetPaginate(2, 20);

// Aggregations
const totalRevenue = await orderRepo.query().where('status', '==', 'completed').sum('total');

const avgRating = await reviewRepo.query().where('productId', '==', 'prod-123').average('rating');

// Count
const activeCount = await userRepo.query().where('status', '==', 'active').count();

// Total collection count (ignores accumulated where clauses)
const totalUsers = await userRepo.query().where('status', '==', 'active').totalCount();

// Exists check
const hasOrders = await orderRepo.query().where('userId', '==', 'user-123').exists();

// Distinct values
const categories = await productRepo.query().distinctValues('category');

// Select specific fields
const userEmails = await userRepo
  .query()
  .where('subscribed', '==', true)
  .select('email', 'name')
  .get();
```

### Query Operations

```typescript
// Update all matching documents
const updatedCount = await orderRepo
  .query()
  .where('status', '==', 'pending')
  .update({ status: 'processing' });

// Delete all matching documents
const deletedCount = await userRepo.query().where('lastLogin', '<', oneYearAgo).delete();

// Delete matching documents
await orderRepo
  .query()
  .where('status', '==', 'cancelled')
  .where('createdAt', '<', sixMonthsAgo)
  .delete();
```

### Streaming for Large Datasets

When processing large datasets, streaming prevents memory issues by processing documents one at a
time.

```typescript
// Stream all users without loading into memory
for await (const user of userRepo.query().stream()) {
  await sendEmail(user.email);
  console.log(`Processed user ${user.id}`);
}

// Stream with filters
for await (const order of orderRepo.query().where('status', '==', 'pending').stream()) {
  await processOrder(order);
}
```

**Performance Cost**: Streaming still reads all matching documents, so you're charged for every
document read. Use with appropriate filters and limits.

### Real-Time Subscriptions

```typescript
// Subscribe to query results
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

**Cost Warning**: Real-time listeners charge you for every document that matches your query, plus
additional reads when documents change. Use narrow filters and consider polling for less critical
data.

### Transactions

Transactions ensure atomic operations across multiple documents. Use them when consistency is
critical (e.g., transferring balances, inventory management).

```typescript
await accountRepo.runInTransaction(async (tx, repo) => {
  const from = await repo.getForUpdateInTransaction(tx, 'account-1');
  const to = await repo.getForUpdateInTransaction(tx, 'account-2');

  if (!from || from.balance < 100) {
    throw new Error('Insufficient funds');
  }

  await repo.updateInTransaction(tx, from.id, {
    balance: from.balance - 100,
  });

  await repo.updateInTransaction(tx, to.id, {
    balance: to.balance + 100,
  });
});
```

**Important Transaction Limitations**:

1. **No `after*` Hooks on Transaction Write Helpers**: `createInTransaction`, `updateInTransaction`,
   `patchInTransaction`, and `deleteInTransaction` run `before*` hooks (before validation + write)
   but skip `after*` hooks by design so side effects stay outside the atomic transaction commit.

2. **Use Cases for Transaction Hooks**:

   ```typescript
   // WORKS - beforeUpdate runs before transaction commits
   orderRepo.on('beforeUpdate', data => {
     if (data.quantity < 0) {
       throw new Error('Negative quantity not allowed');
     }
   });

   // DOES NOT WORK - afterUpdate won't run in transaction
   orderRepo.on('afterUpdate', async ({ id }) => {
     await sendEmailByUserId(id); // This will NOT execute
   });
   ```

3. **Solution for Post-Transaction Side Effects**:

   ```typescript
   const result = await accountRepo.runInTransaction(async (tx, repo) => {
     // ... transaction logic
     return { from, to };
   });

   // Run side effects AFTER transaction succeeds
   await auditLog.record('transfer_completed', result);
   await sendEmail(result.from.email);
   ```

### Subcollections

Navigate document hierarchies naturally:

```typescript
// Access user's orders
const userOrders = userRepo.subcollection<Order>('user-123', 'orders', orderSchema);

// Create order in subcollection
const order = await userOrders.create({
  product: 'Widget',
  price: 99.99,
});

// Query subcollection
const recentOrders = await userOrders
  .query()
  .where('status', '==', 'completed')
  .orderBy('createdAt', 'desc')
  .limit(10)
  .get();

// Nested subcollections
const comments = postRepo
  .subcollection<Comment>('post-123', 'comments')
  .subcollection<Reply>('comment-456', 'replies');

// Get parent ID
const parentId = userOrders.getParentId(); // 'user-123'
```

Subcollection converter behavior is explicit:

```typescript
// Parent converter
const userConverter: FirestoreDataConverter<User> = {
  toFirestore: data => data,
  fromFirestore: snapshot => snapshot.data() as User,
};
const orderConverter: FirestoreDataConverter<Order> = {
  toFirestore: data => data,
  fromFirestore: snapshot => snapshot.data() as Order,
};

const users = FirestoreRepository.withSchema<User>(db, 'users', userSchema, userConverter);

// No converter inheritance: pass converter explicitly for child collection
const userOrders = users.subcollection<Order>('user-123', 'orders', orderSchema, orderConverter);
```

## Dot Notation for Nested Updates

FirestoreORM supports Firestore's dot notation syntax for updating nested fields without replacing
entire objects. This allows you to update specific nested properties while preserving other fields.

### Basic Nested Update

```typescript
// Without dot notation - replaces entire address object
await userRepo.update('user-123', {
  address: {
    city: 'Los Angeles',
  },
});
// Result: { address: { city: 'Los Angeles' } }
// street, zipCode, and other fields are lost

// With dot notation - updates only city, preserves other fields
await userRepo.update('user-123', {
  'address.city': 'Los Angeles',
} as any);
// Result: { address: { city: 'Los Angeles', street: '123 Main', zipCode: '90001' } }
// street and zipCode are preserved
```

### Deep Nested Updates

```typescript
// Update deeply nested settings
await userRepo.update('user-123', {
  'profile.settings.notifications.email': true,
  'profile.settings.theme': 'dark',
} as any);

// Creates nested structure if it doesn't exist
await userRepo.update('user-123', {
  'metadata.preferences.language': 'en',
  'metadata.preferences.timezone': 'UTC',
} as any);
```

### Mixed Updates

```typescript
// Combine regular fields with dot notation
await userRepo.update('user-123', {
  name: 'John Doe', // Regular field
  'address.city': 'New York', // Nested field
  'address.zipCode': '10001', // Another nested field
  'profile.verified': true, // Different nested object
} as any);
```

### Update with Merge Mode

`update(..., { merge: true })` normalizes nested objects into dot-notation update paths and uses
Firestore `update(...)` under the hood.

```typescript
await userRepo.update(
  'user-123',
  {
    'profile.settings.theme': 'dark',
  } as any,
  { merge: true },
);
```

This preserves `update()` semantics, so missing documents still throw `NotFoundError`.

### Patch Convenience Alias

Use `patch(...)` as a convenience alias for `update(..., { merge: true })`.

```typescript
await userRepo.patch('user-123', {
  profile: {
    settings: {
      theme: 'dark',
    },
  },
} as any);
```

### Merge/Patch/BulkPatch Limitation

Literal field names containing a dot (`.`) are not supported by merge/patch/bulkPatch normalization.
Dot-containing keys are always interpreted as nested field paths.

### Bulk Updates with Dot Notation

```typescript
// Bulk update nested fields
await userRepo.bulkUpdate([
  {
    id: 'user-1',
    data: {
      'profile.verified': true,
      'settings.notifications': false,
    } as any,
  },
  {
    id: 'user-2',
    data: {
      'profile.verified': true,
    } as any,
  },
]);
```

### Bulk Patch Convenience Alias

Use `bulkPatch(...)` when you want merge-style normalization for batch updates without manually
flattening nested objects.

```typescript
await userRepo.bulkPatch([
  {
    id: 'user-1',
    data: {
      profile: {
        settings: {
          theme: 'dark',
        },
      },
    } as any,
  },
  {
    id: 'user-2',
    data: {
      'profile.settings.notifications': true,
    } as any,
  },
]);
```

### Query Updates with Dot Notation

```typescript
// Update nested fields for all matching documents
await userRepo
  .query()
  .where('role', '==', 'admin')
  .update({
    'permissions.canDelete': true,
    'permissions.canEdit': true,
  } as any);

// Update deeply nested analytics
await postRepo
  .query()
  .where('published', '==', true)
  .update({
    'analytics.impressions': 0,
    'analytics.lastUpdated': new Date().toISOString(),
  } as any);
```

### Transactions with Dot Notation

```typescript
await userRepo.runInTransaction(async (tx, repo) => {
  // Read first only when your business logic needs current state
  const user = await repo.getForUpdateInTransaction(tx, 'user-123');

  if (!user) {
    throw new Error('User not found');
  }

  // Update nested fields directly
  await repo.updateInTransaction(tx, 'user-123', {
    'settings.theme': 'dark',
    'profile.lastLogin': new Date().toISOString(),
  } as any);
});
```

### FieldValue Sentinels

```typescript
import { FieldValue } from 'firebase-admin/firestore';

// Create with server timestamp
await userRepo.create({
  name: 'Alice',
  createdAt: FieldValue.serverTimestamp(),
} as any);

// Atomic updates
await userRepo.update('user-123', {
  loginCount: FieldValue.increment(1),
  tags: FieldValue.arrayUnion('beta-user'),
  deprecatedField: FieldValue.delete(),
} as any);

// Works in query updates and transactions too
await userRepo
  .query()
  .where('role', '==', 'admin')
  .update({
    tags: FieldValue.arrayRemove('legacy'),
  } as any);
```

### Important Notes

**1. Type Casting Required**

TypeScript requires `as any` for dot notation keys since they're dynamic strings:

```typescript
// Required type assertion
await userRepo.update('user-123', {
  'address.city': 'NYC',
} as any);
```

**2. Path Validation**

Dot notation paths are validated by Firestore during write operations.

**3. Firestore Limitations**

- **Undefined values** are automatically filtered out (Firestore doesn't accept `undefined`)
- Use `null` if you need to explicitly clear a field value

```typescript
// Undefined is filtered out, original value preserved
await userRepo.update('user-123', {
  'address.city': undefined,
} as any);

// Use null to clear a field
await userRepo.update('user-123', {
  'address.city': null,
} as any);
```

**4. Transaction Requirements**

`updateInTransaction()` supports dot notation directly. Use `getForUpdateInTransaction()` only when
your transaction logic needs the existing document state.

```typescript
// Valid - read first only when needed by business logic
await repo.runInTransaction(async (tx, repo) => {
  const doc = await repo.getForUpdateInTransaction(tx, 'doc-123');
  if (!doc) throw new Error('Document not found');
  await repo.updateInTransaction(tx, 'doc-123', {
    'nested.field': 'value',
  } as any);
});
```

**5. Schema Validation with Sentinels**

When using repositories created with `withSchema(...)`, fields assigned to `FieldValue` sentinels
are ignored by Zod validation. All other fields in the same payload are still validated normally.

### Use Cases

**User Preferences**

Update specific settings without replacing all preferences:

```typescript
await userRepo.update('user-123', {
  'preferences.emailNotifications': true,
  'preferences.theme': 'dark',
} as any);
```

**Nested Configurations**

Modify individual config values in complex objects:

```typescript
await configRepo.update('app-config', {
  'features.darkMode.enabled': true,
  'features.darkMode.autoSwitch': true,
  'features.analytics.trackingId': 'GA-123456',
} as any);
```

**Analytics Counters**

Update nested counter fields:

```typescript
await postRepo.update('post-123', {
  'analytics.views': 150,
  'analytics.likes': 42,
  'analytics.shares': 8,
} as any);
```

**Status Updates**

Update status in nested workflow objects:

```typescript
await orderRepo.update('order-123', {
  'workflow.payment.status': 'completed',
  'workflow.payment.completedAt': new Date().toISOString(),
  'workflow.fulfillment.status': 'pending',
} as any);
```

**Partial Address Updates**

Update only changed address fields:

```typescript
await userRepo.update('user-123', {
  'shippingAddress.street': '456 New Street',
  'shippingAddress.apt': '10B',
  // city, state, zipCode remain unchanged
} as any);
```

### Error Handling

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

### Express Error Handler

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

- `ValidationError` → 400 Bad Request
- `NotFoundError` → 404 Not Found
- `ConflictError` → 409 Conflict
- `FirestoreIndexError` → 404 Not Found (with index URL)
- Others → 500 Internal Server Error

## Framework Integration

### Express.js

**Basic Setup**

```typescript
// repositories/user.repository.ts
import { FirestoreRepository } from '@reggieofarrell/firestore-orm';
import { db } from '../config/firebase';
import { userSchema, User } from '../schemas/user.schema';

export const userRepo = FirestoreRepository.withSchema<User>(db, 'users', userSchema);
```

```typescript
// routes/user.routes.ts
import express from 'express';
import { userRepo } from '../repositories/user.repository';
import { ValidationError, NotFoundError } from '@reggieofarrell/firestore-orm';

const router = express.Router();

router.post('/users', async (req, res, next) => {
  try {
    const user = await userRepo.create({
      ...req.body,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    res.status(201).json(user);
  } catch (error) {
    next(error); // errorHandler middleware will process this
  }
});

router.get('/users', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status } = req.query;

    let query = userRepo.query();

    if (status) {
      query = query.where('status', '==', status);
    }

    const result = await query
      .orderBy('createdAt', 'desc')
      .offsetPaginate(Number(page), Number(limit));

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/users/:id', async (req, res, next) => {
  try {
    const user = await userRepo.getById(req.params.id);

    if (!user) {
      throw new NotFoundError(`User with id ${req.params.id} not found`);
    }

    res.json(user);
  } catch (error) {
    next(error);
  }
});

router.patch('/users/:id', async (req, res, next) => {
  try {
    const user = await userRepo.update(
      req.params.id,
      {
        ...req.body,
        updatedAt: new Date().toISOString(),
      },
      { returnDoc: true },
    );
    res.json(user);
  } catch (error) {
    next(error);
  }
});

router.delete('/users/:id', async (req, res, next) => {
  try {
    await userRepo.delete(req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
```

```typescript
// app.ts
import express from 'express';
import { errorHandler } from '@reggieofarrell/firestore-orm';
import userRoutes from './routes/user.routes';

const app = express();

app.use(express.json());
app.use('/api', userRoutes);
app.use(errorHandler); // Must be last

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

### NestJS Integration

NestJS users often work with DTOs for request validation. Here's how to integrate with the ORM's Zod
schemas:

**Shared Schema Strategy**

```typescript
// schemas/user.schema.ts
import { z } from 'zod';

export const userSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().int().positive().optional(),
  status: z.enum(['active', 'inactive', 'suspended']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type User = z.infer<typeof userSchema>;

// DTOs for NestJS (derived from same schema)
export const createUserSchema = userSchema.omit({ id: true, createdAt: true, updatedAt: true });
export const updateUserSchema = createUserSchema.partial();

export type CreateUserDto = z.infer<typeof createUserSchema>;
export type UpdateUserDto = z.infer<typeof updateUserSchema>;
```

**Repository Module**

```typescript
// modules/database/database.module.ts
import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

@Global()
@Module({
  providers: [
    {
      provide: 'FIRESTORE',
      useFactory: (config: ConfigService) => {
        const app = initializeApp({
          credential: cert(config.get('firebase.serviceAccount')),
        });
        return getFirestore(app);
      },
      inject: [ConfigService],
    },
  ],
  exports: ['FIRESTORE'],
})
export class DatabaseModule {}
```

```typescript
// modules/user/user.repository.ts
import { Injectable, Inject } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FirestoreRepository } from '@reggieofarrell/firestore-orm';
import { User, userSchema } from '../../schemas/user.schema';

@Injectable()
export class UserRepository {
  private repo: FirestoreRepository<User>;

  constructor(@Inject('FIRESTORE') private firestore: Firestore) {
    this.repo = FirestoreRepository.withSchema<User>(firestore, 'users', userSchema);

    // Setup hooks
    this.setupHooks();
  }

  private setupHooks() {
    this.repo.on('afterCreate', async user => {
      console.log(`User created: ${user.id}`);
    });
  }

  async create(data: Omit<User, 'id' | 'createdAt' | 'updatedAt'>) {
    return this.repo.create({
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  async findById(id: string) {
    return this.repo.getById(id);
  }

  async update(id: string, data: Partial<User>) {
    return this.repo.update(
      id,
      {
        ...data,
        updatedAt: new Date().toISOString(),
      },
      { returnDoc: true },
    );
  }

  async remove(id: string) {
    return this.repo.delete(id);
  }

  query() {
    return this.repo.query();
  }
}
```

**Service Layer**

```typescript
// modules/user/user.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRepository } from './user.repository';
import { CreateUserDto, UpdateUserDto } from '../../schemas/user.schema';
import { NotFoundError } from '@reggieofarrell/firestore-orm';

@Injectable()
export class UserService {
  constructor(private userRepository: UserRepository) {}

  async create(dto: CreateUserDto) {
    return this.userRepository.create(dto);
  }

  async findOne(id: string) {
    const user = await this.userRepository.findById(id);

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async findActive(page: number = 1, limit: number = 20) {
    return this.userRepository
      .query()
      .where('status', '==', 'active')
      .orderBy('createdAt', 'desc')
      .offsetPaginate(page, limit);
  }

  async update(id: string, dto: UpdateUserDto) {
    try {
      return await this.userRepository.update(id, dto);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  async remove(id: string) {
    await this.userRepository.remove(id);
  }
}
```

**Controller with Validation Pipe**

```typescript
// modules/user/user.controller.ts
import { Controller, Get, Post, Body, Param, Patch, Delete, Query, UsePipes } from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto, UpdateUserDto } from '../../schemas/user.schema';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { createUserSchema, updateUserSchema } from '../../schemas/user.schema';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @UsePipes(new ZodValidationPipe(createUserSchema))
  create(@Body() createUserDto: CreateUserDto) {
    return this.userService.create(createUserDto);
  }

  @Get()
  findAll(@Query('page') page: string = '1', @Query('limit') limit: string = '20') {
    return this.userService.findActive(Number(page), Number(limit));
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.userService.findOne(id);
  }

  @Patch(':id')
  @UsePipes(new ZodValidationPipe(updateUserSchema))
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.userService.update(id, updateUserDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.userService.remove(id);
  }
}
```

**Zod Validation Pipe (Optional - since ORM validates)**

```typescript
// pipes/zod-validation.pipe.ts
import { PipeTransform, BadRequestException } from '@nestjs/common';
import { ZodSchema } from 'zod';

export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}

  transform(value: unknown) {
    try {
      return this.schema.parse(value);
    } catch (error) {
      throw new BadRequestException('Validation failed');
    }
  }
}
```

**Exception Filter for ORM Errors**

```typescript
// filters/firestore-exception.filter.ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { ValidationError, NotFoundError, ConflictError } from '@reggieofarrell/firestore-orm';

@Catch(ValidationError, NotFoundError, ConflictError)
export class FirestoreExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof ValidationError) {
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Validation Error',
        details: exception.issues,
      });
    } else if (exception instanceof NotFoundError) {
      response.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: exception.message,
      });
    } else if (exception instanceof ConflictError) {
      response.status(HttpStatus.CONFLICT).json({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: exception.message,
      });
    }
  }
}
```

**Register Filter Globally**

```typescript
// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { FirestoreExceptionFilter } from './filters/firestore-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalFilters(new FirestoreExceptionFilter());

  await app.listen(3000);
}
bootstrap();
```

## Best Practices

### 1. Initialize Repositories Once

Create repository instances once and reuse them throughout your application. Don't create new
instances in every function.

```typescript
// ❌ Bad - Creates new instance every time
export function getUserRepository() {
  return FirestoreRepository.withSchema<User>(db, 'users', userSchema);
}

// ✅ Good - Single instance, reused everywhere
export const userRepo = FirestoreRepository.withSchema<User>(db, 'users', userSchema);
```

**Why**: Repository initialization is lightweight, but creating instances repeatedly is unnecessary
and makes hook management inconsistent.

### 2. Organize Repositories in a Centralized Module

```typescript
// repositories/index.ts
import { db } from '../config/firebase';
import { FirestoreRepository } from '@reggieofarrell/firestore-orm';
import * as schemas from '../schemas';

export const userRepo = FirestoreRepository.withSchema<schemas.User>(
  db,
  'users',
  schemas.userSchema,
);

export const orderRepo = FirestoreRepository.withSchema<schemas.Order>(
  db,
  'orders',
  schemas.orderSchema,
);

export const productRepo = FirestoreRepository.withSchema<schemas.Product>(
  db,
  'products',
  schemas.productSchema,
);

// Setup common hooks
userRepo.on('afterCreate', async user => {
  await auditLog.record('user_created', user);
});

orderRepo.on('afterCreate', async order => {
  await notificationService.sendOrderConfirmation(order);
});
```

### 3. Use Cursor-Based Pagination Over Offset

For large datasets, cursor-based pagination is significantly more efficient than offset pagination.

```typescript
// ✅ Good - Cursor-based (scales well)
const { items, nextCursor, hasMore } = await userRepo
  .query()
  .orderBy('createdAt', 'desc')
  .paginate(20, lastCursor);

// ❌ Avoid - Offset-based (expensive for large page numbers)
const result = await userRepo.query().orderBy('createdAt', 'desc').offsetPaginate(100, 20); // Skip 1980 docs to get page 100
```

**Why**: Offset pagination requires Firestore to scan and skip all documents before your offset,
while cursor pagination jumps directly to the starting position.

### 4. Use Query Updates for Bulk Operations

When updating multiple documents based on a condition, use `query().update()` instead of fetching
then updating.

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

### 5. Add Timestamps Consistently

Always add `createdAt` and `updatedAt` timestamps to track data lifecycle.

```typescript
const userSchema = z.object({
  id: z.string(),
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

### 6. Handle Composite Index Errors Gracefully

Firestore requires composite indexes for certain query combinations. The ORM provides clear error
messages with links to create them.

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
    // Logs formatted message with link to create index
    // Click link, wait 1-2 minutes, retry query
  }
}
```

### 7. Use Transactions for Critical Operations

Any operation requiring consistency across multiple documents should use transactions.

```typescript
// ✅ Atomic transfer
await accountRepo.runInTransaction(async (tx, repo) => {
  const from = await repo.getForUpdateInTransaction(tx, fromId);
  const to = await repo.getForUpdateInTransaction(tx, toId);

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

### 8. Use Streaming for Large Data Exports

When processing large datasets (exports, migrations, batch jobs), use streaming to avoid memory
issues.

```typescript
// ✅ Memory efficient
const csvStream = createWriteStream('users.csv');
csvStream.write('name,email,status\n');

for await (const user of userRepo.query().stream()) {
  csvStream.write(`${user.name},${user.email},${user.status}\n`);
}

csvStream.end();
```

### 9. Structure Hooks for Reusability

Keep hooks focused and modular. Avoid putting complex business logic directly in hooks.

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

// ❌ Bad - Business logic coupled to hook
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

## Understanding Performance Costs

### Firestore Pricing Model

Firestore charges for:

1. **Document reads** - Every document returned from a query
2. **Document writes** - Every create, update, or delete
3. **Document deletes** - Separate charge from writes
4. **Storage** - Data stored in your database
5. **Network egress** - Data transferred out of Google Cloud

### Operation Costs

| Operation          | Cost                                         | Notes                                     |
| ------------------ | -------------------------------------------- | ----------------------------------------- |
| `getById()`        | 1 read                                       | Single document lookup                    |
| `list(100)`        | 100 reads                                    | Reads up to 100 documents                 |
| `query().get()`    | 1 read per result                            | Charges for every matched document        |
| `query().count()`  | 1 read per 1000 docs                         | Aggregation query (cheaper than fetching) |
| `create()`         | 1 write                                      | Single write operation                    |
| `bulkCreate(100)`  | 100 writes                                   | Batched but still counts as 100 writes    |
| `update()`         | 1 write                                      | Even if updating one field                |
| `delete()`         | 1 delete                                     | Permanently removes document              |
| `query().update()` | 1 write per match                            | Efficient batch update                    |
| `onSnapshot()`     | 1 read per doc initially + 1 read per change | Real-time listener costs                  |

### What Happens Under the Hood

**Simple Query**

```typescript
const users = await userRepo.query().where('status', '==', 'active').limit(10).get();
```

1. Firestore executes query with both conditions
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

## Real-World Examples

### Example 1: E-commerce Order System

```typescript
// schemas/order.schema.ts
import { z } from 'zod';

export const orderItemSchema = z.object({
  id: z.string(), // domain field inside each item (not the Firestore document id)
  productId: z.string(),
  productName: z.string(),
  quantity: z.number().int().positive(),
  price: z.number().positive(),
  subtotal: z.number().positive(),
});

export const orderSchema = z.object({
  id: z.string(),
  userId: z.string(),
  items: z.array(orderItemSchema),
  total: z.number().positive(),
  status: z.enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled']),
  shippingAddress: z.object({
    street: z.string(),
    city: z.string(),
    state: z.string(),
    zipCode: z.string(),
    country: z.string(),
  }),
  trackingNumber: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Order = z.infer<typeof orderSchema>;
```

```typescript
// repositories/order.repository.ts
import { FirestoreRepository } from '@reggieofarrell/firestore-orm';
import { db } from '../config/firebase';
import { orderSchema, Order } from '../schemas/order.schema';
import { inventoryService } from '../services/inventory.service';
import { emailService } from '../services/email.service';

export const orderRepo = FirestoreRepository.withSchema<Order>(db, 'orders', orderSchema);

// Validate inventory before creating order
orderRepo.on('beforeCreate', async order => {
  for (const item of order.items) {
    const available = await inventoryService.checkStock(item.productId, item.quantity);

    if (!available) {
      throw new Error(`Insufficient stock for product ${item.productName}`);
    }
  }
});

// Update inventory and send confirmation after order creation
orderRepo.on('afterCreate', async order => {
  // Reduce inventory
  for (const item of order.items) {
    await inventoryService.reduceStock(item.productId, item.quantity);
  }

  // Send confirmation email
  await emailService.sendOrderConfirmation(order);

  // Log for analytics
  await analytics.track('order_placed', {
    orderId: order.id,
    total: order.total,
    itemCount: order.items.length,
  });
});

// Validate tracking number for shipped orders
orderRepo.on('beforeUpdate', data => {
  if (data.status === 'shipped' && !data.trackingNumber) {
    throw new Error('Tracking number required for shipped orders');
  }
});

// Send shipping notification
orderRepo.on('afterUpdate', async ({ id }) => {
  const order = await orderRepo.getById(id);
  if (order?.status === 'shipped') {
    await emailService.sendShippingNotification(order);
  }
});
```

```typescript
// services/order.service.ts
import { orderRepo } from '../repositories/order.repository';
import { userRepo } from '../repositories/user.repository';
import { ConflictError } from '@reggieofarrell/firestore-orm';

export class OrderService {
  async createOrder(userId: string, items: OrderItem[]) {
    // Verify user exists
    const user = await userRepo.getById(userId);
    if (!user) {
      throw new ConflictError('User not found');
    }

    // Calculate total
    const total = items.reduce((sum, item) => sum + item.subtotal, 0);

    // Create order (hooks will handle inventory and emails)
    return orderRepo.create({
      userId,
      items,
      total,
      status: 'pending',
      shippingAddress: user.defaultAddress,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  async getUserOrders(userId: string, page: number = 1, limit: number = 20) {
    return orderRepo
      .query()
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .offsetPaginate(page, limit);
  }

  async updateOrderStatus(orderId: string, status: Order['status'], trackingNumber?: string) {
    return orderRepo.update(
      orderId,
      {
        status,
        trackingNumber,
        updatedAt: new Date().toISOString(),
      },
      { returnDoc: true },
    );
  }

  async cancelOrder(orderId: string) {
    // Use transaction to ensure inventory is restored
    await orderRepo.runInTransaction(async (tx, repo) => {
      const order = await repo.getForUpdateInTransaction(tx, orderId);

      if (!order) {
        throw new Error('Order not found');
      }

      if (order.status !== 'pending') {
        throw new Error('Only pending orders can be cancelled');
      }

      await repo.updateInTransaction(tx, orderId, {
        status: 'cancelled',
        updatedAt: new Date().toISOString(),
      });
    });

    // Restore inventory after transaction (outside to avoid transaction limits)
    const order = await orderRepo.getById(orderId);
    for (const item of order!.items) {
      await inventoryService.restoreStock(item.productId, item.quantity);
    }
  }

  async getOrderStats(startDate: string, endDate: string) {
    const orders = await orderRepo
      .query()
      .where('status', '==', 'delivered')
      .where('createdAt', '>=', startDate)
      .where('createdAt', '<=', endDate)
      .get();

    const totalRevenue = await orderRepo
      .query()
      .where('status', '==', 'delivered')
      .where('createdAt', '>=', startDate)
      .where('createdAt', '<=', endDate)
      .sum('total');

    const avgOrderValue = await orderRepo
      .query()
      .where('status', '==', 'delivered')
      .where('createdAt', '>=', startDate)
      .where('createdAt', '<=', endDate)
      .average('total');

    return {
      totalOrders: orders.length,
      totalRevenue,
      avgOrderValue,
    };
  }
}
```

### Example 2: Multi-Tenant SaaS Application

```typescript
// schemas/tenant.schema.ts
export const tenantSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  plan: z.enum(['free', 'pro', 'enterprise']),
  seats: z.number().int().positive(),
  usedSeats: z.number().int().nonnegative().default(0),
  features: z.array(z.string()),
  ownerId: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Tenant = z.infer<typeof tenantSchema>;
```

```typescript
// repositories/tenant.repository.ts
export const tenantRepo = FirestoreRepository.withSchema<Tenant>(db, 'tenants', tenantSchema);

// Ensure slug uniqueness
tenantRepo.on('beforeCreate', async tenant => {
  const existing = await tenantRepo.findByField('slug', tenant.slug);

  if (existing.length > 0) {
    throw new ConflictError('Tenant slug already exists');
  }
});

// Create default resources for new tenant
tenantRepo.on('afterCreate', async tenant => {
  // Create default workspace
  await workspaceRepo.create({
    tenantId: tenant.id,
    name: 'Default Workspace',
    ownerId: tenant.ownerId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Add owner as first member
  await memberRepo.create({
    tenantId: tenant.id,
    userId: tenant.ownerId,
    role: 'owner',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
});
```

```typescript
// services/tenant.service.ts
export class TenantService {
  async createTenant(ownerId: string, name: string, slug: string) {
    return tenantRepo.create({
      name,
      slug,
      plan: 'free',
      seats: 5,
      usedSeats: 1,
      features: ['basic_analytics', 'api_access'],
      ownerId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  async addMember(tenantId: string, userId: string, role: string) {
    // Use transaction to ensure seat limit
    await tenantRepo.runInTransaction(async (tx, repo) => {
      const tenant = await repo.getForUpdateInTransaction(tx, tenantId);

      if (!tenant) {
        throw new Error('Tenant not found');
      }

      if (tenant.usedSeats >= tenant.seats) {
        throw new Error('Seat limit reached. Please upgrade your plan.');
      }

      await repo.updateInTransaction(tx, tenantId, {
        usedSeats: tenant.usedSeats + 1,
      });
    });

    // Add member after transaction succeeds
    await memberRepo.create({
      tenantId,
      userId,
      role,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  async upgradePlan(tenantId: string, newPlan: Tenant['plan']) {
    const planSeats = {
      free: 5,
      pro: 25,
      enterprise: 100,
    };

    return tenantRepo.update(
      tenantId,
      {
        plan: newPlan,
        seats: planSeats[newPlan],
        features: this.getFeaturesForPlan(newPlan),
        updatedAt: new Date().toISOString(),
      },
      { returnDoc: true },
    );
  }

  private getFeaturesForPlan(plan: Tenant['plan']): string[] {
    const features = {
      free: ['basic_analytics', 'api_access'],
      pro: ['basic_analytics', 'api_access', 'advanced_analytics', 'priority_support'],
      enterprise: [
        'basic_analytics',
        'api_access',
        'advanced_analytics',
        'priority_support',
        'custom_domain',
        'sso',
      ],
    };

    return features[plan];
  }
}
```

### Example 3: Social Media Feed with Real-Time Updates

```typescript
// schemas/post.schema.ts
import { z } from 'zod';

export const postSchema = z.object({
  id: z.string(),
  authorId: z.string(),
  status: z.enum(['draft', 'published']),
  content: z.string(),
  createdAt: z.string(),
});

export type Post = z.infer<typeof postSchema>;

export const followSchema = z.object({
  id: z.string(),
  followerId: z.string(),
  followingId: z.string(),
});

export type Follow = z.infer<typeof followSchema>;
```

```typescript
// repositories/post.repository.ts
import { FirestoreRepository } from '@reggieofarrell/firestore-orm';
import { db } from '../config/firebase';
import { Follow, followSchema, Post, postSchema } from '../schemas/post.schema';

export const followRepo = FirestoreRepository.withSchema<Follow>(db, 'follows', followSchema);
export const postRepo = FirestoreRepository.withSchema<Post>(db, 'posts', postSchema);

// Monitor new posts in real-time
export async function subscribeToUserFeed(userId: string, callback: (posts: Post[]) => void) {
  // Get list of users this user follows
  const following = await followRepo.query().where('followerId', '==', userId).get();

  const followingIds = following.map(f => f.followingId);

  // Subscribe to posts from followed users
  return postRepo
    .query()
    .where('authorId', 'in', followingIds)
    .where('status', '==', 'published')
    .orderBy('createdAt', 'desc')
    .limit(50)
    .onSnapshot(callback);
}
```

```typescript
// services/feed.service.ts
export class FeedService {
  private unsubscribe: (() => void) | null = null;

  async startFeedUpdates(userId: string, onUpdate: (posts: Post[]) => void) {
    this.unsubscribe = await subscribeToUserFeed(userId, onUpdate);
  }

  stopFeedUpdates() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  async getInitialFeed(userId: string, limit: number = 20) {
    const following = await followRepo.query().where('followerId', '==', userId).get();

    const followingIds = following.map(f => f.followingId);

    return postRepo
      .query()
      .where('authorId', 'in', followingIds)
      .where('status', '==', 'published')
      .orderBy('createdAt', 'desc')
      .paginate(limit);
  }

  async getMorePosts(userId: string, cursor: string, limit: number = 20) {
    const following = await followRepo.query().where('followerId', '==', userId).get();

    const followingIds = following.map(f => f.followingId);

    return postRepo
      .query()
      .where('authorId', 'in', followingIds)
      .where('status', '==', 'published')
      .orderBy('createdAt', 'desc')
      .paginate(limit, cursor);
  }
}
```

## API Reference

### FirestoreRepository

#### Static Methods

**`withSchema<T>(db: Firestore, collection: string, schema: ZodSchema, converter?: FirestoreDataConverter<T>): FirestoreRepository<T>`**

Create a repository with Zod schema validation.

**`new FirestoreRepository<T>(db: Firestore, collectionPath: string, validator?: Validator<T>, parentPath?: string, converter?: FirestoreDataConverter<T>)`**

Create a repository with optional validation and optional Firestore converter support.

#### Instance Methods

**`create(data: WithFieldValue<T>): Promise<T & { id: ID }>`**

Create a new document.

**`bulkCreate(dataArray: WithFieldValue<T>[]): Promise<(T & { id: ID })[]>`**

Create multiple documents in batch.

**`getById(id: ID): Promise<(T & { id: ID }) | null>`**

Get document by ID.

**`getByIdOrThrow(id: ID): Promise<(T & { id: ID })>`**

Get document by ID and throw `NotFoundError` when missing.

**`update(id: ID, data: PartialWithFieldValue<T>, options?: { merge?: boolean, returnDoc?: boolean }): Promise<{ id: ID } | (T & { id: ID })>`**

Update document with partial data. Supports dot notation for nested updates. Pass `{ merge: true }`
to normalize nested objects to dot paths and execute via `update(...)` semantics. Pass
`{ returnDoc: true }` to return the updated document.

**`patch(id: ID, data: PartialWithFieldValue<T>, options?: { returnDoc?: boolean }): Promise<{ id: ID } | (T & { id: ID })>`**

Convenience alias for `update(id, data, { merge: true })`. Pass `{ returnDoc: true }` to return the
updated document.

**`bulkUpdate(updates: { id: ID, data: PartialWithFieldValue<T> }[]): Promise<{ id: ID }[]>`**

Update multiple documents in batch. Supports dot notation.

**`bulkPatch(updates: { id: ID, data: PartialWithFieldValue<T> }[]): Promise<{ id: ID }[]>`**

Convenience alias for merge-style batch updates. Each update payload is normalized like `patch(...)`
before batched `update(...)` writes.

**`upsert(id: ID, data: WithFieldValue<T>, options?: { returnDoc?: boolean }): Promise<{ id: ID } | (T & { id: ID })>`**

Create or update document with specific ID. Pass `{ returnDoc: true }` to return the final persisted
document.

**`delete(id: ID): Promise<void>`**

Permanently delete document.

**`bulkDelete(ids: ID[]): Promise<number>`**

Permanently delete multiple documents.

**`findByField<K extends keyof T>(field: K, value: T[K]): Promise<(T & { id: ID })[]>`**

Find documents by field value.

**`getOneByField<K extends keyof T>(field: K, value: T[K]): Promise<(T & { id: ID }) | null>`**

Find the first document by field value. Returns `null` when no document matches.

**`getOneByFieldOrThrow<K extends keyof T>(field: K, value: T[K]): Promise<(T & { id: ID })>`**

Find exactly one document by field value. Throws `NotFoundError` when none match and `ConflictError`
when multiple documents match.

**`listenOne(id: ID, callback: (item: T & { id: ID }) => void, onError?: (error: Error) => void): () => void`**

Subscribe to real-time updates for a single document by ID.

**`getAll(): Promise<(T & { id: ID })[]>`**

Get all documents in the collection.

**`query(): FirestoreQueryBuilder<T>`**

Create query builder for complex queries.

**`on(event: HookEvent, fn: HookFn): void`**

Register lifecycle hook.

**`subcollection<S>(parentId: ID, subcollectionName: string, schema?: ZodSchema, converter?: FirestoreDataConverter<S>): FirestoreRepository<S>`**

Access subcollection. Converters are explicit per repository instance and are not inherited from
parent repositories.

**`getParentId(): ID | null`**

Get parent document ID (for subcollections).

**`getCollectionPath(): string`**

Get full collection path.

**`runInTransaction<R>(fn: (tx: Transaction, repo: Repository) => Promise<R>): Promise<R>`**

Execute function within transaction.

**`getForUpdateInTransaction(tx: Transaction, id: ID): Promise<(T & { id: ID }) | null>`**

Get document for update within transaction.

**`updateInTransaction(tx: Transaction, id: ID, data: PartialWithFieldValue<T>, options?: { merge?: boolean }): Promise<void>`**

Update document within transaction. Pass `{ merge: true }` to normalize nested objects to dot paths
and execute via transaction `update(...)`.

**`patchInTransaction(tx: Transaction, id: ID, data: PartialWithFieldValue<T>): Promise<void>`**

Convenience alias for `updateInTransaction(tx, id, data, { merge: true })`.

**`createInTransaction(tx: Transaction, data: WithFieldValue<T>): Promise<T & { id: ID }>`**

Create document within transaction.

**`deleteInTransaction(tx: Transaction, id: ID): Promise<void>`**

Delete document within transaction.

### FirestoreQueryBuilder

**`where(field: string, op: Operator, value: any): this`**

Add where clause. Operators: `==`, `!=`, `>`, `>=`, `<`, `<=`, `in`, `not-in`, `array-contains`,
`array-contains-any`.

**`select(...fields: string[]): this`**

Select specific fields to return.

**`orderBy(field: string, direction?: 'asc' | 'desc'): this`**

Order results by field.

**`limit(n: number): this`**

Limit number of results.

**`startAt(cursorId: ID): this`**

Start at document (inclusive).

**`endBefore(cursorId: ID): this`**

End before document.

**`endAt(cursorId: ID): this`**

End at document (inclusive).

**`get(): Promise<(T & { id: ID })[]>`**

Execute query and return all results.

**`getOne(): Promise<(T & { id: ID }) | null>`**

Get single result (first document).

**`count(): Promise<number>`**

Count matching documents (aggregation query).

**`totalCount(): Promise<number>`**

Count all documents in the base collection. Ignores accumulated `where(...)` clauses on the query
builder instance.

**`exists(): Promise<boolean>`**

Check if any documents match query.

**`paginate(pageSize: number, cursor?: string | null): Promise<{ items: (T & { id: ID })[], nextCursor: string | null, hasMore: boolean }>`**

Cursor-based pagination (recommended for large datasets). Requires at least one `orderBy(...)`.

**`offsetPaginate(page: number, pageSize: number): Promise<{ items: (T & { id: ID })[]; page: number; pageSize: number; total: number; totalPages: number }>`**

Offset-based pagination. Returns `{ items, total, page, pageSize, totalPages }`.

**`paginateWithCount(pageSize: number, cursor?: string | null): Promise<{ items: (T & { id: ID })[], nextCursor: string | null, hasMore: boolean, total: number }>`**

Cursor pagination with total count.

**`update(data: PartialWithFieldValue<T>): Promise<number>`**

Update all matching documents. Returns count of updated documents. Supports dot notation.

**`delete(): Promise<number>`**

Delete all matching documents. Returns count of deleted documents.

**`sum<K extends keyof T>(field: K): Promise<number>`**

Perform Firestore-native sum aggregation on a numeric field.

**`average<K extends keyof T>(field: K): Promise<number>`**

Perform Firestore-native average aggregation on a numeric field.

**`distinctValues<K extends keyof T>(field: K): Promise<T[K][]>`**

Get distinct values for field.

### Exported Types

Common types re-exported from the package entry point:

- **`ID`**: `string` document identifier alias
- **`HookEvent`**: union of supported lifecycle hook names
- **`PaginatedResult<T>`**: `{ items, nextCursor, hasMore }` from cursor pagination
- **`UpdateInput<T>`**: update payload type (alias for Firestore `PartialWithFieldValue<T>`)
- **`UpdateOptions`**: `{ merge?: boolean; returnDoc?: boolean }`
- **`Validator<T>`**: validation contract used by `makeValidator(...)`

**`stream(): AsyncGenerator<T & { id: ID }>`**

Stream results (for large datasets).

**`onSnapshot(callback: (items: (T & { id: ID })[]) => void, onError?: (error: Error) => void): Promise<() => void>`**

Subscribe to real-time updates. Returns unsubscribe function.

### Error Classes

**`ValidationError`**

Thrown when Zod schema validation fails.

Properties:

- `issues: ZodIssue[]` - Array of validation errors
- `message: string` - Formatted error message

**`NotFoundError`**

Thrown when a requested document is not found.

Properties:

- `message: string` - Error description

**`ConflictError`**

Thrown when operation conflicts with existing data.

Properties:

- `message: string` - Error description

**`FirestoreIndexError`**

Thrown when query requires a composite index.

Properties:

- `indexUrl: string` - URL to create the required index
- `fields: string[]` - Fields requiring indexing
- `toString(): string` - Returns formatted error message with instructions

### Express Middleware

**`errorHandler(err: any, req: Request, res: Response, next: NextFunction): void`**

Express middleware for handling repository errors.

Maps errors to HTTP status codes:

- `ValidationError` → 400 Bad Request
- `NotFoundError` → 404 Not Found
- `ConflictError` → 409 Conflict
- `FirestoreIndexError` → 404 Not Found (with index URL)
- Others → 500 Internal Server Error

## Advanced Patterns

### Audit Logging

Track all data changes for compliance and debugging.

```typescript
// services/audit-log.service.ts
class AuditLogService {
  private auditRepo = new FirestoreRepository<AuditLog>(db, 'audit_logs');

  async record(action: string, data: any, userId?: string) {
    await this.auditRepo.create({
      action,
      data,
      userId: userId || 'system',
      timestamp: new Date().toISOString(),
      ipAddress: getCurrentIpAddress(),
      userAgent: getCurrentUserAgent(),
    });
  }
}

export const auditLog = new AuditLogService();

// Apply to all repositories
userRepo.on('afterCreate', async user => {
  await auditLog.record('user_created', user, user.id);
});

userRepo.on('afterUpdate', async ({ id }) => {
  const user = await userRepo.getById(id);
  if (user) {
    await auditLog.record('user_updated', user, id);
  }
});

userRepo.on('afterDelete', async user => {
  await auditLog.record('user_deleted', { id: user.id }, user.id);
});
```

### Caching Layer

Add Redis caching to reduce Firestore reads.

```typescript
// repositories/cached-user.repository.ts
import { Redis } from 'ioredis';

class CachedUserRepository {
  private repo = FirestoreRepository.withSchema<User>(db, 'users', userSchema);
  private cache = new Redis(process.env.REDIS_URL);
  private cacheTTL = 300; // 5 minutes

  async getById(id: string): Promise<User | null> {
    // Check cache first
    const cached = await this.cache.get(`user:${id}`);
    if (cached) {
      return JSON.parse(cached);
    }

    // Fallback to Firestore
    const user = await this.repo.getById(id);
    if (user) {
      await this.cache.setex(`user:${id}`, this.cacheTTL, JSON.stringify(user));
    }

    return user;
  }

  async update(id: string, data: Partial<User>): Promise<User | null> {
    await this.repo.update(id, data);
    // Invalidate cache
    await this.cache.del(`user:${id}`);
    return this.repo.getById(id);
  }

  async create(data: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User & { id: string }> {
    return this.repo.create({
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  // Delegate other methods to repo...
  query() {
    return this.repo.query();
  }
}

export const cachedUserRepo = new CachedUserRepository();
```

### Full-Text Search

Integrate with Algolia or Elasticsearch for full-text search.

```typescript
// services/search.service.ts
import algoliasearch from 'algoliasearch';

class SearchService {
  private client = algoliasearch(process.env.ALGOLIA_APP_ID!, process.env.ALGOLIA_ADMIN_KEY!);
  private usersIndex = this.client.initIndex('users');
  private productsIndex = this.client.initIndex('products');

  async indexUser(user: User & { id: string }) {
    await this.usersIndex.saveObject({
      objectID: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
    });
  }

  async deleteUser(userId: string) {
    await this.usersIndex.deleteObject(userId);
  }

  async searchUsers(query: string) {
    const { hits } = await this.usersIndex.search(query);
    return hits;
  }
}

export const searchService = new SearchService();

// Sync with Algolia on user changes
userRepo.on('afterCreate', async user => {
  await searchService.indexUser(user);
});

userRepo.on('afterUpdate', async ({ id }) => {
  const user = await userRepo.getById(id);
  if (user) {
    await searchService.indexUser(user);
  }
});

userRepo.on('afterDelete', async user => {
  await searchService.deleteUser(user.id);
});
```

### Event-Driven Architecture

Publish domain events to message queue.

```typescript
// services/event-publisher.service.ts
import { EventEmitter } from 'events';

class EventPublisher extends EventEmitter {
  async publish(event: string, data: any) {
    this.emit(event, data);
    // Also publish to external queue (RabbitMQ, SQS, etc.)
    await messageQueue.publish(event, data);
  }
}

export const eventPublisher = new EventPublisher();

// Publish events on repository actions
userRepo.on('afterCreate', async user => {
  await eventPublisher.publish('user.created', user);
});

orderRepo.on('afterCreate', async order => {
  await eventPublisher.publish('order.placed', order);
});

// Consumers can subscribe to events
eventPublisher.on('user.created', async user => {
  await emailService.sendWelcomeEmail(user.email);
  await analyticsService.trackSignup(user);
});

eventPublisher.on('order.placed', async order => {
  await inventoryService.reserveStock(order);
  await notificationService.notifyWarehouse(order);
});
```

### Multi-Database Pattern

Use different databases for different data types.

```typescript
// config/database.ts
import { getFirestore } from 'firebase-admin/firestore';

// Primary database for transactional data
export const primaryDb = getFirestore(primaryApp);

// Analytics database for reporting
export const analyticsDb = getFirestore(analyticsApp);

// repositories/user.repository.ts
export const userRepo = FirestoreRepository.withSchema<User>(primaryDb, 'users', userSchema);

// repositories/analytics.repository.ts
export const userAnalyticsRepo = new FirestoreRepository<UserAnalytics>(
  analyticsDb,
  'user_analytics',
);

// Sync analytics data
userRepo.on('afterCreate', async user => {
  await userAnalyticsRepo.create({
    userId: user.id,
    signupDate: user.createdAt,
    source: user.source,
    plan: user.plan,
  });
});
```

### Data Archiving

Archive documents before deleting them from the primary collection.

```typescript
class ArchivingService {
  private archiveRepo = new FirestoreRepository<ArchivedDocument>(db, 'archived_documents');

  async archiveAndDelete<T>(repo: FirestoreRepository<T>, id: string): Promise<void> {
    // Get document
    const doc = await repo.getById(id);
    if (!doc) {
      throw new NotFoundError('Document not found');
    }

    // Archive to separate collection
    await this.archiveRepo.create({
      originalCollection: repo.getCollectionPath(),
      originalId: id,
      data: doc,
      archivedAt: new Date().toISOString(),
    });

    // Permanently delete from original collection
    await repo.delete(id);
  }
}

export const archivingService = new ArchivingService();

// Usage
await archivingService.archiveAndDelete(userRepo, 'user-123');
```

### Rate Limiting

Implement rate limiting at the repository level.

```typescript
// decorators/rate-limited-repository.ts
import { RateLimiterMemory } from 'rate-limiter-flexible';

class RateLimitedRepository<T> {
  private rateLimiter = new RateLimiterMemory({
    points: 100, // 100 requests
    duration: 60, // per 60 seconds
  });

  constructor(private repo: FirestoreRepository<T>) {}

  async create(data: T, userId: string): Promise<T & { id: string }> {
    await this.rateLimiter.consume(userId);
    return this.repo.create(data);
  }

  async update(id: string, data: Partial<T>, userId: string): Promise<{ id: string }> {
    await this.rateLimiter.consume(userId);
    return this.repo.update(id, data);
  }

  // Delegate other methods...
}

export const rateLimitedUserRepo = new RateLimitedRepository(userRepo);
```

### Subclassing for Enforced Denormalization

When you must guarantee that base document updates always include connected denormalized writes,
subclass `FirestoreRepository` and override write entry points so they all route through one
transactional path.

```typescript
import {
  FirestoreRepository,
  ID,
  NotFoundError,
  UpdateInput,
  UpdateOptions,
} from '@reggieofarrell/firestore-orm';
import { Firestore } from 'firebase-admin/firestore';

type Order = {
  id: string;
  userId: string;
  status: 'pending' | 'processing' | 'cancelled';
  updatedAt: string;
};

type User = {
  id: string;
  lastOrderId?: string;
  lastOrderStatus?: string;
  lastOrderAt?: string;
};

class OrderRepository extends FirestoreRepository<Order> {
  constructor(
    db: Firestore,
    private readonly userRepo: FirestoreRepository<User>,
  ) {
    super(db, 'orders');
  }

  // All order updates go through one transaction that also updates denormalized user fields.
  override async update(
    id: ID,
    data: UpdateInput<Order>,
    options?: UpdateOptions,
  ): Promise<{ id: ID } | (Order & { id: ID })> {
    return this.runInTransaction(async (tx, repo) => {
      const order = await repo.getForUpdateInTransaction(tx, id);
      if (!order) {
        throw new NotFoundError(`Order with id ${id} not found`);
      }

      await repo.updateInTransaction(tx, id, data, options);
      await this.userRepo.updateInTransaction(
        tx,
        order.userId,
        {
          lastOrderId: id,
          lastOrderStatus: (data as Partial<Order>).status ?? order.status,
          lastOrderAt: new Date().toISOString(),
        } as UpdateInput<User>,
        { merge: true },
      );

      if (options?.returnDoc === true) {
        const updated = await repo.getForUpdateInTransaction(tx, id);
        if (!updated) throw new NotFoundError(`Order with id ${id} not found after update`);
        return updated;
      }

      return { id };
    });
  }

  // Keep patch behavior aligned by delegating to the overridden update path.
  override async patch(
    id: ID,
    data: UpdateInput<Order>,
    options?: { returnDoc?: boolean },
  ): Promise<{ id: ID } | (Order & { id: ID })> {
    if (options?.returnDoc === true) {
      return this.update(id, data, { merge: true, returnDoc: true });
    }
    return this.update(id, data, { merge: true });
  }
}
```

Why this pattern is useful:

- It prevents accidental base-only writes because callers use your subclass methods, not the raw
  repository methods.
- It guarantees base + connected writes are atomic by committing them in one transaction.
- The same structure applies to `bulkUpdate`/`bulkPatch`, and to create/delete paths when
  denormalization must be enforced there as well.

## Troubleshooting

### 1. Composite Index Required

**Error:** `Query requires a Firestore index`

**Solution:** Click the URL in the error message to create the index. Wait 1-2 minutes for it to
build.

### 2. Hooks Not Running in Transactions

```typescript
// after* hooks do not run for transaction-scoped write helpers
await repo.runInTransaction(async (tx, repo) => {
  await repo.createInTransaction(tx, data);
  // afterCreate hook will NOT run here
});
```

**Solution:** Run side effects after transaction completes:

```typescript
const result = await repo.runInTransaction(async (tx, repo) => {
  const doc = await repo.createInTransaction(tx, data);
  return doc;
});

// Now run side effects
await sendEmail(result.email);
```

### 3. "in" Query Limit (10 items)

```typescript
// Firestore limits "in" queries to 10 items
await userRepo
  .query()
  .where('id', 'in', arrayOf20Ids) // ERROR
  .get();
```

**Solution:** Chunk your queries:

```typescript
const chunks = chunkArray(ids, 10);
const results = [];

for (const chunk of chunks) {
  const users = await userRepo.query().where('id', 'in', chunk).get();
  results.push(...users);
}
```

### 4. Query Ordering Requires Index

```typescript
// This requires composite index
await repo
  .query()
  .where('status', '==', 'active')
  .orderBy('createdAt', 'desc') // Different field from where
  .get();
```

**Solution:** Create the composite index via the error message link, or order by the same field you
filter on.

### 5. Subcollection Parent ID Lost

When querying subcollections, the parent ID isn't automatically included in results.

**Solution:** Use `getParentId()` method:

```typescript
const ordersRepo = userRepo.subcollection('user-123', 'orders');
const parentId = ordersRepo.getParentId(); // 'user-123'
```

### 6. Dot Notation in Transactions

**Issue:** Transaction logic needs existing state before update

**Solution:** Read with `getForUpdateInTransaction()` only when needed by your business rules:

```typescript
await repo.runInTransaction(async (tx, repo) => {
  const doc = await repo.getForUpdateInTransaction(tx, 'doc-123');
  if (!doc) throw new Error('Document not found');
  await repo.updateInTransaction(tx, 'doc-123', {
    'nested.field': 'value',
  } as any);
});
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

## Testing Strategy

This project uses a **two-tier Jest** strategy:

| Tier            | Runner                                            | Role                                            |
| --------------- | ------------------------------------------------- | ----------------------------------------------- |
| **Unit**        | `jest.config.unit.js`                             | Fast checks on utils, errors, validation, mocks |
| **Integration** | `jest.config.integration.js` + Firestore emulator | **Primary ORM safety net** — real reads/writes  |

Each suite enforces **path-specific coverage gates** (not merged LCOV). A merged report would count
a line as covered if either suite hit it, which overstates confidence for a database library.

```bash
npm run test:unit              # Fast unit tests
npm run test:integration:emulator  # Emulator-backed integration tests
npm test                       # Both tiers
npm run test:coverage:all      # Full coverage + dual gates
```

**Full guide:** [docs/development/testing.md](docs/development/testing.md)

### Coverage thresholds

Releases require `npm run test:coverage:all` to pass (publish CI runs the same check). Thresholds
are enforced per suite by `scripts/check-coverage-gates.mjs` — not by a single global percentage.

| Suite           | Scope                                         | Lines | Branches | Functions |
| --------------- | --------------------------------------------- | ----- | -------- | --------- |
| **Unit**        | `src/utils/**`                                | 95%   | 90%      | 90%       |
| **Unit**        | Errors, ErrorParser, ErrorHandler, Validation | 90%   | 85%      | 90%       |
| **Unit**        | `src/index.ts`                                | 100%  | 100%     | 65%       |
| **Integration** | `FirestoreRepository.ts`                      | 90%   | 75%      | 85%       |
| **Integration** | `QueryBuilder.ts`                             | 90%   | 75%      | 95%       |
| **Integration** | `Validation.ts` (emulator paths)              | 90%   | 80%      | 95%       |
| **Integration** | `src/vector/**`                               | 90%   | 75%      | 90%       |

The static **coverage** badge above means these dual gates are enforced on PR CI and before npm
publish — it is not a live Codecov-style percentage.

### Quick prerequisites (integration)

- JDK 21+ (Firestore emulator; required ahead of `firebase-tools@15`)
- `FIRESTORE_EMULATOR_HOST` defaults to `127.0.0.1:8080`

### Hooks and CI

- **Pre-push:** unit coverage + unit gate (no emulator)
- **CI:** unit and integration jobs run in parallel; each enforces its own gate
- **Publish:** `test:coverage:all` must pass before the package is published to npm

See [.github/workflows/tests.yml](.github/workflows/tests.yml) and
[docs/development/releasing.md](docs/development/releasing.md).

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Add tests — **unit** for pure logic; **integration (emulator)** for repository/query behavior
5. Run `npm test` before opening a PR; run `npm run test:coverage:all` when changing test infra
6. Commit using [Conventional Commits](https://www.conventionalcommits.org/) (e.g.
   `git commit -m 'feat(query): add distinct filter'`) — a `commit-msg` hook validates the format,
   and the changelog is generated from these messages (see
   [docs/development/releasing.md](docs/development/releasing.md))
7. Push to your branch (`git push origin feature/amazing-feature`) — pre-push runs unit coverage
   gate
8. Open a Pull Request — CI runs both suite gates

### Development Setup

```bash
git clone https://github.com/reggieofarrell/firestore-orm.git
cd firestore-orm
npm install
npm run build
npm test
```

### Coding Standards

- Use TypeScript strict mode
- Follow existing code style
- Write **integration** tests for `FirestoreRepository` / `QueryBuilder` changes; **unit** tests for
  utils and error layer
- Update documentation (including `docs/development/testing.md` when test policy changes)
- Keep commits focused and atomic

## License

This project is licensed under the **MIT License**.

- Full license text: [LICENSE](https://github.com/reggieofarrell/firestore-orm/blob/main/LICENSE)
- Fork attribution notice:
  [NOTICE](https://github.com/reggieofarrell/firestore-orm/blob/main/NOTICE)
- Original upstream license:
  [HBFLEX/spacelabs-firestoreorm LICENSE](https://github.com/HBFLEX/spacelabs-firestoreorm/blob/main/LICENSE)

### Derivative work notice

This repository is a fork of
[HBFLEX/spacelabs-firestoreorm](https://github.com/HBFLEX/spacelabs-firestoreorm). Under the MIT
License, you may use, modify, and distribute this software provided that **all copies include the
original copyright notice, permission notice, and this repository's NOTICE file** where applicable.

Current copyright holders in this repository:

- Copyright (c) 2025 HBFL3Xx (original work)
- Copyright (c) 2026 Reggie Farrell (fork modifications)

No additional license restrictions are imposed beyond MIT. There are no copyleft obligations, but
attribution to the original author must be preserved in source distributions.

## Support

- **Issues:** [GitHub Issues](https://github.com/reggieofarrell/firestore-orm/issues)
- **Documentation:** [GitHub Repository](https://github.com/reggieofarrell/firestore-orm)
- **Email:** reggie@blackflag.design

## Acknowledgments

- **Original author:** [Happy Banda (HBFL3Xx)](https://github.com/HBFLEX) for creating
  [spacelabs-firestoreorm](https://github.com/HBFLEX/spacelabs-firestoreorm) and publishing it under
  the MIT License
- **Firebase team** for the Admin SDK
- **Zod team** for schema validation
- Everyone who has contributed ideas, issues, and feedback around Firestore ORM ergonomics

If this package saves you time, consider giving this repository a star and crediting the upstream
project when sharing derivative work.

## Roadmap

Planned features for future releases:

- Looking forward to your suggestions here

---

**Maintained by [Reggie Farrell](https://github.com/reggieofarrell)** · Forked from work by
[HBFL3Xx](https://github.com/HBFLEX)
