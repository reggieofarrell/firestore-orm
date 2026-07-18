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
- [Documentation](#documentation)
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
  `@reggieofarrell/firestore-orm/vector`
  ([guide](https://reggieofarrell.github.io/firestore-orm/guides/vector-search/))
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

## Documentation

[https://reggieofarrell.github.io/firestore-orm/](https://reggieofarrell.github.io/firestore-orm/)

Start with [Getting Started](https://reggieofarrell.github.io/firestore-orm/getting-started/)

**Concepts**

- [Core Concepts](https://reggieofarrell.github.io/firestore-orm/guides/core-concepts/) — repository
  pattern, Firestore converters, delete behavior
- [Schema Validation](https://reggieofarrell.github.io/firestore-orm/guides/schema-validation/) —
  Zod validation lifecycle, derived schemas, `id` handling
- [Per-Field Sentinel Approval](https://reggieofarrell.github.io/firestore-orm/guides/field-value-sentinels/)
  — write combinators and `sentinelPolicy: 'strict'`
- [Timestamps ↔ Millis](https://reggieofarrell.github.io/firestore-orm/guides/timestamps/) — the
  timestamp/millisecond converter
- [Lifecycle Hooks](https://reggieofarrell.github.io/firestore-orm/guides/lifecycle-hooks/)

**Operations**

- [CRUD Operations](https://reggieofarrell.github.io/firestore-orm/guides/crud-operations/)
- [Queries](https://reggieofarrell.github.io/firestore-orm/guides/queries/) — query builder,
  aggregations, streaming, real-time
- [Transactions](https://reggieofarrell.github.io/firestore-orm/guides/transactions/)
- [Subcollections](https://reggieofarrell.github.io/firestore-orm/guides/subcollections/)
- [Dot Notation for Nested Updates](https://reggieofarrell.github.io/firestore-orm/guides/dot-notation/)

**Reference & integration**

- [API Reference](https://reggieofarrell.github.io/firestore-orm/guides/api-reference/)
- [Error Handling](https://reggieofarrell.github.io/firestore-orm/guides/error-handling/)
- [Framework Integration](https://reggieofarrell.github.io/firestore-orm/guides/framework-integration/)
  — Express, NestJS
- [Vector Search](https://reggieofarrell.github.io/firestore-orm/guides/vector-search/)

**Guidance**

- [Best Practices](https://reggieofarrell.github.io/firestore-orm/guides/best-practices/)
- [Performance](https://reggieofarrell.github.io/firestore-orm/guides/performance/)
- [Real-World Examples](https://reggieofarrell.github.io/firestore-orm/guides/examples/)
- [Advanced Patterns](https://reggieofarrell.github.io/firestore-orm/guides/advanced-patterns/)
- [Troubleshooting](https://reggieofarrell.github.io/firestore-orm/guides/troubleshooting/)

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

For significant architectural or contract-level changes, record the decision as an
[Architecture Decision Record](docs/adr/README.md) (start from
[`docs/adr/0000-template.md`](docs/adr/0000-template.md)).

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
- Copyright (c) 2026 Reggie O'Farrell (fork modifications)

No additional license restrictions are imposed beyond MIT. There are no copyleft obligations, but
attribution to the original author must be preserved in source distributions.

## Support

- **Issues:** [GitHub Issues](https://github.com/reggieofarrell/firestore-orm/issues)
- **Documentation:**
  [https://reggieofarrell.github.io/firestore-orm/](https://reggieofarrell.github.io/firestore-orm/)
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

**Maintained by [Reggie O'Farrell](https://github.com/reggieofarrell)** · Forked from work by
[HBFL3Xx](https://github.com/HBFLEX)
