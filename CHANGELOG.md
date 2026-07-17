# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0](https://github.com/reggieofarrell/firestore-orm/compare/v2.0.1...v2.1.0) (2026-07-17)

### Added

- **validation:** per-field FieldValue sentinel approval with opt-in strict policy
  ([#6](https://github.com/reggieofarrell/firestore-orm/issues/6))
  ([0e0234c](https://github.com/reggieofarrell/firestore-orm/commit/0e0234cb204fc08b827b770a7070e2345b23f83d))

## [2.0.1](https://github.com/reggieofarrell/firestore-orm/compare/v2.0.0...v2.0.1) (2026-07-15)

### Documentation

- add coverage badge and release thresholds to README
  ([#4](https://github.com/reggieofarrell/firestore-orm/issues/4))
  ([6a4c428](https://github.com/reggieofarrell/firestore-orm/commit/6a4c428890fbefbc25eac5a3ef2e90888fe482ab))

## [2.0.0] - 2026-07-08

First intentional release under `@reggieofarrell/firestore-orm`. This is a maintained fork and major
refactor of `@spacelabstech/firestoreorm`; changes below are described relative to the upstream
baseline **`@spacelabstech/firestoreorm@1.1.0`**. It is a deliberate break from the upstream `1.x`
line — the core write/return contracts changed, the soft-delete subsystem was removed, and an opt-in
vector search extension was added. Users migrating from `@spacelabstech/firestoreorm` should target
`2.0.0`, not `1.x` continuity. Entries marked **Breaking** require code changes when upgrading from
the upstream package.

### Added

- **Vector search extension** (`@reggieofarrell/firestore-orm/vector`) — opt-in KNN similarity
  search, reached only through the new `./vector` subpath (the main entry point does not re-export
  it):
  - `withVectorSearch(repo)` — wraps a repository, returning a vector-enabled repository whose
    `query()` yields a `VectorQueryBuilder`
  - `VectorQueryBuilder` — `where()`, `select()`, `findNearest()`, `get()`, `getOne()`, with
    chaining guards (`findNearest()` may be called once; `where()`/`select()` only before it;
    `orderBy()`/`onSnapshot()`/`stream()` are unsupported and throw)
  - `vectorEmbeddingSchema(dimensions?)` — Zod helper accepting a `FieldValue.vector()` sentinel or
    a plain `number[]` of the expected length
  - Types and constants: `FindNearestOptions`, `VectorSearchResult`, `VectorDistanceMeasure` (+
    `VectorDistanceMeasureValue`), `VECTOR_MAX_DIMENSIONS` (2048), `VECTOR_MAX_LIMIT` (1000)
  - Runtime helpers: `validateFindNearestOptions()`, `isVectorFieldValue()`,
    `assertVectorSearchSupported()`
  - `getUnderlyingQuery()` / `getQueryRef()` internal composition helpers on the core query builder
  - `firestore.indexes.json` with vector index definitions for the integration tests
  - Vector search documentation
- **Read-after-write control** — `update()`, `upsert()`, and `patch()` accept `{ returnDoc: true }`
  (new exported `UpdateOptions` type) to return the full re-read document instead of the default
  `{ id }` payload
- **Merge-style convenience aliases** — `patch()`, `bulkPatch()`, and `patchInTransaction()` wrap
  the `{ merge: true }` path, flattening nested objects to dot-notation update paths
- **New read helpers** — `getByIdOrThrow()` (throws `NotFoundError` when missing), `getOneByField()`
  (first match or `null`), `getOneByFieldOrThrow()` (throws `NotFoundError` on zero, `ConflictError`
  on multiple), `getAll()` (unbounded collection read; large collections steered to
  `query().paginate()`), and `listenOne()` (single-document real-time listener returning an
  unsubscribe function)
- **Native aggregation** — `query().sum(field)` and `query().average(field)` using Firestore's
  server-side `AggregateField` aggregation (returns only the aggregate; `null` normalized to `0`)
- **Firestore converter support** — pass a `FirestoreDataConverter` to the constructor,
  `FirestoreRepository.withSchema(db, collection, schema, converter?)`, or
  `subcollection(parentId, name, schema?, converter?)`. Converters are instance-local:
  subcollections do **not** inherit a parent's converter and must be given their own.
- **Sentinel-aware validation** — write validation now recognizes Firestore `FieldValue` sentinels
  (`serverTimestamp`, `increment`, `arrayUnion`, `arrayRemove`, `delete`) and `FieldValue.vector()`
  values, accepting a write when the only schema violations are scoped to sentinel-valued paths
  while still rejecting genuine violations. Exposes `isFieldValueSentinel()` and
  `collectSentinelPaths()`.
- **Schema introspection** — repositories expose a frozen `schemas` bundle plus `readSchema` /
  `createSchema` / `updateSchema` getters (`create` = read schema without top-level `id`; `update` =
  `create.partial()`)
- **New exported types** — `UpdateOptions`, `UpdateInput` (`PartialWithFieldValue<T>`), and
  `PaginatedResult<T>` (`{ items, nextCursor, hasMore }`) are re-exported from the package root;
  `CreateInput`/`RepositorySchemaSet` are defined internally
- **Developer tooling & CI** (dev-only; not shipped to consumers): ESLint flat config
  (`eslint.config.js`), Prettier (`.prettierrc`), Husky hooks (`pre-commit` → lint-staged;
  `pre-push` → unit coverage + gate), `lint-staged` config, and a GitHub Actions workflow running
  the unit and emulator-backed integration suites with **dual per-suite path-specific coverage
  gates** (`scripts/check-coverage-gates.mjs`; merged LCOV is intentionally not gated)
- **Firebase emulator configuration** — `firebase.json`, `.firebaserc` (`demo-firestoreorm-test`),
  and `firestore.indexes.json`, enabling credential-free integration tests
- **Test suite** — a two-tier Jest architecture (unit suites under `src/tests/unit/`,
  emulator-backed integration suites under `src/tests/integration/`) with a shared integration
  harness, data factories, and Firestore mocks; split Jest configs (`jest.config.base.js` /
  `.unit.js` / `.integration.js`)
- **Documentation & attribution** — `NOTICE` (fork/upstream MIT attribution),
  `docs/vector-search.md`, and `docs/development/` testing guides; `LICENSE` retains the upstream
  `Copyright (c) 2025 HBFL3Xx` and adds `Copyright (c) 2026 Reggie O'Farrell`
- Package `files` now ships `CHANGELOG.md`, `docs/vector-search.md`, and `NOTICE`; keyword
  `vector-search` added

### Changed

- **Breaking:** package renamed `@spacelabstech/firestoreorm` → `@reggieofarrell/firestore-orm` and
  bumped to `2.0.0`; update the install target and all import specifiers
- **Breaking:** `update()`, `bulkUpdate()`, and `upsert()` return `{ id }` / `{ id }[]` by default
  instead of the full (merged) document. Use `{ returnDoc: true }` to get the document back.
  `afterUpdate` now receives `{ id }` and `afterBulkUpdate` receives `{ ids }` (previously the full
  document / full updates array).
- **Breaking:** write semantics moved to Firestore-native writes. `update()`/`updateInTransaction()`
  now call `docRef.update()` directly instead of a read-modify-write `set(..., { merge: true })`.
  Consequences: passing a nested object replaces that entire map field unless `{ merge: true }` (or
  `patch()`) is used; top-level `undefined` values are stripped; a payload that reduces to no fields
  is a no-op. A missing document still surfaces as `NotFoundError`, except an empty/undefined-only
  payload returns `{ id }` without a read or write.
- **Breaking:** lifecycle hook ordering is now `before*` → validation → write → `after*`. `before*`
  hooks run **before** schema validation and receive the raw caller input (previously they ran after
  validation and received the validated payload).
- **Breaking:** `query().aggregate(field, 'sum' | 'avg')` was replaced by `sum()` / `average()` (see
  Added / Removed). The old method fetched every matching document and reduced client-side; the
  replacements run server-side and are far cheaper on large result sets.
- **Breaking:** transaction read helper `getForUpdate(tx, id, includeDeleted?)` renamed to
  `getForUpdateInTransaction(tx, id)`; `updateInTransaction()` dropped its `existingData` parameter,
  gained an `UpdateOptions` argument, and now uses native `tx.update()` (fails when the document is
  missing) instead of `tx.set(..., { merge: true })`
- **Breaking:** create/update input typing moved from `T` / `Partial<T>` to `CreateInput<T>`
  (`WithFieldValue<T>`) / `UpdateInput<T>` (`PartialWithFieldValue<T>`) across the repository and
  query builder, and a top-level `id` supplied in a write payload is now stripped before persistence
- **Breaking:** `FirestoreRepository.withSchema()` and `subcollection(..., schema)` now require a
  schema with a required top-level string `id` field and throw at construction time otherwise
  (upstream examples used `id`-less schemas)
- **Breaking:** `makeValidator(readSchema, updateSchema?)` treats its first argument as the
  canonical **read** schema and derives the write schema by omitting the top-level `id` (update
  defaults to the id-stripped create schema made partial). `Validator<T>` now carries a required
  `schemas` bundle, and its parse methods return `WithFieldValue<T>` / `PartialWithFieldValue<T>`.
- **Breaking:** `paginate()` / `paginateWithCount()` now take an opaque base64url cursor (encoding
  the document path, resilient across subcollections) and return `{ items, nextCursor, hasMore }`
  instead of `{ items, nextCursorId }`. They require at least one `orderBy()`, reject a non-positive
  page size, fetch `pageSize + 1` to compute `hasMore` accurately, and throw on a stale cursor
  rather than silently restarting.
- **Breaking:** `parseFirestoreError()` now maps Firestore not-found failures (gRPC code `5` or
  `'not-found'`) to `NotFoundError`. Because it is re-thrown from nearly every repository/query
  catch block, code that inspected the raw error's numeric `.code` on not-found conditions must
  switch to `instanceof NotFoundError`.
- **Breaking:** the runtime `dependencies` block was removed — `firebase-admin` and `zod` are now
  **peer dependencies only** and are no longer installed transitively. The `zod` peer range was
  tightened to `^3.25.0 || ^4.0.0` (dropping `3.0.0`–`3.24.x`); the `firebase-admin` peer range is
  unchanged (`^12.0.0 || ^13.0.0`, with `>= 13` recommended for the vector extension).
- **Breaking:** minimum supported Node raised to `>=18.0.0` (from upstream's `>=16.0.0`) via
  `engines.node`. `firebase-admin@13` requires Node 18+, and Node 16 is end-of-life.
- `query().update()` was rewritten: it validates and sanitizes each matching document's payload
  (stripping top-level `undefined`, converting Zod failures to `ValidationError`, skipping documents
  that reduce to no fields) and no longer supports dot-notation deep-merge. Dot-notation **path
  validation** (`validateDotNotationPath`) was also dropped from the repository write paths, so
  malformed field paths now surface as Firestore errors at write time.
- `src/index.ts` now separates value exports from type-only exports (`ID`, `HookEvent`, `Validator`
  are `export type`), driven by the newly enabled `isolatedModules` in `tsconfig.json`
- `firebase-admin` (`^13.0.0`) and `zod` (`^4.0.0`) are pinned as dev dependencies; the package
  description and keywords dropped all soft-delete wording (keyword `soft-delete` removed, along
  with `query-builder`)
- npm scripts were overhauled (lint/format/emulator, split unit/integration test flows, coverage
  gates); the `test:dotnotation` script was removed
- Documentation rewritten for fork ownership with explicit upstream attribution (README
  `About This Project` / `Fork & Attribution` sections, `Explicit Delete Semantics`, converter and
  sentinel docs, vector search section, and a two-tier testing strategy)

### Removed

- **Breaking:** the entire soft-delete subsystem:
  - repository methods `softDelete()`, `bulkSoftDelete()`, `restore()`, `restoreAll()`,
    `purgeDelete()`
  - query-builder methods `includeDeleted()`, `onlyDeleted()`, `softDelete()`
  - the eight soft-delete/restore hook events (`before/afterSoftDelete`, `before/afterRestore`, and
    their `Bulk` variants)
  - the automatic `deletedAt: null` field written on create (documents created by the fork no longer
    carry `deletedAt`)
  - the `includeDeleted` parameter on `getById()`, `list()`, and `getForUpdate()`, and the implicit
    `deletedAt == null` filter previously applied to reads, counts, updates, and deletes
- **Breaking:** `query().aggregate(field, 'sum' | 'avg')` (replaced by `sum()` / `average()`)
- **Breaking:** the `list(limit, startAfterId?, includeDeleted?)` repository method (use `getAll()`
  or `query().paginate()`) and the `startAfterId(id)` query-builder method (cursor positioning is
  now internal to `paginate()`)

### Fixed

- `runInTransaction()` now copies registered hooks (and the converter and schemas) onto the
  transaction-scoped repository, so `before*` hooks fire for `createInTransaction()` /
  `updateInTransaction()` / `deleteInTransaction()`. Previously these hooks were silently dropped
  inside transactions. (`after*` hooks are still intentionally skipped inside transactions.)
- `totalCount()` documentation corrected — it counts the base collection and ignores accumulated
  `where` clauses (the upstream JSDoc claimed a soft-delete filter that never applied); runtime
  behavior is unchanged.

### Notes

- Migration guidance for consumers coming from `@spacelabstech/firestoreorm` lives in the
  [README](README.md#fork--attribution).
- `ErrorHandler` HTTP status mappings are unchanged (`ValidationError` → 400, `NotFoundError` → 404,
  `FirestoreIndexError` → 404, `ConflictError` → 409, otherwise 500).
- `src/utils/dotNotation.ts` is functionally unchanged from upstream (reformatting only).
- Recommended: use top-level `embedding` fields for vector search.

[2.0.0]: https://github.com/reggieofarrell/firestore-orm/releases/tag/v2.0.0
