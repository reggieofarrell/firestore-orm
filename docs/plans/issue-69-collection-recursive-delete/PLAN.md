# Issue #69 — Collection-wide recursive delete

**Implementer:** unassigned · **Reviewer:** unassigned · **Baseline:** `main` @ `75aa6ea`
(`feat(repository): add opt-in write metadata (#72) (#85)`) · **Branch:**
`plan/issue-69-collection-recursive-delete` — already created and pushed with this plan; check it
out, do not cut a new branch

**Issue:** [#69](https://github.com/reggieofarrell/firestore-orm/issues/69) — labels `enhancement`,
`parity`, `v3.x`. This is a separately tracked follow-up to ADR-0017 issue #38 rather than one of
the original `#35–#41` living-index items; §9 records the resulting ADR carve-out precisely.

> **Acceptance (verbatim issue body; the issue has no separately headed acceptance list):** “#38
> shipped document-scoped `repo.recursiveDelete(id)`. The SDK's `Firestore.recursiveDelete()` also
> accepts a `CollectionReference`, verified working against the emulator: it deletes every document
> in the collection plus all nested subcollections, and correctly spares a collection whose id merely
> *prefixes* the target (the null-byte upper bound in `recursive-delete.js`). This fills a real gap —
> `query().get()` + `bulkDelete` leaves orphaned subcollections behind — but it is the most destructive
> call the library could expose, so it was held out of #38 deliberately (ADR-0032, alternatives).
> Decide the guard (a distinct method name, a required confirmation option, or nothing) before
> implementing.”

---

## §0 How to use this plan

1. Read §1 and §4 before editing. D1–D4 are settled for this handoff; do not re-litigate them.
2. Re-run the committed SDK probe from the repository root:

   ```bash
   npx firebase emulators:exec --project demo-firestoreorm-test --only firestore "node docs/plans/issue-69-collection-recursive-delete/probes/sdk-collection-recursive-delete.mjs"
   ```

   Expected: exit 0; both target states are `{ direct: 0, grandchildExists: false }`; both
   prefix-sibling states remain `{ direct: 2, grandchildExists: true }`; `parentExists` is `true`.
   The three `undefined` results are intentionally omitted by `JSON.stringify` and are separately
   asserted inside the probe.
3. §6 is copy-verbatim. Its exact method body compiled under `npm run test:types` in a temporary
   `src/__issue69_plan_spec.ts`, then that scratch file was removed (§12). This was not a full source
   prototype; §5 states the resulting bound.
4. Follow the `plan-execution` skill. Add the permanent tests in §8, prove every new test fails on
   the unfixed baseline, and commit `notes.md` with deviations, mutation evidence, gate output, and
   the independent refute-first self-review.
5. Leave this directory in the PR through external review. Only after approval should the final
   cleanup commit delete the complete directory (§11).

## §1 Owner-approved decisions

Settled — do not re-litigate during implementation.

| Id | Fork | Decision | Rejected alternative and why |
| --- | --- | --- | --- |
| **D1** (owner-approved 2026-08-01) | Destructive-call guard | Add the distinct zero-argument method `recursiveDeleteCollection(): Promise<void>`. The explicit, collection-naming verb is the opt-in. | Overloading `recursiveDelete()` with no argument makes an accidentally omitted document id select the maximally destructive behavior. A generic name/no guard hides collection scope. |
| **D2** (owner-approved 2026-08-01) | Confirmation ceremony | Do not add a `confirm`, `force`, or literal-token option. | ADR-0032:101-102 already rejects a magic recursive-delete confirmation flag as ceremony; a distinct method name is the durable signal in source, types, logs, and autocomplete. |
| **D3** (derived from existing contract) | Hooks/result/error behavior | Match document-scoped `recursiveDelete`: no lifecycle hooks, `Promise<void>`, empty collection resolves, partial failure rejects as a whole-call error, and retry is safe. | Returning a count would invent information the SDK does not provide; hooks cannot honestly model arbitrary descendant repositories or payloads (R2/R3/R5). |
| **D4** (derived from existing SDK-lifecycle decision) | SDK delegation | Pass the raw repository `CollectionReference` directly to `this.db.recursiveDelete`; do not construct a custom `BulkWriter` or reimplement the descendant query. | A supplied writer is flushed but not closed, creating lifecycle risk; reimplementing the SDK's null-byte upper bound can silently delete prefix-sharing collections (R4/R5/R6). |

## §2 Scope and scope correction

### In scope

| Area | Change |
| --- | --- |
| Public repository API | Add `recursiveDeleteCollection(): Promise<void>` to `FirestoreRepository`, adjacent to document-scoped `recursiveDelete(id)`. |
| Runtime | Delegate `this.writeCol()` to Admin SDK `Firestore.recursiveDelete`, preserve error normalization, and run no hooks. |
| Permanent regression guards | Type-contract coverage and emulator tests for root/nested collection scope, descendants, prefix siblings, parent survival, idempotency, return shape, and no hooks. |
| Consumer documentation | Update the repository reference, capability matrix, CRUD guide, lifecycle-hooks guide, and performance guide. |
| Durable decision record | Add ADR-0038, amend ADR-0032 and ADR-0017 without rewriting historical snapshots, and update the ADR index. |

### Explicitly out of scope

- Document-scoped `recursiveDelete(id)` behavior/signature: retain it exactly (R1/R2).
- Query-wide and collection-group-wide deletion: those have different identity/hook contracts and
  do not represent one concrete repository collection (R9/R10).
- A count, per-document result list, `withMetadata`, custom throttling, retry callbacks, or a
  caller-owned `BulkWriter`: the SDK returns only `Promise<void>` and D3/D4 reject invented surface
  area (R3/R4).
- Transaction and read-only transaction interfaces: collection recursive delete performs I/O
  outside the transaction, so it remains absent from `ReadOnlyTransactionalRepository` (R8).
- New hooks or hook payload types: descendants can cross unmodeled collections and the SDK selects
  names only (R2/R5).
- `src/index.ts`, `src/vector/index.ts`, the Express adapter, error classes/mappings, and frozen
  `website/src/content/docs/2.0/**`: no new named export/type/error/subpath is introduced (R9-R12).
- README installation, pitch, peer dependencies, or quick start: the method is reference-guide
  material and neither README currently mentions recursive delete (R13).

### Scope correction

The issue body accurately identifies the SDK capability but does not enumerate the current public
surface. On baseline `75aa6ea`, the required consumer sweep includes five Starlight pages, the
read-only transaction negative type surface, the vector proxy (verified unaffected), ADR-0032's
explicit deferral, and ADR-0017's historical follow-up text. The issue's earlier emulator assertion
was re-run rather than trusted (P1-P5).

## §3 Verified facts

### 3.1 Emulator behavior — `probes/sdk-collection-recursive-delete.mjs`

Executed against the local Firestore emulator with installed `firebase-admin@14.2.0`.

| Id | Expression / condition | Observed | Consequence |
| --- | --- | --- | --- |
| **P1** | `db.recursiveDelete(rootCollection)` | Target direct size `0`; grandchild absent | A `CollectionReference` deletes every direct document and deeper descendants. |
| **P2** | Root collection whose id is `target + '_prefix'` | Direct size `2`; grandchild present | The SDK's collection-prefix range does not consume a longer prefix sibling. |
| **P3** | `db.recursiveDelete(nestedCollection)` | Nested target direct size `0`; grandchild absent | The same behavior works for a subcollection repository path. |
| **P4** | Parent document and nested prefix sibling after P3 | Parent exists; sibling direct size `2`; grandchild present | The target is the concrete collection, not its parent document or similarly named sibling. |
| **P5** | Return from root, nested, and repeated empty-target calls | All strictly equal `undefined` | The runtime contract is `Promise<void>`; an empty/repeated target resolves. |

### 3.2 SDK declaration and implementation

| Id | File:line | Verified fact |
| --- | --- | --- |
| **R1** | `node_modules/@google-cloud/firestore/types/firestore.d.ts:625-662` | `recursiveDelete(ref: CollectionReference | DocumentReference, bulkWriter?): Promise<void>`. The exact installed declaration accepts both reference kinds. |
| **R2** | `src/core/FirestoreRepository.ts:3386-3437` | Existing `recursiveDelete(id)` validates one document id, documents no hooks/count, delegates a raw document ref, and normalizes errors. |
| **R3** | `docs/adr/0032-bulkwriter-high-throughput-writes-and-recursive-delete.md:32-33,51-54,67-70,98-102` | Existing contract is void/idempotent/no-count; distinct method naming is the opt-in and confirmation flags are rejected as ceremony. |
| **R4** | `node_modules/@google-cloud/firestore/build/src/index.js:1187-1201` | Omitting `bulkWriter` selects the SDK-owned lazy writer; the deleter receives the reference unchanged. |
| **R5** | `node_modules/@google-cloud/firestore/build/src/recursive-delete.js:184-217` | Collection deletion derives parent path + collection id, selects names only, and bounds document names from `collectionId + '/'` to `collectionId + '\0/'`. Do not reproduce this query. |
| **R6** | `node_modules/@google-cloud/firestore/build/src/recursive-delete.js:226-248` | Only a `DocumentReference` is explicitly deleted after descendants; collection deletion streams/deletes its documents and resolves after writer flush. |
| **R7** | `src/core/FirestoreRepository.ts:1216-1239` | `readCol()` may carry a converter; `writeCol()` is the raw collection reference used by writes. Recursive deletion must use `writeCol()`. |
| **R8** | `src/core/FirestoreRepository.ts:206-265`; `src/tests/types/transaction-options.type-test.ts:87-115` | The read-only interface explicitly lists safe members and negative-tests non-transactional writes. The new method must remain absent. |
| **R9** | `src/vector/withVectorSearch.ts:13-20,47-64` | `VectorEnabledRepository` intersects the complete `FirestoreRepository` and the proxy binds all core methods; the new method propagates automatically with no vector implementation/export edit. |
| **R10** | `website/src/content/docs/reference/scope-and-capabilities.md:59-69` | Collection groups are intentionally read-only and group writes use full paths; issue #69 is repository-collection scoped, not group-wide. |
| **R11** | `src/index.ts:1-17`; `src/tests/unit/packageExports.unit.test.ts:10-14` | The runtime class is already the root export. Adding a class method needs no new named entry export or runtime export assertion. |
| **R12** | `website/src/content/docs/reference/errors.md:80-82`; `src/express/index.ts` (no recursive-delete match) | The only recursive-delete-specific error note concerns malformed document ids. The zero-argument collection method adds no error class/status mapping. |
| **R13** | `rg -n "recursive delete|recursiveDelete" README.md npm-readme.md` | Expected and observed: no matches. Install/pitch/quick-start text is unaffected. |

### 3.3 Authoritative implementation and test enumeration (`main` @ `75aa6ea`)

| File | Baseline lines | Required change |
| --- | --- | --- |
| `src/core/FirestoreRepository.ts` | 3386-3437 | Add the §6 method adjacent to document recursive delete; reuse `writeCol` and `parseFirestoreError`. |
| `src/tests/types/bulk-write.type-test.ts` | 162-179 | Assert new zero-argument method returns `void`; preserve one-argument document method and reject wrong arities. |
| `src/tests/types/transaction-options.type-test.ts` | 87-115 | Add negative guards for both recursive-delete methods on the RO callback. |
| `src/tests/integration/repository-bulk-writer.integration.test.ts` | 1-15,384-472 | Extend the strategy header and add a dedicated collection-wide describe/test fixture in this existing owner file. |

### 3.4 Deliberately NOT changed

- `src/core/FirestoreRepository.ts:3426-3437` document-scoped body — remains the distinct sibling
  method; R2/D1 proves no overload should replace it.
- `src/core/QueryBuilder.ts` and `src/core/CollectionGroup.ts` — query/group deletion is deliberately
  separate (R10).
- `src/vector/**` — its type intersection/proxy automatically carries the core method (R9). Do not
  add a redundant type assertion or duplicate runtime code.
- `src/index.ts` and `src/tests/unit/packageExports.unit.test.ts` — the class export already exposes
  its methods and no new named symbol exists (R11).
- `src/core/Errors.ts`, `src/core/ErrorParser.ts`, `src/express/index.ts`, and
  `website/src/content/docs/reference/errors.md` — reuse the existing parser; there is no new error
  contract or malformed collection input (R12).
- `ReadOnlyTransactionalRepository` interface — remain absent by design; only its negative type test
  changes (R8).
- `README.md`, `npm-readme.md`, and `website/src/content/docs/2.0/**` — R13 and the frozen archive
  rule prove these are not implementation sites.

### 3.5 Integration gate headroom

Measured from `coverage/integration/lcov.info` after `npm run test:integration:coverage`, against
`scripts/check-coverage-gates.mjs`. New branches should still be covered; this table is not a license
to omit §8 tests.

| Gate | Lines | Branches | Functions |
| --- | --- | --- | --- |
| FirestoreRepository | 4434/4518 = **98.14%** (90% threshold; **8.14pp slack**) | 499/539 = **92.58%** (75%; **17.58pp**) | 85/91 = **93.41%** (85%; **8.41pp**) |

### 3.6 Current docs/ADR enumeration

| File | Baseline lines | Required edit |
| --- | --- | --- |
| `docs/adr/0032-bulkwriter-high-throughput-writes-and-recursive-delete.md` | 51-54,69-70,101-102,108-110,125-132 | Add a dated issue #69 amendment and living follow-up note; do not rewrite accepted text. |
| `docs/adr/0017-v3-core-operations-scope.md` | 124-131,183-207 | Add a new issue #69 amendment/reference note; leave the issue #38 snapshot unchanged and state original remaining #41 is unchanged. |
| `docs/adr/README.md` | 27-67 | Add ADR-0038 row. |
| `website/src/content/docs/reference/repository.md` | 316-321,391-393 | Add the new signature/contract and include it in the no-hooks statement. |
| `website/src/content/docs/reference/scope-and-capabilities.md` | 42,50-57 | Replace the deferred clause with supported document + collection scopes; #69 is not a row in the remaining deferred table. |
| `website/src/content/docs/guides/working-with-data/crud-operations.md` | 272-274,287-292 | Explain document-vs-collection recursive deletion and the destructive/no-hooks distinction. |
| `website/src/content/docs/guides/concepts/lifecycle-hooks.md` | 73-84,156-165 | Include both recursive-delete methods in the explicit no-hooks inventory and cross-reference text. |
| `website/src/content/docs/guides/designing/performance.md` | 25-39 | Add/expand collection-wide write-cost/scope row. |

## §4 Traps

Ordered by severity and silent-failure potential.

### T1 — A zero-argument overload on `recursiveDelete` turns an omitted id into a collection wipe (D1/R2)

Do not overload the existing verb. `recursiveDeleteCollection` must be a separate property, while
`recursiveDelete()` with no id stays a compile error. T-1/T-2 observe both sides.

### T2 — Passing a parent `DocumentReference` widens a nested delete beyond the repository collection (P3/P4/R1)

For a subcollection repository, `this.writeCol()` is the exact collection target. Deriving its parent
document would also delete the parent and every sibling subcollection. I-2 checks parent survival,
target removal, and sibling survival in one observable.

### T3 — Reimplementing collection-prefix matching can delete similarly named collections (P2/P4/R5)

Naive string-prefix scans cannot distinguish `children` from `children_prefix`. Delegate to the SDK's
null-byte upper-bound implementation. I-1 and I-2 each guard one physical site (root and nested).

### T4 — A custom `BulkWriter` is flushed but not closed and can block teardown (R3/R4)

Mirror document recursive delete: pass only the collection ref. Do not allocate a writer or expose
throttling/retry callbacks. Existing suite teardown plus the full integration gate exposes a leaked
writer as a hang/termination failure; source review ensures the forbidden second argument is absent.

### T5 — Hooks or counts would misrepresent an unmodeled descendant operation (D3/R2/R5/R6)

The SDK streams name-only snapshots across arbitrary subcollections and reports no count. The method
must not call `runHooks`, pre-read documents, or fabricate accounting. T-1 asserts `void`; I-3 asserts
strict `undefined`; I-4 asserts all registered delete hooks remain silent.

### T6 — Updating only the method/reference page leaves contradictory deferral and hook docs (R3/R13)

Five live Starlight pages describe this behavior. §9 enumerates every one; `check:docs` cannot detect
semantic contradictions, so the definition of done names the required text changes explicitly.

## §5 Could not verify / scope bounds

- **No full source prototype.** The runtime change is one local, greppable method and the direct SDK
  probe answers the behavioral unknown. The exact §6 body compiled, but implementation tests and the
  14-leg gate remain the implementer's obligation.
- **Failure injection.** The emulator probe did not force a mid-recursion permanent delete failure;
  the plan relies on the installed SDK declaration/implementation and existing document method for
  whole-call rejection semantics (R2/R6). Do not claim production failure-path execution.
- **Peer matrix.** Local `check:consumer` covers the installed `firebase-admin@14.2.0`. CI still owes
  the `^12`, `^13`, `^14`, and pinned-firestore matrix legs. The public SDK signature is already used
  by the existing document method, reducing but not eliminating peer-version risk.
- **Production Firestore.** All runtime facts P1-P5 are emulator results; no production project was
  mutated.
- **No second defect folded in.** Collection-group-wide recursive deletion, custom retry policy, and
  delete-hook redesign remain outside issue #69.

## §6 API specification

### 6.1 `src/core/FirestoreRepository.ts` — add adjacent to `recursiveDelete(id)`

Copy verbatim, including JSDoc. The JSDoc must loudly name the collection-wide scope, no-hooks/no-count
contract, partial failure, idempotency, prefix-sibling boundary, and subcollection-repository behavior.

```ts
  /**
   * **Highly destructive.** Permanently deletes **every document in this repository's collection**
   * and every descendant subcollection, at any depth, via the Admin SDK's
   * `Firestore.recursiveDelete()`.
   *
   * This is deliberately separate from {@link recursiveDelete}, which removes one document subtree,
   * and {@link delete}, which removes one document but leaves its subcollections orphaned. When this
   * repository points at a subcollection, only that concrete subcollection is removed: its parent
   * document and sibling collections survive. A collection whose id merely shares this collection's
   * prefix also survives.
   *
   * No lifecycle hooks run and no count is returned. The SDK reads names only and descendants may
   * belong to collections this repository does not model. An empty collection resolves successfully;
   * re-running is safe. Deletes are non-atomic, so a rejection can mean some documents were already
   * removed; the SDK reports the failure count and last failure status.
   *
   * @returns Nothing after all discovered documents have been deleted
   * @throws {Error} If any descendant delete failed; already-deleted documents remain deleted
   *
   * @example
   * // Delete every user and every descendant beneath every user.
   * await userRepo.recursiveDeleteCollection();
   *
   * @example
   * // Delete every post below one user; the user document and sibling subcollections survive.
   * const postRepo = userRepo.subcollection('user-123', 'posts', postSchema);
   * await postRepo.recursiveDeleteCollection();
   */
  async recursiveDeleteCollection(): Promise<void> {
    try {
      await this.db.recursiveDelete(this.writeCol());
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }
```

Compile evidence: the exact body was placed inside a minimal class using the exact
`firebase-admin/firestore` `Firestore`/`CollectionReference` imports and repository
`parseFirestoreError` import; `npm run test:types` returned zero diagnostics (§12). No new public type
or external declaration reference is introduced; the emitted method is `(): Promise<void>`.

### 6.2 Size

Expected implementation: **3 source/test files, about +130–190 lines**, plus **5 website pages**,
**3 ADR/index files**, and this plan's temporary notes. Runtime production code is one new method
(roughly 35 JSDoc lines + 8 body lines); no new dependency, export-map entry, error class, hook type,
or vector implementation.

## §7 Implementation sequence and anti-instructions

1. Check out `plan/issue-69-collection-recursive-delete`; it already carries this plan. If `main`
   moved past `75aa6ea`, rebase, then re-run §3's source/docs enumerations and correct every line
   anchor before editing.
2. Add the §6 method beside document `recursiveDelete`. Preserve the exact distinct name, no-arg
   signature, raw `writeCol()` target, single SDK argument, and parser catch.
3. Add T-1/T-2 before runtime tests so the public shape and RO exclusion fail immediately on the
   baseline. Add I-1–I-4 with isolated collection names and deterministic cleanup.
4. Mutation-check each new test: stash/reverse only the production method (and, for negative guards,
   deliberately realize the named trap), run the targeted test, and record the actual failure in
   `notes.md`. A test that passes both versions is not a regression guard.
5. Complete the ADR and five-page docs sweep in §9. Re-run the exact SDK probe and semantic greps.
6. Run the 14-leg §10 gate under Node 24, report any failure honestly, update `notes.md`, and perform
   the plan-execution refute-first self-review. Leave the plan directory present for external review.

### Anti-instructions

- **Do not** overload `recursiveDelete()` or make omitted `id` select collection scope (T1).
- **Do not** add `confirm`, `force`, `skipHooks`, metadata, count, throttling, retry, or writer options
  (D2-D4).
- **Do not** pass a `DocumentReference`, parent path, converted `readCol()`, or custom `BulkWriter`
  (T2-T4).
- **Do not** run any lifecycle hook or pre-read documents to synthesize hook payloads/counts (T5).
- **Do not** add the method to `ReadOnlyTransactionalRepository`, QueryBuilder, CollectionGroup, or
  Express surfaces (R8/R10/R12).
- **Do not** duplicate core runtime code in `src/vector`; the existing proxy/intersection carries it
  (R9).
- **Do not** add root/vector named exports or runtime package-export assertions for a class method
  (R9/R11).
- **Do not** rewrite historical ADR amendment blockquotes, frozen v2 docs, or README content (R13).
- **Do not** commit implementation unless asked; leave implementation changes for review with the
  proposed subject in §10. (The plan itself is already committed/pushed by the planner.)

## §8 Test specification

Use Jest and the Firestore emulator per the `integration-testing` skill. Every new test file needs a
JSDoc strategy/verification header; extending the existing file requires updating its header.

### 8.1 Type — `src/tests/types/bulk-write.type-test.ts`

| Id | Assertion | Observable on failure | Guards |
| --- | --- | --- | --- |
| **T-1** | `const removed: void = await users.recursiveDeleteCollection()` compiles with exactly zero arguments. | Missing/wrongly named method or non-void return is a type diagnostic. | D1, D3, T1, T5 |
| **T-2** | Existing `recursiveDelete('u1')` remains `void`; `recursiveDelete()` and `recursiveDeleteCollection('u1')` each carry `@ts-expect-error`. | An unused directive exposes accidental overload/arity widening. | T1 |

### 8.2 Read-only type boundary — `src/tests/types/transaction-options.type-test.ts`

| Id | Assertion | Observable on failure | Guards |
| --- | --- | --- | --- |
| **T-3** | Inside a `{ readOnly: true }` callback, both `repo.recursiveDelete('u1')` and `repo.recursiveDeleteCollection()` are `@ts-expect-error`. | Either directive becomes unused if destructive I/O leaks onto the RO type. | R8 |

### 8.3 Emulator integration — repository recursive-delete suite

Extend `src/tests/integration/repository-bulk-writer.integration.test.ts`; it already owns the SDK
recursive-delete contract. Use a dedicated `describe` and collection namespace so a collection wipe
cannot interfere with sibling cases. This is a test-content change, not test infrastructure, so the
testing documentation/configuration sync rule is not triggered.

| Id | Assertion | Observable on failure | Guards |
| --- | --- | --- | --- |
| **I-1** | Root repository collection: seed two documents, a grandchild, and a longer prefix-named root collection; call collection delete. | Target direct size is not 0, grandchild still exists, or prefix sibling no longer has two docs/grandchild. | T3, T5 |
| **I-2** | Subcollection repository: seed parent, target children with grandchild, and `children_prefix`; call collection delete. | Parent disappears, target remains, or nested prefix sibling changes. | T2, T3 |
| **I-3** | Seed a dedicated collection, call once to delete it, then call again on the now-empty target; both resolve strictly `undefined`. | Promise rejects or result differs from `undefined`. | D3, T5 |
| **I-4** | Register `beforeDelete`, `afterDelete`, `beforeBulkDelete`, `afterBulkDelete`; wipe a seeded collection. | Hook spy array is non-empty while target is gone. | T5 |

Cleanup must use raw `db.recursiveDelete(collectionRef)` in `afterAll`/`finally` so failed assertions
cannot strand descendants. Use unique root collection names; do not call the method under test as the
only cleanup path. Prefix test names must be derived from the target id exactly as the probe does.

### 8.4 Trap coverage — inverse direction

| Trap | Physical site | Falsifying test | Observable |
| --- | --- | --- | --- |
| T1 | Public document method arity | T-2 | `recursiveDelete()` without id stays a diagnostic. |
| T1 | Public collection method name/arity | T-1/T-2 | Named zero-arg call compiles; an id argument does not. |
| T2 | Root collection reference | I-1 | Only target collection disappears. |
| T2 | Nested collection reference | I-2 | Parent and sibling collection survive. |
| T3 | Root prefix boundary | I-1 | Longer root collection prefix remains populated. |
| T3 | Nested prefix boundary | I-2 | Longer nested collection prefix remains populated. |
| T4 | SDK call writer lifecycle | Source invariant + full integration teardown | §6 has one SDK argument; suite/emulator exits rather than hanging. |
| T5 | Return contract | T-1/I-3 | Static `void`; runtime strict `undefined`, including repeat. |
| T5 | Hook bypass | I-4 | All four delete hook spies remain empty while deletion succeeds. |
| T6 | Five live docs sites | §9 checklist + docs grep | Every current singular/no-hooks/deferral statement names both scopes consistently. |

### 8.5 Coverage ownership

| Changed path | Gate |
| --- | --- |
| `src/core/FirestoreRepository.ts` | `test:coverage:gate:integration` — FirestoreRepository 90/75/85 |
| `src/tests/integration/**` | Produces integration LCOV; not itself collected |
| `src/tests/types/**` | `test:types`; excluded from Jest coverage |
| Docs/ADR | `check:docs` + `docs:build`; no coverage gate |

Measured headroom is §3.5. I-1–I-4 exercise every new executable line/branch; do not spend slack.

## §9 Docs and ADR bookkeeping

### 9.1 ADR classification

This is a contract-level public destructive method, so a new ADR is required. Issue #69 is a
separately tracked follow-up to original ADR-0017 issue #38, not a new original `#35–#41` item:

- add a new amendment to ADR-0017 and ADR-0032 because their accepted text records the deferral;
- do **not** rewrite the historical issue #38 amendment;
- do **not** decrement or rewrite the original living-index remainder `#41` in every feature ADR;
  issue #69 does not change that set.

### 9.2 New ADR — `docs/adr/0038-collection-wide-recursive-delete.md`

Create from `docs/adr/0000-template.md`: status `Accepted (v3.x, pending merge/release)`, date
`2026-08-01`, decider `maintainer`, related issue #69, ADR-0017, ADR-0032, source, tests, and docs. It
must contain:

1. **Context:** document delete orphans descendants; `bulkDelete`/query delete cannot discover
   orphaned subcollections; SDK accepts a concrete collection reference; this is maximally
   destructive.
2. **Verified SDK forces:** P1-P5/R1/R4-R6 including nested scope, null-byte prefix boundary,
   `Promise<void>`, idempotency, non-atomic partial failure, and writer ownership.
3. **Decision:** D1-D4 exactly—distinct `recursiveDeleteCollection()`, no confirmation option, no
   hooks/count/options, raw collection SDK delegation, error normalization.
4. **Consequences:** additive API; collection and all descendants disappear; parent/prefix siblings
   survive; partial success on rejection; no audit hooks/count; safe retry.
5. **Alternatives:** zero-arg overload/no distinct name; confirmation token; query + `bulkDelete`;
   custom writer/options; hook/count synthesis; raw-SDK-only deferral.
6. **References:** issue, ADRs, implementation, tests, repository/capability/lifecycle docs.
7. **Living note:** original ADR-0017 remaining deferral `#41` is unchanged because #69 is a
   separately tracked #38 follow-up.

Add the ADR-0038 row to `docs/adr/README.md`.

### 9.3 Existing ADR amendments

| File | Baseline line | Additive edit |
| --- | --- | --- |
| `docs/adr/0032-bulkwriter-high-throughput-writes-and-recursive-delete.md` | 108-110,125-132 | Add `> Amendment (3.0.0, issue #69)` stating the collection-wide method now ships under ADR-0038 with D1-D4; add an issue/ADR reference. Keep original deferral text intact. Update only its explicit living follow-up sentence to say #69 has since shipped. |
| `docs/adr/0017-v3-core-operations-scope.md` | 124-131,183-207 | Add a new amendment after the issue #38 snapshot and a References amendment after #72: #69/ADR-0038 ships the separately tracked collection-wide half; historical text remains; original remaining #41 unchanged. |

Run this after edits:

```bash
rg -n "#69|collection-wide recursive|remaining deferral" docs/adr/0017-v3-core-operations-scope.md docs/adr/0032-bulkwriter-high-throughput-writes-and-recursive-delete.md docs/adr/0038-collection-wide-recursive-delete.md
```

Expected: new #69/ADR-0038 amendment/reference rows appear; original issue #38 deferral lines remain
as historical text; every new follow-up says remaining original deferral `#41` is unchanged.

### 9.4 Starlight consumer docs — five pages

| File | Baseline line | Required edit |
| --- | --- | --- |
| `website/src/content/docs/reference/repository.md` | 316-321 | Add `recursiveDeleteCollection(): Promise<void>` with loud destructive scope, parent/prefix boundaries, void/idempotent/partial/no-hooks contract, and example. |
| same | 391-393 | Change no-hooks inventory from singular `recursiveDelete` to both recursive-delete methods. |
| `website/src/content/docs/reference/scope-and-capabilities.md` | 42 | Replace “Collection-wide variant deferred (#69)” with supported document and collection forms; distinguish scopes. |
| `website/src/content/docs/guides/working-with-data/crud-operations.md` | 272-274 | Document when to choose document subtree vs entire repository collection, including the warning. |
| same | 287-292 | Include both methods in no-hooks text. |
| `website/src/content/docs/guides/concepts/lifecycle-hooks.md` | 73-84,156-165 | List/document both methods as hookless and explain why collection descendants cannot supply modeled payloads. |
| `website/src/content/docs/guides/designing/performance.md` | 25-39 | Add `recursiveDeleteCollection()` as one delete per document across the collection and descendants. |

`website/**/*.md` is prettier-exempt; match surrounding style. No aside is prescribed, so no
literal-`:::` HTML check is required.

Run this semantic sweep after edits:

```bash
rg -n "recursiveDelete|Collection-wide variant deferred|collection-wide recursive" website/src/content/docs --glob '!**/2.0/**'
```

Expected: every live recursive-delete statement distinguishes document and collection scopes; the
exact stale phrase `Collection-wide variant deferred` has zero matches. Frozen v2 matches are
excluded and unchanged.

### 9.5 Root/vector exports, errors, and READMEs

Do not edit them (R9/R11-R13). Re-run:

```bash
rg -n "recursive delete|recursiveDelete" README.md npm-readme.md
```

Expected: no output (exit 1 means the expected no-match result, not failure). Record this in
`notes.md` and state in the PR body that `readme-sync` was not triggered because install, pitch,
quick-start, peers, migration notes, and docs links are unchanged.

## §10 Gate and commit

Use Node 24 (`node --version` must report `v24.x`) and a JDK. Run exactly:

```bash
npm run test:types && npm run lint && npm run check:format && npm run test:unit && npm run test:integration:emulator && npm run test:unit:coverage && npm run test:coverage:gate:unit && npm run test:integration:coverage && npm run test:coverage:gate:integration && npm run build && npm run check:package && npm run check:consumer && npm run check:docs && npm run docs:build
```

Fourteen legs. Report failures with output; never claim an unexecuted leg passed. Baseline on
`75aa6ea`: unit **32 suites / 426 tests**; integration **36 suites / 540 tests**. Unit suite/test
counts must remain unchanged. Integration must become **36 suites / 544 tests** after I-1–I-4 are
added to the existing owner file. Type checks gain compile cases but Jest counts do not include them.

Re-run the SDK probe and §9 greps. For README no-match, accept exit 1 only when output is empty. For
the website sweep, explicitly confirm the stale phrase has zero matches rather than treating any
recursive-delete matches as failure.

**Commit subject** (Conventional Commits; commitlint runs on `commit-msg`):

```text
feat(repository): add collection-wide recursive delete (#69)
```

**Breaking?** No. The method is additive and distinctly named; `recursiveDelete(id)`, `delete(id)`,
all existing return shapes, hooks, and default behavior remain unchanged. It joins unreleased v3.x.

## §11 Definition of done

| # | Item |
| --- | --- |
| 1 | D1-D4 implemented exactly; no confirmation/options/count/hooks/custom writer. |
| 2 | §3 source/docs sites re-enumerated after any rebase; every deliberately unchanged surface still justified. |
| 3 | Exact §6 method/JSDoc present beside document recursive delete and emits `(): Promise<void>`. |
| 4 | T-1–T-3 and I-1–I-4 implemented; every new test shown to fail on the unfixed/realized-trap baseline and evidence recorded in `notes.md`. |
| 5 | Every §4 trap × physical site has the §8 observable; no test throws before reaching what it claims to guard. |
| 6 | ADR-0038/index plus additive ADR-0017/0032 amendments complete; historical snapshots and original `#41` remainder preserved. |
| 7 | All five live Starlight pages agree; stale deferral phrase has zero live matches; frozen v2 docs unchanged. |
| 8 | Root/vector exports, Express/errors, READMEs, query/group/RO production surfaces remain untouched as prescribed. |
| 9 | SDK probe and semantic/README greps return expected results. |
| 10 | Fourteen-leg §10 gate green with real output and predicted suite-count movement; peer-matrix bound reported. |
| 11 | Nothing in the §7 anti-instruction list violated. |
| 12 | `notes.md` committed with deviations, mutation evidence, gate results, and refute-first self-review dispositions. |
| 13 | External review occurs while this directory is visible; only afterward run `git rm -r docs/plans/issue-69-collection-recursive-delete/` in the final cleanup commit, so the plan directory is absent before merge. |

## §12 Pre-handoff verification

What the planner ran on baseline `75aa6ea`; this is evidence, not the implementer's checklist.

| Check | Command / method | Result |
| --- | --- | --- |
| Baseline/update | `git pull --ff-only origin main`; `git log -1 --oneline` | Fast-forwarded `07f72c3..75aa6ea`; baseline subject matches header. |
| Issue facts/decision | GitHub issue connector + owner reply | Open issue #69; labels enhancement/parity/v3.x; owner approved distinct `recursiveDeleteCollection()` with no confirmation flag on 2026-08-01. |
| SDK behavior probe | Exact §0 `npx firebase emulators:exec …` command | Exit 0; P1-P5 all asserted for root/nested targets, prefix siblings, parent survival, `undefined`, and repeat. Initial sandbox run could not bind ports; approved out-of-sandbox rerun passed. |
| SDK declaration/implementation | `rg`/`nl` in installed `@google-cloud/firestore` | R1/R4-R6 verified at cited lines; exact union input and `Promise<void>` observed. |
| §6 block compiles | Temporary `src/__issue69_plan_spec.ts` with exact body/imports + `npm run test:types`; removed using `apply_patch` | Zero diagnostics under Node `v24.18.0`. Exact `firebase-admin/firestore` specifier resolved. |
| Declaration emit | Public shape inspection + full `npm run build` in gate | Build passed for ESM + CJS declarations; no new named type/package reference, and the prescribed class method emits only `(): Promise<void>`. |
| Baseline suite counts | `npm run test:unit`; `npm run test:integration:coverage` | Unit 32/426; integration 36/540, all passed. |
| Gate headroom | integration coverage + `npm run test:coverage:gate:integration`; raw LCOV `awk` | FirestoreRepository exact counts/slack in §3.5; gate passed. |
| §9 grep baselines | Exact ADR/site/README `rg` commands from §9 | Executed before implementation: ADR grep reported the expected missing ADR-0038 plus current #69 deferral sites; website grep listed the nine current live statements including the stale phrase; README grep produced expected empty output/exit 1. Post-change expected results are explicit in §9. |
| Full baseline/plan gate | Exact fourteen-leg §10 command under Node `v24.18.0` | All passed: types, lint, format; unit 32 suites / 426 tests; integration 36 / 540 in both ordinary and coverage runs; both coverage gates; ESM+CJS build; 98-file package check; packed `firebase-admin@^14` ESM/CJS/Express consumer; 187-file docs-link check; 61-page production docs build + Pagefind. |
| Unresolved conditionals | Re-read §§1-9 | None. Owner settled D1/D2 and §8 fixes the tests in the existing recursive-delete owner file. |
| Trap inverse walk | §4 against §8.4 | Every trap × root/nested/type/docs site has a falsifying observable; T4 additionally requires one-argument source review and successful teardown. |

## Appendix — probe inventory

| File | Classification | What it proves |
| --- | --- | --- |
| `probes/sdk-collection-recursive-delete.mjs` | Asks (delete with plan directory) | Installed SDK/emulator behavior P1-P5. Permanent contract assertions are promoted to T-1–T-3/I-1–I-4 rather than relying on this temporary probe. |
