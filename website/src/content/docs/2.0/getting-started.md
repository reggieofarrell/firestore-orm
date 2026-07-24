---
title: Getting Started
description: Install @reggieofarrell/firestore-orm, define a Zod schema, and run
  your first create/query/update/delete.
slug: 2.0/getting-started
---

Install the package, wire Firebase Admin, define a schema, and use a repository for CRUD and
queries. This page is the shortest path from zero to a working collection.

## Prerequisites

* Node.js 18+
* A Firebase project with Cloud Firestore enabled
* A service account key (or another Admin SDK credential) for local/server use

## Install

```bash
npm install @reggieofarrell/firestore-orm firebase-admin zod
```

```bash
yarn add @reggieofarrell/firestore-orm firebase-admin zod
```

```bash
pnpm add @reggieofarrell/firestore-orm firebase-admin zod
```

### Peer dependencies

| Package          | Supported range                                            |
| ---------------- | ---------------------------------------------------------- |
| `firebase-admin` | `^12.0.0 \|\| ^13.0.0` (vector extension: ≥13 recommended) |
| `zod`            | `^3.25.0 \|\| ^4.0.0`                                      |

## 1. Initialize Firebase Admin

```typescript
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const app = initializeApp({
  credential: cert('./serviceAccountKey.json'),
});

export const db = getFirestore(app);
```

Use Application Default Credentials, or your host’s recommended Admin init, in production instead of
a checked-in key file.

## 2. Define a schema

Every schema passed to `withSchema` **must** declare a required top-level `id: z.string()`. The
repository strips `id` from write payloads and sources it from Firestore (or from the `id` argument
on updates).

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

See [Schema Validation](/firestore-orm/2.0/guides/schema-validation/) for derived create/update schemas and `id`
handling.

## 3. Create a repository

```typescript
import { FirestoreRepository } from '@reggieofarrell/firestore-orm';
import { db } from './firebase';
import { userSchema, type User } from './schemas';

export const userRepo = FirestoreRepository.withSchema<User>(db, 'users', userSchema);
```

Prefer `withSchema` when you want runtime validation. For an unvalidated collection, construct
`new FirestoreRepository<User>(db, 'users')` instead — see [Core Concepts](/firestore-orm/2.0/guides/core-concepts/).

## 4. Create, query, update, delete

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

## Next steps

| Topic                                                    | When to read it                                        |
| -------------------------------------------------------- | ------------------------------------------------------ |
| [Core Concepts](/firestore-orm/2.0/guides/core-concepts/)                 | Repository pattern, converters, delete behavior        |
| [CRUD Operations](/firestore-orm/2.0/guides/crud-operations/)             | Bulk variants and return shapes                        |
| [Queries](/firestore-orm/2.0/guides/queries/)                             | Pagination, aggregations, streaming, listeners         |
| [Field-value sentinels](/firestore-orm/2.0/guides/field-value-sentinels/) | `serverTimestamp`, `increment`, strict sentinel policy |
| [Framework Integration](/firestore-orm/2.0/guides/framework-integration/) | Express / NestJS wiring                                |
| [Documentation overview](/firestore-orm/2.0/overview/)                    | Full guide index                                       |
