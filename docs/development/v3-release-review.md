# Firestore ORM v3 release review

**Review date:** July 18, 2026  
**Review baseline:** `main`, commits after tag `v2.2.1`  
**Recommendation:** Do not publish v3 yet. The release is close, but five contract, security, and
packaging issues should be fixed before the major-version boundary is crossed.

## Executive summary

The v3 work is in good shape overall. The repository has unusually strong automated coverage, strict
TypeScript settings, a useful migration guide, documented architectural decisions, and a versioned
v2 documentation archive. The main v3 features—removing the curried factory, separating read
conversion from write validation, exposing validation APIs, supporting dot-notation updates, and
preventing defaults from leaking into partial updates—are coherent and well tested.

The remaining risk is not a lack of features. It is that several public contracts do not match their
runtime behavior:

1. A normal package import fails type-checking for consumers that do not install Express types.
2. Create operations claim to return the read model but actually return the write payload, and
   `bulkCreate` can return fields that were never persisted.
3. Exported dot-notation utilities permit prototype pollution and mutate nested objects supplied by
   the caller.
4. Permissive Firestore-sentinel validation discards all successful Zod coercions, defaults,
   stripping, and transforms whenever a sentinel is present.
5. The published tarball contains compiled test infrastructure, while the lockfile advertises an
   obsolete Zod peer range.

Those are release blockers because v3 is the best opportunity to make the public model honest and to
change unsafe defaults. The other high-priority items—projection typing, actual streaming,
empty-update semantics, current Firebase/Node support, and vector validation—should also be resolved
before v3 if practical. Most remaining findings can safely be follow-up patches.

No broad new feature set is recommended. The best v3 is a tightened, internally consistent release
rather than a larger one.

## Review scope and method

The review covered:

- The complete diff from `v2.2.1` to `main`.
- Public exports and generated declarations.
- Repository, query builder, vector search, validation, conversion, pagination, hook, and
  error-handling paths.
- Unit, integration, type, build, documentation, package, and release workflows.
- The package manifest, lockfile, packed npm contents, and dependency audit.
- The current Firebase Admin, Firebase CLI, Firestore, Node.js, TypeScript, and Zod support
  landscape.
- The v3 migration guide, ADRs, versioned v2 documentation, and current open release issue.

Several findings below were confirmed with small runtime or isolated-consumer reproductions, not
only by source inspection.

## Verified baseline

The following checks passed on the reviewed commit:

| Check                           | Result                                   |
| ------------------------------- | ---------------------------------------- |
| Lint                            | Passed                                   |
| Library build                   | Passed                                   |
| Type tests                      | Passed                                   |
| Unit tests                      | 18 suites, 167 tests passed              |
| Emulator integration tests      | 21 suites, 194 tests passed              |
| Documentation links             | 82 documentation files checked; passed   |
| Documentation build             | 48 pages built; passed                   |
| Node.js 24.18 / npm 11.16       | Build, type tests, and unit tests passed |
| Website dependency audit        | 0 vulnerabilities                        |
| Working tree after verification | Clean                                    |

Coverage gates also passed:

| Area                       |  Lines | Branches | Functions |
| -------------------------- | -----: | -------: | --------: |
| Unit: utilities            | 99.38% |   98.55% |      100% |
| Unit: validation errors    | 97.80% |   92.35% |      100% |
| Unit: public index         |   100% |     100% |    82.76% |
| Integration: repository    | 95.81% |   84.66% |    88.46% |
| Integration: query builder | 96.73% |   77.92% |      100% |
| Integration: validation    | 94.43% |   86.67% |      100% |
| Integration: vector search | 96.78% |   94.90% |    96.30% |

These results make the remaining problems more tractable: the project does not need a general
quality overhaul. It needs targeted tests around consumer packaging and the gaps between static
types, documentation, and runtime semantics.

## Release-blocking findings

### 1. Express types leak into every consumer

**Severity:** Release blocker  
**Area:** Public declarations and optional integrations

`src/core/ErrorHandler.ts` (moved to [`src/express/index.ts`](../../src/express/index.ts) in v3)
imports `Request`, `Response`, and `NextFunction` from `express`, and the root package exports
`errorHandler`. Express types are only a development dependency; they are not a runtime dependency
or peer dependency.

An isolated consumer created from the packed package, with `skipLibCheck: false` and no Express
installation, failed with:

```text
dist/core/ErrorHandler.d.ts(1,49): error TS2307: Cannot find module 'express'
or its corresponding type declarations.
```

This means an application can fail merely by importing the library, even when it never uses the
Express adapter. Local CI misses this because the repository itself has `@types/express` installed.

**Recommended fix**

Prefer moving the Express adapter behind an optional subpath export such as `firestore-orm/express`.
Give that subpath an explicit optional peer contract, or replace the imported types with the
smallest local structural interfaces the handler actually requires. Keeping framework-specific types
out of the root declaration graph is the cleanest long-term contract.

Add an isolated packed-consumer test that installs only declared production and peer dependencies,
compiles with `skipLibCheck: false`, and imports every public root symbol.

While changing this adapter, also fix two correctness issues:

- A `FirestoreIndexError` currently maps to HTTP 404. A missing index is a server/configuration
  failure and should normally be a 5xx response, such as 500 or 503.
- The response text says “Query needs to be index”; it should say that the query needs an index.

[`src/core/ErrorParser.ts`](../../src/core/ErrorParser.ts) should also be hardened.
`parseFirestoreError(null)` can throw because the function uses optional access for one check and
then reads `error.code` directly. Index detection appears limited to numeric code `9`; Firestore can
expose the equivalent string status `failed-precondition`.

### 2. Create methods return a write model while promising a read model

**Severity:** Release blocker  
**Area:** Repository model contract

`FirestoreRepository.withSchema` exposes
`FirestoreRepository<z.infer<ReadSchema>, z.infer<WriteSchema>>`, but `create` validates and returns
the write payload cast to the repository's read type. It does not invoke the read converter or read
the document back.

A concrete reproduction used:

- A write schema with `happenedAt: z.date()`.
- A read schema with `happenedAt: z.number()`.
- A read converter that maps a Firestore `Timestamp` to milliseconds.

`create({ happenedAt: someDate })` returned a JavaScript `Date` at runtime while TypeScript promised
a `number`.

The same conceptual mismatch affects `bulkCreate` and create operations inside transactions. The
mismatch is especially important in v3 because separate read conversion and write validation are a
headline feature.

`bulkCreate` has an additional concrete bug. It starts with shallow copies of the raw inputs,
validates separate copies, and then assigns validated values back onto the raw objects. If Zod
strips an unknown property, that property remains in the returned object and in the
`afterBulkCreate` hook payload even though it was never persisted. A payload containing
`extra: "not persisted"` reproduced exactly that behavior.

**Recommended fix**

