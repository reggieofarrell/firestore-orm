---
title: Getting Started
description:
  Install @reggieofarrell/firestore-orm, define a Zod schema, and run your first
  create/query/update/delete.
---

Install the package, wire Firebase Admin, define a schema, and use a repository for CRUD and
queries. This page is the shortest path from zero to a working collection.

## Prerequisites

- Node.js 22+ — the supported floor, required by `firebase-admin` 14; the library's own code targets
  ES2020, so on `firebase-admin` 12/13 it runs on Node 18+ (just outside the tested/supported
  window)
- A Firebase project with Cloud Firestore enabled
- A credential for the Admin SDK — Application Default Credentials (recommended), or a service
  account key for local development

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

| Package          | Supported range                                                         |
| ---------------- | ----------------------------------------------------------------------- |
| `firebase-admin` | `^12.0.0 \|\| ^13.0.0 \|\| ^14.0.0` (vector extension: ≥13 recommended) |
| `zod`            | `^4.0.0`                                                                |

## 1. Initialize Firebase Admin

Prefer **Application Default Credentials** — the Admin SDK reads them from
`GOOGLE_APPLICATION_CREDENTIALS`, `gcloud auth application-default login`, or the service account
attached to your host (Cloud Run, Cloud Functions, GCE). Nothing is checked in.

```typescript
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const app = initializeApp({ credential: applicationDefault() });

export const db = getFirestore(app);
```

For local development without ADC configured, a downloaded service-account key is a labeled
fallback. Keep the JSON out of version control (`.gitignore` it) and rotate it regularly:

```typescript
import { initializeApp, cert } from 'firebase-admin/app';

// Local-dev fallback only — never commit the key file.
const app = initializeApp({ credential: cert('./serviceAccountKey.json') });
```

## 2. Define a schema

Schemas describe the document's **own data** and **must not** declare a top-level `id` — the
Firestore document name is the sole authority for `id`, and `withSchema` throws at construction if a
schema declares one. `id` is generated automatically on `create`, taken from the `id` argument on
`update`/`upsert`/`delete`, and overlaid onto every read.

```typescript
import { z } from 'zod';

export const userSchema = z.object({
  // No `id` field — the repository owns identity (sourced from the document name).
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  age: z.number().int().positive().optional(),
  status: z.enum(['active', 'inactive', 'suspended']).default('active'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// The read-data shape (no `id`). Reads resolve to `FirestoreDocument<User>`, which adds the id.
export type User = z.infer<typeof userSchema>;
```

See [Schema Validation](/firestore-orm/guides/concepts/schema-validation/) for derived create/update
schemas and the no-top-level-`id` rule.

## 3. Create a repository

```typescript
import { FirestoreRepository } from '@reggieofarrell/firestore-orm';
import { db } from './firebase';
import { userSchema, type User } from './schemas';

export const userRepo = FirestoreRepository.withSchema(db, 'users', userSchema);
```

Prefer `withSchema` when you want runtime validation. For an unvalidated collection, construct
`new FirestoreRepository<User>(db, 'users')` instead — see
[Core Concepts](/firestore-orm/guides/concepts/core-concepts/).

## 4. Create, query, update, delete

```typescript
// Create a user — returns { id } by default (pass { returnDoc: true } for the full document)
const { id: userId } = await userRepo.create({
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
const { id: updatedUserId } = await userRepo.update(userId, {
  status: 'inactive',
  updatedAt: new Date().toISOString(),
});

// Delete user
await userRepo.delete(userId);
```

## Next steps

| Topic                                                                          | When to read it                                        |
| ------------------------------------------------------------------------------ | ------------------------------------------------------ |
| [Core Concepts](/firestore-orm/guides/concepts/core-concepts/)                 | Repository pattern, converters, delete behavior        |
| [CRUD Operations](/firestore-orm/guides/working-with-data/crud-operations/)    | Bulk variants and return shapes                        |
| [Queries](/firestore-orm/guides/working-with-data/queries/)                    | Pagination, aggregations, streaming, listeners         |
| [Field-value sentinels](/firestore-orm/guides/concepts/field-value-sentinels/) | `serverTimestamp`, `increment`, strict sentinel policy |
| [Framework Integration](/firestore-orm/guides/integrations/express/)           | Express / NestJS wiring                                |
| [Documentation overview](/firestore-orm/overview/)                             | Full guide index                                       |
