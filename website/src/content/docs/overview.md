---
title: Documentation overview
description:
  Index of firestore-orm usage guides — concepts, operations, reference, integration, and guidance.
---

Topic index for `@reggieofarrell/firestore-orm`. New to the library? Start with
[Getting Started](./getting-started/), then browse the nested sections in the sidebar (or the tables
below).

## How this is organized

- **Concepts** — the mental model: repositories, converters, schema validation, and hooks.
- **Operations** — the day-to-day API: CRUD, queries, transactions, subcollections, nested updates.
- **Reference** — exhaustive signatures and error semantics.
- **Integration & extensions** — framework wiring and the optional vector-search module.
- **Guidance** — upgrading from v2, best practices, cost model, worked examples, patterns, and
  troubleshooting.

## Contents

### Concepts

| Page                                                           | What it covers                                                         |
| -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [Core Concepts](./guides/core-concepts/)                       | Repository pattern, Firestore converters, delete behavior              |
| [Schema Validation](./guides/schema-validation/)               | Zod validation lifecycle, derived create/update schemas, `id` handling |
| [Per-Field Sentinel Approval](./guides/field-value-sentinels/) | Write combinators, `sentinelPolicy: 'strict'`, sharing types front-end |
| [Timestamps ↔ Millis](./guides/timestamps/)                    | `createMillisTimestampConverter` and the write/read timestamp pattern  |
| [Lifecycle Hooks](./guides/lifecycle-hooks/)                   | `before*`/`after*` hooks, payloads, and ordering                       |

### Operations

| Page                                                      | What it covers                                                  |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| [CRUD Operations](./guides/crud-operations/)              | Create, read, update, delete, and bulk variants                 |
| [Queries](./guides/queries/)                              | Query builder, aggregations, streaming, real-time subscriptions |
| [Transactions](./guides/transactions/)                    | `runInTransaction` and the transaction-scoped methods           |
| [Subcollections](./guides/subcollections/)                | Nested collections and per-instance converter behavior          |
| [Dot Notation for Nested Updates](./guides/dot-notation/) | Field-path updates, merge/patch, and `FieldValue` sentinels     |

### Reference

| Page                                       | What it covers                                                  |
| ------------------------------------------ | --------------------------------------------------------------- |
| [API Reference](./guides/api-reference/)   | Every `FirestoreRepository` / `FirestoreQueryBuilder` signature |
| [Error Handling](./guides/error-handling/) | Error classes, when they throw, and the Express middleware      |

### Integration & extensions

| Page                                                     | What it covers                                      |
| -------------------------------------------------------- | --------------------------------------------------- |
| [Framework Integration](./guides/framework-integration/) | Express.js and NestJS wiring                        |
| [Firestore Triggers](./guides/triggers/)                 | Mapping trigger snapshots with `fromSnapshot`       |
| [Vector Search](./guides/vector-search/)                 | The optional `./vector` extension and `findNearest` |

### Guidance

| Page                                                    | What it covers                                        |
| ------------------------------------------------------- | ----------------------------------------------------- |
| [Migrating from v2 to v3](./guides/migration-v2-to-v3/) | Breaking changes and step-by-step upgrade from 2.x    |
| [Best Practices](./guides/best-practices/)              | Recommended patterns for production use               |
| [Performance](./guides/performance/)                    | Firestore cost model, optimization tips, benchmarks   |
| [Real-World Examples](./guides/examples/)               | End-to-end e-commerce, multi-tenant, and social feed  |
| [Advanced Patterns](./guides/advanced-patterns/)        | Audit logging, caching, event-driven, denormalization |
| [Troubleshooting](./guides/troubleshooting/)            | Common errors and their fixes                         |