Choose and document one consistent create contract:

- Return only `{ id }` by default and require `{ returnDoc: true }` for a converted read model,
  matching the update/upsert pattern; or
- Always read the created document back and apply the read converter before returning it.

The first option avoids an implicit read and is likely the better default. Whichever contract is
selected, apply it consistently to single, bulk, and transactional creates.

For `bulkCreate`, construct results from the validated data:

```ts
const result = { ...validData, id };
```

Do not mutate a copy of the unvalidated input. Define whether hooks receive the validated write
model or the converted read model, then test that contract directly.

The repository's ID-schema check also needs tightening. It currently verifies that a sentinel string
can be parsed, but not that the parsed output remains a string. A schema such as
`z.string().transform(value => value.length)` is accepted even though its output ID is a number.
Validate the parsed output type and reject nullable, optional, or transforming ID outputs that do
not remain strings.

Longer term, consider explicitly modeling four types instead of two:

1. Zod input accepted from callers.
2. Validated write output.
3. Firestore stored representation.
4. Converted read model.

That distinction would also improve query-value typing, hooks, and transform/default behavior.

### 3. Dot-notation utilities permit prototype pollution and mutate input

**Severity:** Release blocker  
**Area:** Security and exported utilities

[`src/utils/dotNotation.ts`](../../src/utils/dotNotation.ts) builds ordinary objects and traverses
arbitrary user-provided path segments. A reproduction using:

```ts
expandDotNotation({ '__proto__.firestoreOrmPolluted': true });
```

caused `Object.prototype.firestoreOrmPolluted` to become `true`.

`mergeDotNotationUpdate` has the same dangerous path traversal. It also performs only a shallow copy
of the existing object and then mutates nested references while merging. A reproduction showed that
adding a nested field through the returned value also changed the caller's original nested object.

`convertTimestampsToMillis` should be reviewed under the same rule because it creates ordinary
objects and assigns arbitrary keys recursively.

**Recommended fix**

- Reject dangerous path segments: `__proto__`, `prototype`, and `constructor`.
- Build dictionary-like intermediate values with `Object.create(null)` where prototypes are
  unnecessary.
- Copy each modified branch instead of mutating shared nested references.
- Add adversarial tests for all exported object/path utilities.
- Add an invariant test that the input object remains deeply unchanged after merge operations.

This should be fixed even if normal Firestore field names make exploitation less likely. These
helpers are public exports and can be called directly with untrusted request bodies.

### 4. Permissive sentinel validation discards valid Zod output

**Severity:** Release blocker  
**Area:** Validation semantics

The current default is permissive handling for Firestore sentinels. When parsing fails only at
sentinel paths, `runParse` returns the entire raw input. That bypasses every successful Zod behavior
elsewhere in the object.

A reproduction used a schema with:

- `count: z.coerce.number()`
- `status: z.string().default("new")`
- A timestamp field receiving `serverTimestamp()`

For `{ count: "7", createdAt: serverTimestamp() }`, validation returned `count` as the string `"7"`
and omitted the `status` default. The sentinel in one field silently disabled coercion and defaults
in unrelated fields. Refinements, stripping, and transforms can be lost for the same reason.

This is a particularly risky default because callers reasonably expect a successful `validate`
result to be the schema's parsed output.

**Recommended fix**

Flip strict sentinel handling to the default in v3.
[ADR 0002](../adr/0002-per-field-sentinel-write-validation.md) explicitly reserved a future major
release for this change. Keep permissive behavior available only as an explicit migration option.

If permissive behavior remains supported, implement it by masking only sentinel paths, parsing the
rest of the structure, and restoring the sentinels. Do not fall back to the complete raw input.
Tests should verify that sibling coercions, defaults, unknown-key stripping, and transforms still
apply.

There is a related documented limitation in default stripping: transform-added keys can be removed
along with schema defaults. That limitation is recorded in
[ADR 0011](../adr/0011-no-defaults-on-partial-update.md). Because v3 makes partial-update behavior a
first-class feature, either fix this before release or state the unsupported transform pattern
prominently in the migration and API documentation.

### 5. Published package contents and peer metadata are stale

**Severity:** Release blocker  
**Area:** npm packaging

The TypeScript build includes `src/**/*` and excludes test/spec filename patterns, but it does not
exclude the test support directories. The package allowlist then publishes all of `dist/**`.

`npm pack --dry-run` produced a 65-file tarball that included compiled test infrastructure such as:

```text
dist/tests/integration/helpers/firestoreIntegrationHarness.js
dist/tests/integration/helpers/firestoreIntegrationHarness.d.ts
dist/tests/shared/factories/*
dist/tests/shared/mocks/*
```

These files are not part of the product, enlarge the package, expose internal fixtures, and may
create accidental declaration dependencies.

The declaration maps also point back to `src` files that are not shipped. Either ship the referenced
source files intentionally or disable declaration maps in the publish build.

Separately, [`package.json`](../../package.json) declares Zod `^4`, but the root entry in
[`package-lock.json`](../../package-lock.json) still advertises `^3.25.0 || ^4.0.0`. `npm ci` did
not detect this peer-metadata drift.

**Recommended fix**

- Exclude `src/tests/**` from the publish build.
- Add an explicit tarball allowlist test based on `npm pack --json`.
- Decide whether declaration-map sources should be shipped; otherwise disable those maps for the
  package build.
- Regenerate the lockfile so root peer dependencies and engines match the manifest.
- Add a CI assertion comparing root manifest metadata with the root lockfile package entry.

Run package tests with Husky disabled. A plain pack in a read-only or cache-limited environment
attempted Git configuration/cache writes through the `prepare` lifecycle, while `HUSKY=0 npm pack`
succeeded. Consider using `pinst` or otherwise ensuring install/publish lifecycle scripts are
harmless for downstream package consumers.

## Strong candidates to fix before v3

### 6. `select()` is statically unsound

**Severity:** High  
**Area:** Query typing

The query builder documents projections as partial results, but `select()` returns `this` without
changing the builder's result type. `get()` therefore continues to promise complete `T` documents
even when Firestore returns only selected fields. Vector-query projections have the same problem.

This can compile:

```ts
const user = await users.select('displayName').get();
user.email.toLowerCase(); // typed as present, absent at runtime
```

Read converters add another failure mode: a converter written for complete snapshots may throw when
invoked on a projection.

**Recommended fix**

Make the builder generic over its current result shape. Literal string paths can derive a projected
type; dynamic Firestore `FieldPath` values should conservatively return a partial or unknown
projection. Carry the projection type through vector queries as well.

Document how read converters interact with projections. If converters require full documents, either
reject `select()` on converted repositories or offer a projection-aware conversion path.

### 7. `stream()` buffers the complete query

**Severity:** High  
**Area:** Query execution

