<!-- npm-readme -->

# @reggieofarrell/firestore-orm

A type-safe, thoroughly tested, feature-rich Firestore ORM built for the Firebase Admin SDK.
Designed to make backend Firestore development actually enjoyable.

[![npm version](https://img.shields.io/npm/v/@reggieofarrell/firestore-orm.svg)](https://www.npmjs.com/package/@reggieofarrell/firestore-orm)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5+-blue.svg)](https://www.typescriptlang.org/)
[![Docs](https://img.shields.io/badge/docs-GitHub%20Pages-blue.svg)](https://reggieofarrell.github.io/firestore-orm/)

## Table of Contents

- [Why FirestoreORM?](#why-firestoreorm)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Documentation](#documentation)
- [Migration](#migration)
- [Support](#support)
- [License](#license)

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
  `@reggieofarrell/firestore-orm/vector`
  ([guide](https://reggieofarrell.github.io/firestore-orm/guides/advanced/vector-search/))
- **Transaction Support** - ACID guarantees for critical operations
- **Subcollection Support** - Navigate document hierarchies naturally
- **Dot Notation Updates** - Update nested fields without replacing entire objects

### Framework Agnostic

Works seamlessly with Express.js, NestJS, Fastify, Koa, Next.js API routes, and any Node.js
environment.

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

- Node.js: >= 22 — the supported floor, required by `firebase-admin` 14; the library targets ES2020,
  so `firebase-admin` 12/13 users can run on Node 18+ (outside the tested/supported window)
- `firebase-admin`: ^12.0.0 || ^13.0.0 || ^14.0.0 (vector extension: object-form `findNearest`
  requires `@google-cloud/firestore >= 7.10`, guaranteed by `firebase-admin >= 13`; on admin 12 only
  when the resolved firestore is >= 7.10)
- `zod`: ^4.0.0
- `express`: ^4.0.0 || ^5.0.0 (optional — only needed for the
  `@reggieofarrell/firestore-orm/express` middleware)

> **v3** is the current major line. Upgrading from 2.x? See the
> [migration guide](https://reggieofarrell.github.io/firestore-orm/guides/migration-v2-to-v3/).

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
import { userSchema } from './schemas';

// The read type is inferred from `userSchema` (equivalent to the exported `User` type).
export const userRepo = FirestoreRepository.withSchema(db, 'users', userSchema);
```

### 4. Start Building

```typescript
// Create a user (returns { id } by default; pass { returnDoc: true } for the full read model)
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

## Documentation

Full documentation lives at
**[reggieofarrell.github.io/firestore-orm](https://reggieofarrell.github.io/firestore-orm/)**,
organized into two pillars: **Guides** (learn) and **Reference** (look up).

Start with [Getting Started](https://reggieofarrell.github.io/firestore-orm/getting-started/), then
browse the Guides and Reference pillars in the sidebar.

Source, issues, and contributing guides:
[github.com/reggieofarrell/firestore-orm](https://github.com/reggieofarrell/firestore-orm).

## Migration

Migrating from
[`@spacelabstech/firestoreorm`](https://www.npmjs.com/package/@spacelabstech/firestoreorm)? Replace
imports with `@reggieofarrell/firestore-orm` and review the
[API Reference](https://reggieofarrell.github.io/firestore-orm/guides/api-reference/) for current
method contracts. Upgrading within this fork from 2.x → 3.x? See the
[v2 → v3 migration guide](https://reggieofarrell.github.io/firestore-orm/guides/migration-v2-to-v3/).

This package is a maintained fork of
[spacelabs-firestoreorm](https://github.com/HBFLEX/spacelabs-firestoreorm) by
[Happy Banda (HBFL3Xx)](https://github.com/HBFLEX), published under the MIT License.

## Support

- **Issues:** [GitHub Issues](https://github.com/reggieofarrell/firestore-orm/issues)
- **Documentation:**
  [https://reggieofarrell.github.io/firestore-orm/](https://reggieofarrell.github.io/firestore-orm/)
- **Email:** reggie@blackflag.design

## License

MIT. Full text: [LICENSE](https://github.com/reggieofarrell/firestore-orm/blob/main/LICENSE). Fork
attribution: [NOTICE](https://github.com/reggieofarrell/firestore-orm/blob/main/NOTICE).

- Copyright (c) 2025 HBFL3Xx (original work)
- Copyright (c) 2026 Reggie O'Farrell (fork modifications)

---

**Maintained by [Reggie O'Farrell](https://github.com/reggieofarrell)** · Forked from work by
[HBFL3Xx](https://github.com/HBFLEX)
