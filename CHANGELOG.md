# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.4](https://github.com/reggieofarrell/flintfire/compare/v3.1.3...v3.1.4) (2026-09-06)

### Fixed

- npm readme cleanup ([#130](https://github.com/reggieofarrell/flintfire/issues/130))
  ([aab90e2](https://github.com/reggieofarrell/flintfire/commit/aab90e2fd7c7ce21fc60582841ea783d9f43f374))
- pin local Sonar host ([#128](https://github.com/reggieofarrell/flintfire/issues/128))
  ([3926507](https://github.com/reggieofarrell/flintfire/commit/39265076ffc7f19839b27623efedb657aad7843d))
- scope local Sonar credentials ([#129](https://github.com/reggieofarrell/flintfire/issues/129))
  ([e9eb634](https://github.com/reggieofarrell/flintfire/commit/e9eb63428f2d00b332d3096efbce6590f13be5bb))

## [3.1.3](https://github.com/reggieofarrell/flintfire/compare/v3.1.2...v3.1.3) (2026-08-31)

### Fixed

- **sonar:** clear open project SonarQube issues
  ([#126](https://github.com/reggieofarrell/flintfire/issues/126))
  ([d48a2e4](https://github.com/reggieofarrell/flintfire/commit/d48a2e4d7ecc200214a11dd06760234c8041d7d2)),
  closes [#121](https://github.com/reggieofarrell/flintfire/issues/121)

## [3.1.2](https://github.com/reggieofarrell/flintfire/compare/v3.1.1...v3.1.2) (2026-08-30)

### Changed

- **repository / query / vector:** SonarJS complexity and style refactors with no intentional
  behavior change (helper extraction in `findNearest` validation, staging callbacks, regex and sort
  clarifications, overload documentation)
  ([#121](https://github.com/reggieofarrell/flintfire/issues/121))
  ([62b0c39](https://github.com/reggieofarrell/flintfire/commit/62b0c3975e123030f06f2e27c59b2b8d7407929c))

### Fixed

- **repository:** drop a redundant write-method array type assertion already narrowed by the Set
  ([#121](https://github.com/reggieofarrell/flintfire/issues/121))
  ([62b0c39](https://github.com/reggieofarrell/flintfire/commit/62b0c3975e123030f06f2e27c59b2b8d7407929c))

## [3.1.1](https://github.com/reggieofarrell/flintfire/compare/v3.1.0...v3.1.1) (2026-08-27)

### Added

- **errors:** add InvalidPaginationCursorError and TypeError for numeric args
  ([#118](https://github.com/reggieofarrell/flintfire/issues/118))
  ([5f3e422](https://github.com/reggieofarrell/flintfire/commit/5f3e4228382a056e941bcadc6b5a07cf4261a1c2))

### Documentation

- bump Starlight and use the horizontal wordmark in the nav
  ([#116](https://github.com/reggieofarrell/flintfire/issues/116))
  ([63cb7fb](https://github.com/reggieofarrell/flintfire/commit/63cb7fb546639e552c4ddff5cfa155fc4ed2d0c3))
- center the splash hero mark on small screens
  ([#117](https://github.com/reggieofarrell/flintfire/issues/117))
  ([3f5f433](https://github.com/reggieofarrell/flintfire/commit/3f5f4333950de5154c5f879e3b369380988a542a))

## [3.1.0](https://github.com/reggieofarrell/flintfire/compare/v3.0.0...v3.1.0) (2026-08-25)

### Added

- **query:** export ReadOnlyQuery so fluent chains cannot leak write terminals
  ([#107](https://github.com/reggieofarrell/flintfire/issues/107))
  ([a6069f0](https://github.com/reggieofarrell/flintfire/commit/a6069f0a524edc2ebb0c5f366e75cb6c45704431)),
  closes [#100](https://github.com/reggieofarrell/flintfire/issues/100)
  [#100](https://github.com/reggieofarrell/flintfire/issues/100)
  [#100](https://github.com/reggieofarrell/flintfire/issues/100)
- **repository:** expose withSchema's argument assembly for subclasses (withSchemaArgs)
  ([#104](https://github.com/reggieofarrell/flintfire/issues/104))
  ([ac45759](https://github.com/reggieofarrell/flintfire/commit/ac45759d11e9c25f47fa52feea3f912bb38f8fe3)),
  closes [#102](https://github.com/reggieofarrell/flintfire/issues/102)
  [#102](https://github.com/reggieofarrell/flintfire/issues/102)
  [#105](https://github.com/reggieofarrell/flintfire/issues/105)
  [#105](https://github.com/reggieofarrell/flintfire/issues/105)
  [#105](https://github.com/reggieofarrell/flintfire/issues/105)
- **repository:** guarantee write interceptors run in the primary write's atomic boundary
  ([#108](https://github.com/reggieofarrell/flintfire/issues/108))
  ([#113](https://github.com/reggieofarrell/flintfire/issues/113))
  ([510f595](https://github.com/reggieofarrell/flintfire/commit/510f595a6b473616df0413a9b9d87cc56f156be3)),
  closes [#103](https://github.com/reggieofarrell/flintfire/issues/103)
  [#100](https://github.com/reggieofarrell/flintfire/issues/100)
  [#112](https://github.com/reggieofarrell/flintfire/issues/112)
- **repository:** warn once when subclass overrides unenforceable write
  ([#103](https://github.com/reggieofarrell/flintfire/issues/103))
  ([#109](https://github.com/reggieofarrell/flintfire/issues/109))
  ([b72436c](https://github.com/reggieofarrell/flintfire/commit/b72436c71972c883cac43b3bf93a58888443d768))

### Fixed

- **ci:** skip rulesync bump when the lockfile is inside the cooldown
  ([#111](https://github.com/reggieofarrell/flintfire/issues/111))
  ([42314e8](https://github.com/reggieofarrell/flintfire/commit/42314e8434ba94cb465f5b6e8578b68916846f01))
- **repository:** refuse nested write-interceptor transactions
  ([#112](https://github.com/reggieofarrell/flintfire/issues/112))
  ([#114](https://github.com/reggieofarrell/flintfire/issues/114))
  ([d8c7805](https://github.com/reggieofarrell/flintfire/commit/d8c78056fb3831dc0cf98f2a000dbb5e2097218c))

### Documentation

- **adr:** add ADR-0041 read-only query builder type
  ([4625d60](https://github.com/reggieofarrell/flintfire/commit/4625d60dc4cacc3ef37ef799422a77005223a217)),
  closes [#100](https://github.com/reggieofarrell/flintfire/issues/100)
- apply the v3 audit findings to the docs site
  ([#101](https://github.com/reggieofarrell/flintfire/issues/101))
  ([0ef66cb](https://github.com/reggieofarrell/flintfire/commit/0ef66cb3888496d0959a82ec2068546265be5928)),
  closes [#6](https://github.com/reggieofarrell/flintfire/issues/6)
  [#102](https://github.com/reggieofarrell/flintfire/issues/102)
- make the query-builder write-terminal leak preventable, not just documented
  ([0b7d883](https://github.com/reggieofarrell/flintfire/commit/0b7d88316fa857919b5bdc39f60f52ae8ff78f2c))
- **release:** record FlintFire 3.0.0 closeout
  ([#96](https://github.com/reggieofarrell/flintfire/issues/96))
  ([070b378](https://github.com/reggieofarrell/flintfire/commit/070b378d3ba023f7c7b7c673e41d104e6de8d443))
- use zod 4 top-level formats in npm README and add an idiom gate
  ([#106](https://github.com/reggieofarrell/flintfire/issues/106))
  ([b999f40](https://github.com/reggieofarrell/flintfire/commit/b999f40d5c430d3bd7b97c69fdd61d1584dcd486)),
  closes [#105](https://github.com/reggieofarrell/flintfire/issues/105)
- v3 website docs audit + ADR-0040 (repository write interceptors)
  ([#99](https://github.com/reggieofarrell/flintfire/issues/99))
  ([f30d6ae](https://github.com/reggieofarrell/flintfire/commit/f30d6aef5a293a82fc3d3ba3f11d817a0d227d1c)),
  closes [#80](https://github.com/reggieofarrell/flintfire/issues/80)

## [3.0.0](https://github.com/reggieofarrell/flintfire/compare/v2.2.1...v3.0.0) (2026-08-23)

### ⚠ BREAKING CHANGES

- install and import `flintfire` instead of `@reggieofarrell/firestore-orm`. Package version remains
  2.2.1 until the 3.0.0 release; this commit records the identity change so release tooling treats
  the next bump as major.
- **repository:** model hook and partial-write outcomes (#46) (#81)
- **types:** distribute Omit<_, 'id'> over union data models (#54) (#59)
- **query:** parseFirestoreError now reclassifies gRPC 6 (already-exists) as ConflictError and
  non-index gRPC 9 (failed-precondition) as PreconditionFailedError. Callers that inspected raw
  Error.code on those statuses must switch to instanceof checks. Missing-index errors (code 9 +
  "requires an index") remain FirestoreIndexError.
- QueryBuilder.totalCount() is renamed to collectionCount(); average() returns `number | null`
  instead of `number`; withVectorSearch(repo).query() now returns the normal query builder (use
  vectorQuery() for findNearest). FieldValue.delete() is rejected on create/set/upsert (use
  update()/patch() to clear a field), and a forged `{ _values }` map is no longer accepted as a
  vector value. See ADR-0019/0020/0021/0022.
- schemas must not declare a top-level `id`; repository generics changed; write input is
  `z.input<WS>`; `where('id')` / `orderBy('id')` are replaced by `whereId` / `orderById`;
  `totalCount()` is renamed to `collectionCount()`; `average()` returns `number | null`. See
  ADR-0018 for the model and migration guidance.
- **vector:** a dynamically-typed (non-literal `string`) distanceResultField now yields a
  conservative result type instead of typing every field as number. Pass a string literal for
  precise per-field typing.
- **vector:** a distanceResultField that collides with a model field now types that field as the
  numeric distance (replacement) instead of the collapsed intersection, and distanceResultField "id"
  is rejected.
- **vector:** VectorQueryBuilder.select() returns a new builder instead of mutating and returning
  the original (mirrors the core select() change). Fluent chains are unaffected.
- **query:** select() returns a new query builder instead of mutating and returning the original.
  Fluent chains are unaffected; code that called select() for its side effect on a retained builder
  reference must use the returned builder.
- the minimum supported Node.js version is now 22.
- **query:** (types only): sum()/average() now reject non-numeric field arguments, and
  findByField/getOneByField/getOneByFieldOrThrow are typed to schema field paths. Calls that relied
  on the looser keyof-T typing may need a numeric/valid field path or a FieldPath.
- **repository:** an update whose payload is empty after validation now throws a ValidationError
  instead of silently succeeding as a no-op. Callers relying on the old no-op behavior must avoid
  issuing empty patches.
- **query:** (types only): after `.select(...)`, terminal reads return `Partial<T> & { id }` instead
  of `T & { id }`. Code that accessed a field without selecting it (or without a null check) now
  fails to type-check — reflecting the runtime reality that projected-away fields are absent.
- **express:** `errorHandler` is no longer exported from the package root. Import it from the
  subpath instead: `import { errorHandler } from '@reggieofarrell/firestore-orm/express'` and
  install express (now an optional peer dependency).
- **validation:** sentinelPolicy now defaults to 'strict'. Payloads that wrote bare FieldValue
  sentinels on fields whose schema did not permit them (relying on the permissive escape hatch) now
  throw. Adopt the write combinators, or pass { sentinelPolicy: 'permissive' } to
  withSchema()/subcollection() to keep the old behavior.
- **repository:** create(), bulkCreate(), and createInTransaction() no longer return the full
  document by default. create()/bulkCreate() return `{ id }` / `{ id }[]` unless called with
  `{ returnDoc: true }`; createInTransaction() returns `{ id }`. Schemas whose `id` field is
  optional, nullable, or transformed to a non-string are now rejected at construction.
- **validation:** zod v3 is no longer a supported peer; upgrade to zod v4.
- **dot-notation:** where/orderBy/select (and vector where/select) accept FieldPaths<T> | FieldPath
  instead of arbitrary strings (use FieldPath for dynamic names); `id` is no longer allowed in
  update payloads; create/set/upsert reject dot-notation keys; dotted updates on schema-validated
  repos are now validated and persisted (previously silently dropped) and throw on invalid values or
  unknown paths; vectorField is constrained to top-level keys; query().update() returns the number
  of documents actually written.
- **repository:** the `converter` option (on withSchema, subcollection, and the FirestoreRepository
  constructor) is renamed to `readConverter` and now accepts only the fromFirestore mapper
  (ReadConverter<T> = (snapshot) => T), not a full FirestoreDataConverter. toFirestore is no longer
  invoked on any write path. createMillisTimestampConverter's return type narrows from
  FirestoreDataConverter to the fromFirestore mapper. Migration: pass your fromFirestore mapper
  (e.g. existingConverter.fromFirestore) as readConverter, and move any create-time toFirestore
  logic into a before* hook.
- **repository:** withSchema and subcollection no longer accept a curried call or positional
  converter/opts arguments, and no longer take an explicit read-type generic. Pass the read schema
  as a value and move converter/sentinelPolicy into the options object; supply a writeSchema overlay
  for cast-free combinator writes. subcollection now requires a schema - construct an unvalidated
  subcollection via new FirestoreRepository(db, fullPath).

### Added

- **dot-notation:** type-safe, schema-validated Firestore dot-notation
  ([#27](https://github.com/reggieofarrell/flintfire/issues/27))
  ([88a321b](https://github.com/reggieofarrell/flintfire/commit/88a321b17df92ed50bb0280581f4ed7b6ef9680c))
- **express:** move errorHandler to the firestore-orm/express subpath with an optional express peer
  ([548ab17](https://github.com/reggieofarrell/flintfire/commit/548ab17677885bf780563efc8ea68d5de5a33331))
- **package:** add a dual ESM+CJS build with require/import export conditions
  ([0aed5af](https://github.com/reggieofarrell/flintfire/commit/0aed5afe221583dc72a4b3aee255f3604ff080aa))
- **query:** add Core explainStream diagnostics
  ([#65](https://github.com/reggieofarrell/flintfire/issues/65))
  ([#84](https://github.com/reggieofarrell/flintfire/issues/84))
  ([07f72c3](https://github.com/reggieofarrell/flintfire/commit/07f72c34d11e06bdfea72d3b9827dba3f0884bf0))
- **query:** add explain() for Core and vector queries
  ([#37](https://github.com/reggieofarrell/flintfire/issues/37))
  ([#67](https://github.com/reggieofarrell/flintfire/issues/67))
  ([df4be22](https://github.com/reggieofarrell/flintfire/commit/df4be2228e2e3e967410e6becaa5690b960dfee6))
- **query:** collection-group queries with full-path identity
  ([#31](https://github.com/reggieofarrell/flintfire/issues/31))
  ([#55](https://github.com/reggieofarrell/flintfire/issues/55))
  ([b97d18e](https://github.com/reggieofarrell/flintfire/commit/b97d18e64f04b2b27a42ddf9474cac5452f28dd4))
- **query:** composite AND/OR filters via whereFilter()
  ([#30](https://github.com/reggieofarrell/flintfire/issues/30))
  ([#53](https://github.com/reggieofarrell/flintfire/issues/53))
  ([b852fc1](https://github.com/reggieofarrell/flintfire/commit/b852fc1f5a4c16900988bc66d5c1a0139949fc62)),
  closes [#31](https://github.com/reggieofarrell/flintfire/issues/31)
- **query:** dedupe distinctValues() by Firestore-aware semantic equality
  ([#40](https://github.com/reggieofarrell/flintfire/issues/40))
  ([#78](https://github.com/reggieofarrell/flintfire/issues/78))
  ([284ef98](https://github.com/reggieofarrell/flintfire/commit/284ef98a033c0ee6ef22c526e6331f5511b5eff3)),
  closes [#39](https://github.com/reggieofarrell/flintfire/issues/39)
  [-#41](https://github.com/reggieofarrell/flintfire/issues/41)
  [#39](https://github.com/reggieofarrell/flintfire/issues/39)
  [#75](https://github.com/reggieofarrell/flintfire/issues/75)
  [#39](https://github.com/reggieofarrell/flintfire/issues/39)
  [#39](https://github.com/reggieofarrell/flintfire/issues/39)
  [#39](https://github.com/reggieofarrell/flintfire/issues/39)
- **query:** numeric field-path typing for sum/average and typed dotted findByField
  ([03945c6](https://github.com/reggieofarrell/flintfire/commit/03945c62733f45733e3bf429a5f0ba8e7257f75d))
- **query:** projection-aware result typing for select()
  ([0f0f914](https://github.com/reggieofarrell/flintfire/commit/0f0f91435a894654f7c14c20fc27515cc55273c3))
- **query:** ship typed multi-aggregation via aggregate(spec)
  ([#34](https://github.com/reggieofarrell/flintfire/issues/34))
  ([#57](https://github.com/reggieofarrell/flintfire/issues/57))
  ([e55d20f](https://github.com/reggieofarrell/flintfire/commit/e55d20fe85729725f300997cd4ec3a23c5312493)),
  closes [#33](https://github.com/reggieofarrell/flintfire/issues/33)
  [#33](https://github.com/reggieofarrell/flintfire/issues/33)
- **query:** typed cursor bounds, offset, and limitToLast
  ([#36](https://github.com/reggieofarrell/flintfire/issues/36))
  ([#63](https://github.com/reggieofarrell/flintfire/issues/63))
  ([afda368](https://github.com/reggieofarrell/flintfire/commit/afda368932299f16bf6570d14d80838b7cf429aa))
- raise Node floor to 22 and support Firebase Admin 14
  ([b3a2937](https://github.com/reggieofarrell/flintfire/commit/b3a29375d0dbfcb2753e363a9436002931de3686))
- rename the npm package and project to FlintFire
  ([#94](https://github.com/reggieofarrell/flintfire/issues/94))
  ([208dee6](https://github.com/reggieofarrell/flintfire/commit/208dee6b6aee2eda1f4e6815d29d2a34fa5810e8))
- **repository:** add BulkWriter-backed bulkWrite and explicit recursiveDelete
  ([#38](https://github.com/reggieofarrell/flintfire/issues/38))
  ([#70](https://github.com/reggieofarrell/flintfire/issues/70))
  ([1fd2dc0](https://github.com/reggieofarrell/flintfire/commit/1fd2dc09d860c8374538419ccb73403a1757e62e)),
  closes [#69](https://github.com/reggieofarrell/flintfire/issues/69)
- **repository:** add collection-wide recursive delete
  ([#69](https://github.com/reggieofarrell/flintfire/issues/69))
  ([#86](https://github.com/reggieofarrell/flintfire/issues/86))
  ([df6a6ee](https://github.com/reggieofarrell/flintfire/commit/df6a6eec377a8465d9c083e9f13e276c238abb4a))
- **repository:** add opt-in write metadata
  ([#72](https://github.com/reggieofarrell/flintfire/issues/72))
  ([#85](https://github.com/reggieofarrell/flintfire/issues/85))
  ([75aa6ea](https://github.com/reggieofarrell/flintfire/commit/75aa6ea06cd001e4376662eb21e19fbf6017c586))
- **repository:** add validate() / safeValidate() read-boundary validators
  ([#14](https://github.com/reggieofarrell/flintfire/issues/14))
  ([#23](https://github.com/reggieofarrell/flintfire/issues/23))
  ([e12f8f3](https://github.com/reggieofarrell/flintfire/commit/e12f8f322e751a91c7997d03eb76cffe42d70ce5))
- **repository:** batched multi-document reads via getMany(ids)
  ([#35](https://github.com/reggieofarrell/flintfire/issues/35))
  ([#60](https://github.com/reggieofarrell/flintfire/issues/60))
  ([1ab5de8](https://github.com/reggieofarrell/flintfire/commit/1ab5de87573d3f735f601b58776b503f2c02eacc))
- **repository:** make create return { id } by default with returnDoc for the read model
  ([ed8e03e](https://github.com/reggieofarrell/flintfire/commit/ed8e03eb85b32f45bd503e41ccce9d000999a266))
- **repository:** make Firestore converters read-only via readConverter (v3,
  [#11](https://github.com/reggieofarrell/flintfire/issues/11))
  ([#22](https://github.com/reggieofarrell/flintfire/issues/22))
  ([7338c59](https://github.com/reggieofarrell/flintfire/commit/7338c59faeaf9181ab988f350fe4aa5f23a01bde))
- **repository:** model hook and partial-write outcomes
  ([#46](https://github.com/reggieofarrell/flintfire/issues/46))
  ([#81](https://github.com/reggieofarrell/flintfire/issues/81))
  ([e0e7296](https://github.com/reggieofarrell/flintfire/commit/e0e729674c2decf9c3b7052fca4dd0f8c20bd7c0))
- **repository:** opt-in snapshot metadata and detailed listeners
  ([#39](https://github.com/reggieofarrell/flintfire/issues/39))
  ([#74](https://github.com/reggieofarrell/flintfire/issues/74))
  ([3f0dd7a](https://github.com/reggieofarrell/flintfire/commit/3f0dd7abca943a39d520bd53cf8558c4307753a3)),
  closes [#72](https://github.com/reggieofarrell/flintfire/issues/72)
  [#37](https://github.com/reggieofarrell/flintfire/issues/37)
  [#65](https://github.com/reggieofarrell/flintfire/issues/65)
  [#38](https://github.com/reggieofarrell/flintfire/issues/38)
  [#69](https://github.com/reggieofarrell/flintfire/issues/69)
- **repository:** retire curried withSchema/subcollection (v3,
  [#10](https://github.com/reggieofarrell/flintfire/issues/10))
  ([#18](https://github.com/reggieofarrell/flintfire/issues/18))
  ([524b983](https://github.com/reggieofarrell/flintfire/commit/524b9835a142ab95ff07ed9c03c81101f0dd19f8)),
  closes [#19](https://github.com/reggieofarrell/flintfire/issues/19)
- **repository:** transaction options, read-only/PITR, and getInTransaction rename
  ([#56](https://github.com/reggieofarrell/flintfire/issues/56))
  ([10c9c59](https://github.com/reggieofarrell/flintfire/commit/10c9c599f15e0f7bb52b589647a0acf3ad512ee7)),
  closes [#32](https://github.com/reggieofarrell/flintfire/issues/32)
- v3 Track B query-builder, sentinel, and vector hardening
  ([9b70324](https://github.com/reggieofarrell/flintfire/commit/9b70324da202c840fe8fa44efc7e888be2876004))
- v3 virtual document identity and read/write/stored data-model split
  ([b1f2b6f](https://github.com/reggieofarrell/flintfire/commit/b1f2b6fe400ce82ca06c57b921d13bb84ea79223))
- **validation:** default sentinelPolicy to 'strict'
  ([a20e783](https://github.com/reggieofarrell/flintfire/commit/a20e7831c3151fbf93f469c7c6302404e376fe5a))
- **validation:** drop zod v3 support; require zod ^4.0.0
  ([#29](https://github.com/reggieofarrell/flintfire/issues/29))
  ([1273471](https://github.com/reggieofarrell/flintfire/commit/127347114425993815245525c38ec1e73b100acc)),
  closes [#26](https://github.com/reggieofarrell/flintfire/issues/26)
  [#26](https://github.com/reggieofarrell/flintfire/issues/26)

### Fixed

- **build:** exclude test dirs and declaration maps from the build; regenerate lockfile peers
  ([e1db8bb](https://github.com/reggieofarrell/flintfire/commit/e1db8bb6db2eabbf9cb6473e8580fe5ce3631491))
- **errors:** harden parseFirestoreError and map missing-index errors to 503
  ([4afe6bf](https://github.com/reggieofarrell/flintfire/commit/4afe6bf8548d88fa0be8b3a8612c67df649056ae))
- **express:** stop returning the Firestore index-creation URL to clients
  ([c988eaf](https://github.com/reggieofarrell/flintfire/commit/c988eaf7284d3344120d5aea56c5b181a390522b))
- **query:** back stream() with the native Firestore query stream
  ([ec2a67d](https://github.com/reggieofarrell/flintfire/commit/ec2a67d9d31817ecde7c8bfee0a6136021cf6383))
- **query:** deep-partial projection result so dotted select() is sound
  ([879babd](https://github.com/reggieofarrell/flintfire/commit/879babd0cfa5a68249ad2638ba6ce334ccf8268d))
- **query:** non-mutating getOne/exists and normalized listener errors
  ([3ae1682](https://github.com/reggieofarrell/flintfire/commit/3ae1682a6c8f245af6055410e51ffb934b6a2ea5))
- **query:** sound projection typing, onSnapshot guard, zero-match empty-update
  ([a0d3c77](https://github.com/reggieofarrell/flintfire/commit/a0d3c7736b50d296b2e28739654347da8bc7e0c5))
- **query:** validate pagination inputs and bind cursors to the collection
  ([621060e](https://github.com/reggieofarrell/flintfire/commit/621060e30959f90c06af3694c8ab910c490fdb5c))
- **repository:** don't inject Zod defaults on partial update
  ([#25](https://github.com/reggieofarrell/flintfire/issues/25))
  ([#28](https://github.com/reggieofarrell/flintfire/issues/28))
  ([b267001](https://github.com/reggieofarrell/flintfire/commit/b2670019d472e8bac9d5edb41772323022623ffc))
- **repository:** reject duplicate ids in bulk operations and document non-atomic chunking
  ([c10adbe](https://github.com/reggieofarrell/flintfire/commit/c10adbe8a57bc8c1c09b19a470f561f65b650d0d))
- **repository:** reject empty update payloads across all update surfaces
  ([7f73293](https://github.com/reggieofarrell/flintfire/commit/7f73293afec6252b539e6b6c17f0fa6f7d427a1a))
- **security:** block prototype-pollution in dot-notation utils and stop input mutation
  ([ac58dd2](https://github.com/reggieofarrell/flintfire/commit/ac58dd2cce35ac9a8ffc15941023c65c8996436d))
- **security:** safe object-copy in timestamp + flatten utils
  ([4b6725c](https://github.com/reggieofarrell/flintfire/commit/4b6725cbe1bc7f7a4da5e2fa358956001e873f82))
- **types:** distribute Omit<_, 'id'> over union data models
  ([#54](https://github.com/reggieofarrell/flintfire/issues/54))
  ([#59](https://github.com/reggieofarrell/flintfire/issues/59))
  ([3b00d7b](https://github.com/reggieofarrell/flintfire/commit/3b00d7b5f7a91a95e31e1e8f2acad8352a3f2c8d))
- **types:** distribute PathValue over unions so numeric aggregation paths stay sound
  ([3194ca8](https://github.com/reggieofarrell/flintfire/commit/3194ca8222a7741d5834f086ec1acc606645d5ec))
- **types:** normalize before the numeric-path never guard so nullish fields aren't numeric
  ([cfaa428](https://github.com/reggieofarrell/flintfire/commit/cfaa4286f16ef7febfc0fd9cf7fa8712b4296692))
- **types:** preserve explicit-id indexed field paths
  ([#82](https://github.com/reggieofarrell/flintfire/issues/82))
  ([#92](https://github.com/reggieofarrell/flintfire/issues/92))
  ([2a1eb63](https://github.com/reggieofarrell/flintfire/commit/2a1eb63893e5ed6de3a214fb27b41844026485bc)),
  closes [#91](https://github.com/reggieofarrell/flintfire/issues/91)
- **types:** preserve Firestore leaf/scalar APIs through DeepPartial
  ([eb55f03](https://github.com/reggieofarrell/flintfire/commit/eb55f03ab9bba0072c01164c25e1b1f1478c89c1))
- **types:** preserve literal paths beside index signatures
  ([#58](https://github.com/reggieofarrell/flintfire/issues/58))
  ([#83](https://github.com/reggieofarrell/flintfire/issues/83))
  ([aa58f7a](https://github.com/reggieofarrell/flintfire/commit/aa58f7ae2fe39c75ebd7762eaa745a0724784589))
- **types:** union-distributive leaf handling in DeepPartial and FieldPaths
  ([cc10058](https://github.com/reggieofarrell/flintfire/commit/cc10058163e5596277698c0be1bafd687df5bc3e))
- **vector:** conservative result typing for a dynamic distanceResultField
  ([ef32cda](https://github.com/reggieofarrell/flintfire/commit/ef32cda3c424bb22eb9df335d65ddf075fabd150))
- **vector:** immutable select(), empty-projection distance field, reject threshold 0
  ([a96ab1b](https://github.com/reggieofarrell/flintfire/commit/a96ab1b9f108c935d6e2d15f698ee9bd06632ee7))
- **vector:** reject non-finite values, validate field names/dimensions, type the distance field
  ([002165c](https://github.com/reggieofarrell/flintfire/commit/002165c0069a5d21e98c33d0abede915d067317c))
- **vector:** reject non-finite vector sentinels via a shared finite-value check
  ([089d723](https://github.com/reggieofarrell/flintfire/commit/089d7232d242c8f3e9604d997cf296b845b193f4))
- **vector:** replacement typing for distanceResultField; reject reserved "id"
  ([ab89b94](https://github.com/reggieofarrell/flintfire/commit/ab89b94c76fb2d39b7e827d0fa6f5a783ce32e6b))

### Changed

- **types:** drop unsupported returnDoc from updateInTransaction options
  ([d71962e](https://github.com/reggieofarrell/flintfire/commit/d71962e018812f6b9119a6e8bb6e07bceefe7883))

### Documentation

- add optional review.md for adversarial review
  ([746bb7f](https://github.com/reggieofarrell/flintfire/commit/746bb7f24777be70eb02802b7ad4f9315fbae0d3))
- add round-3 response verification to the review record
  ([b9be1fa](https://github.com/reggieofarrell/flintfire/commit/b9be1faf1a8abfc761ca4d232859e936b70b38e6))
- add round-3 review (round-2 response verification) to the record
  ([0904197](https://github.com/reggieofarrell/flintfire/commit/0904197273753fdda394bc8a6939d9a5a776079f))
- add round-4 response verification to the review record
  ([6e9f655](https://github.com/reggieofarrell/flintfire/commit/6e9f65528e880ec4417ae81fa0a4e8ae4d848134))
- add round-6 response and commit round-5 verification record
  ([18963bb](https://github.com/reggieofarrell/flintfire/commit/18963bb1fd2e91a22a0a6a1a068aa6f3ddcc12ae))
- add round-7 response and commit round-6 verification record
  ([8322077](https://github.com/reggieofarrell/flintfire/commit/8322077004aee131bd5f02a1f19d9e1fd91e18dc))
- add v2 to v3 migration guide ([#24](https://github.com/reggieofarrell/flintfire/issues/24))
  ([32619d0](https://github.com/reggieofarrell/flintfire/commit/32619d0cf0a4a87a1db9e50ee75f585898b9104a))
- **adr:** address follow-up review (de-link local review docs, correct claims)
  ([72935aa](https://github.com/reggieofarrell/flintfire/commit/72935aa8ef2c2128bf1cb8e85a8bb360340c3185))
- **adr:** record ADR-0017 v3 Core-operations scope decision
  ([a8c4c23](https://github.com/reggieofarrell/flintfire/commit/a8c4c2314ca363bcdc5cb27e4f9016d3e0700a6d)),
  closes [#30](https://github.com/reggieofarrell/flintfire/issues/30)
  [-#41](https://github.com/reggieofarrell/flintfire/issues/41)
- **adr:** record v3 identity, sentinel, aggregate, and API-cleanup decisions
  ([3823cf9](https://github.com/reggieofarrell/flintfire/commit/3823cf9319cc752a77b6dda8543b620e097bca9e))
- **adr:** refresh stale ADR statuses and record the v3 contract decisions
  ([9239283](https://github.com/reggieofarrell/flintfire/commit/9239283db51b50bef522c201272d51cc59ca3527))
- **adr:** tighten ADR-0018 mirror-migration and query-typing wording
  ([48d9074](https://github.com/reggieofarrell/flintfire/commit/48d9074f42878e102b2db45c153ed0ae3b306e68)),
  closes [#45](https://github.com/reggieofarrell/flintfire/issues/45)
- correct DeepPartial recurse-rule wording and class-instance workaround
  ([b7e6083](https://github.com/reggieofarrell/flintfire/commit/b7e608384bc8ee5f2c23f5fedc88b177d59f3381))
- correct projection/vector wording; add literal-distance-field guidance
  ([e7c636d](https://github.com/reggieofarrell/flintfire/commit/e7c636ddcc897358f0420cf7e3d56061e1dbf57c))
- correct query-hook behavior and sync guides/README/migration guide to v3 contracts
  ([6e9bc25](https://github.com/reggieofarrell/flintfire/commit/6e9bc259b8a648e7e2ba4d819d6c59b310823393))
- dual README for GitHub vs npm ([#52](https://github.com/reggieofarrell/flintfire/issues/52))
  ([452bd51](https://github.com/reggieofarrell/flintfire/commit/452bd51bcb8c652462361e4cfb488b4110abc6af))
- **plans:** implementation plan for typed query bounds
  ([#36](https://github.com/reggieofarrell/flintfire/issues/36))
  ([#62](https://github.com/reggieofarrell/flintfire/issues/62))
  ([b1ab4b4](https://github.com/reggieofarrell/flintfire/commit/b1ab4b48dd7d837b4d595356ad37ff1be4f1a336))
- **plans:** issue [#79](https://github.com/reggieofarrell/flintfire/issues/79) lifecycle-hooks
  query().delete() handoff ([#90](https://github.com/reggieofarrell/flintfire/issues/90))
  ([6dc98c6](https://github.com/reggieofarrell/flintfire/commit/6dc98c62e5c0f4bd7e195047cd8119c01617b2ba))
- reconcile consumer docs and README to the v3 contract
  ([8f68c39](https://github.com/reggieofarrell/flintfire/commit/8f68c39b1c9fb8e6bd901d9532e494d949748c5b)),
  closes [#1](https://github.com/reggieofarrell/flintfire/issues/1)
- remove transitional docs/usage mirror; decouple ADRs from usage docs
  ([#21](https://github.com/reggieofarrell/flintfire/issues/21))
  ([695b87e](https://github.com/reggieofarrell/flintfire/commit/695b87ed0c3f32ae4dd2b299ca21bb15e8e4517a))
- reorganize v3 site into pillars and gate Pages deploy
  ([1be3889](https://github.com/reggieofarrell/flintfire/commit/1be3889280de7617e20d07ea8234a63a7543ac8f))
- round-3 review response; drop stale ErrorHandler release task
  ([66718eb](https://github.com/reggieofarrell/flintfire/commit/66718eb7369931a7b0df3e16f813a6b7e87346a9))
- **skills:** add implementation-review skill and write-review command
  ([#68](https://github.com/reggieofarrell/flintfire/issues/68))
  ([0528c6d](https://github.com/reggieofarrell/flintfire/commit/0528c6d2fa6c9f8f0bbf442d36904c39e62a9efa)),
  closes [#66](https://github.com/reggieofarrell/flintfire/issues/66)
  [#37](https://github.com/reggieofarrell/flintfire/issues/37)
  [#37](https://github.com/reggieofarrell/flintfire/issues/37)
- **skills:** compile-check plan code blocks and add pre-handoff verification
  ([#64](https://github.com/reggieofarrell/flintfire/issues/64))
  ([0db80f1](https://github.com/reggieofarrell/flintfire/commit/0db80f1c39594edfc58f3a5c2487440d15ba5aa8)),
  closes [#37](https://github.com/reggieofarrell/flintfire/issues/37)
  [#37](https://github.com/reggieofarrell/flintfire/issues/37)
- **skills:** reserve plan review.md for external reviewers
  ([#66](https://github.com/reggieofarrell/flintfire/issues/66))
  ([da8f2fe](https://github.com/reggieofarrell/flintfire/commit/da8f2fe8e0fef7d19f90cb295f948b98f7a81a3e))
- **skills:** stop a gate-green prototype from becoming a transcribed plan
  ([#71](https://github.com/reggieofarrell/flintfire/issues/71))
  ([32ce4c1](https://github.com/reggieofarrell/flintfire/commit/32ce4c1a985b3fe59a7f11d9f027863bc4f98069)),
  closes [#38](https://github.com/reggieofarrell/flintfire/issues/38)
  [#38](https://github.com/reggieofarrell/flintfire/issues/38)
- sync guides for projection/vector/onSnapshot; add Scope & Capabilities page
  ([355fc6f](https://github.com/reggieofarrell/flintfire/commit/355fc6faaff2b82124cedfdfaf28e9487b169ae3)),
  closes [#30](https://github.com/reggieofarrell/flintfire/issues/30)
  [-#41](https://github.com/reggieofarrell/flintfire/issues/41)
- sync remaining Partial<T> references to DeepPartial; add round-4 response
  ([3eadeab](https://github.com/reggieofarrell/flintfire/commit/3eadeab29137e2c1a7b845d5c2763a11e1d11ed5))
- use result generic R in API reference terminal signatures; DeepPartial projection notes
  ([d3da7de](https://github.com/reggieofarrell/flintfire/commit/d3da7dedd606c9f380a94336a404c59c70eda570))

## [2.2.1](https://github.com/reggieofarrell/firestore-orm/compare/v2.2.0...v2.2.1) (2026-07-18)

### Documentation

- add Starlight site with GitHub Pages deploy
  ([#19](https://github.com/reggieofarrell/firestore-orm/issues/19))
  ([89ccf30](https://github.com/reggieofarrell/firestore-orm/commit/89ccf3034068a41c5c7442b9c66b182b63d7dec8))

## [2.2.0](https://github.com/reggieofarrell/firestore-orm/compare/v2.1.0...v2.2.0) (2026-07-18)

### Added

- **repository:** add fromSnapshot() to map raw snapshots to the read type
  ([#13](https://github.com/reggieofarrell/firestore-orm/issues/13))
  ([87f3dec](https://github.com/reggieofarrell/firestore-orm/commit/87f3dec144d01d34f401fc86b0cc7fbcfb34be5f))
- **repository:** opt-in schema-inferred write types (curried withSchema); optional id on create
  ([#9](https://github.com/reggieofarrell/firestore-orm/issues/9))
  ([e8c88c7](https://github.com/reggieofarrell/firestore-orm/commit/e8c88c7eeef0e9371c77eff528c3ed3046bde354)),
  closes [#10](https://github.com/reggieofarrell/firestore-orm/issues/10)
- **timestamps:** Timestamp <-> millis converter helpers
  ([#8](https://github.com/reggieofarrell/firestore-orm/issues/8))
  ([6498929](https://github.com/reggieofarrell/firestore-orm/commit/64989290c29755808c8588b2ae2e8c8e737593c0))

### Documentation

- reorganize README into docs/usage/ topic pages
  ([#12](https://github.com/reggieofarrell/firestore-orm/issues/12))
  ([07fd711](https://github.com/reggieofarrell/firestore-orm/commit/07fd711f27c73b1bdc9394eceb7a2fe8336791b8))

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
