# Documentation

The complete usage guide for `@reggieofarrell/firestore-orm`. The [project README](../../README.md)
covers installation and a quick start; everything below goes deeper, one topic per page.

## How this is organized

- **Concepts** — the mental model: repositories, converters, schema validation, and hooks.
- **Operations** — the day-to-day API: CRUD, queries, transactions, subcollections, nested updates.
- **Reference** — exhaustive signatures and error semantics.
- **Integration & extensions** — framework wiring and the optional vector-search module.
- **Guidance** — best practices, cost model, worked examples, patterns, and troubleshooting.

## Contents

### Concepts

| Page                                                      | What it covers                                                         |
| --------------------------------------------------------- | ---------------------------------------------------------------------- |
| [Core Concepts](./core-concepts.md)                       | Repository pattern, Firestore converters, delete behavior              |
| [Schema Validation](./schema-validation.md)               | Zod validation lifecycle, derived create/update schemas, `id` handling |
| [Per-Field Sentinel Approval](./field-value-sentinels.md) | Write combinators, `sentinelPolicy: 'strict'`, sharing types front-end |
| [Timestamps ↔ Millis](./timestamps.md)                    | `createMillisTimestampConverter` and the write/read timestamp pattern  |
| [Lifecycle Hooks](./lifecycle-hooks.md)                   | `before*`/`after*` hooks, payloads, and ordering                       |

### Operations

| Page                                                 | What it covers                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------- |
| [CRUD Operations](./crud-operations.md)              | Create, read, update, delete, and bulk variants                 |
| [Queries](./queries.md)                              | Query builder, aggregations, streaming, real-time subscriptions |
| [Transactions](./transactions.md)                    | `runInTransaction` and the transaction-scoped methods           |
| [Subcollections](./subcollections.md)                | Nested collections and per-instance converter behavior          |
| [Dot Notation for Nested Updates](./dot-notation.md) | Field-path updates, merge/patch, and `FieldValue` sentinels     |

### Reference

| Page                                  | What it covers                                                  |
| ------------------------------------- | --------------------------------------------------------------- |
| [API Reference](./api-reference.md)   | Every `FirestoreRepository` / `FirestoreQueryBuilder` signature |
| [Error Handling](./error-handling.md) | Error classes, when they throw, and the Express middleware      |

### Integration & extensions

| Page                                                | What it covers                                      |
| --------------------------------------------------- | --------------------------------------------------- |
| [Framework Integration](./framework-integration.md) | Express.js and NestJS wiring                        |
| [Vector Search](./vector-search.md)                 | The optional `./vector` extension and `findNearest` |

### Guidance

| Page                                        | What it covers                                        |
| ------------------------------------------- | ----------------------------------------------------- |
| [Best Practices](./best-practices.md)       | Recommended patterns for production use               |
| [Performance](./performance.md)             | Firestore cost model, optimization tips, benchmarks   |
| [Real-World Examples](./examples.md)        | End-to-end e-commerce, multi-tenant, and social feed  |
| [Advanced Patterns](./advanced-patterns.md) | Audit logging, caching, event-driven, denormalization |
| [Troubleshooting](./troubleshooting.md)     | Common errors and their fixes                         |

---

← Back to the [project README](../../README.md).
