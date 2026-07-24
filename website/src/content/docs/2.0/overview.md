---
title: Documentation overview
description: Index of firestore-orm usage guides — concepts, operations,
  reference, integration, and guidance.
slug: 2.0/overview
---

Topic index for `@reggieofarrell/firestore-orm`. New to the library? Start with
[Getting Started](/firestore-orm/2.0/getting-started/), then browse the nested sections in the sidebar (or the tables
below).

## How this is organized

* **Concepts** — the mental model: repositories, converters, schema validation, and hooks.
* **Operations** — the day-to-day API: CRUD, queries, transactions, subcollections, nested updates.
* **Reference** — exhaustive signatures and error semantics.
* **Integration & extensions** — framework wiring and the optional vector-search module.
* **Guidance** — best practices, cost model, worked examples, patterns, and troubleshooting.

## Contents

### Concepts

| Page                                                           | What it covers                                                         |
| -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [Core Concepts](/firestore-orm/2.0/guides/core-concepts/)                       | Repository pattern, Firestore converters, delete behavior              |
| [Schema Validation](/firestore-orm/2.0/guides/schema-validation/)               | Zod validation lifecycle, derived create/update schemas, `id` handling |
| [Per-Field Sentinel Approval](/firestore-orm/2.0/guides/field-value-sentinels/) | Write combinators, `sentinelPolicy: 'strict'`, sharing types front-end |
| [Timestamps ↔ Millis](/firestore-orm/2.0/guides/timestamps/)                    | `createMillisTimestampConverter` and the write/read timestamp pattern  |
| [Lifecycle Hooks](/firestore-orm/2.0/guides/lifecycle-hooks/)                   | `before*`/`after*` hooks, payloads, and ordering                       |

### Operations

| Page                                                      | What it covers                                                  |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| [CRUD Operations](/firestore-orm/2.0/guides/crud-operations/)              | Create, read, update, delete, and bulk variants                 |
| [Queries](/firestore-orm/2.0/guides/queries/)                              | Query builder, aggregations, streaming, real-time subscriptions |
| [Transactions](/firestore-orm/2.0/guides/transactions/)                    | `runInTransaction` and the transaction-scoped methods           |
| [Subcollections](/firestore-orm/2.0/guides/subcollections/)                | Nested collections and per-instance converter behavior          |
| [Dot Notation for Nested Updates](/firestore-orm/2.0/guides/dot-notation/) | Field-path updates, merge/patch, and `FieldValue` sentinels     |

### Reference

| Page                                       | What it covers                                                  |
| ------------------------------------------ | --------------------------------------------------------------- |
| [API Reference](/firestore-orm/2.0/guides/api-reference/)   | Every `FirestoreRepository` / `FirestoreQueryBuilder` signature |
| [Error Handling](/firestore-orm/2.0/guides/error-handling/) | Error classes, when they throw, and the Express middleware      |

### Integration & extensions

| Page                                                     | What it covers                                      |
| -------------------------------------------------------- | --------------------------------------------------- |
| [Framework Integration](/firestore-orm/2.0/guides/framework-integration/) | Express.js and NestJS wiring                        |
| [Firestore Triggers](/firestore-orm/2.0/guides/triggers/)                 | Mapping trigger snapshots with `fromSnapshot`       |
| [Vector Search](/firestore-orm/2.0/guides/vector-search/)                 | The optional `./vector` extension and `findNearest` |

### Guidance

| Page                                             | What it covers                                        |
| ------------------------------------------------ | ----------------------------------------------------- |
| [Best Practices](/firestore-orm/2.0/guides/best-practices/)       | Recommended patterns for production use               |
| [Performance](/firestore-orm/2.0/guides/performance/)             | Firestore cost model, optimization tips, benchmarks   |
| [Real-World Examples](/firestore-orm/2.0/guides/examples/)        | End-to-end e-commerce, multi-tenant, and social feed  |
| [Advanced Patterns](/firestore-orm/2.0/guides/advanced-patterns/) | Audit logging, caching, event-driven, denormalization |
| [Troubleshooting](/firestore-orm/2.0/guides/troubleshooting/)     | Common errors and their fixes                         |
