# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-07-08

First intentional release under `@reggieofarrell/firestore-orm`. This major version bundles the
maintained fork baseline with a new opt-in vector search extension. It is not a continuation of the
upstream `@spacelabstech/firestoreorm` `1.x` line.

### Added

- **Vector search extension** (`@reggieofarrell/firestore-orm/vector`)
  - `withVectorSearch()` — wrap a repository for KNN similarity search
  - `VectorQueryBuilder` — `where()`, `select()`, `findNearest()`, `get()`, `getOne()`
  - `vectorEmbeddingSchema()` — Zod helper for embedding fields
  - Types and constants: `FindNearestOptions`, `VectorDistanceMeasure`, `VECTOR_MAX_DIMENSIONS`,
    `VECTOR_MAX_LIMIT`
- Core `isFieldValueSentinel()` recognition for `FieldValue.vector()` write values (`VectorValue`)
- `getUnderlyingQuery()` / `getQueryRef()` for internal vector module composition
- `firestore.indexes.json` with vector index definitions for integration tests
- [Vector search documentation](docs/vector-search.md)

### Changed

- Package version reset to `2.0.0` to reflect fork lineage under `@reggieofarrell/firestore-orm`
- Dev dependency `firebase-admin` bumped to `^13.0.0` for full vector query option coverage in tests
- Integration coverage gate added for `src/vector/**`

### Notes

- Core repository and query APIs remain backward-compatible; vector search is opt-in via `/vector`
- Users migrating from `@spacelabstech/firestoreorm` should target `2.0.0`, not `1.x` continuity
- Recommended: use top-level `embedding` fields; see [vector search docs](docs/vector-search.md)

[2.0.0]: https://github.com/reggieofarrell/firestore-orm/releases/tag/v2.0.0
