<!-- npm-readme -->

# FlintFire

A type-safe, schema-aware Firestore data-access library for Node.js, built for the Firebase Admin
SDK. Validation, lifecycle hooks, and a fluent query builder.

[![npm version](https://img.shields.io/npm/v/flintfire.svg)](https://www.npmjs.com/package/flintfire)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5+-blue.svg)](https://www.typescriptlang.org/)
[![Docs](https://img.shields.io/badge/docs-GitHub%20Pages-blue.svg)](https://reggieofarrell.github.io/flintfire/)

## Table of Contents

- [Why FlintFire?](#why-flintfire)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Documentation](#documentation)
- [Support](#support)
- [License](#license)

## Why FlintFire?

### Built for Real Production Use

- **Type-Safe Everything** - Full TypeScript support with intelligent inference
- **Zod Validation** - Schema validation that integrates seamlessly with your data layer
- **Explicit Delete Semantics** - Keep data lifecycle behavior clear and predictable
- **Lifecycle Hooks** - Add logging, analytics, or side effects without cluttering your business
  logic
- **Powerful Query Builder** - Intuitive, chainable queries with pagination, aggregation, and
  streaming
- **Vector Search Extension** - Opt-in KNN similarity search via `flintfire/vector`
  ([guide](https://reggieofarrell.github.io/flintfire/guides/advanced/vector-search/))
- **Transaction Support** - ACID guarantees for critical operations
- **Subcollection Support** - Navigate document hierarchies naturally, and query every parent's
  subcollection at once with collection groups
- **Dot Notation Updates** - Update nested fields without replacing entire objects

### Framework Agnostic

Works seamlessly with Express.js, NestJS, Fastify, Koa, Next.js API routes, and any Node.js
environment.

## Installation

```bash
npm install flintfire firebase-admin zod
```

```bash
yarn add flintfire firebase-admin zod
```

```bash
pnpm add flintfire firebase-admin zod
```

### Peer Dependencies

- Node.js: >= 22 — the supported floor, required by `firebase-admin` 14; the library targets ES2020,
  so `firebase-admin` 12/13 users can run on Node 18+ (outside the tested/supported window)
- `firebase-admin`: ^12.0.0 || ^13.0.0 || ^14.0.0 (vector extension: object-form `findNearest`
  requires `@google-cloud/firestore >= 7.10`, guaranteed by `firebase-admin >= 13`; on admin 12 only
  when the resolved firestore is >= 7.10)
- `zod`: ^4.0.0
- `express`: ^4.0.0 || ^5.0.0 (optional — only needed for the `flintfire/express` middleware)

> **v3** is the current major line. Upgrading from `@reggieofarrell/firestore-orm` 2.x? See the
> [v2 → v3 migration guide](https://reggieofarrell.github.io/flintfire/guides/migration-v2-to-v3/).

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
  email: z.email('Invalid email address'),
  age: z.number().int().positive().optional(),
  status: z.enum(['active', 'inactive', 'suspended']).default('active'),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type User = z.infer<typeof userSchema>;
```

### 3. Create Your Repository

```typescript
import { FirestoreRepository } from 'flintfire';
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
**[reggieofarrell.github.io/flintfire](https://reggieofarrell.github.io/flintfire/)**, organized
into two pillars: **Guides** (learn) and **Reference** (look up).

Start with [Getting Started](https://reggieofarrell.github.io/flintfire/getting-started/), then
browse the Guides and Reference pillars in the sidebar.

Source, issues, and contributing guides:
[github.com/reggieofarrell/flintfire](https://github.com/reggieofarrell/flintfire).

## Support

- **Issues:** [GitHub Issues](https://github.com/reggieofarrell/flintfire/issues)
- **Documentation:**
  [https://reggieofarrell.github.io/flintfire/](https://reggieofarrell.github.io/flintfire/)

## License

MIT. Full text: [LICENSE](https://github.com/reggieofarrell/flintfire/blob/main/LICENSE). Required
attribution for redistributors:
[NOTICE](https://github.com/reggieofarrell/flintfire/blob/main/NOTICE).

- Copyright (c) 2025 HBFL3Xx (original work)
- Copyright (c) 2026 Reggie O'Farrell (subsequent modifications)

---

**Maintained by [Reggie O'Farrell](https://github.com/reggieofarrell)** · Built on MIT-licensed work
by [HBFL3Xx](https://github.com/HBFLEX)
([NOTICE](https://github.com/reggieofarrell/flintfire/blob/main/NOTICE))