The public method named `stream()` awaits `query.get()` and then yields snapshots from the completed
result. It is an async iterator, but it is not streaming and is not memory-efficient for large
result sets, contrary to the documentation.

**Recommended fix**

Use the Admin Firestore query's native `stream()` implementation and adapt it with `for await`.
Preserve conversion, validation, and error semantics per document. If true streaming cannot be
supported reliably, rename the API and correct the documentation before v3.

### 8. Empty updates can report success for missing documents

**Severity:** High  
**Area:** Update and hook semantics

When an update becomes empty, the repository skips the Firestore `update()` call, fires
`afterUpdate`, and returns the ID. Because no write is attempted, a nonexistent document is reported
as successfully updated unless `returnDoc` forces a later read.

Bulk update similarly omits empty write actions but still includes all input IDs in results and
hooks. The query-builder implementation was recently changed to track written IDs only, so the three
update surfaces are inconsistent.

An empty update can arise directly or after partial-update normalization/default stripping.

**Recommended fix**

Define one policy and apply it everywhere:

- Reject empty patches as invalid; or
- Treat them as explicit no-ops, do not fire write hooks, and clearly document that existence is not
  checked; or
- Verify existence before reporting success.

Rejecting empty patches is the simplest contract and preserves the current documentation claim that
update throws for missing documents. Test single, bulk, query, and transactional update paths
together.

### 9. Update current Firebase and Node support before setting the v3 floor

**Severity:** High  
**Area:** Compatibility and dependency security

The package currently supports Node.js `>=18` and peers only Firebase Admin 12 and 13. As of this
review:

- Firebase Admin 14.2.0 is current.
- Firebase Admin 14 requires Node.js 22 or newer and uses `@google-cloud/firestore` 8.6.0.
- Node.js 22 and 24 are LTS lines; Node.js 18 and 20 are end-of-life.
- Firebase CLI 15.24.0 is current, while the project uses the older 14.x line.

