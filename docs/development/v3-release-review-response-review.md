# Review of the response to the v3 release review

**Review date:** July 19, 2026  
**Reviewed branch:** `v3-release-hardening` at `9239283`  
**Compared against:** `main` / `origin/main` at `e9ab34c`  
**Response reviewed:** [`v3-release-review-response.md`](./v3-release-review-response.md)  
**Original review:** [`v3-release-review.md`](./v3-release-review.md)

> **Follow-ups:** The verification of the round-2 response at `a8c4c23` is under
> [Round-2 response verification](#round-2-response-verification-july-19-2026). The verification of
> the round-3 response at `0904197` is under
> [Round-3 response verification](#round-3-response-verification-july-20-2026). The verification of
> the round-4 response at `b9be1fa` is under
> [Round-4 response verification](#round-4-response-verification-july-20-2026). The verification of
> the round-5 response at `6e9f655` is under
> [Round-5 response verification](#round-5-response-verification-july-20-2026). The opening review
> remains as the historical assessment of `9239283`.

## Executive conclusion

The branch is substantially better than `main`, and most of the response is supported by the code.
The build, package boundary, test counts, coverage gates, native streaming change, create contract,
strict sentinel default, Express subpath, dual ESM/CommonJS output, error parser, and documentation
cleanup are all real.

I would **not accept the response's claim that all findings are addressed**, and I would not release
v3 from this exact branch yet. Four implementation defects remain in areas the response marks fixed:

1. The prototype-pollution hardening is incomplete; `convertTimestampsToMillis()` can return an
   object with an attacker-selected prototype, and `flattenToDotNotation()` has the same unsafe
   construction pattern.
2. `FieldValue.vector([Infinity])` is still accepted by `vectorEmbeddingSchema()` despite the claim
   that non-finite vectors are rejected.
3. Projection typing remains unsound through builder aliases and loses its projection entirely when
   a vector query transitions through `findNearest()`.
4. `query().update({})` returns `0` instead of rejecting when the query has no matches, so the
   promised all-surfaces empty-update contract is data-dependent.

The release-engineering claim is also broader than the implementation: neither workflow invokes
`release:verify`, the PR workflow does not build the website, the publish workflow omits both docs
checks, and the declared Firebase Admin 12/13/14 peer range is tested only against Admin 14.

Finally, the response covers the original numbered findings but does not address the later
server-side Firestore parity review. Native query streaming is the only major item from that
follow-up implemented on this branch. Composite filters, collection-group queries, transaction
options/PITR, conditional writes, and invalid-combination guards are still absent.

## Prioritized findings

### 1. Release blocker: object-building utilities remain vulnerable to output prototype pollution

**Response claim affected:** F3, “prototype pollution ... fixed”; the response explicitly refutes a
problem in `convertTimestampsToMillis()`.

**Evidence**

[`src/utils/timestamps.ts`](../../src/utils/timestamps.ts) constructs an ordinary object and assigns
arbitrary source keys with `out[key] = ...`:

```ts
const out: Record<string, unknown> = {};
for (const [key, entry] of Object.entries(value)) {
  out[key] = convertValue(entry);
}
```

The `__proto__` setter on an ordinary object makes that assignment special. This reproduction on the
built branch succeeds:

```ts
const input = JSON.parse('{"__proto__":{"isAdmin":true}}');
const out = convertTimestampsToMillis<Record<string, unknown>>(input);

Object.hasOwn(out, 'isAdmin'); // false
(out as any).isAdmin; // true, inherited from the injected prototype
```

The response's argument that this is safe because only the local output object is affected is not a
sufficient security boundary. Output-object prototype pollution can still turn an absent own field
into a truthy inherited field, which is enough to break authorization and feature-flag checks. The
“trusted read data” premise is also unsafe: this helper is a public root export and accepts
arbitrary input, and Firestore documents may contain data originally written by less-trusted
clients.

[`src/utils/dotNotation.ts`](../../src/utils/dotNotation.ts) has the same construction pattern in
`flattenToDotNotation()`: it creates `{}` and assigns arbitrary keys. An own `__proto__` input whose
value is a non-plain object changes the returned object's prototype. The new adversarial tests cover
`expandDotNotation()`, `mergeDotNotationUpdate()`, and `validateDotNotationPath()`, but not
`flattenToDotNotation()` or the timestamp walker, even though the original recommendation called for
all exported object/path utilities to be tested.

**Required fix before v3**

- Build copied dictionaries without invoking inherited setters. `Object.fromEntries()`, explicit
  `Object.defineProperty()`, or carefully handled null-prototype intermediates are viable options.
- Apply one consistent safe-copy primitive to both recursive utilities.
- Add tests using own `__proto__`, `constructor`, and `prototype` keys, including JSON-parsed input.
- Assert both that `Object.prototype` is unchanged and that the returned object's prototype/own-key
  shape cannot be attacker-controlled.

### 2. High: vector sentinels containing infinity still bypass finite-number validation

**Response claim affected:** F10, “reject non-finite values”.

**Evidence**

[`src/vector/VectorSearch.ts`](../../src/vector/VectorSearch.ts) still recognizes structural vector
values with this test:

```ts
vectorValue._values.every(entry => typeof entry === 'number' && !Number.isNaN(entry));
```

That rejects `NaN` but accepts positive and negative infinity. Then
[`vectorEmbeddingSchema.ts`](../../src/vector/vectorEmbeddingSchema.ts) returns success immediately
when `isVectorFieldValue(value)` is true, before reaching the new `Number.isFinite()` check for
plain arrays.

Firebase Admin 14 permits construction of such a value, and the built branch accepts it:

```ts
const value = FieldValue.vector([Infinity]);

isVectorFieldValue(value); // true
vectorEmbeddingSchema(1).safeParse(value); // { success: true, ... }
```

`src/core/Validation.ts` contains the same `!Number.isNaN()` structural vector check, so strict
sentinel validation can classify an infinite vector as a valid vector sentinel as well.

**Required fix before v3**

- Use `Number.isFinite()` in every vector-value recognition path, not only on raw query arrays.
- Test `FieldValue.vector([Infinity])`, `FieldValue.vector([-Infinity])`, and their structural
  equivalents against `isVectorFieldValue`, `vectorEmbeddingSchema`, and strict sentinel schemas.
- Consider centralizing vector extraction/validation so the core validator and vector extension
  cannot drift again.

### 3. High: vector projection typing is reset by `findNearest()` and contradicts the guide

**Response claims affected:** F6 and F10, including “projection-aware result generic” and “make
vector projection typing compose”.

**Evidence**

[`VectorQueryBuilder.select()`](../../src/vector/VectorQueryBuilder.ts) narrows its result generic
from the full model to `Partial<T> & { id }`. However,
[`findNearest()`](../../src/vector/VectorQueryBuilder.ts) then discards that generic and returns:

```ts
VectorQueryBuilder<T, VectorSearchResult<T, DF>>;
```

`VectorSearchResult<T, DF>` starts from full `T`, so this compiles as if projected-away fields were
present:

```ts
const rows = await vectorRepo
  .query()
  .select('name')
  .findNearest({
    vectorField: 'embedding',
    queryVector: [0.1, 0.2],
    limit: 5,
    distanceMeasure: 'COSINE',
  })
  .get();

rows[0].embedding.length; // statically allowed; embedding was projected away
```

There is a second mismatch. The vector guide tells users to include `distanceResultField` in
`select()`, but `select()` accepts only `FieldPaths<T> | FieldPath`. A computed distance field such
as `'vectorDistance'` is not part of `T`, so the documented string form does not type-check. A
caller can construct a `FieldPath` as an escape hatch, but that is neither shown nor
projection-aware.

The current vector type tests verify the distance field and the non-projected case only; they never
compose `select()` with `findNearest()`.

**Required fix before v3**

- Preserve the builder's current result generic through `findNearest()` and add only the configured
  distance property to that result.
- Decide how computed fields participate in projection. Good options are automatically selecting
  `distanceResultField`, accepting the configured literal as a computed field, or exposing a typed
  post-`findNearest` projection API if the SDK permits it.
- Add type tests for projected vector results with and without `distanceResultField`.
- Correct the guide so its example is accepted by the public TypeScript API.

### 4. High: core projection typing is still unsound through mutable builder aliases

**Response claim affected:** F6, “closes the soundness hole”.

**Evidence**

[`FirestoreQueryBuilder.select()`](../../src/core/QueryBuilder.ts) mutates `this.query` and returns
the same runtime object cast to a new generic instantiation. A pre-existing alias keeps its old
full-model type even though the shared runtime builder now has a projection:

```ts
const query = repo.query();
query.select('name');

const rows = await query.get();
rows[0].createdAt.getTime(); // compiles as Date; createdAt is absent at runtime
```

The `Partial<T>` compromise also does not make selected-away properties themselves compile errors;
it makes every model property optional. Accessing `row.createdAt` remains legal, while dereferencing
it without a guard fails. That is a useful improvement over the old full-model promise, but it is
not the exact projection contract or the acceptance criterion stated in the original review.

Documentation is not fully synchronized either. The current API reference still describes
`FirestoreQueryBuilder<T, W>`, says chainable clause methods return `this`, and documents
`select(...): this`. The query guide does not mention partial result typing, converter/projection
interaction, or the SDK restriction on projected listeners.

**Required fix before v3**

- Prefer immutable query-builder transitions, matching the native Firestore query API: `select()`
  should return a new builder rather than mutate an object that may have aliases.
- Carry a precise projection result type where practical. At minimum, exact top-level literal fields
  should become `Pick<T, K> & { id }`; nested paths need an explicit documented result policy.
- Document how read converters behave when Firestore supplies only a projection. A converter that
  assumes a full snapshot can currently throw on a projected query.
- Update the API reference and add an alias-based type regression test.

### 5. High: query empty-update rejection depends on whether documents happen to match

**Response claim affected:** F8, “reject empty patches everywhere”.

**Evidence**

[`FirestoreQueryBuilder.update()`](../../src/core/QueryBuilder.ts) reads the query and immediately
returns when the snapshot is empty:

```ts
const snapshot = await this.query.get();
if (snapshot.empty) return 0;
```

Validation, undefined stripping, and `assertNonEmptyUpdatePayload()` occur only later inside the
loop over matched documents. Therefore:

```ts
await repo.query().where('state', '==', 'missing').update({});
```

returns `0`, while the identical empty payload throws `ValidationError` as soon as one document
matches. The contract is consequently data-dependent and does not match ADR-0014 or the response's
“all four surfaces” statement.

**Required fix before v3**

- On the empty-snapshot path, validate/sanitize the caller payload and assert that it is non-empty
  before returning `0`.
- Add integration coverage for raw `{}`, all-`undefined`, and schema-stripped payloads against a
  zero-match query as well as a non-empty query.

### 6. High for release confidence: the workflows do not use the advertised release gate or test the full peer range

**Response claim affected:** F16, “`release:verify` ... in PR & publish workflows”; the statement
that everything else in the final release gate is satisfied.

**Evidence**

- `package.json` defines a useful `release:verify` script, but neither
  [`.github/workflows/tests.yml`](../../.github/workflows/tests.yml) nor
  [`.github/workflows/publish.yml`](../../.github/workflows/publish.yml) invokes it.
- The PR workflow has separate jobs for lint, types, tests, links, packaging, and Node 22, but it
  does not run `docs:build`.
- The publish workflow runs lint, types, tests, build, and package checks, but omits both
  `check:docs` and `docs:build`.
- The manifest declares `firebase-admin: ^12 || ^13 || ^14`; CI and the packed-consumer script
  install only the Admin 14 development version. There is no 12/13/14 compatibility matrix.
- The packed-consumer gate type-checks with `skipLibCheck: true` and never executes an
  import/require smoke test against the installed tarball. The direct built ESM and CommonJS
  entrypoints did load in this review, but that success is not protected by CI.
- The recommended dependency-audit policy is not present.
- `check:manifest` compares `peerDependencies` and `engines`, but not `peerDependenciesMeta`; drift
  could silently make the optional Express peer mandatory in the lockfile metadata.

The current package check itself is valuable and passed. This finding is about the response
overstating what is continuously gated.

**Required fix before v3**

- Invoke one canonical release gate from both PR and publish workflows, or factor the steps into a
  reusable workflow that is definitionally equivalent to `release:verify`.
- Add Admin 12/13/14 consumer/type/runtime coverage if all three majors remain declared peers. If
  the matrix is not worth maintaining, narrow the v3 peer range honestly.
- Add runtime `import()` and `require()` smoke tests against the installed tarball and its subpaths.
- Add `peerDependenciesMeta` to the manifest/lockfile comparison.
- Either implement the stated audit policy or remove it from the “satisfied” claim.

### 7. Release-scope decision required: the server-side Firestore parity follow-up is not addressed

The response is organized around the original 18 numbered findings. It does not discuss the
server-side feature-parity follow-up later added to the same review, yet its closing sentence says
everything else in the review's final release gate is satisfied.

That is not true. On this branch, native query streaming is fixed, but the other recommended stable
Core gaps remain:

| Firestore server feature                                      | Current branch                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Composite `AND` / `OR` filters                                | Missing; `where()` has only the field/operator/value overload.           |
| Collection-group queries                                      | Missing; repositories require one concrete collection path.              |
| Read-only transactions, retry options, and PITR `readTime`    | Missing; `runInTransaction()` accepts only the callback.                 |
| Update/delete preconditions                                   | Missing from repository, bulk, and transaction helpers.                  |
| Guard for `select().onSnapshot()`                             | Missing; the builder permits a combination the SDK documents as invalid. |
| Generic multi-aggregation                                     | Missing; only separate count/sum/average helpers exist.                  |
| Multi-document `getAll`                                       | Missing.                                                                 |
| `BulkWriter`, throttling, and per-write retry/error callbacks | Missing.                                                                 |
| Query Explain / explain streaming                             | Missing.                                                                 |
| Full cursor bounds and `limitToLast`                          | Missing.                                                                 |

These are not speculative SDK internals. The current official Node reference exposes
[`Query.where(Filter)`](https://docs.cloud.google.com/nodejs/docs/reference/firestore/latest/firestore/query#where_filter_),
[`Firestore.collectionGroup()`](https://docs.cloud.google.com/nodejs/docs/reference/firestore/latest/firestore/firestore#collectiongroup),
[`runTransaction(..., transactionOptions)`](https://docs.cloud.google.com/nodejs/docs/reference/firestore/latest/firestore/firestore#runtransaction),
[`DocumentReference` write preconditions](https://docs.cloud.google.com/nodejs/docs/reference/firestore/latest/firestore/documentreference#update),
[`Firestore.getAll()`](https://docs.cloud.google.com/nodejs/docs/reference/firestore/latest/firestore/firestore#getall),
and
[`Firestore.bulkWriter()`](https://docs.cloud.google.com/nodejs/docs/reference/firestore/latest/firestore/firestore#bulkwriter).
The same Query reference explicitly states that a query with a field mask cannot use `onSnapshot()`.

Not all of these need to block v3. The original follow-up recommended a narrower pre-v3 set because
those features complete APIs the ORM already exposes:

1. Composite filters, including vector prefilters.
2. Transaction options, including read-only/PITR reads.
3. Conditional update/delete preconditions.
4. A local guard for `select().onSnapshot()`.
5. An intentional decision on collection-group query support and the public raw-SDK escape hatch.

The maintainer should either implement that set before v3 or explicitly revise the release scope and
the response. The current response should not be used as evidence that the parity follow-up or the
review's expanded final release gate is complete.

## Claims that did verify

The findings above should not obscure the amount of correct work on the branch. I verified these
substantive claims:

- `errorHandler` moved to the `/express` subpath, Express is an optional peer, and root declarations
  do not reference Express.
- `create()` and `bulkCreate()` return IDs by default and read through the converter only with
  `returnDoc: true`; transactional create returns only an ID.
- The strict sentinel policy is the default, with permissive behavior retained as an explicit
  migration option.
- Compiled tests and declaration maps are excluded from the packed artifact.
- ESM and CommonJS root, vector, and Express entrypoints build and load.
- Core `stream()` uses native `Query.stream()` rather than `get()`.
- Duplicate IDs are rejected on the normal bulk-update/delete input path, and chunk non-atomicity is
  documented.
- Pagination numbers are validated and cursor document paths are bound to the repository collection.
- Numeric field-path typing, dotted find helpers, error-code normalization, and the missing-index
  503 mapping are present.
- Query hook documentation now matches the existing bulk-hook behavior.
- The Node 22 floor, Admin 14 peer support, current development SDK, and v3 dry-run version
  selection are present.

## Verification performed

| Check                                             | Result                                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Branch diff                                       | 19 commits; 71 tracked files changed                                                            |
| `npm run lint`                                    | Passed                                                                                          |
| `npm run test:types`                              | Passed                                                                                          |
| `npm run build`                                   | Passed; ESM + CommonJS generated                                                                |
| Unit suite                                        | 194/194 passed                                                                                  |
| Emulator integration suite                        | 209/209 passed                                                                                  |
| Unit coverage gates                               | Passed                                                                                          |
| Integration coverage gates                        | Passed                                                                                          |
| Manifest/lockfile check                           | Passed for the sections it checks                                                               |
| Package allowlist                                 | Passed; 66 packed files                                                                         |
| Packed consumer compile                           | Passed for ESM, CommonJS, and `/express`                                                        |
| Direct ESM/CommonJS runtime entrypoint load       | Passed                                                                                          |
| Website build                                     | Passed; 48 pages                                                                                |
| Release bump dry-run                              | Selected `3.0.0`                                                                                |
| Documentation link check in the supplied worktree | Failed only on the known stale `src/core/ErrorHandler.ts` link in the untracked original review |

The documentation-link failure does not affect a clean checkout because both review artifacts are
currently untracked. If they are committed, update that link to `src/express/index.ts` first.

## Recommended acceptance order

Before releasing v3:

1. Fix and regression-test the two remaining unsafe object/vector validation paths.
2. Fix vector projection composition and the mutable core-builder alias hole.
3. Make zero-match query updates honor the empty-update contract.
4. Decide the pre-v3 server feature set, with composite filters, transaction options, conditional
   writes, and invalid-combination guards as the highest-value additions.
5. Make the workflow gate match the documented `release:verify` contract and test every declared
   Firebase Admin major.
6. Revise the response's bottom line and finding table, then curate the v3 changelog and finish
   issue #17 at release time as already planned.

After those changes, rerun the packed consumer, Node/Admin matrix, complete coverage gates, docs
link check, website build, and release rehearsal from a clean checkout.

---

## Round-2 response verification (July 19, 2026)

- **Reviewed branch:** `v3-release-hardening` at `a8c4c23`
- **Previous reviewed head:** `9239283`
- **Response reviewed:**
  [`v3-release-review-response-round2.md`](./v3-release-review-response-round2.md)
- **Round-2 change set:** 6 commits; 39 files; 2,774 insertions and 93 deletions

### Round-2 conclusion

Round 2 closes the security, non-finite-vector, zero-match-update, listener-guard, issue-tracking,
and most release-gate gaps for real. The canonical `release:verify` command passes, the packed
artifact compiles and loads against all three declared Firebase Admin majors, and all twelve
deferred parity issues exist with the promised labels.

I still would **not release v3 from this exact commit**. The response says all seven findings are
addressed, but projection soundness is still incomplete in three independently reproducible ways:

1. A dotted `select()` is represented by shallow `Partial<T>`, so unselected nested siblings remain
   statically required after the selected parent is guarded.
2. `VectorQueryBuilder.select()` still mutates and re-casts the same wrapper, recreating the alias
   unsoundness that core `select()` was changed to eliminate.
3. Vector `select()` with an empty field list promises a configured distance field but returns only
   `{ id }` because the widening condition mistakes “zero selected fields” for “no projection”.

A fourth vector correctness bug was exposed while testing the new surface: `distanceThreshold: 0` is
accepted by the ORM but silently omitted by the installed Firestore SDK serializer, broadening an
exact-match Euclidean query to all nearest neighbors. Two release-engineering/documentation items
should also be tightened: the publish job does not bind the release tag/prerelease state to the
package version or rerun the Admin compatibility matrix, and the API reference still hard-codes
full-model terminal-read signatures despite introducing result generic `R`.

### Round-2 disposition

| Round-2 item                  | Verification result                                                                                                                                                                     | Disposition                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Output prototype pollution    | Shared `safeAssign` is used in both object builders; adversarial tests cover JSON-owned and nested `__proto__` keys.                                                                    | **Verified fixed**          |
| Non-finite vector sentinels   | Core and vector paths share `Number.isFinite` recognition; `NaN` and both infinities are covered.                                                                                       | **Verified fixed**          |
| Vector projection composition | A normal non-empty projection now survives `findNearest()` and includes the distance field, but wrapper aliases and empty projections remain unsound.                                   | **Partial**                 |
| Core projection aliases       | Core `select()` is genuinely immutable and the original alias remains full at runtime; dotted projections are still unsound under shallow `Partial<T>`.                                 | **Partial**                 |
| Zero-match empty query update | Empty/all-undefined/schema-stripped updates validate and reject even with no matches; valid updates return `0`.                                                                         | **Verified fixed**          |
| Release engineering           | `release:verify`, runtime smoke, audit, docs build, metadata check, and PR Admin matrix all exist and pass; publish itself still tests only Admin 14 and lacks release identity guards. | **Mostly fixed; tighten**   |
| Server-side Firestore scope   | ADR-0017, the capability matrix, raw-SDK escape hatch, and open issues #30–#41 with `parity` + `v3.x` all verify.                                                                       | **Verified scope decision** |

### Finding 1 — High: dotted projections remain statically unsound

[`FirestoreQueryBuilder.select()`](../../src/core/QueryBuilder.ts) returns `Partial<T> & { id }`.
That is conservative for a top-level selection such as `select('name')`, but it is **not**
conservative for a dotted selection. `Partial<T>` makes only the root properties optional; if a root
object is present, all of its nested properties retain their original required types.

This compiles under the branch's own `npm run test:types` configuration:

```ts
type Doc = {
  id: string;
  address: { city: string; zip: string };
};

const rows = await repo.query().select('address.city').get();
if (rows[0].address) {
  rows[0].address.zip.toUpperCase(); // compiles, but `zip` was not returned
}
```

Firestore returns an `address` map containing `city`, not the unselected `zip`. The guard only
proves that the partially returned parent map exists; it cannot make its absent sibling appear. This
is the same class of “typed present, runtime absent” problem the projection work is meant to remove.

The new type tests cover only top-level projected-away fields. They do exercise dotted path
_acceptance_, but do not assert a safe result shape for dotted projections. The response describes
precise `Pick<T, K>` as optional future work, yet at least a recursive conservative shape is
required for soundness now.

**Required before v3**

- Derive a projection result from literal paths, including nested paths, or return a recursive
  `DeepPartial<T> & { id }` whenever dotted/dynamic `FieldPath` projection prevents precise
  inference.
- Add type tests for one-level and deep dotted selections, sibling fields, multiple paths, parent +
  child combinations, and dynamic `FieldPath` input.
- Keep the result policy explicit in the migration guide; a shallow `Partial<T>` should not be
  described as closing nested projection soundness.

### Finding 2 — High: the vector wrapper recreates mutable-alias unsoundness

Core `select()` now returns a new builder. However,
[`VectorQueryBuilder.select()`](../../src/vector/VectorQueryBuilder.ts) stores that new core builder
back on `this`, stores the selected fields on `this`, and returns the **same vector wrapper** cast
to the narrower generic:

```ts
this.selectedFields = fields;
this.coreBuilder = this.coreBuilder.select(...fields);
return this as unknown as VectorQueryBuilder<T, Partial<T> & { id: ID }>;
```

Therefore the old vector alias keeps the full-model type while its runtime query is projected:

```ts
const query = withVectorSearch(repo).query();
query.select('name'); // returned narrowed alias is ignored

const rows = await query
  .findNearest({
    vectorField: 'embedding',
    queryVector: [1, 0, 0],
    limit: 1,
    distanceMeasure: 'EUCLIDEAN',
  })
  .get();

rows[0].embedding.length; // compiles as number[]; embedding is absent at runtime
```

A temporary type probe containing that exact alias pattern passed `npm run test:types`. The
checked-in vector test only uses the returned fluent chain, so it cannot catch the stale-alias case.

**Required before v3**

- Make `VectorQueryBuilder.select()` an immutable transition too: construct a new wrapper around the
  projected core builder and copied projection state instead of mutating/casting `this`.
- Add an alias-focused type test and a runtime unit/emulator test mirroring the core regression.
- Consider the same state-transition discipline for `findNearest()`. Its current mutation mostly
  under-types old aliases rather than over-typing them, but immutable transitions would make the
  generic state model much easier to audit.

### Finding 3 — High: an empty vector projection drops the promised distance field

Firestore supports `select()` with zero fields as an ID-only projection, and the ORM's variadic API
also permits it. `findNearest()` widens an active projection with `distanceResultField` only when
`this.selectedFields.length > 0`:

```ts
if (options.distanceResultField !== undefined && this.selectedFields.length > 0) {
  // reselect stored fields + computed distance field
}
```

That condition conflates two different states:

- no call to `select()`; and
- a valid `select()` call with zero stored fields.

The second state still has a field mask and still needs the computed distance field added. The
public return type nevertheless intersects `Record<DF, number>`, so it promises the field.

Focused emulator reproduction:

```ts
const rows = await withVectorSearch(repo)
  .query()
  .select()
  .findNearest({
    vectorField: 'embedding',
    queryVector: [1, 0, 0],
    limit: 1,
    distanceMeasure: 'EUCLIDEAN',
    distanceResultField: 'vectorDistance',
  })
  .get();
```

Expected from the type/guide: `{ id, vectorDistance }`. Actual emulator value: `{ id }`. The focused
assertion `toHaveProperty('vectorDistance')` failed.

**Required before v3**

- Track projection activity with an explicit boolean/state, not `selectedFields.length`.
- When an empty projection is active and a distance field is configured, apply a mask containing
  that computed field.
- Add a unit test that distinguishes “never selected” from “selected zero fields”, plus an emulator
  regression asserting the field exists and is numeric.

### Finding 4 — High: `distanceThreshold: 0` is accepted but silently ignored

[`validateFindNearestOptions()`](../../src/vector/VectorSearch.ts) accepts every finite threshold,
including zero. [`VectorQueryBuilder.findNearest()`](../../src/vector/VectorQueryBuilder.ts) also
correctly forwards zero because it checks `!== undefined`.

The installed `@google-cloud/firestore` 8.6.0 serializer then drops it with a truthiness test:

```js
distanceThreshold: this._options?.distanceThreshold
  ? { value: this._options?.distanceThreshold }
  : undefined;
```

Direct `toProto()` inspection confirmed that the resulting structured query has no
`distanceThreshold`. A focused emulator test seeded distances `0`, approximately `0.14`, and
approximately `1.41`; an Euclidean threshold of `0` should return only the exact vector, but the
query returned all three (`nearest`, `middle`, `far`).

Zero is semantically meaningful. The official Firestore vector-search documentation says
Euclidean/Cosine thresholds retain results whose distance is less than or equal to the configured
threshold, and cosine distance ranges from `0` to `2`:
[Firebase vector-search documentation](https://firebase.google.com/docs/firestore/vector-search#specify_a_distance_threshold).

This is upstream serialization behavior, but it is still an ORM contract bug because the public API
accepts the value without warning and returns materially broader results.

**Required before v3**

- Check whether a newer compatible Firestore/Admin SDK fixes zero serialization; upgrade and pin a
  protocol/emulator regression if it does.
- If not, reject `distanceThreshold: 0` locally with a specific error and document the upstream
  limitation rather than silently changing the query.
- Add measure-aware threshold checks where useful (`EUCLIDEAN` and `COSINE` cannot have negative
  distances; cosine's documented range is bounded), while preserving legitimate negative
  `DOT_PRODUCT` thresholds.
- File/track the serializer bug upstream.

### Finding 5 — Medium: publishing is not bound tightly enough to the intended release

The publish workflow now runs the full local gate, which is a major improvement. Two integrity gaps
remain in [`.github/workflows/publish.yml`](../../.github/workflows/publish.yml):

1. It triggers on `release: published` and immediately runs unqualified `npm publish`. GitHub's
   `published` event includes both stable releases and prereleases, while npm assigns `latest` when
   no `--tag` is supplied. There is no assertion that the GitHub tag is exactly
   `v${package.json.version}`, that the event is not a prerelease, or that the tagged commit is the
   intended release commit. A mistakenly published `v3.0.0-rc.1` release at a tree whose manifest is
   `3.0.0` would attempt to publish stable `3.0.0` as `latest`.
2. `release:verify` runs `check:consumer` only once against the default dev peer (Admin 14). The
   Admin 12/13/14 matrix exists only in pull-request CI. Consequently the “single canonical gate”
   and “PR union is definitionally equivalent” comments are not literal: the PR union is a strict
   superset, and a release/tag that did not traverse that PR matrix can still reach `npm publish`.

Official behavior references:
[GitHub release event documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#release)
and [npm publish tag documentation](https://docs.npmjs.com/cli/publish/#tag).

**Recommended before v3**

- Add a preflight that fails unless `github.event.release.prerelease == false` and
  `github.event.release.tag_name == v${package.json.version}`; optionally assert the tag commit is
  reachable from `main`.
- Use the stable-only `released` activity or route prereleases to an explicit non-`latest` npm
  dist-tag.
- Make publish depend on an Admin compatibility matrix, or provide a canonical matrix script that
  both PR and publish workflows invoke.
- Enable the commented npm GitHub Environment approval gate once configured; publishing is the one
  operation where a deliberate final approval is worth the friction.

### Finding 6 — Low: the round-2 response and API reference still contain stale contradictions

The published API reference introduces result generic `R` and correctly says `select()` narrows it,
but then documents terminal methods with full-model types:

- `get(): Promise<(T & { id })[]>`
- `getOne(): Promise<(T & { id }) | null>`
- `paginate` / `offsetPaginate` / `paginateWithCount` items as `T & { id }`
- `stream(): AsyncGenerator<T & { id }>`
- `onSnapshot(callback: (items: (T & { id })[]) => void, ...)`

Those signatures should use `R` wherever the implementation does. As written, the page contradicts
its own `select()` section and weakens the migration documentation.

The round-2 response also says the now-committed original review still needs its stale
`src/core/ErrorHandler.ts` link fixed. That link has already been converted to explanatory text plus
a valid `src/express/index.ts` link; `check:docs` passes while scanning all committed review files.
Remove this no-longer-applicable release task.

### What verified cleanly in round 2

- `safeAssign` prevents output-object prototype control in the timestamp and flattening utilities;
  the new adversarial tests are meaningful and the unit utility gate remains effectively complete.
- `hasFiniteVectorValues` is shared by core and vector recognition and correctly rejects `NaN`,
  `Infinity`, and `-Infinity` in the tested sentinel shapes.
- Core `select()` returns a distinct builder, preserves prior query clauses/order state, and leaves
  the original alias unprojected at runtime.
- A normal non-empty vector projection composes through `findNearest()` and the computed distance
  field survives the mask.
- `select().onSnapshot()` fails locally before touching the SDK.
- `query().update()` now validates empty payloads on zero matches and retains `0` for a valid patch
  with zero matches.
- The manifest check deep-compares `peerDependenciesMeta`; the audit policy, website build, runtime
  ESM/CommonJS/subpath smoke tests, and Node 22 job are wired into CI as described.
- The capability matrix honestly distinguishes Core support from deferred parity and documents a
  usable raw-SDK path back through `fromSnapshot()`.
- GitHub issues #30 through #41 are all open and each has `enhancement`, `parity`, and `v3.x`
  labels, matching ADR-0017 and the scope guide.

### Verification performed for round 2

| Check                                     | Result                                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Commit/diff audit                         | `9239283..a8c4c23`: 6 commits, 39 files, 2,774 insertions, 93 deletions                         |
| `npm run release:verify`                  | Passed end-to-end                                                                               |
| Lint + checked-in type tests              | Passed                                                                                          |
| Manifest/lockfile/meta check              | Passed                                                                                          |
| Runtime-only audit                        | 0 vulnerabilities                                                                               |
| Dual ESM/CommonJS build                   | Passed                                                                                          |
| Package allowlist                         | Passed; 74 packed files                                                                         |
| Packed consumer, Admin 14                 | Compile + runtime load passed for root, `/vector`, `/express`, ESM and CommonJS                 |
| Packed consumer, Admin 12 and 13          | Same checks passed in separate matrix-equivalent local runs                                     |
| Unit suite + path gates                   | 205/205 passed; all gates passed                                                                |
| Emulator integration suite + path gates   | 214/214 passed; all gates passed                                                                |
| Documentation link check                  | Passed; 91 Markdown/MDX files scanned                                                           |
| Website build                             | Passed; 49 pages built (with the existing missing-404-entry warning)                            |
| Release bump rehearsal                    | Passed; selected `3.0.0`                                                                        |
| Parity issue audit                        | #30–#41 open; all carry `parity` + `v3.x`                                                       |
| Temporary nested-projection type probe    | **Compiled**, demonstrating the unselected nested sibling remains statically required           |
| Temporary vector-alias type probe         | **Compiled**, demonstrating the original wrapper alias retains the full result type             |
| Temporary empty-projection emulator probe | **Failed expected contract**: result was `{ id }`, without promised `vectorDistance`            |
| Temporary zero-threshold emulator probe   | **Failed expected contract**: returned all three neighbors instead of only the distance-0 match |

The temporary probes were removed after execution. The only pre-existing uncommitted workspace
change remains the user's `.gitignore` edit; this review did not alter it.

### Revised acceptance order

Before publishing v3:

1. Make core and vector projection shapes safe for dotted paths and immutable vector aliases.
2. Fix the zero-field vector projection/distance-mask state bug.
3. Resolve or explicitly reject the upstream `distanceThreshold: 0` serialization hole.
4. Bind npm publishing to the exact stable release tag/version and include the Admin compatibility
   matrix in the publish decision.
5. Correct the API-reference `R` signatures and remove the stale release-time link instruction.
6. Rerun the full release gate, all three Admin consumers, focused type/emulator regressions, and
   the release rehearsal from the final release commit.

After those items, the remaining server-side Firestore omissions are appropriately documented v3.x
scope rather than unacknowledged v3 blockers.

---

## Round-3 response verification (July 20, 2026)

- **Reviewed branch:** `v3-release-hardening` at `0904197`
- **Previous reviewed head:** `a8c4c23`
- **Response reviewed:**
  [`v3-release-review-response-round3.md`](./v3-release-review-response-round3.md)
- **Round-3 change set:** 6 commits; 18 files; 793 insertions and 54 deletions

### Round-3 conclusion

All six findings from the prior pass are addressed in their stated scenarios. Dotted projections are
now conservatively safe, vector `select()` is immutable, the ID-only projection retains its distance
field, zero thresholds fail locally, the publish job verifies its release identity and runs all
three Admin consumers, and the API-reference terminal signatures use result generic `R`. The full
release gate passes at this head.

I found one new **high-severity vector result-shaping bug** that should still block v3:
`distanceResultField` is allowed to collide with the repository's reserved `id` or any existing
model property. The result type intersects the old property with `number`; incompatible collisions
collapse to `never`, which TypeScript permits to be assigned to either side. Runtime behavior then
disagrees in two different ways: Firestore replaces an ordinary colliding field with the numeric
distance, while the ORM's final `{ id: doc.id }` overlay replaces a computed `id` distance with the
string document ID.

There is also one medium type-quality issue worth tightening before the public v3 contract freezes:
`DeepPartial<T>` recursively maps native Firestore scalar/class values such as `Timestamp`,
`GeoPoint`, and `DocumentReference`, destroying their callable method types after a projection. The
same file already knows these are atomic `Leaf` values. Finally, three stale `Partial<T>` references
remain in source/scope documentation, and the generated changelog still describes the old shallow
projection type.

### Round-3 disposition

| Round-3 item                      | Verification result                                                                                                           | Disposition                                       |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Dotted projection soundness       | `DeepPartial<T>` makes nested siblings optional; the new type tests cover deep, multiple, parent/child, and dynamic paths.    | **Verified fixed for plain-object models**        |
| Immutable vector `select()`       | A new wrapper is returned around the projected core builder; type, unit, and emulator alias tests pass.                       | **Verified fixed**                                |
| Empty projection distance field   | Explicit `projectionActive` distinguishes ID-only projection from no projection; emulator result includes a numeric distance. | **Verified fixed**                                |
| Zero `distanceThreshold`          | Zero fails locally before the SDK; negative Euclidean/Cosine and negative dot-product behavior is tested; issue #42 exists.   | **Verified guarded**                              |
| Publish identity and Admin matrix | Tag/prerelease preflight, actionlint, branch simulations, and Admin 12/13/14 packed consumers all verify.                     | **Verified fixed for the stated policy**          |
| API-reference result signatures   | `get`, `getOne`, pagination, `stream`, and `onSnapshot` use `R`; numeric aggregate signatures are corrected.                  | **Verified fixed; minor stale references remain** |

### Finding 1 — High: `distanceResultField` collisions produce unsound result types and can lose the distance

[`VectorQueryBuilder.findNearest()`](../../src/vector/VectorQueryBuilder.ts) models a configured
distance field by intersecting it with the current result:

```ts
R & Record<DF, number>;
```

That works only when `DF` is a fresh property name. `FindNearestOptions` accepts any non-empty
string, so a caller may use an existing model key or the ORM-reserved `id`.

#### Collision with an ordinary model field

For a model containing `name: string`, this is accepted:

```ts
const rows = await vectorRepo
  .query()
  .findNearest({
    vectorField: 'embedding',
    queryVector: [1, 0, 0],
    limit: 1,
    distanceMeasure: 'EUCLIDEAN',
    distanceResultField: 'name',
  })
  .get();
```

Firestore returns `name` as the computed number, replacing the stored string. The static type is
`string & number`, which reduces to `never`. This looks restrictive, but `never` is assignable to
every type, so both of these compiled in a focused branch type probe:

```ts
const distance: number = rows[0].name;
const originalName: string = rows[0].name;
```

The second assignment promises a string even though the emulator returned a number. Code using the
assigned value as a string can therefore fail at runtime.

#### Collision with the reserved `id`

The mismatch is worse for `distanceResultField: 'id'`. Firestore supplies a numeric output field,
but [`VectorQueryBuilder.get()`](../../src/vector/VectorQueryBuilder.ts) builds every result as:

```ts
{
  ...doc.data(),
  id: doc.id,
}
```

The numeric distance is silently overwritten by the string document ID. The intersection again
reduces `id` to `never`, allowing this to compile:

```ts
const distance: number = rows[0].id;
distance.toFixed();
```

The focused emulator reproduction returned `typeof rows[0].id === 'string'`, so the promised numeric
distance is not merely mistyped; it is unavailable.

**Required before v3**

- Reject `distanceResultField: 'id'` locally because `id` is reserved and overlaid by the ORM.
- Model ordinary collisions as replacement, not intersection—for literal fields, use an equivalent
  of `Omit<R, DF> & Record<DF, number>`.
- Define a conservative policy for a dynamically typed `string` field name, which may collide with
  any model key; consider requiring a literal for strongly typed distance output.
- Add type and emulator regressions for a fresh field, a nonnumeric model-field collision, a numeric
  model-field collision, `id`, and a dotted output name. The focused dotted-name probe returned a
  literal own key such as `'metrics.distance'`, matching the current `Record<DF, number>` treatment.

### Finding 2 — Medium: `DeepPartial` destroys native Firestore value APIs

[`DeepPartial<T>`](../../src/utils/pathTypes.ts) preserves mutable array containers and `Date`, then
recursively maps every other object:

```ts
export type DeepPartial<T> = T extends (infer U)[]
  ? DeepPartial<U>[]
  : T extends Date
    ? T
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;
```

That recursive object branch includes common Firestore read values: `Timestamp`, `GeoPoint`,
`DocumentReference`, and structural vector values. Their methods are functions, and recursively
mapping a function produces an object-shaped partial rather than a callable signature. This focused
type probe behaved as follows:

```ts
declare const row: DeepPartial<{ at: Timestamp }>;

if (row.at) {
  row.at.toMillis(); // compile error: the mapped `toMillis` is no longer callable
}
```

The runtime selected value is still a complete `Timestamp`; only the new public result type makes it
unusable. This is conservative rather than unsafe, but native Firestore values are normal
server-side model fields, not an exotic case. Byte values (`Buffer`/`Uint8Array`) and readonly
arrays deserve the same review.

The file already defines `Leaf` specifically to stop recursion for `Timestamp`, `GeoPoint`,
`DocumentReference`, `FieldValue`, vector values, arrays, dates, and functions when deriving field
paths. Reusing an atomic-value definition for `DeepPartial` would keep projected maps safe without
erasing scalar APIs. Because Firestore does not project into array elements, preserving the complete
array value rather than recursively partializing each element would also more closely match runtime.

**Recommended before v3**

- Preserve all Firestore atomic/leaf value types, not only `Date`.
- Include server byte values and readonly arrays/tuples in the policy.
- Add type tests showing that a selected `Timestamp`, `GeoPoint`, `DocumentReference`, vector value,
  byte value, and array retain their normal APIs after the parent field is guarded.
- Adjust the public `DeepPartial` documentation to state exactly which values recurse and which are
  atomic.

### Finding 3 — Low: projection wording is not fully synchronized

The primary API reference and migration/query/vector guides are corrected, but these checked-in
references still say `Partial<T>`:

- [`src/core/QueryBuilder.ts`](../../src/core/QueryBuilder.ts) class JSDoc;
- [`src/vector/VectorQueryBuilder.ts`](../../src/vector/VectorQueryBuilder.ts) result-shape comment;
- [Scope & Capabilities](../../website/src/content/docs/guides/scope-and-capabilities.md) capability
  table.

The `release:bump:dry` output also still generates the earlier breaking-change text saying projected
reads return `Partial<T> & { id }`. Changelog curation is already a declared release-time task; it
should explicitly replace that text with `DeepPartial<T> & { id }` and include the later immutable
vector `select()` break.

### What verified cleanly in round 3

- Core dotted projections no longer permit an unselected nested sibling to be dereferenced after
  guarding the parent map.
- Core and vector projections use the same exported `DeepPartial<T>` result contract.
- Vector `select()` returns a distinct wrapper and leaves the ignored original alias unprojected at
  both type and runtime.
- An empty vector `select()` widens the field mask with the configured distance field and returns
  only `{ id, distance }` as intended.
- `distanceThreshold: 0` now throws a clear local error instead of reaching the affected SDK
  serializer; the negative-threshold policy matches the three measures.
- [Issue #42](https://github.com/reggieofarrell/firestore-orm/issues/42) is open and records the
  serializer evidence, interim guard, and future upgrade work with `bug`, `parity`, and `v3.x`
  labels.
- The publish preflight reads release fields through environment variables, accepts the exact stable
  tag, rejects prerelease and mismatched-tag simulations, and passes `actionlint`.
- The publish workflow runs the packed consumer sequentially for Admin 12, 13, and 14 after the
  canonical release verification.
- API-reference terminal signatures use `R`, and `sum`/`average` document
  `NumericFieldPaths<T> | FieldPath`.
- The obsolete ErrorHandler release-time task is removed.

### Verification performed for round 3

| Check                                     | Result                                                                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Commit/diff audit                         | `a8c4c23..0904197`: 6 commits, 18 files, 793 insertions, 54 deletions                                                   |
| `npm run release:verify`                  | Passed end-to-end                                                                                                       |
| Lint + checked-in type tests              | Passed                                                                                                                  |
| Manifest/lockfile/meta check              | Passed                                                                                                                  |
| Runtime-only audit                        | 0 vulnerabilities                                                                                                       |
| Dual ESM/CommonJS build                   | Passed                                                                                                                  |
| Package allowlist                         | Passed; 74 packed files                                                                                                 |
| Packed consumer, Admin 14                 | Compile + runtime load passed for root, `/vector`, `/express`, ESM and CommonJS                                         |
| Packed consumer, Admin 12 and 13          | Same checks passed in separate matrix-equivalent runs                                                                   |
| Unit suite + path gates                   | 211/211 passed; all gates passed                                                                                        |
| Emulator integration suite + path gates   | 216/216 passed; all gates passed                                                                                        |
| Documentation link check                  | Passed; 92 Markdown/MDX files scanned                                                                                   |
| Website build                             | Passed; 49 pages built (same missing-404-entry warning)                                                                 |
| Workflow validation                       | `actionlint` passed; exact-tag accepted; prerelease and mismatch simulations rejected                                   |
| Release bump rehearsal                    | Passed; selected `3.0.0`                                                                                                |
| Threshold issue audit                     | #42 open with `bug`, `parity`, and `v3.x` labels                                                                        |
| Temporary result-collision type probe     | **Compiled unsafely**: colliding `name` assignable to both `string` and `number`; colliding `id` assignable to `number` |
| Temporary result-collision emulator probe | Ordinary `name` collision returned a number; reserved `id` collision returned the string document ID                    |
| Temporary native-leaf type probe          | Confirmed projected `Timestamp.toMillis()` loses its callable type under `DeepPartial`                                  |

The temporary probes were removed after execution. The only other uncommitted workspace change is
the user's existing `.gitignore` edit, which this review leaves untouched.

### Revised acceptance order after round 3

Before publishing v3:

1. Reject the reserved `id` distance-result name and make ordinary distance-field collisions replace
   the prior property in the result type instead of intersecting to `never`.
2. Preserve native Firestore leaf/scalar APIs through `DeepPartial` and add focused type coverage.
3. Replace the remaining stale `Partial<T>` source/doc references and curate the generated changelog
   wording.
4. Rerun the full release gate, all three packed Admin consumers, collision/leaf regressions,
   workflow validation, and the release rehearsal from the final commit.

After those changes, I would consider the round-1 through round-3 implementation and release
engineering findings closed. The intentionally deferred server-side parity work remains properly
tracked as v3.x scope.

---

## Round-4 response verification (July 20, 2026)

- **Reviewed branch:** `v3-release-hardening` at `b9be1fa`
- **Previous implementation head reviewed:** `0904197`
- **Response reviewed:**
  [`v3-release-review-response-round4.md`](./v3-release-review-response-round4.md)
- **Response implementation commits:** `ab89b94`, `eb55f03`, and `3eadeab`
- **Full change set since the previous implementation head:** 4 commits; 11 files; 483 insertions
  and 26 deletions (including `b9be1fa`, which commits the preceding review record)

### Round-4 conclusion

The three reported fixes are real in the exact cases covered by the response. A literal
`distanceResultField: 'name'` now replaces `name` with `number` in the result type, the reserved
literal `id` is rejected before Firestore execution, directly declared native Firestore values keep
their APIs through `DeepPartial`, and the identified public `Partial<T>` wording was mostly synced.
The complete release gate and all three declared Firebase Admin packed consumers pass at this head.

I would still **not publish v3 from this exact type contract**. The replacement utility has a new
high-severity broad-string case: when `distanceResultField` comes from an ordinary `string`
variable, `Omit<R, string> & Record<string, number>` erases every known string key and promises that
all string properties are numeric. It therefore types the always-string repository `id` as `number`,
along with unchanged model fields. This is a normal abstraction pattern—options frequently come from
a helper or configuration—rather than a contrived cast.

The `DeepPartial` fix also remains incomplete for unions mixing an atomic Firestore value with a
map. The deliberately non-distributive `IsLeaf` check classifies the whole union as non-leaf, then
maps the Firestore class. The same helper allows `FieldPaths` to descend into class API members; a
focused probe accepted the nonsensical stored path `'value.toMillis'`. In addition, the
implementation does not actually detect “plain objects”: arbitrary class instances produced by the
library's first-class `readConverter` seam are recursively mapped and lose guaranteed methods.

Finally, the response says the guide/JSDoc recommends literal distance names, but no such guidance
is present. The vector guide still shows the pre-replacement intersection formula, and a type-test
comment still states the old shallow projection type.

### Round-4 disposition

| Round-4 item                         | Verification result                                                                                                                         | Disposition                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Literal distance-field replacement   | `Omit<R, DF> & Record<DF, number>` matches the emulator's overwrite for a literal colliding model key.                                      | **Verified fixed for literal field names**               |
| Reserved `distanceResultField: 'id'` | Validation rejects it before constructing the SDK vector query; unit and emulator paths pass.                                               | **Verified fixed at runtime**                            |
| Native leaf preservation             | Direct `Timestamp`, `GeoPoint`, `DocumentReference`, `Uint8Array`/`Buffer`, dates, arrays, and structural vectors are atomic.               | **Verified for direct leaf fields; mixed unions remain** |
| Stale `Partial<T>` cleanup           | QueryBuilder and scope documentation are corrected; one false checked-in test comment remains, plus incomplete vector-result documentation. | **Mostly fixed**                                         |
| Claimed release verification         | Canonical gate, Admin 12/13/14 consumers, docs, website, workflow lint, and release rehearsal all pass.                                     | **Verified**                                             |

### Finding 1 — High: a dynamic distance-field name turns every result property into `number`

[`VectorQueryBuilder.findNearest()`](../../src/vector/VectorQueryBuilder.ts) and the exported
[`VectorSearchResult`](../../src/vector/VectorSearch.ts) now use the right replacement operation for
a literal field:

```ts
DF extends string ? Omit<R, DF> & Record<DF, number> : R;
```

The conditional does not distinguish a literal such as `'score'` from the broad `string` type. For
`DF = string`, TypeScript evaluates the result as:

```ts
Omit<R, string> & Record<string, number>;
```

`Omit<R, string>` removes every string-named property from an ordinary object result. The remaining
index signature then promises that **every** string-named property is a number. This focused type
probe passed without an error:

```ts
async function search(distanceField: string) {
  const rows = await vectorRepo
    .query()
    .findNearest({
      vectorField: 'embedding',
      queryVector: [0.1, 0.2, 0.3],
      limit: 1,
      distanceMeasure: 'COSINE',
      distanceResultField: distanceField,
    })
    .get();

  const idAsNumber: number = rows[0].id; // compiled
  const nameAsNumber: number = rows[0].name; // compiled
}
```

At runtime, use of a fresh value such as `distanceField = 'score'` returns the normal string
document `id`, the normal string `name`, and a numeric `score`. Calling `toFixed()` on either known
field is therefore permitted statically and fails at runtime. The new `id` validator does not help:
it prevents the _runtime value_ `'id'`, but the compiler still sees a broad `string` while the
actual value may safely be `'score'`.

This also affects consumers who directly instantiate the exported `VectorSearchResult<T, string>`
type. The response characterizes this as a broad/degraded shape and says the guide/JSDoc recommends
a literal. The current shape is not merely broad—it is confidently wrong—and the claimed literal
guidance is absent from both the vector guide and the public option JSDoc.

**Required before v3**

- Add a `string extends DF` branch before literal replacement handling.
- Preserve `id` as its repository ID type for a broad field name, because successful calls can never
  use the rejected exact value `'id'`.
- Treat every other known result field as potentially its original type **or** `number`, since the
  runtime name may collide with any one of them; arbitrary dynamic-key access should be conservative
  (`unknown` or an equivalent safe shape), not universally numeric.
- Alternatively, make the strongly typed overload accept literal distance names only and provide a
  separately documented conservative overload for runtime strings.
- Apply the same policy to `VectorSearchResult`, and consider resolving literal `'id'` to `never` so
  the exported type cannot describe a successful result forbidden by runtime validation.
- Add checked-in tests for a plain `string`, `string | undefined`, a union of literal names, an
  extracted/pretyped options object, and the direct exported result type. The broad-string test must
  reject both `rows[0].id.toFixed()` and an unconditionally numeric model-field assignment.

One possible conservative shape for the broad branch is conceptually:

```ts
{
  [K in keyof R]: K extends 'id' ? R[K] : R[K] | number;
} & Record<string, unknown>
```

The exact utility may differ, but it must not promise that all known properties became numbers.

### Finding 2 — Medium: leaf handling is not distributive and “plain object” handling is not implemented

[`IsLeaf<V>`](../../src/utils/pathTypes.ts) intentionally wraps `V` in a tuple:

```ts
type IsLeaf<V> = [V] extends [Leaf] ? true : false;
```

That is useful when asking whether an entire union consists only of leaves, but it does not preserve
each leaf member when a field can be either a leaf or a map. For example:

```ts
type MigratingValue = Timestamp | { legacy: string };
type Projected = DeepPartial<{ value: MigratingValue }>;
```

Because `{ legacy: string }` is not a `Leaf`, `IsLeaf<MigratingValue>` is false. The following
`T extends object` branch distributes, but by then both branches take the recursive mapped-object
path. The `Timestamp` member becomes an object with optional class members instead of staying a
complete `Timestamp`. A temporary test confirmed that the projected value was no longer assignable
to `Timestamp | { legacy?: string }`.

The same classification leaks class implementation members into `FieldPaths`. This invalid path
compiled in the focused probe:

```ts
const path: FieldPaths<{ value: Timestamp | { legacy: string } }> = 'value.toMillis';
```

`toMillis` is a TypeScript method, not a queryable nested Firestore field. The map branch should
contribute `'value.legacy'`, while the `Timestamp` branch should contribute no child paths.

There is a second limitation behind the JSDoc statement that “only plain (map) objects recurse.” No
plain-object test exists in the type. Every object not explicitly enumerated in `Leaf` recurses. A
custom class returned by a `readConverter`, for example, has its methods made optional:

```ts
class ConvertedValue {
  normalized(): string {
    return '...';
  }
}

declare const row: DeepPartial<{ value: ConvertedValue }>;
row.value?.normalized(); // compile error: normalized may be undefined
```

Arbitrary converted read models are part of the documented repository contract, so this is not
limited to unsupported Firestore storage types.

**Recommended before v3**

- Make the `DeepPartial` leaf test distributive per union member—for example, route each member
  through `T extends Leaf ? T : ...` rather than deciding the whole union up front.
- In `FieldPaths`, filter leaf members out of a union before recursing into the remaining map
  members; do not expose SDK/class methods as Firestore paths.
- Add mixed-union tests for `Timestamp | map`, `Date | map`, array/byte | map, and two map variants.
- Either implement a conservative strategy for converter-produced class instances (for example,
  preserve method-bearing objects), provide an explicit atomic-type escape hatch, or narrow the
  public documentation from “only plain objects recurse” to the actual enumerated-leaf behavior and
  document the limitation. Given the prominence of `readConverter`, preserving such instances is
  preferable before freezing v3.

### Finding 3 — Low: the final projection/vector wording is still inconsistent

The response correctly updates QueryBuilder's class JSDoc and the Scope & Capabilities table. These
remaining statements should be synchronized:

- [`query-paths.type-test.ts`](../../src/tests/types/query-paths.type-test.ts) still says the
  projected result “narrows to `Partial<Doc> & { id }`.” This describes the asserted contract and is
  false; it is not merely the valid contrastive use of `Partial<T>` elsewhere in the file.
- The [vector-search guide](../../website/src/content/docs/guides/vector-search.md) still
  illustrates result composition as `DeepPartial<T> & { id } & { [distanceResultField]: number }`.
  It should describe replacement on a collision, the reserved `id` rejection, and the eventual
  conservative broad-string behavior.
- The same guide and [`FindNearestOptions`](../../src/vector/VectorSearch.ts) do not contain the
  response's claimed recommendation to preserve a string literal for precise result typing.
- The [API reference](../../website/src/content/docs/guides/api-reference.md) says only that arrays
  and `Date` are preserved by `DeepPartial`; once the union/class policy is settled, document the
  complete public atomic-value contract there as well.

The generated `3.0.0` changelog continues to say `Partial<T> & { id }`. The response explicitly
retains this as a release-time curation task, and the rehearsal now does include the later immutable
`select()` and distance-collision breaking entries. That deferral is acceptable only if the final
curation checklist is executed before the version commit/tag.

### What verified cleanly in round 4

- A literal collision with a nonnumeric model field is typed as the numeric distance rather than
  `never`, and the emulator returns the expected number.
- Exact `distanceResultField: 'id'` is rejected synchronously before touching Firestore.
- The exported `VectorSearchResult` uses replacement typing for literal distance fields.
- Direct native leaf fields retain their normal APIs after projection: `Timestamp.toMillis()`,
  `GeoPoint.latitude`, `DocumentReference.id`, byte length, date methods, and array elements all
  type-check after guarding the optional parent field.
- `Uint8Array` makes Node `Buffer` atomic through its subtype relationship.
- Arrays remain whole, matching Firestore field-mask behavior.
- The remaining source JSDoc and public capability-table references identified in round 3 now use
  `DeepPartial`.
- Unit, integration, coverage, package, consumer, documentation, website, audit, workflow-lint, and
  release-rehearsal checks all pass.

### Verification performed for round 4

| Check                                      | Result                                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Commit/diff audit                          | `0904197..b9be1fa`: 4 commits, 11 files, 483 insertions, 26 deletions                                          |
| `npm run release:verify`                   | Passed end-to-end                                                                                              |
| Lint + checked-in type tests               | Passed                                                                                                         |
| Manifest/lockfile/meta check               | Passed                                                                                                         |
| Runtime-only audit                         | 0 vulnerabilities                                                                                              |
| Dual ESM/CommonJS build                    | Passed                                                                                                         |
| Package allowlist                          | Passed; 74 packed files                                                                                        |
| Packed consumer, Admin 14                  | Compile + runtime load passed for root, `/vector`, `/express`, ESM and CommonJS                                |
| Packed consumer, Admin 12 and 13           | Same checks passed in separate matrix-equivalent runs                                                          |
| Unit suite + path gates                    | 212/212 passed; all gates passed                                                                               |
| Emulator integration suite + path gates    | 218/218 passed; all gates passed                                                                               |
| Documentation link check                   | Passed; 93 Markdown/MDX files scanned                                                                          |
| Website build                              | Passed; 49 pages built (same missing-404-entry warning)                                                        |
| Workflow validation                        | `actionlint` passed                                                                                            |
| Release bump rehearsal                     | Passed; selected `3.0.0`; generated projection entry still requires the declared `DeepPartial` curation        |
| Temporary dynamic-distance type probe      | **Compiled unsafely**: both the string `id` and unchanged `name` were assignable to `number` for `DF = string` |
| Temporary mixed-leaf `DeepPartial` probe   | Confirmed a mixed Timestamp/map field no longer preserved the complete `Timestamp` branch                      |
| Temporary mixed-leaf `FieldPaths` probe    | **Compiled invalid path**: accepted `'value.toMillis'` as a stored Firestore field path                        |
| Temporary converter-class projection probe | Confirmed an arbitrary read-model class method became optional/non-callable after projection                   |

The temporary probes were removed after execution. The user's existing `.gitignore` edit remains the
only other uncommitted workspace change and was not modified by this review.

### Revised acceptance order after round 4

Before publishing v3:

1. Make broad/dynamic distance-result names conservative in both builder inference and the exported
   result utility; retain the correct literal replacement behavior and reserved-ID guard.
2. Make leaf preservation union-distributive for both `DeepPartial` and `FieldPaths`, and decide the
   documented behavior for custom class instances returned by read converters.
3. Correct the remaining test/source-guide wording and perform the already-declared changelog
   curation.
4. Add the focused broad-string and mixed-union regression tests, then rerun the canonical release
   gate, Admin 12/13/14 consumers, workflow validation, and version rehearsal from the final commit.

Once the high broad-string issue and the mixed-union type contract are fixed, I would consider the
implementation findings from rounds 1–4 closed. The deferred server-side Firestore parity work can
remain in its existing v3.x issue/ADR scope.

---

## Round-5 response verification (July 20, 2026)

- **Reviewed branch:** `v3-release-hardening` at `6e9f655`
- **Previous implementation head reviewed:** `b9be1fa`
- **Response reviewed:**
  [`v3-release-review-response-round5.md`](./v3-release-review-response-round5.md)
- **Response implementation commits:** `ef32cda`, `cc10058`, and `e7c636d`
- **Full change set:** 4 commits; 9 files; 550 insertions and 33 deletions (including `6e9f655`,
  which commits the preceding round-4 verification)

### Round-5 conclusion

The response resolves the previous high-severity vector result bug. Literal distance fields still
replace collisions precisely; broad `string` fields now preserve `id`, make other known properties
original-type-or-number, and expose arbitrary keys as `unknown`. Extracted/pretyped options,
optional strings, literal unions, and the exported `VectorSearchResult` all behave conservatively in
focused type probes.

The union-distributive `DeepPartial` and `FieldPaths` fixes also work as stated. A directly declared
`Timestamp | map` preserves the complete `Timestamp` branch, valid map-member paths remain
available, and class methods such as `toMillis` are no longer emitted as Firestore paths. The custom
`readConverter` class-instance limitation is conservative rather than unsound and is now disclosed.

One adjacent **medium-severity public path-type defect remains**. `FieldPaths` now distributes over
union members, but the exported `PathValue` does not. A path newly and correctly admitted from one
union branch therefore resolves to `never`. `NumericFieldPaths` then evaluates that concrete `never`
as extending `number`, causing `sum()` and `average()` to accept string-valued paths from union
branches. A checked probe compiled `sum('metric.label')` for a field whose present value is a
string. This should be corrected before v3 freezes the type-safe field-path contract.

There is also a small documentation contradiction around arbitrary class instances: the API
reference and one test comment still say only plain maps recurse, immediately before acknowledging
that an unrecognized class also recurses. The limitation itself is acceptable if described precisely
and with actionable guidance.

### Round-5 disposition

| Round-5 item                          | Verification result                                                                                                                      | Disposition                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Broad-string distance result          | Known fields are conservative, `id` remains a string, arbitrary-key access is `unknown`, and extracted options retain the same behavior. | **Verified fixed**                                      |
| Literal/union distance result         | Fresh and colliding literals remain precise; literal unions describe only the possible successful result branches.                       | **Verified fixed**                                      |
| Distributive `DeepPartial` leaves     | Known leaf members remain complete when mixed with map members.                                                                          | **Verified fixed**                                      |
| Map-only `FieldPaths` recursion       | Valid map paths remain; Timestamp/class API members are excluded.                                                                        | **Verified fixed; exposed a `PathValue` follow-on bug** |
| Arbitrary converter-produced classes  | Still recursively partialized, but conservatively and now documented.                                                                    | **Accepted residual; wording needs tightening**         |
| Literal guidance and stale references | Vector guide, option JSDoc, API reference, and prior shallow test comment were updated.                                                  | **Verified, with one contradictory phrase remaining**   |
| Claimed release verification          | Canonical gate, Admin 12/13/14 consumers, docs, website, workflow lint, and release rehearsal pass.                                      | **Verified**                                            |

### Finding 1 — Medium: `PathValue` does not follow `FieldPaths` through unions, making string paths numeric

[`FieldPaths<T>`](../../src/utils/pathTypes.ts) now correctly removes leaf members before recursing
into a union's map members:

```ts
Exclude<NonNullable<T[K]>, Leaf>;
```

For this model, it correctly includes both `value` and `value.legacy` while excluding
`value.toMillis`:

```ts
type Model = {
  value: Timestamp | { legacy: string };
};
```

However, the exported [`PathValue<T, P>`](../../src/utils/pathTypes.ts) still checks a union as a
whole:

```ts
export type PathValue<T, P extends string> = P extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? PathValue<NonNullable<T[Head]>, Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never;
```

At the recursive step, `T` is `Timestamp | { legacy: string }`. `keyof` for that union contains only
keys common to every member, so `'legacy'` does not pass the check and the otherwise valid path
resolves to `never`:

```ts
const path: FieldPaths<Model> = 'value.legacy'; // compiles correctly
const value: PathValue<Model, 'value.legacy'> = 'old'; // compile error: value type is never
```

This is already a public API inconsistency because both helpers are exported together and
`PathValue` is documented as resolving a valid field path. It also opens an unsound aggregate path
through the internal `NumericFieldPaths`:

```ts
export type NumericFieldPaths<T> = {
  [P in FieldPaths<T>]: NonNullable<PathValue<T, P>> extends number ? P : never;
}[FieldPaths<T>];
```

For a concrete `never`, the conditional `never extends number` selects the true branch. Every
union-member path that `PathValue` failed to resolve is therefore classified as numeric, regardless
of its actual value:

```ts
const schema = z.object({
  id: z.string(),
  metric: z.union([z.object({ count: z.number() }), z.object({ label: z.string() })]),
});

const repo = FirestoreRepository.withSchema(db, 'mixed', schema);
repo.query().sum('metric.count'); // expected
repo.query().sum('metric.label'); // also compiled; label is string when present
```

The temporary type probe also directly assigned both `'metric.count'` and `'metric.label'` to
`NumericFieldPaths<Model>`, confirming this is the derived type rather than overload inference or a
`FieldPath` escape hatch.

**Required before v3**

- Make `PathValue` distributive over `T`, so each union member contributes its value when the path
  exists and contributes `never` when it does not. A small helper with a naked `T extends unknown`
  branch is sufficient; the resulting union should collapse to the actual reachable value types.
- Explicitly exclude an unresolved `never` before the numeric check instead of relying on
  `never extends number` behavior.
- Preserve the existing rule that a path whose resolved non-null value is a mixed `number | string`
  is not numeric.
- Add type regressions for a top-level union, nested map unions, leaf-or-map unions, optional/null
  members, numeric and string branch-specific paths, and mixed-value paths.
- Exercise `sum()` and `average()` through the public builder in addition to testing the helper
  aliases directly.

Conceptually, the missing guards are:

```ts
type PathValue<T, P extends string> = T extends unknown
  ? /* resolve P against this member */
  : never;

type NumericPath<T, P extends FieldPaths<T>> = [PathValue<T, P>] extends [never]
  ? never
  : NonNullable<PathValue<T, P>> extends number
    ? P
    : never;
```

The precise implementation can differ, but `FieldPaths<T>` and `PathValue<T, P>` must agree on which
union branches contribute to a path.

### Finding 2 — Low: arbitrary-class documentation remains internally contradictory

The response appropriately chooses conservative treatment for arbitrary class instances returned as
read-model field values. TypeScript's structural type system cannot reliably distinguish every class
instance from a map-shaped object, and making methods optional is safer than preserving possibly
unselected map siblings.

Two statements still overclaim the implementation:

- The [API reference](../../website/src/content/docs/guides/api-reference.md) says “Only plain map
  objects recurse,” then says a custom class that is not a known leaf also recurses.
- [`query-paths.type-test.ts`](../../src/tests/types/query-paths.type-test.ts) retains the comment
  “`DeepPartial` only recurses into plain (map) objects.”

The source implementation has no plain-object predicate; it recurses into **every object not
assignable to the private `Leaf` union**. The source JSDoc states that more accurately. The wording
should use the same rule everywhere.

The phrase “a `?.` guard restores” a custom class method also deserves precision. Guarding only the
optional field does not make a recursively optional method callable:

```ts
row.value?.normalized(); // still an error: normalized may be undefined
row.value?.normalized?.(); // compiles by guarding the method too
```

Finally, “treat that field as atomic” is not directly actionable because `Leaf` is private and there
is no public marker or atomic-type parameter. Either describe the available assertion/conversion
workaround explicitly, or consider an opt-in marker/escape hatch in a later minor release. This is a
documented conservative limitation, not a v3 release blocker.

### What verified cleanly in round 5

- A broad `string` distance field no longer turns `id` or every model property into `number`.
- Known non-ID fields in the broad case become original-type-or-number, preserving required/optional
  modifiers from the current result shape.
- Arbitrary broad-string access is `unknown`, preventing a false universal numeric promise.
- A pretyped `FindNearestOptions` object takes the same conservative result branch.
- `string | undefined` combines the conservative and no-distance result safely.
- Literal distance fields retain replacement typing; colliding fields become required numbers.
- Literal unions distribute through the builder/exported result type, and reserved `id` contributes
  no successful result branch.
- `DeepPartial` now distributes its leaf test per union member.
- `FieldPaths` recurses only into the non-leaf/map members of a mixed union and rejects
  `'value.toMillis'`.
- The vector guide and `FindNearestOptions` JSDoc now contain the previously missing literal-name
  recommendation and accurately describe broad-string result behavior.
- The canonical release gate and all declared Admin peer consumers pass.

### Verification performed for round 5

| Check                                    | Result                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Commit/diff audit                        | `b9be1fa..6e9f655`: 4 commits, 9 files, 550 insertions, 33 deletions                                    |
| `npm run release:verify`                 | Passed end-to-end                                                                                       |
| Lint + checked-in type tests             | Passed                                                                                                  |
| Manifest/lockfile/meta check             | Passed                                                                                                  |
| Runtime-only audit                       | 0 vulnerabilities                                                                                       |
| Dual ESM/CommonJS build                  | Passed                                                                                                  |
| Package allowlist                        | Passed; 74 packed files                                                                                 |
| Packed consumer, Admin 14                | Compile + runtime load passed for root, `/vector`, `/express`, ESM and CommonJS                         |
| Packed consumer, Admin 12 and 13         | Same checks passed in separate matrix-equivalent runs                                                   |
| Unit suite + path gates                  | 212/212 passed; all gates passed                                                                        |
| Emulator integration suite + path gates  | 218/218 passed; all gates passed                                                                        |
| Documentation link check                 | Passed; 94 Markdown/MDX files scanned                                                                   |
| Website build                            | Passed; 49 pages built (same missing-404-entry warning)                                                 |
| Workflow validation                      | `actionlint` passed                                                                                     |
| Release bump rehearsal                   | Passed; selected `3.0.0`; generated projection entry still requires the declared `DeepPartial` curation |
| Temporary extracted-options vector probe | Verified `id` stays string and broad known fields are conservative                                      |
| Temporary union `PathValue` probe        | **Failed contract**: a valid `'value.legacy'` path resolved to `never`                                  |
| Temporary numeric union-path probe       | **Compiled unsafely**: `NumericFieldPaths` and `sum()` accepted string-valued `'metric.label'`          |
| Temporary reserved-ID union result probe | Verified the exported result describes only the possible successful non-ID branch                       |

The temporary probes were removed after execution. The user's existing `.gitignore` edit remains the
only other uncommitted workspace change and was not modified by this review.

### Revised acceptance order after round 5

Before publishing v3:

1. Make `PathValue` distribute over union members and explicitly reject unresolved `never` values
   from `NumericFieldPaths`.
2. Add direct `PathValue`, numeric-helper, `sum`, and `average` regression coverage for union-backed
   paths.
3. Replace the two remaining “only plain map” claims with the actual known-leaf rule and make the
   custom-class workaround precise.
4. Perform the declared changelog curation, then rerun the canonical release gate, Admin 12/13/14
   consumers, workflow validation, and version rehearsal from the final commit.

After the union path-value/aggregate fix, I would consider the implementation findings from rounds
1–5 closed. The intentionally deferred server-side Firestore parity features remain appropriately
tracked for v3.x.
