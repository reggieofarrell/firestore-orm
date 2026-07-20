# Review of the response to the v3 release review

**Review date:** July 19, 2026  
**Reviewed branch:** `v3-release-hardening` at `9239283`  
**Compared against:** `main` / `origin/main` at `e9ab34c`  
**Response reviewed:** [`v3-release-review-response.md`](./v3-release-review-response.md)  
**Original review:** [`v3-release-review.md`](./v3-release-review.md)

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