Sources:
[Firebase Admin Node.js release notes](https://firebase.google.com/support/release-notes/admin/node)
and [Node.js release status](https://nodejs.org/en/about/previous-releases).

The root dependency audit reported 12 advisories: 2 high and 10 moderate. The high-severity path is
primarily through the old `firebase-tools` development tree; several moderate advisories are through
Firebase Admin 13 transitives. The website dependency audit is clean.

**Recommended fix**

- Set the v3 engine floor to Node.js 22.
- Add Firebase Admin 14 to the peer range and use it in development.
- Upgrade Firebase CLI to the current major and re-run the audit.
- Test Node.js 22 and 24 in CI.
- If Admin 12 and 13 remain supported, run an explicit Admin 12/13/14 peer matrix. Otherwise, use
  the major release to narrow the supported range and document it.

Do not apply npm audit's suggested Firebase Admin 10 downgrade; that would move the project backward
and conflict with the v3 compatibility goal.

The README's TypeScript “5.0+” claim should also be raised. Zod 4's official documentation says it
is tested against TypeScript 5.5 and later and requires strict mode:
[Zod requirements](https://zod.dev/).

### 10. Vector validation accepts non-finite values and result typing omits computed fields

**Severity:** High  
**Area:** Vector search

Vector validation uses `Number.isNaN`, which still accepts positive and negative infinity. Both an
infinite query-vector component and an infinite distance threshold were accepted in reproduction.
The exported `vectorEmbeddingSchema` has the same issue.

Other validation gaps include:

- Dimensions are not required to be a positive integer within Firestore's supported limit.
- Whitespace-only vector field names are accepted.
- Empty or whitespace-only distance-result field names are accepted.

The exported `VectorSearchResult` type is not carried through the builder's `get()` result. A
configured `distanceResultField` exists at runtime but is absent from the promised return type.
Conversely, `select()` does not naturally accept an arbitrary computed distance field because its
typing is limited to model field paths.

**Recommended fix**

- Use `Number.isFinite` for vector values and thresholds.
- Validate dimensions as positive integers no greater than Firestore's current maximum.
- Trim and validate field names.
- Parameterize the vector builder with the configured distance-result field and include it in the
  result type.
- Make vector projection typing compose with the general projection-builder fix.

Document threshold direction by metric. Firestore treats Euclidean and cosine thresholds as maximum
distances, while dot-product thresholds use the opposite comparison direction. See
[Firestore vector search documentation](https://firebase.google.com/docs/firestore/vector-search).

## Additional correctness and API findings

### 11. Query hook behavior contradicts the documentation

**Severity:** Medium  
**Area:** Documentation and lifecycle contract

The query builder runs `beforeBulkUpdate` and `afterBulkUpdate` for query updates, and the
integration tests explicitly verify hook mutation and after-hook payloads. Query deletes likewise
run bulk delete hooks.

Multiple current documentation pages state that query update/delete operations do not run hooks,
including the API reference, query guide, lifecycle-hook guide, best-practices guide,
troubleshooting guide, and CRUD guide. The query guide also describes update's return value as
matched documents, while the implementation returns successfully written documents.

**Recommended fix**

Treat implementation and integration tests as the intended behavior unless there is a design reason
to remove hooks. Update all current v3 documentation in one pass, while leaving the archived v2 docs
frozen. State precisely:

- Which bulk hooks run.
- Whether `beforeBulkUpdate` can change the update payload.
- Which IDs are supplied to after hooks.
- Whether the returned count is matched, attempted, or successfully written documents.

### 12. Bulk operations do not define duplicate-ID behavior or global atomicity

**Severity:** Medium  
**Area:** Bulk writes

`bulkDelete` and `bulkUpdate` accept duplicate IDs without deduplicating or rejecting them.
Duplicate actions against the same document can lead to confusing counts and backend-dependent
failures.

Bulk commits are split into sequential 500-operation batches. Operations above 500 are therefore not
globally atomic: earlier chunks remain committed if a later chunk fails, and final after-hooks may
not run. This is a reasonable scalability tradeoff, but it is a significant contract that should not
be implicit.

**Recommended fix**

- Reject duplicate document IDs with a clear validation error, or explicitly deduplicate them before
  hooks and result counting.
- State prominently that operations above 500 writes are chunked and non-atomic.
- Consider a strict atomic mode that rejects more than 500 operations and a separate explicitly
  non-atomic bulk mode.
- Return enough progress information for callers to reconcile partial completion, if the API
  continues to permit multi-batch operations.

The missing multi-batch failure test is already tracked in the repository's coverage follow-ups and
should be promoted into the v3 release checklist.

### 13. Pagination inputs and cursor scope need hardening

**Severity:** Medium  
**Area:** Pagination

Cursor pagination only rejects values less than or equal to zero. `NaN`, infinity, and non-integers
pass the library check and fail later in less predictable ways. Offset pagination does not
consistently validate `page` and `pageSize`; zero, negative, non-integer, and non-finite values can
produce invalid offsets or page counts.

The cursor payload contains a document path that is passed to `db.doc(path).get()` without being
bound to the repository or base query. An untrusted cursor can therefore cause a read against an
arbitrary document path in the same database and reveal existence through timing/error behavior.
Each page also incurs an extra document read, and pagination stops working if that cursor document
is deleted between requests.

**Recommended fix**

- Require positive finite integers for page, page size, and limit inputs.
- Version cursor payloads.
- Bind cursor paths to the repository collection and, ideally, to a stable query signature.
- Consider signed cursors when they cross a trust boundary.
- Longer term, encode the ordered cursor values rather than requiring a fresh document lookup, with
  a documented serialization policy for Firestore value types.

### 14. Aggregation and distinct-value typing are too broad

**Severity:** Medium  
**Area:** Query API

`sum` and `average` accept any top-level `keyof T`, including strings, objects, and other nonnumeric
fields, while excluding valid dotted numeric fields. The API should accept only numeric Firestore
field paths.

`distinctValues` uses a JavaScript `Set`. Reference-valued Firestore data such as objects and
timestamps are distinct by object identity even when semantically equal, so the result does not
reliably represent distinct Firestore values.

`findByField` is similarly limited to top-level keys despite the new dot-path support elsewhere.

**Recommended fix**

- Introduce numeric field-path typing for `sum` and `average`.
- Extend `findByField` to typed dotted paths.
- Limit `distinctValues` to scalar values, or define and implement Firestore-aware equality for
  supported structured values.

The current `where` value is intentionally typed broadly because read converters can make the
application model differ from the stored model. Documentation should qualify claims that all query
values are type-safe. A separate stored-model generic would allow accurate query-value types in a
future iteration.

### 15. Error normalization needs a small consistency pass

**Severity:** Medium  
**Area:** Error handling

In addition to the Express issues above:

- Parser functions should accept `unknown` and never throw merely while trying to classify an error.
- Firestore status codes should be normalized across numeric gRPC values and string status names.
- Index errors should preserve a safe version of the index-creation URL or structured remediation
  information where available.
- HTTP status mappings should distinguish client validation/not-found failures from server
  configuration or availability failures.

Add a table-driven test suite using `null`, primitives, ordinary `Error` instances, numeric codes,
string codes, and representative Firestore error shapes.

## Release engineering and maintenance findings

### 16. CI does not exercise the same artifact that users install

**Severity:** High for release confidence  
**Area:** CI and publishing

The pull-request workflow runs coverage, documentation links, and type tests, but it does not
consistently gate lint, the library build, the website build, tarball contents, or an isolated
consumer compile. The publish workflow runs coverage and build, but not the complete quality set.

That is why the Express declaration leak, test-file packaging, and lockfile peer drift can coexist
with a green suite.

**Recommended fix**

Add a single `release:verify` command and use it in both pull-request and publish workflows. It
should run:

1. Lint.
2. Type tests.
3. Library build.
4. Unit and emulator integration coverage gates.
5. Documentation link check and website build.
6. `npm pack --json` with a package-content allowlist.
7. An isolated consumer compile against the packed tarball.
8. Node.js 22/24 and Firebase Admin compatibility checks.
9. A dependency-audit policy that distinguishes runtime from development-only advisories.

The isolated consumer should also test the documented import styles and package exports.

### 17. The generated v3 changelog needs manual curation

**Severity:** Medium  
**Area:** Release notes

The dry-run version command correctly selected `3.0.0`, but the generated changelog was not
release-ready. It incorporated conventional-looking text from a squash commit body into the
breaking-change section, included coauthor footers, duplicated an issue reference, and was too long
to work as a migration-focused major release summary.

**Recommended fix**

Curate the v3 changelog manually. Lead with breaking changes, link directly to the migration guide,
then summarize the major new behavior. Ensure GitHub's generated release notes do not duplicate the
same material or omit the migration and v2 archive links.

There is one open release issue,
[#17: preserve v2 documentation via the final v2.x release tag](https://github.com/reggieofarrell/firestore-orm/issues/17).
The Starlight version archive appears to supersede part of the original plan. Update or close the
issue with explicit acceptance evidence: the final v2 tag, the stable archived v2 docs URL, and
confirmation that v3 docs do not overwrite the archive.

Several ADRs still describe already-merged work as pending merge or release. Update their statuses
before publication so the architectural record matches reality.

### 18. Module-format and build portability should be deliberate v3 decisions

**Severity:** Medium  
**Area:** Packaging and developer experience

The package exports only an ESM `import` path and no CommonJS `require` path. That may be the
correct direction, but Firebase Functions and NestJS projects still commonly have CommonJS
configurations. A major release should either provide a tested dual build or explicitly declare that
v3 is ESM-only, with migration examples.

There is also an apparently unused `tsconfig.esm.json` option/build path. Remove it if obsolete or
integrate and test it if it is intended to control packaging.

The build script uses `rm -rf`, which makes the npm workflow unnecessarily Unix-specific. Use a
cross-platform cleanup command through a direct development dependency.

Finally, fix the package keyword misspellings `fireorm-altenative` and `typesaurus-altenative`.

## Server-side Firestore feature parity follow-up

**Follow-up review date:** July 19, 2026  
**Scope:** Features exposed by the current privileged Node.js Firestore server client, plus the new
Firestore Enterprise server query surface

### Bottom line

The library supports the everyday repository layer well, but it does not provide first-class access
to the complete server-side Firestore feature set. The largest stable Core-operation gaps are:

1. Composite `Filter.and(...)` / `Filter.or(...)` queries.
2. Collection-group queries.
3. Native query streaming.
4. Read-only and point-in-time transaction options.
5. Conditional writes using create-only semantics and last-update-time preconditions.
6. `BulkWriter`, recursive deletion, and high-throughput write controls.
7. Query Explain and execution statistics.
8. Generic multi-aggregation, multi-document reads, and the complete cursor surface.

There is also a much larger new surface: Firestore Enterprise Pipeline operations. Pipelines support
expression-based queries, grouping, many more aggregation functions, server-side joins, full-text
and geographic search, transformations, and DML update/delete stages. The library has no pipeline
abstraction, and its current Firebase Admin peer range excludes Admin 14, which carries the current
`@google-cloud/firestore` 8.6 client.

This does **not** mean all of these features should block v3. A repository ORM should not duplicate
the entire database administration plane, and the Enterprise Pipeline API is still pre-GA. The
stable Core gaps should, however, be acknowledged explicitly so the package does not imply broader
feature parity than it provides.

For this review, "supported" means the feature has a documented, typed ORM API that preserves the
repository's conversion, validation, error, and result-shaping behavior. A caller who already owns
the injected `Firestore` instance can always drop down to the Admin SDK. That is an escape hatch,
not first-class ORM support. `getUnderlyingQuery()` is likewise marked `@internal`, returns an
untyped `Query<any>`, and does not let callers re-enter the ORM builder after applying a raw SDK
operation.

### Current coverage

| Server-side capability             | ORM status           | Important qualification                                                                                                 |
| ---------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Document create/read/update/delete | Supported            | Create/read-model and empty-update contract problems are covered earlier in this review.                                |
| Auto-generated and explicit IDs    | Partial              | Create generates IDs; `upsert(id, ...)` accepts an ID, but there is no create-only explicit-ID write.                   |
| Subcollections                     | Supported            | A concrete parent path is required; cross-parent collection groups are not supported.                                   |
| Named databases                    | Supported indirectly | A repository accepts an already-configured `Firestore` instance, so the selected database travels with that instance.   |
| Simple field filters               | Supported            | All `WhereFilterOp` strings can reach the SDK, but values are typed as `unknown`.                                       |
| Chained logical AND                | Supported            | Repeated `.where(field, op, value)` calls form an implicit AND.                                                         |
| Explicit AND/OR composite filters  | Missing              | The builder has no `where(Filter)` overload.                                                                            |
| Ordering and forward limits        | Supported            | `orderBy()` and `limit()` are exposed.                                                                                  |
| Cursor pagination                  | Partial              | The ORM has one opaque, forward-only `startAfter(document)` flow.                                                       |
| Field projections                  | Partial              | Runtime support exists, but result typing is unsound and projected queries cannot be listened to.                       |
| Realtime query/document listeners  | Partial              | Full model arrays/items are exposed; raw snapshot metadata and incremental document changes are discarded.              |
| Count/sum/average                  | Supported            | Each is a separate convenience call; arbitrary aliased aggregates in one request are not exposed.                       |
| Distinct values                    | Client-side only     | `distinctValues()` downloads every matching document and deduplicates in memory.                                        |
| Transactions                       | Partial              | Read-write transaction helpers exist; options, PITR, multi-get, aggregate reads, and several write forms do not.        |
| Atomic write batches               | Partial              | Fixed operation-specific helpers use 500-write chunks; there is no heterogeneous validated batch API.                   |
| High-throughput bulk writes        | Missing              | The ORM does not wrap Firestore `BulkWriter`.                                                                           |
| Field transforms/sentinels         | Supported            | Delete, timestamp, increment, array, and vector sentinels are recognized, subject to the validation issues above.       |
| Vector search                      | Mostly supported     | Distance measures, result field, threshold, and prefilters exist; `VectorValue` inputs and vector Query Explain do not. |
| Query Explain                      | Missing              | Neither normal nor vector explain plans/execution statistics are exposed.                                               |
| Enterprise Pipeline operations     | Missing              | No pipeline source, stages, expressions, execution, output validation, or pipeline DML support exists.                  |

### Stable Core features that are missing or incomplete

#### Composite filters and OR queries

The Admin Node client accepts either the traditional three-argument `where(field, op, value)` form
or a `where(Filter)` form. `Filter.or(...)` and `Filter.and(...)` can represent nested boolean
expressions. The ORM exposes only the three-argument form in
[`QueryBuilder.ts`](../../src/core/QueryBuilder.ts), and the vector builder repeats the same
restriction.

This is the clearest missing mainstream query feature. `in` and `array-contains-any` cover only
specific same-field disjunctions; they are not substitutes for:

```ts
Filter.or(Filter.where('status', '==', 'published'), Filter.where('authorId', '==', currentUserId));
```

**Recommendation:** Add a `where(filter: Filter): this` overload, or a separate
`whereFilter(filter: Filter)` method if that makes overload resolution and documentation clearer.
Preserve the three-argument overload and support the same prefilter on the vector builder. This is
small enough and important enough to include before v3.

Official references:
[Node Filter API](https://docs.cloud.google.com/nodejs/docs/reference/firestore/latest/firestore/filter)
and
[Firestore compound queries](https://firebase.google.com/docs/firestore/query-data/queries#or_queries).

#### Collection-group queries and query partitioning

Firestore can query every collection and subcollection with the same collection ID through
`firestore.collectionGroup(id)`. A `CollectionGroup` can also produce partition cursors with
`getPartitions()` so large scans can run in parallel.

The repository always seeds its builder from `readCol()`, a concrete `CollectionReference`; there is
no factory that accepts a `CollectionGroup` or arbitrary base `Query`. The existing
`subcollection()` helper addresses only one known parent and therefore is not equivalent.

Collection-group support needs more design than swapping the query source. Document IDs are not
globally unique across a group, while the ORM result model exposes only `id`. A useful result must
also retain `path`, `ref`, or parent metadata. Cursor encoding already uses the full path
internally, which is the right identity basis.

**Recommendation:** Add a query-source abstraction or a collection-group-specific factory whose
result includes stable path identity. Do not silently reuse `{ id }` as if it were globally unique.
Add `getPartitions()` later on the collection-group builder rather than to every query.

Official references:
[Firestore collection-group queries](https://firebase.google.com/docs/firestore/query-data/queries#collection-group-query)
and
[Node CollectionGroup API](https://docs.cloud.google.com/nodejs/docs/reference/firestore/latest/firestore/collectiongroup).

#### Complete query bounds, reverse limits, and explicit offsets

The Node server query supports `startAt`, `startAfter`, `endAt`, `endBefore`, `limitToLast`, and
`offset`. The ORM exposes `offset` only through `offsetPaginate()` and `startAfter` only inside its
opaque pagination method. It intentionally documents that the other cursor-chaining methods are not
public.

This leaves out bounded ranges, inclusive cursors, reverse pagination, field-value cursors, and
several efficient work-queue/export patterns. It also forces a document lookup when resuming the ORM
cursor, so pagination fails after the cursor document is deleted even when the ordered field values
could otherwise identify a valid boundary.

**Recommendation:** Keep the safe opaque pagination helper, but also expose typed lower-level bound
methods. Cursor tokens should encode query identity and ordered field values, not only a document
path. `limitToLast()` must require an `orderBy()` and must be rejected by native `stream()` because
the server SDK does not allow that combination.

Official reference:
[Node Query API](https://docs.cloud.google.com/nodejs/docs/reference/firestore/latest/firestore/query).

#### Native streaming and query diagnostics

The server client exposes `Query.stream()`, which yields snapshots as they arrive. It also exposes
`Query.explain()` and `Query.explainStream()` for plan summaries, execution statistics, index use,
and backend read metrics. `VectorQuery.explain()` provides equivalent diagnostics for vector search.

The ORM's `stream()` calls `get()` first, so it buffers the entire result. It has no explain API for
normal or vector queries. These omissions matter together: exports and migrations need actual
streaming, while Query Explain is the primary way to identify a scan or expensive index plan.

**Recommendation:** Fix native streaming before v3 as already recommended. Add `explain()` soon
after, returning the SDK's diagnostic structure without pretending it is an ORM document result.
`explainStream()` can follow when there is a clear async-iterator representation for both documents
and terminal metrics.

Official references:
[Node Query Explain and stream](https://docs.cloud.google.com/nodejs/docs/reference/firestore/latest/firestore/query)
and
[Node VectorQuery](https://docs.cloud.google.com/nodejs/docs/reference/firestore/latest/firestore/vectorquery).

#### Generic multi-aggregation and server-side distinct

Firestore Core can calculate multiple aliased `count`, `sum`, and `average` values in one aggregate
request. The ORM instead provides three methods that each execute immediately and each use a fixed
alias. This prevents one-round-trip dashboards such as count + total + average.

`distinctValues()` is more misleading: in Core operations there is no native distinct aggregation,
so the method downloads all matching documents. Firestore Enterprise Pipelines now have a `distinct`
stage plus `countDistinct` and `arrayAggDistinct`, which can do that work on the server.

**Recommendation:** Add a generic Core `aggregate(spec)` method with typed aliases and restrict the
field helpers to numeric paths. Keep `distinctValues()` documented as client-side for Standard/Core
queries. A future Pipeline extension should expose true server-side distinct under a different API
so costs and edition requirements remain obvious.

Official references:
[Node aggregate queries](https://docs.cloud.google.com/nodejs/docs/reference/firestore/latest/firestore/query#aggregate)
and
[Pipeline aggregate functions](https://firebase.google.com/docs/firestore/pipelines/functions/aggregate-functions).

#### Multi-document reads and snapshot/write metadata

The server client has `Firestore.getAll(...refs, { fieldMask })` and
`Transaction.getAll(...refs, { fieldMask })`. The ORM has no multi-ID read. `getAll()` means
"download the collection," not Firestore's multi-reference get. `bulkDelete()` therefore launches
one `get()` per requested ID before batching deletes.

The ORM also strips snapshot metadata (`ref`, `path`, `createTime`, `updateTime`, `readTime`) and
write results (`writeTime`). That makes efficient cache validation, audit logging, replication, and
optimistic concurrency harder. `fromSnapshot()` helps trigger handlers map data, but it still
returns only the model and ID.

**Recommendation:** Add a clearly named `getMany(ids, options?)`, preserve input order, represent
missing documents explicitly, and optionally accept a field mask. Add an opt-in metadata result
shape instead of changing every existing return type. Avoid calling the new method `getAll`, because
that name already means something different publicly.

Official references:
[Node Firestore `getAll`](https://docs.cloud.google.com/nodejs/docs/reference/firestore/latest/firestore/firestore#getall)
and
[Node Transaction `getAll`](https://docs.cloud.google.com/nodejs/docs/reference/firestore/latest/firestore/transaction#getall).

#### Conditional writes, preconditions, and create-only IDs

Firestore supports:

- `DocumentReference.create(data)`, which atomically fails if the document already exists.
- Update/delete preconditions using `lastUpdateTime`.
- The same preconditions in transactions, batches, and `BulkWriter`.
- A `WriteResult` containing the server write time.

The ORM does not expose these controls. `upsert(id, data)` first reads and then chooses update or
set, so it is not create-if-absent and can race with another writer between the read and write.
Repository update/delete methods cannot protect a read-modify-write flow with an update-time compare
unless the caller rewrites the operation using the raw SDK or a transaction.

This is more than a convenience gap. Conditional writes are a core concurrency primitive, and v3 is
the natural point to decide how preconditions, errors, hooks, validation, and write metadata fit the
public write contract.

**Recommendation:** Add an explicit-ID create-only method and optional preconditions to update and
delete families. Normalize failed preconditions to a distinct ORM error rather than conflating them
with validation or not-found errors. Do not redefine `upsert()` as create-only.

Official reference:
[Node DocumentReference API](https://docs.cloud.google.com/nodejs/docs/reference/firestore/latest/firestore/documentreference).

#### Read-only transactions, PITR reads, and transaction controls

The server client accepts read-write options such as `maxAttempts`, and read-only options including
`readTime`. Node point-in-time recovery reads must run in a read-only transaction. With PITR
enabled, that can read minute snapshots up to seven days in the past; even without PITR, Firestore
retains a short stale-read window.

`runInTransaction()` does not accept transaction options and always calls `db.runTransaction(fn)`.
Consequently the ORM cannot initiate a read-only transaction, set a retry ceiling, or use its model
mapping helpers for PITR reads. The raw transaction passed into the callback can execute query,
aggregate, and multi-document reads, but only after the ORM has already chosen the wrong transaction
mode for PITR.

**Recommendation:** Add an overload or second parameter for the SDK transaction options and ensure
read-only callbacks expose only read helpers at the type level. A convenience such as
`runReadOnlyAt(readTime, fn)` could make the important PITR case discoverable without replacing the
general option.

Official references:
[Node Firestore transactions](https://docs.cloud.google.com/nodejs/docs/reference/firestore/latest/firestore/firestore#runtransaction)
and
[Firestore PITR reads](https://docs.cloud.google.com/firestore/native/docs/use-pitr#read-pitr-data).

#### `BulkWriter`, arbitrary batches, and recursive deletion

Current bulk helpers split fixed create/update/delete operations into sequential batches of 500.
They do not provide:

- Parallel high-throughput writes with adaptive throttling.
- Per-write success promises and write times.
- Default retry behavior for `UNAVAILABLE` and `ABORTED` failures.
- Custom retry and throttling policies.
- Mixed create/set/update/delete operations in one validated unit.
- Recursive deletion of documents and all descendant subcollections.

Firestore's `BulkWriter` provides the first four capabilities. `Firestore.recursiveDelete()` uses a
BulkWriter and deletes descendants; an ordinary document delete does not delete subcollections.

**Recommendation:** Do not silently replace the existing batch helpers with BulkWriter because the
atomicity, ordering, hook, retry, and failure contracts differ. Add a separately named
high-throughput API with per-item results. Add recursive delete only as an explicit destructive
operation, with prominent documentation that partial failure is possible. A validated heterogeneous
batch scope would be valuable but needs a cross-repository hook/validation design.

Official references:
[Node BulkWriter](https://docs.cloud.google.com/nodejs/docs/reference/firestore/latest/firestore/bulkwriter)
and
[Node recursive delete](https://docs.cloud.google.com/nodejs/docs/reference/firestore/latest/firestore/firestore#recursivedelete).

#### Listener detail and invalid query combinations

The Admin server listeners expose complete `DocumentSnapshot` / `QuerySnapshot` objects. Query
snapshots include incremental `docChanges()`, read time, size, and document references. The ORM
reduces every query event to a freshly materialized model array and every document event to one
model. Applications cannot efficiently process only added/modified/removed documents or retain
snapshot version metadata.

There is also an unguarded invalid chain: Firestore does not allow `onSnapshot()` on a query with a
field mask, but the ORM allows `.select(...).onSnapshot()` and defers the failure to the SDK. The
vector builder already uses explicit capability guards; the Core builder should use the same idea.

**Recommendation:** Track builder capabilities and reject invalid combinations locally. Add an
optional detailed listener API that returns mapped documents plus change type, old/new indexes,
path, and read time. Keep the current full-array callback as the simple default.

Official reference:
[Node Query projection/listener constraint](https://docs.cloud.google.com/nodejs/docs/reference/firestore/latest/firestore/query#select).

#### Smaller server-client omissions

These are real Node server features, but they are lower priority for an ORM:

- Root collection discovery with `Firestore.listCollections()`.
- Direct-child subcollection discovery with `DocumentReference.listCollections()`.
- Firestore data bundles for preloading selected snapshots into client SDK caches.
- Query and reference equality helpers.
- A query that selects no fields and returns references only.
- `VectorValue` as a nearest-neighbor query input.
- Vector Query Explain.

They are best treated as an advanced SDK-interoperability layer or documented raw-SDK escape hatches
rather than as v3 blockers.

### Firestore Enterprise features

#### Pipeline operations are an entirely unsupported query model

Firestore Enterprise in Native mode now has two query models:

1. **Core operations**, the traditional collection/query API used by this ORM.
2. **Pipeline operations**, a stage-based advanced query engine.

Pipeline operations are pre-GA as of this review, but their scope is substantial. Current server
capabilities include:

- Collection, collection-group, database-wide, and explicit-document input stages.
- Expression-based `where`, sort, select, add/remove-fields, restrict, sample, unnest, and distinct
  stages.
- Scalar/string/array/map/math/date-time and conditional functions.
- Grouped aggregations including count-if, count-distinct, min, max, first, last, array aggregation,
  and distinct array aggregation.
- Correlated and uncorrelated subqueries, including server-side joins across collections and
  subcollections.
- Preview full-text and geographic search with score/distance ordering.
- Preview terminal update and delete DML stages.
- Pipeline Query Explain and point-in-time execution options.

None of these APIs is reachable through `FirestoreRepository` or `FirestoreQueryBuilder`. Several
features that the current docs describe as client-side or external—especially distinct values and
full-text search—now have a native Firestore server implementation for Enterprise Pipeline users.

The current [advanced-patterns guide](../../website/src/content/docs/guides/advanced-patterns.md)
says without qualification that Firestore has no native full-text index. That remains useful advice
for Standard edition and Core operations, but it is no longer universally true. Update it to mention
the preview Enterprise Pipeline search stage, its edition/pre-GA constraints, and the continued
value of external search services for production workloads that cannot adopt those constraints.

The right design is not to add dozens of pipeline methods to the existing query builder. Pipeline
stages can change the output from a document model into projections, computed rows, groups, scalar
aggregates, or joined documents. That is fundamentally incompatible with a builder that always
returns `T & { id }`.

**Recommendation:** Do not block v3 on a pre-GA Enterprise feature family. First add Firebase Admin
14 support and document that v3 wraps Firestore Core operations. If demand exists, build Pipelines
as a separate experimental subpath such as `firestore-orm/pipeline`, generic over an explicit output
schema. Reuse read validation where a pipeline returns repository documents, but require a separate
result schema for projections, groups, joins, and computed output. Keep Pipeline DML opt-in and do
not automatically run repository lifecycle hooks unless that behavior can be made truthful.

Official references:
[Pipeline overview](https://firebase.google.com/docs/firestore/enterprise/pipelines-overview),
[Pipeline query guide](https://firebase.google.com/docs/firestore/pipelines/get-started-with-pipelines),
[server-side joins](https://firebase.google.com/docs/firestore/pipelines/perform-joins-with-sub-pipelines),
[Pipeline search](https://firebase.google.com/docs/firestore/pipelines/stages/transformation/search),
and [Pipeline DML](https://firebase.google.com/docs/firestore/pipelines/dml).

#### MongoDB compatibility is a separate product mode

Enterprise also offers Firestore with MongoDB compatibility. That uses MongoDB drivers, BSON/MQL,
different IDs and data types, and a different ORM ecosystem. This package targets
`firebase-admin/firestore` Core operations, so MongoDB compatibility is not a reasonable missing
method to add to `FirestoreRepository`.

**Recommendation:** State explicitly that MongoDB-compatibility databases and MQL are out of scope.
Applications wanting a document model on that mode should use the supported MongoDB Node driver or
Mongoose rather than making this package serve two incompatible database APIs.

Official reference:
[Firestore MongoDB compatibility overview](https://firebase.google.com/docs/firestore/enterprise/mongodb-compatibility-overview).

### Administrative features that should remain outside the ORM

Firestore also has a control plane for:

- Database creation, update, deletion, cloning, and delete protection.
- Backup schedules, backup restore, PITR enablement, export, and import.
- TTL policies.
- Single-field, composite, vector, sparse/non-sparse, unique, and search index administration.
- IAM, database users, security rules, CMEK, tags, locations, and edition/mode selection.
- Query Insights and fleet-level monitoring.

These are server-side Firestore features, but they are deployment/operations concerns rather than
repository operations. The ORM should document how its runtime APIs relate to them—especially
indexes, PITR reads, named databases, and Enterprise edition—but should not grow a second Google
Cloud administration client. Terraform, Firebase CLI, Google Cloud CLI, and the Firestore Admin API
are the appropriate tools.

### Recommended v3 feature boundary

Add or settle these before v3 because they close mainstream Core gaps or require major-version
contract decisions:

1. Add Firebase Admin 14 / Node 22 support and test it.
2. Add `where(Filter)` composite AND/OR support to Core and vector prefilters.
3. Implement actual native streaming.
4. Accept Firestore transaction options, including read-only/read-time operation.
5. Define conditional-write and precondition support, including explicit-ID create-only behavior.
6. Guard `select().onSnapshot()` and other SDK-invalid method combinations.
7. Document a capability matrix and a supported raw-SDK escape hatch.

Strong additive candidates for the first v3 minor releases:

1. Collection-group query sources with full-path result identity.
2. `getMany()` with field masks and optional snapshot metadata.
3. Typed lower-level query bounds and `limitToLast()`.
4. Generic multi-aggregate queries.
5. Query Explain, followed by vector Explain.
6. A separately named BulkWriter-backed high-throughput API.
7. Explicit recursive delete.

Defer these until demand and API stability justify them:

1. Firestore data bundles and collection discovery.
2. Query partition orchestration.
3. A separate experimental Enterprise Pipeline package.
4. Any MongoDB-compatibility abstraction.
5. Firestore control-plane administration.

The practical release message should therefore be: v3 is a type-safe ORM for Firestore **Core
operations**, with documented Admin SDK escape hatches. It should not claim full server-side
Firestore parity, Enterprise Pipeline support, or database administration support.

## Features worth including in v3

Only features that complete an existing v3 promise or close a mainstream Core-operation gap with a
major-version contract decision are recommended:

### Projection-aware query results

Make `select()` change the result type, including nested field paths and vector distance fields.
This closes a real soundness bug rather than expanding scope.

### A true streaming iterator

Back the public async iterator with Firestore's native stream. The method already exists and is
documented as memory-efficient; v3 should make that statement true.

### An explicit write-output/read-model contract

Separate caller input, validated write output, stored representation, and converted read output—or
at minimum make `{ returnDoc: true }` the uniform boundary for returning a read model. This is the
most important design refinement for the new read/write schema split.

### Strict sentinel validation by default

This is a previously documented future-major decision and prevents surprising bypass of Zod
behavior. Retain permissive mode only as an explicit compatibility option.

### Current Firebase Admin and Node.js support

Treat Admin 14 and Node.js 22/24 as v3 launch requirements, not later feature work. Publishing a new
major already behind the current supported platform would create avoidable immediate migration work.

### Composite filters and transaction options

Expose `Filter.and(...)` / `Filter.or(...)`, and pass typed read-write/read-only options through
`runInTransaction()`. These are stable server-client capabilities; the latter also unlocks
ORM-mapped PITR reads.

### Conditional-write and query-capability contracts

Decide how create-only explicit IDs, update/delete preconditions, write metadata, and failed
preconditions appear in the ORM. Track incompatible query states so combinations such as
`select().onSnapshot()` fail locally and predictably.

### Optional: explicit Express integration export

An `express` subpath is a small feature that solves the declaration leak cleanly and leaves room for
framework adapters without burdening the core package.

## What should not block v3

The following could be scheduled as patch/minor follow-ups if the core blockers and high-priority
contract items are fixed:

- Collection-group query sources with full-path document identity.
- Generic multi-aggregate queries, multi-ID reads, Query Explain, and lower-level cursor bounds.
- Separately named BulkWriter and recursive-delete APIs with explicit partial-failure contracts.
- An experimental Enterprise Pipeline subpath after the underlying pre-GA API stabilizes.
- Richer self-contained cursor formats, after adding immediate input and scope validation.
- Firestore-aware deep equality for structured `distinctValues`, if the method is temporarily
  limited/documented.
- More elaborate partial-success reporting for multi-batch bulk operations, after non-atomic
  behavior is documented.
- New framework adapters beyond isolating the existing Express adapter.
- Broad repository features unrelated to the current v3 contract.

## Recommended implementation order

1. Decide the create/read model, strict sentinel default, empty-update, projection, conditional
   write, transaction-option, ESM/CJS, Node, and Firebase Admin contracts.
2. Fix prototype-pollution and input-mutation bugs, with adversarial tests.
3. Implement the create/bulk-create return contract and strict/per-path sentinel parsing.
4. Isolate Express types and harden error parsing/status mapping.
5. Fix package contents, declaration-map policy, lockfile metadata, and install lifecycle behavior.
6. Implement projection-aware results, composite filters, native streaming, transaction options,
   conditional writes, and invalid-query capability guards.
7. Align update/hook semantics, vector validation/types, and current documentation.
8. Upgrade Firebase Admin/CLI, set the Node/TypeScript floors, and run the support matrix.
9. Add the unified release-verification workflow and isolated packed-consumer test.
10. Curate the changelog, close or revise issue #17, update ADR statuses, and perform the final
    release rehearsal.

## Suggested issue breakdown

For manageable review and rollback, split the work into focused issues or pull requests:

| Priority | Suggested issue                              | Acceptance signal                                                                   |
| -------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| P0       | Secure dot-notation/object utilities         | Pollution reproductions fail; inputs remain unchanged                               |
| P0       | Make create returns match read/write types   | Single, bulk, and transaction tests cover converted read models and stripped fields |
| P0       | Make sentinel validation preserve Zod output | Strict is default; permissive mode preserves sibling parsing                        |
| P0       | Fix npm artifact and peer metadata           | Tarball allowlist and isolated consumer compile pass                                |
| P0       | Remove Express types from the root graph     | Core import compiles without Express installed                                      |
| P1       | Add projection-aware query/vector types      | Selected-away fields become compile errors                                          |
| P1       | Implement true streaming                     | Test proves iteration uses native stream rather than `get()`                        |
| P1       | Add composite filters                        | Nested AND/OR filters work on Core and vector prequeries                            |
| P1       | Add transaction options and preconditions    | Read-only PITR and conditional-write tests pass                                     |
| P1       | Guard incompatible query states              | Projection listeners and other invalid chains fail locally                          |
| P1       | Normalize empty-update and hook semantics    | All four update surfaces share one tested policy                                    |
| P1       | Support Admin 14 on Node 22/24               | CI matrix and emulator tests pass; audit is reviewed                                |
| P1       | Harden vector inputs/results                 | Non-finite values rejected; distance field appears in result type                   |
| P1       | Add `release:verify` packed-consumer gate    | PR and publish workflows run the same command                                       |
| P2       | Harden pagination/cursors                    | Finite integer validation and collection/query binding tested                       |
| P2       | Tighten aggregation/distinct typing          | Numeric paths only; structured equality policy explicit                             |
| P2       | Reconcile docs, ADRs, and release issue      | Current docs match tests; v2 archive remains frozen                                 |
| P2       | Curate v3 release notes                      | Concise breaking-change list and migration/archive links                            |

## Final release gate

Publish v3 only when all of the following are true:

- The five release blockers in this review have fixes and regression tests.
- Public create, update, projection, sentinel, hook, and module-format contracts are explicitly
  decided and documented.
- Node.js and Firebase Admin support ranges reflect the v3 decision and pass a compatibility matrix.
- Stable Core support includes composite filters, native streaming, transaction options, and
  explicitly decided conditional-write semantics.
- Invalid query combinations such as projected realtime listeners fail locally with documented
  errors.
- `release:verify` passes against the exact packed tarball on Node.js 22 and 24.
- The packed tarball contains only intended runtime declarations, JavaScript, maps/sources, license,
  README, and package metadata.
- A fresh consumer can install and type-check the tarball without undeclared packages.
- Root and website audits have been reviewed after dependency upgrades, with no unexplained
  high-severity advisories.
- Current v3 docs match runtime hook/count/stream behavior, while archived v2 docs remain stable.
- The migration guide, curated changelog, GitHub release body, and issue #17 all point to a
  consistent upgrade path.
- The final working tree is clean and the release rehearsal selects version `3.0.0`.

Once those gates pass, the repository is ready for v3. The existing implementation and test
foundation are strong; the remaining work is primarily about making the package boundary as reliable
as the internals.
