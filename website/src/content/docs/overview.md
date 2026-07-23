---
title: Documentation overview
description: Index of firestore-orm docs — a Guides pillar (learn) and a Reference pillar (look up).
---

Topic index for `@reggieofarrell/firestore-orm`. New to the library? Start with
[Getting Started](/firestore-orm/getting-started/), then follow the **Guides** pillar in order (the
sidebar gives you prev/next). Reach for the **Reference** pillar when you need an exact signature.

## How this is organized

The docs split into two pillars:

- **Guides** — learn the library in a sensible order: get started, the core concepts (the mental
  model), working with data day to day, designing your data model, advanced features, framework
  integrations, and upgrading.
- **Reference** — look up exact signatures and contracts: the repository and query-builder classes,
  exported types, runtime helpers, error classes, scope, and troubleshooting.

## Guides

### Get started

| Page                                               | What it covers                                 |
| -------------------------------------------------- | ---------------------------------------------- |
| [Getting Started](/firestore-orm/getting-started/) | Install, initialize, define a schema, and CRUD |
| [Documentation overview](/firestore-orm/overview/) | This page — the docs map                       |

### Core concepts

| Page                                                                                 | What it covers                                                 |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| [Core Concepts](/firestore-orm/guides/concepts/core-concepts/)                       | Repository pattern, the four generics, delete behavior         |
| [Document Identity](/firestore-orm/guides/concepts/document-identity/)               | Virtual identity, no top-level `id`, `repo.id()`, `whereId`    |
| [Schema Validation](/firestore-orm/guides/concepts/schema-validation/)               | Zod validation lifecycle, derived create/update schemas        |
| [Read Converters](/firestore-orm/guides/concepts/read-converters/)                   | Read-only `readConverter`, required `storedSchema`, id overlay |
| [Per-Field Sentinel Approval](/firestore-orm/guides/concepts/field-value-sentinels/) | Write combinators and `sentinelPolicy: 'strict'`               |
| [Timestamps ↔ Millis](/firestore-orm/guides/concepts/timestamps/)                    | `createMillisTimestampConverter` and the timestamp pattern     |
| [Lifecycle Hooks](/firestore-orm/guides/concepts/lifecycle-hooks/)                   | `before*`/`after*` hooks, payloads, and ordering               |

### Working with data

| Page                                                                        | What it covers                                              |
| --------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [CRUD Operations](/firestore-orm/guides/working-with-data/crud-operations/) | Create, read, update, delete, and bulk variants             |
| [Queries](/firestore-orm/guides/working-with-data/queries/)                 | Query builder, aggregations, streaming, real-time           |
| [Transactions](/firestore-orm/guides/working-with-data/transactions/)       | `runInTransaction` and the transaction-scoped methods       |
| [Subcollections](/firestore-orm/guides/working-with-data/subcollections/)   | Nested collections and per-instance converter behavior      |
| [Dot Notation](/firestore-orm/guides/working-with-data/dot-notation/)       | Field-path updates, merge/patch, and `FieldValue` sentinels |

### Designing your data

| Page                                                                            | What it covers                                           |
| ------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [Data Modeling](/firestore-orm/guides/designing/data-modeling/)                 | Maps vs subcollections, arrays, denormalized query flags |
| [ID Strategies](/firestore-orm/guides/designing/id-strategies/)                 | Auto, deterministic, and shared document ids             |
| [Schema Evolution](/firestore-orm/guides/designing/schema-evolution/)           | Read-side normalization without a data migration         |
| [Trust Boundary & Security](/firestore-orm/guides/designing/security-boundary/) | Admin SDK bypasses rules; validate at the boundary       |
| [Best Practices](/firestore-orm/guides/designing/best-practices/)               | Recommended patterns for production use                  |
| [Performance & Cost](/firestore-orm/guides/designing/performance/)              | Firestore cost model, optimization tips, benchmarks      |

### Advanced

| Page                                                               | What it covers                                       |
| ------------------------------------------------------------------ | ---------------------------------------------------- |
| [Real-time & Listeners](/firestore-orm/guides/advanced/real-time/) | `listenOne` and query `onSnapshot`                   |
| [Advanced Patterns](/firestore-orm/guides/advanced/patterns/)      | Custom repository methods, denormalization, and more |
| [Real-World Examples](/firestore-orm/guides/advanced/examples/)    | End-to-end e-commerce, multi-tenant, and social feed |
| [Vector Search](/firestore-orm/guides/advanced/vector-search/)     | The optional `./vector` extension and `findNearest`  |

### Integrations & upgrading

| Page                                                                              | What it covers                                     |
| --------------------------------------------------------------------------------- | -------------------------------------------------- |
| [Express](/firestore-orm/guides/integrations/express/)                            | Route handlers and the `errorHandler` middleware   |
| [NestJS](/firestore-orm/guides/integrations/nestjs/)                              | DI module/service/controller stack                 |
| [Cloud Functions & Triggers](/firestore-orm/guides/integrations/cloud-functions/) | Mapping trigger snapshots with `fromSnapshot`      |
| [Testing with the Emulator](/firestore-orm/guides/integrations/testing/)          | Testing repositories against the local emulator    |
| [Migrating from v2 to v3](/firestore-orm/guides/migration-v2-to-v3/)              | Breaking changes and step-by-step upgrade from 2.x |

## Reference

| Page                                                                     | What it covers                                     |
| ------------------------------------------------------------------------ | -------------------------------------------------- |
| [FirestoreRepository](/firestore-orm/reference/repository/)              | Construction, reads, writes, identity, hooks, txns |
| [FirestoreQueryBuilder](/firestore-orm/reference/query-builder/)         | Filtering, projection, aggregation, pagination     |
| [Exported Types](/firestore-orm/reference/types/)                        | `FirestoreDocument`, `DataOf`, `FieldPaths`, …     |
| [Helpers & Utilities](/firestore-orm/reference/helpers/)                 | Validation combinators, timestamp & dot-notation   |
| [Error Handling](/firestore-orm/reference/errors/)                       | Error classes and `parseFirestoreError`            |
| [Scope & Capabilities](/firestore-orm/reference/scope-and-capabilities/) | Supported surface and deferred capabilities        |
| [Troubleshooting](/firestore-orm/reference/troubleshooting/)             | Common errors and their fixes                      |
