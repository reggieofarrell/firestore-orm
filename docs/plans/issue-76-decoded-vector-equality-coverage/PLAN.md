# Issue #76 — Add decoded `VectorValue` equality integration regression coverage

**Implementer:** Cursor Cloud Agent or later Codex session · **Reviewer:** independent agent via the
`implementation-review` skill · **Baseline:** `main` @ `8c5ed6d17c8a88bad93643f9e7eb6884de3afdee`
(`chore: gitignore local agent tooling under .cursor/.claude/.agents (#87)`) · **Branch:**
`test/issue-76-decoded-vector-equality-coverage` — already created and pushed with this plan on it;
check it out, do not cut a new branch

**Issue:** [#76](https://github.com/reggieofarrell/firestore-orm/issues/76) — label `v3.x`. The label
places the work in the v3.x release stream, but this issue is a regression-coverage follow-up to the
already-shipped #40 contract, not an ADR-0017 deferred capability.

> **Acceptance (verbatim from the issue):**
>
> - [ ] Emulator integration coverage writes and reads genuine stored vector fields through the ORM.
> - [ ] Equal decoded vectors produce one distinct value.
> - [ ] Unequal decoded vectors remain distinct.
> - [ ] Assertions are behavior-focused and fail if decoded vectors start falling through to identity comparison.
> - [ ] Existing integration and coverage gates pass.

---

## §0 How to use this plan

1. Read §1 and §4 before editing. The decisions in §1 are settled; do not re-litigate them.
2. §6 contains the exact test-harness type and integration-test blocks. They were compile-checked as
   written against the exact module specifiers in this repository (V6–V8, §12). This is a test-only
   handoff, not a public API specification despite the conventional section name.
3. Every factual claim in §3 was re-derived from baseline `8c5ed6d`; do not trust the issue body over
   the evidence here. Re-run the observational probe with the command in §10 when needed.
4. No implementation prototype was retained. The exact decoded-read behavior was exercised through
   the emulator probe, and the future test shape was compile-checked in a scratch file, but the real
   integration test was deliberately not added because this plan is the requested cross-context
   handoff. Bounds are explicit in §5.
5. Follow the `plan-execution` skill. Keep `notes.md` current with commands, deviations, the required
   mutation check, and the refute-first self-review. Commit `notes.md` before external review; never
   write `review.md` yourself.
6. Leave this directory present through external review. Remove it only in the final cleanup commit
   after review, as required by §11.

## §1 Owner-approved decisions

| Id | Fork | Decision | Rejected alternative and why |
| --- | ---- | -------- | ---------------------------- |
| **D1** | Close #76 without implementation vs retain it | **Owner approved retaining #76 as a narrow regression-coverage issue.** Implement one emulator integration assertion. | Closing it would leave an explicit `VectorValue` by-value contract unpinned at the SDK decode boundary. This differs from the rejected runtime features in #75/#77: the cost is one test, not a new production mechanism. |
| **D2** | Runtime fix vs test-only pin | **No production-code or public-API change unless the new test reveals a real failure.** Current behavior is correct on the pinned SDK (P1–P4). | Preemptively changing recognition would solve no observed defect and risks weakening the ADR-0022 authenticity boundary (R3, T5). |
| **D3** | Mechanism assertion vs public behavior | Assert `query().distinctValues('embedding')` output after an emulator round trip. Do not assert a private SDK constructor in the committed test. | A constructor assertion couples the suite to the current private implementation and can fail even when the documented ORM behavior remains correct. The probe may report constructor identity; the regression test must observe the contract (P1, T2). |
| **D4** | Equal-only case vs equal + unequal | Write two equal vectors and one unequal vector; assert exactly the two expected component arrays. | An equal-only assertion catches under-merging but cannot detect an implementation that over-merges every vector (P1, T3). |
| **D5** | Cast around the incomplete test model vs correct it | Add required `embedding: VectorValueLike` to the shared `VectorDoc` interface and use the typed `distinctValues('embedding')` call. | `as any`/`as VectorDoc` would hide that the harness model omits the field its own JSDoc and every write already use. Making it optional degrades the result to `(VectorValueLike | undefined)[]` even though the test fixtures require it (P8–P10, T4). |
| **D6** | New ADR/docs vs existing contract | No new ADR or consumer-doc edit. ADR-0034 and the website already state the exact contract; this issue only adds evidence for it (P11–P13). | Re-documenting unchanged behavior would create noise and could make a test-only change look like a new contract. |
| **D7** | Full supported-SDK matrix vs normal integration dependency | Pin the behavior for the dependency version exercised by this branch and catch drift when that dependency is upgraded. | Adding emulator legs for every supported `firebase-admin` peer major is outside #76 and the updated issue's non-goals (P2, B1). |

`D5`–`D7` are derived from the owner-approved narrow scope and current repository evidence; they were
not separately asked as questions.

## §2 Scope

### In scope

| Area | Change |
| ---- | ------ |
| Shared integration model | In `src/tests/integration/helpers/firestoreIntegrationHarness.ts`, import the existing internal `VectorValueLike` type and add required `embedding: VectorValueLike` to `VectorDoc`. |
| Emulator regression | In `src/tests/integration/vector-search.integration.test.ts`, update the file strategy header and add one test that writes two equal and one unequal vector through the repository, reads them through `query().distinctValues('embedding')`, and compares public `toArray()` output. |
| Verification | Run the targeted vector integration file, mutation-check the new test, run the observational probe, then run the full fourteen-leg gate. |

### Explicitly out of scope

- Any edit to `src/utils/vectorValue.ts`, `src/utils/firestoreValueEquality.ts`, or
  `src/core/QueryBuilder.ts`: the emulator probe demonstrates the runtime is correct today (P1), and
  #76 is not authorization for speculative behavior changes (D2).
- Structural/duck-typed vector recognition: ADR-0022 deliberately chose nominal recognition to stop
  forged maps from bypassing write validation (R3, T5).
- A direct dependency or import from `@google-cloud/firestore`: it is transitive and the repository
  already provides `VectorValueLike` precisely to avoid that coupling (P7, T6).
- A `firebase-admin` peer-version emulator matrix: only the installed `firebase-admin@14.2.0` /
  `@google-cloud/firestore@8.6.0` pair was executed locally (P2, B1).
- Field masks, server-side distinct, or canonicalizer memoization: those belonged to #75, #41, and
  #77 respectively; #75 and #77 were closed without implementation and #41 remains separate.
- README, website, migration, ADR, or test-infrastructure documentation changes: no public contract,
  command, harness location, factory, runner, or gate ownership changes (P11–P15).
- Cleanup of the existing `as VectorDoc` casts elsewhere in `vector-search.integration.test.ts`.
  Correcting the model makes them unnecessary, but removing them is unrelated mechanical churn; the
  new test itself must not introduce a cast (D5).

### Scope correction — where the issue was incomplete

The updated issue correctly identifies the missing decoded-read assertion and the vector harness, but
it does not mention that `VectorDoc` omits `embedding` at
`src/tests/integration/helpers/firestoreIntegrationHarness.ts:218-222` even though the interface JSDoc
calls out that field and every vector fixture writes it (P8). A typed call to
`distinctValues('embedding')` cannot be prescribed honestly without correcting this test-only model.
The compile probe also resolved whether the field should be optional: optional produced TS18048 on
`value.toArray()`; required compiled cleanly and matches all current `vectorRepo`/`prefilterRepo`
writes (P9–P10).

The issue says the prior reviewer verified current emulator behavior. That claim was not trusted: the
committed probe re-ran the round trip through the public repository terminal on this baseline (P1).

## §3 Verified facts

### 3.1 Actual decoded read behavior — `probes/decoded-vector-read-path.mjs`

Command executed three times during planning; the final run uses the exact filtered and ordered query
shape prescribed in §6:

```bash
npx firebase emulators:exec --project demo-firestoreorm-test --only firestore "npm run build && node docs/plans/issue-76-decoded-vector-equality-coverage/probes/decoded-vector-read-path.mjs"
```

| Id | Expression / condition | Observed | Note |
| -- | ---------------------- | -------- | ---- |
| **P1** | Three vectors `[1,2,3]`, `[1,2,3]`, `[1,2,4]` written to the emulator, decoded, then passed through `FirestoreRepository.query().orderBy('name').distinctValues('embedding')` | `distinctCount: 2`; components `[[1,2,3],[1,2,4]]` | This is the exact public behavior #76 will pin. |
| **P2** | Installed dependency topology (`npm ls firebase-admin @google-cloud/firestore --all`) | One `firebase-admin@14.2.0`, with one `@google-cloud/firestore@8.6.0` | No duplicate constructor copy exists in this installation. |
| **P3** | Decoded constructor vs `FieldValue.vector([0]).constructor` | All constructors named `VectorValue`; all three `instanceof` results `true` | Observational mechanism evidence only; do not copy this assertion into the committed test (D3). |
| **P4** | SDK public `isEqual()` on decoded values | Equal pair `true`; unequal pair `false` | Confirms the stored values themselves preserve the expected components. |

### 3.2 Why constructor identity currently holds

| Id | Source | Observed |
| -- | ------ | -------- |
| **P5** | `node_modules/firebase-admin/lib/firestore/index.js:24-35` | `firebase-admin/firestore` re-exports `FieldValue` from its resolved `@google-cloud/firestore` module. |
| **P6** | `node_modules/@google-cloud/firestore/build/src/field-value.js:35-69,80-87`; `serializer.js:297-300` | `FieldValue.vector()` constructs `new VectorValue(values)` and the decoder calls `VectorValue._fromProto()`, which also constructs that class. |
| **P7** | `src/utils/pathTypes.ts:14-19` | The repository already defines `VectorValueLike` with public `toArray()`/`isEqual()` methods because `firebase-admin/firestore` does not export a nameable `VectorValue` class. |

### 3.3 The unpinned boundary in the current tests

| Id | Source | Observed |
| -- | ------ | -------- |
| **P8** | `src/tests/integration/helpers/firestoreIntegrationHarness.ts:214-234`; `src/tests/integration/vector-search.integration.test.ts:34-46,62-70,94-101,127-216` | `VectorDoc` JSDoc names a top-level `embedding`, but the interface omits it. Every current repository vector write supplies an embedding behind `as VectorDoc`. The harness uses fixed collections required by vector indexes and already provides `afterEach` cleanup through the vector suite. |
| **P9** | Scratch compile with `embedding?: VectorValueLike` + the planned test | `npm run test:types` failed TS18048: `value` possibly `undefined` at `value.toArray()` | Optionality would force a cast or runtime narrowing that does not match these fixtures. |
| **P10** | Scratch compile with required `embedding: VectorValueLike`; then the same type edit temporarily applied to the actual harness | Both `npm run test:types` runs passed; temporary source edit was reverted | `FieldValue.vector()` is structurally assignable and all existing call sites remain type-correct. Exact imports: `firebase-admin/firestore`, `./utils/pathTypes.js` in scratch, and `../../../utils/pathTypes.js` in the harness. |
| **P11** | `src/tests/unit/firestoreValueEquality.unit.test.ts:115-120` | U-9 covers equal and unequal vectors created directly by `FieldValue.vector()`, never serialization/decoding. |
| **P12** | `src/tests/integration/repository-query-builder.integration.test.ts:132-224` | Existing decoded-value integration coverage includes map, array, Timestamp, GeoPoint, DocumentReference, and Bytes; vector is absent. |
| **P13** | `src/tests/integration/vector-search.integration.test.ts:62-70` | Existing vector read coverage asserts only the fetched document's `name`; it never observes decoded embedding equality or `distinctValues`. |

### 3.4 Runtime failure mechanism

| Id | Source | Observed |
| -- | ------ | -------- |
| **R1** | `src/core/QueryBuilder.ts:1376-1396` | `distinctValues()` fetches snapshots, reads `doc.data()[field]`, and passes those SDK-decoded values to `distinctFirestoreValues()`. |
| **R2** | `src/utils/vectorValue.ts:29-40,54-60`; `src/utils/firestoreValueEquality.ts:121-175` | Vector recognition probes the write constructor and uses `instanceof`. If it fails, a decoded non-plain instance reaches the identity fallback at line 175, so two equal objects receive different keys. The failure is silent under-merging, not a throw. |
| **R3** | `docs/adr/0022-vector-value-hardening.md:38-54,86-102` | Nominal recognition is an intentional authenticity boundary; structural recognition was rejected because a forged map can spoof methods and bypass validation. |
| **R4** | `src/utils/firestoreValueEquality.ts:178-201`; `src/core/QueryBuilder.ts:1341-1351` | The internal and public JSDoc explicitly promise `VectorValue` by-value equality and first-seen retention. |

### 3.5 Existing documentation already states the contract

| Id | Source | Observed |
| -- | ------ | -------- |
| **P14** | `docs/adr/0034-distinct-values-semantic-equality.md:37-70,98-116` | ADR-0034 already decides VectorValue semantic equality, owns runtime logic with the unit gate, and records #76 as the decoded-read follow-up. |
| **P15** | `website/src/content/docs/reference/query-builder.md:217-232`; `reference/scope-and-capabilities.md:48`; `guides/migration-v2-to-v3.md:199-202` | All consumer surfaces already say `VectorValue` compares by value. No wording changes are needed. |
| **P16** | `rg` across `README.md` and `npm-readme.md` | Neither README documents the individual VectorValue equality mechanism; install, pitch, quick start, peers, and support links are unaffected. |

### 3.6 Baseline tests and gate ownership

| Id | Command / source | Observed |
| -- | ---------------- | -------- |
| **G1** | `npm run test:unit` | 32 suites / 426 tests passed. |
| **G2** | Direct authorized emulator invocation of `npm run test:integration` | 36 suites / 544 tests passed. |
| **G3** | Targeted `vector-search.integration.test.ts` invocation | 1 suite / 34 tests passed. |
| **G4** | `jest.config.base.js:25-34` | `src/tests/**` is excluded from coverage collection. The harness's added type is erased; the new test adds no production branch. |
| **G5** | `scripts/check-coverage-gates.mjs:139-165` | The integration gate owns `QueryBuilder.ts` and `src/vector/**`; this test exercises `QueryBuilder` but changes neither production path. Full integration coverage/gate still runs in §10. |

### 3.7 Authoritative site enumeration (`main` @ `8c5ed6d`)

| File | Current lines | Treatment |
| ---- | ------------- | --------- |
| `src/tests/integration/helpers/firestoreIntegrationHarness.ts` | 1-6, 214-256 | **Change:** import `VectorValueLike`; add required `embedding` to `VectorDoc`. |
| `src/tests/integration/vector-search.integration.test.ts` | 1-4, 5-31, 62-70 | **Change:** extend strategy header and add the decoded `distinctValues` test after the existing basic vector round-trip test. |
| `src/utils/pathTypes.ts` | 14-19 | Reuse `VectorValueLike`; do not change it. |
| `src/core/QueryBuilder.ts` | 1341-1399 | Exercised public terminal; do not change it. |
| `src/utils/vectorValue.ts` | 19-60 | Constructor probe/recognizer under test; do not change it. |
| `src/utils/firestoreValueEquality.ts` | 121-175, 178-201 | Vector canonicalization/fallback under test; do not change it. |
| `src/tests/unit/firestoreValueEquality.unit.test.ts` | 1-16, 115-120 | Existing write-side coverage; leave intact. |
| `src/tests/integration/repository-query-builder.integration.test.ts` | 1-9, 132-224 | Existing decoded coverage for other Firestore types; do not duplicate the new case here. |
| `docs/adr/0022-vector-value-hardening.md` | 38-54, 86-102 | Existing nominal-authenticity decision; no amendment. |
| `docs/adr/0034-distinct-values-semantic-equality.md` | 37-70, 98-116 | Existing equality decision and #76 reference; no edit. |
| Website pages in P15 | cited in P15 | Contract already accurate; no edit. |

**Deliberately NOT changed** (justify in `notes.md` before deviating):

- `src/utils/vectorValue.ts:29-60` — P1 proves current nominal recognition works; R3 proves widening
  it would violate an existing security decision.
- `src/utils/firestoreValueEquality.ts:121-175` — P1 proves the current vector branch produces the
  required result; R2 explains why the integration test, rather than a speculative fallback, is the
  scoped fix.
- `src/core/QueryBuilder.ts:1376-1399` — R1 proves it already exercises the decoded path and P1 proves
  the output; production edits are unjustified.
- `src/tests/unit/firestoreValueEquality.unit.test.ts:115-120` — P11 proves this remains valuable
  fast coverage; it simply cannot replace the emulator case.
- `src/tests/integration/repository-query-builder.integration.test.ts:132-224` — P12 proves the
  generic decoded-value test is complete for its enumerated types but omitted vectors; vector-specific
  coverage belongs with the existing vector harness/suite (P8).
- `src/vector/**` and `src/core/Validation.ts` — D2 limits the work to reads; R3 shows write/vector
  authenticity is a separate contract.
- `docs/adr/**`, `website/**`, `README.md`, and `npm-readme.md` — P14–P16 prove the unchanged contract
  is already recorded and the READMEs are unaffected.

No gate-headroom table is required: G4 proves the only changed runtime-bearing files are excluded test
files, and the harness addition is type-only. Do not turn that into permission to skip either coverage
run or gate in §10.

## §4 Traps

Ordered by severity and likelihood.

### T1 — In-process vectors make the missing boundary look covered (P11–P13)

Calling `distinctFirestoreValues([FieldValue.vector(...), ...])` or passing freshly created values
directly to a helper never invokes Firestore serialization or the Admin SDK decoder. That test passes
even if future decoded vectors use a different class. I-1 must write documents, execute a new query,
and let `doc.data()` produce the values.

### T2 — Constructor assertions test the private mechanism, not the public contract (P1, P3, D3)

The constructor identity is useful diagnosis but not promised API. An implementation that compares a
future decoded vector correctly by another genuine mechanism should still pass. I-1 observes only
`distinctValues()` and public `toArray()` results.

### T3 — Equal-only coverage permits catastrophic over-merge (P4, D4)

An implementation that maps every vector to the same key satisfies “two equal values yield length
one.” The unequal `[1,2,4]` fixture and exact two-array assertion make that error visible.

### T4 — Optional `embedding` silently weakens the test type (P8–P10)

`embedding?: VectorValueLike` makes the terminal return include `undefined`, even though the terminal
drops absent values at runtime. A cast or non-null assertion would hide the harness-model defect.
Declare the field required; every current vector repository fixture supplies it.

### T5 — Structural fallback reopens the forged-vector boundary (R3)

Adding “has `toArray()`” recognition to production code appears robust against constructor drift but
lets ordinary objects spoof vector behavior in write-validation consumers of the shared recognizer.
This issue must not modify the recognizer.

### T6 — Importing `VectorValue` from the transitive package leaks dependency topology (P2, P7)

`@google-cloud/firestore` is not a declared dependency. A hoisted local import can compile and still
break strict consumers or duplicate nominal identities. The test harness needs only the existing
structural `VectorValueLike` type from `../../../utils/pathTypes.js`.

### T7 — An unscoped fixed-collection query can observe unrelated parallel fixtures (P8)

The vector harness uses fixed collections for index-backed vector tests. Query only the three unique
`name` values introduced by I-1 and order by `name` before deduplication; do not call unfiltered
`distinctValues()` and assume no other Jest worker can write the collection.

### T8 — Length-only assertions do not prove which values survived (D4)

`toHaveLength(2)` alone passes for the wrong pair. Assert length and the ordered public component
arrays `[[1,2,3],[1,2,4]]`.

### T9 — A regression pin that passes today needs a mutation proof, not a false baseline claim (P1)

The literal baseline is correct, so the new test necessarily passes after it is added. To prove the
assertion is load-bearing, temporarily force the vector canonicalization branch not to recognize
vectors (simulating nominal drift), run I-1, observe three values/failure, and restore the source. Do
not claim the naturally passing baseline is an “unfixed failure.” Record the mutant and output in
`notes.md`.

### T10 — New files and manual cleanup expand race/lifecycle surface (P8)

Keep I-1 in the existing vector suite and rely on its existing `afterEach` harness cleanup. A new
suite would create another fixed-collection lifecycle and require a new JSDoc header; manual cleanup
inside the test can be skipped after assertion failures.

## §5 Could not verify / scope bounds

- **B1 — Supported peer matrix:** only `firebase-admin@14.2.0` with
  `@google-cloud/firestore@8.6.0` was installed and emulator-executed. The test will catch drift when
  the development dependency changes, but this plan does not claim runtime verification on peer
  majors 12 and 13 (D7).
- **B2 — Actual future split-constructor SDK:** no released installed SDK exhibits the hypothesized
  split. P3 verifies the opposite today. The implementer must use T9's local mutation to demonstrate
  that the new assertion fails on the silent identity-fallback behavior.
- **B3 — No full prototype:** the real test was not added or gated during planning. The emulator
  probe verifies the behavior and scratch compilation verifies the exact spelling, but the
  implementer still owns the targeted test, mutation run, and full gate.
- **B4 — Sandbox-only invocation failure:** `npm run test:integration:emulator` failed during one
  planning attempt because the managed sandbox denied port probes (`listen EPERM`). Direct authorized
  `npx firebase emulators:exec ... "npm run test:integration"` ran the same 36-suite integration set
  green (G2). This is not a repository failure; the full gate was rerun outside that restriction as
  recorded in §12.
- **Carried over, explicitly deferred:** #41 remains the server-side/Pipeline distinct capability.
  Closed #75 and #77 remain intentionally unimplemented. None is reopened by this test.

## §6 API specification

There is no public API change. The following test-only blocks are copy-verbatim.

### 6.1 `src/tests/integration/helpers/firestoreIntegrationHarness.ts` — type the vector field

Add the type-only import beside the existing internal imports:

```ts
import type { VectorValueLike } from '../../../utils/pathTypes.js';
```

Replace `VectorDoc` with:

```ts
/**
 * Document shape for vector search integration tests.
 * Uses a top-level `embedding` field (recommended for emulator reliability).
 */
export interface VectorDoc {
  name: string;
  category?: string;
  status?: string;
  embedding: VectorValueLike;
}
```

Do not import `@google-cloud/firestore`, make the field optional, or add a local duplicate structural
type (T4, T6). The existing JSDoc already describes the symbol accurately.

### 6.2 `src/tests/integration/vector-search.integration.test.ts` — decoded equality regression

Extend the file header's verification sentence to include decoded `distinctValues` equality. Then add
this test immediately after the existing “top-level FieldValue.vector embedding” round-trip test:

```ts
it('I-1: distinctValues dedupes vectors decoded from stored documents by value (issue #76)', async () => {
  const names = ['distinct-vector-a', 'distinct-vector-b', 'distinct-vector-c'] as const;
  await Promise.all([
    vectorRepo.create({ name: names[0], embedding: FieldValue.vector([1, 2, 3]) }),
    vectorRepo.create({ name: names[1], embedding: FieldValue.vector([1, 2, 3]) }),
    vectorRepo.create({ name: names[2], embedding: FieldValue.vector([1, 2, 4]) }),
  ]);

  const distinct = await vectorRepo
    .query()
    .where('name', 'in', [...names])
    .orderBy('name', 'asc')
    .distinctValues('embedding');

  expect(distinct).toHaveLength(2);
  expect(distinct.map(value => value.toArray())).toEqual([
    [1, 2, 3],
    [1, 2, 4],
  ]);
});
```

The write calls exercise the repository, the query forces a fresh emulator read, the name filter
isolates the fixed harness collection, and `orderBy` makes first-seen order deterministic (T1, T7,
T8). No new symbol needs JSDoc; the existing file-level strategy header must mention the new
verification point.

### 6.3 Compile verification

The exact imports, required model field, repository writes, query chain, terminal call, and
`toArray()` assertion were compiled in `src/issue76-plan-compile.ts` with `npm run test:types`; the
scratch file was removed. An optional-field candidate failed TS18048 and was rejected. The required
field was also temporarily applied to the real harness and the entire current type suite passed; that
edit was reverted (P9–P10, V6–V8).

### 6.4 Size

Two existing test files, approximately +25 net lines. No production source, exported declaration,
runtime behavior, ADR, website, README, dependency, or configuration changes. The plan directory is
temporary and must net to zero before merge (§11).

## §7 Implementation sequence and anti-instructions

1. Check out `test/issue-76-decoded-vector-equality-coverage`; it already carries this plan. If
   `main` moved past `8c5ed6d`, rebase and re-run the §3 site enumeration before editing.
2. Update the harness import and required `VectorDoc.embedding` first (§6.1). This makes the new test
   compile without casts and lets TypeScript expose any stale vector fixture (T4).
3. Run `npm run test:types`. All current vector fixtures must remain clean.
4. Update the vector test file header and add I-1 exactly as in §6.2.
5. Run the targeted emulator command from §10. Expected post-change count: 1 suite / 35 tests.
6. Perform T9's mutation check: temporarily disable the vector-specific canonicalization branch in
   `src/utils/firestoreValueEquality.ts`, run only I-1, record the failure showing three decoded
   values instead of two, and restore the source. Confirm `git diff` contains no production edit.
7. Re-run the observational probe (§10). It must still report two distinct component arrays.
8. Perform the docs/ADR no-op audit in §9 and record it in `notes.md`; do not manufacture doc edits.
9. Run the full fourteen-leg gate (§10), update `notes.md`, and perform an independent refute-first
   review. Leave this plan directory present for external review.
10. After external review is complete and findings are resolved, remove this entire plan directory in
    the final cleanup commit before merge (§11).

### Anti-instructions

- **Do not** edit production code unless I-1 exposes a real failure on the unmodified current SDK;
  if it does, stop and report the scope change to the owner before proceeding (D2, P1).
- **Do not** assert `constructor`, `_values`, `_fromProto`, or `instanceof` in I-1 (D3, T2).
- **Do not** use `as any`, `as VectorDoc`, a non-null assertion, or optional `embedding` in the new
  test path (D5, T4).
- **Do not** import from `@google-cloud/firestore` (T6).
- **Do not** move this test to the unit suite or call the canonicalizer directly (T1).
- **Do not** query the entire fixed vector collection without the three-name filter (T7).
- **Do not** remove the unequal fixture or exact component assertion (T3, T8).
- **Do not** add a new ADR, alter ADR-0017/living-index footers, or edit consumer docs (D6, §9).
- **Do not** clean up the existing `as VectorDoc` casts as drive-by work (§2).
- **Do not** write `review.md`; self-review belongs in `notes.md` and chat.
- **Do not** remove the plan directory before external review; remove it after review and before
  merge.

## §8 Test specification

### 8.1 Integration suite — `src/tests/integration/vector-search.integration.test.ts`

| Id | Asserts | Observable when it fails | Guards |
| -- | ------- | ------------------------ | ------ |
| **I-1a** | Three genuine vectors survive repository writes and are read through `QueryBuilder.distinctValues`, not an in-process helper. | SDK/emulator/write/query failures reject the test; identity fallback returns three values. | T1, T5 |
| **I-1b** | The two decoded `[1,2,3]` vectors collapse to one. | `distinct` length is 3 or components include `[1,2,3]` twice. | T1, T2, T9 |
| **I-1c** | Decoded `[1,2,4]` remains distinct from `[1,2,3]`. | Length is 1 or exact component arrays omit/replace the unequal vector. | T3, T8 |
| **I-1d** | Returned values are usable through the public `VectorValueLike.toArray()` surface and retain deterministic first-seen component order. | Compile failure or component array mismatch. | T2, T4, T6, T8 |
| **I-1e** | Only the three named fixtures feed the terminal. | An unscoped query can produce extra values under parallel activity; the scoped query's exact result remains two arrays. | T7, T10 |

### 8.2 Required mutation proof

The current baseline behavior is already correct (P1), so adding I-1 and observing green is not proof
that the assertion sees the intended regression. Temporarily make the vector canonicalization
condition false so decoded vectors fall to identity, run only the I-1 test, and require a red result
whose observed length is 3. Restore production source and rerun I-1 green. Record both outputs and the
clean production diff in `notes.md`. This is the coverage-only equivalent of the planning skill's
“fails on unfixed baseline” requirement (T9); do not falsely claim the natural baseline is broken.

### 8.3 Trap coverage — inverse direction

| Trap | Site | Falsifying test | What it observes |
| ---- | ---- | --------------- | ---------------- |
| T1 | Test fixture/read path | I-1a/I-1b | A fresh query over stored documents yields two values; an in-process-only test cannot satisfy the setup. |
| T2 | Test assertions | I-1d | Only public `toArray()` and terminal output are observed; private constructor changes alone do not fail it. |
| T3 | Canonicalizer vector key | I-1c | Unequal components must remain as the second distinct result. |
| T4 | `VectorDoc` type | `test:types` + I-1d | Optional/missing field yields TS18048 or prevents typed field selection; no cast masks it. |
| T5 | Shared recognizer/authenticity boundary | I-1a + unchanged production diff | Runtime works without widening recognition; any production recognizer edit violates scope. |
| T6 | Harness import/type | `test:types` + package checks | Exact internal `VectorValueLike` import resolves without a transitive package import. |
| T7 | Fixed collection query | I-1e | Filtered names and exact arrays prevent unrelated vector rows from affecting output. |
| T8 | Output assertion | I-1c/I-1d | Exact component arrays catch both wrong cardinality and wrong survivor. |
| T9 | Silent identity fallback | Mutation run of I-1b | Disabled vector recognition returns three values and makes the test red. |
| T10 | Suite lifecycle | Existing `afterEach` + I-1 | The test remains in the established suite and its fixtures are removed by the shared cleanup. |

### 8.4 Coverage gates

| Changed path | Gate |
| ------------ | ---- |
| `src/tests/integration/helpers/firestoreIntegrationHarness.ts` | Excluded from LCOV (G4); compile-owned by `test:types`. |
| `src/tests/integration/vector-search.integration.test.ts` | Excluded from LCOV (G4); behavior-owned by the integration suite. It exercises integration-gated `QueryBuilder.ts` but adds no production branch. |

Run `test:integration:coverage` and `test:coverage:gate:integration` anyway. No gate-headroom claim is
needed because no covered production statement/branch/function is added or removed (G4–G5).

## §9 Docs and ADR bookkeeping

### 9.1 Bookkeeping — what does not apply

- **No new ADR:** the decision already exists in ADR-0034 (P14); #76 adds regression evidence without
  changing architecture, public API, return semantics, validation, or dependency floors.
- **No ADR-0017 amendment/living-index update:** although labeled `v3.x`, #76 is not one of
  ADR-0017's deferred capabilities. #40 already left that set under ADR-0034.
- **No amendment to ADR-0022:** nominal authenticity remains unchanged (R3).
- **No edit to ADR-0034:** its #76 link remains a useful historical follow-up reference after the
  issue closes, and its equality claim is unchanged (P14).
- **No Starlight edit:** query-builder reference, capabilities table, and migration guide already
  say exactly that VectorValue compares by value (P15). The frozen `website/src/content/docs/2.0/**`
  archive is never touched.
- **No README edit/readme-sync:** neither README owns this low-level equality detail; install, peer
  dependencies, pitch, quick start, migration links, and support links do not change (P16).
- **No testing-doc infrastructure sweep:** no test command, Jest config, harness location, factory,
  coverage matcher/threshold, workflow, or hook is added/renamed/moved/deleted. Correcting one test
  fixture interface and adding one test does not change documented infrastructure.
- **No changelog edit:** the changelog is generated; use the Conventional Commit subject in §10.

### 9.2 Required no-op verification

Before review, re-run and record that the consumer contract remains present and no #76-specific
documentation exists outside ADR-0034/this temporary plan:

```bash
rg -n "VectorValue.*by value|Bytes.*VectorValue|#76" docs/adr/0034-distinct-values-semantic-equality.md website/src/content/docs README.md npm-readme.md
```

Expected result: existing VectorValue equality wording in ADR-0034 and the v3 Starlight pages, plus
ADR-0034's two #76 follow-up references; no README result and no missing-contract result. This is an
audit, not a request to edit the matches.

## §10 Gate and commit

Use Node 24 as pinned by `.nvmrc`. Run the targeted file first:

```bash
npx firebase emulators:exec --project demo-firestoreorm-test --only firestore "npx jest --config jest.config.integration.js src/tests/integration/vector-search.integration.test.ts --runInBand"
```

Expected after implementation: 1 suite / **35 tests** (baseline G3 is 1 / 34).

Re-run the observational probe:

```bash
npx firebase emulators:exec --project demo-firestoreorm-test --only firestore "npm run build && node docs/plans/issue-76-decoded-vector-equality-coverage/probes/decoded-vector-read-path.mjs"
```

Expected: decoded constructors currently report `VectorValue`, all current `instanceof` observations
are `true`, the SDK equal/unequal observations are `true`/`false`, and the ORM distinct result is
`[[1,2,3],[1,2,4]]` with count 2.

Then run the full fourteen-leg gate:

```bash
npm run test:types && npm run lint && npm run check:format && npm run test:unit && npm run test:integration:emulator && npm run test:unit:coverage && npm run test:coverage:gate:unit && npm run test:integration:coverage && npm run test:coverage:gate:integration && npm run build && npm run check:package && npm run check:consumer && npm run check:docs && npm run docs:build
```

Report failures with output; never claim an unexecuted leg passed.

Baseline on `8c5ed6d`: unit **32 suites / 426 tests**; integration **36 suites / 544 tests**. After
implementation, unit must remain **32 / 426**; integration suites must remain **36** and tests must
increase to **545**. Targeted vector tests increase from 34 to 35. Both coverage gates must remain
green; no threshold movement is authorized.

Run the §9 grep after the change and interpret it as specified there. Confirm no production diff:

```bash
git diff -- src/core src/utils src/vector
```

Expected result: no output. Any output is a scope violation unless the owner explicitly approved a
scope change after a real baseline failure.

**Commit subject** (Conventional Commits; commitlint runs on `commit-msg`):

```text
test(query-builder): pin decoded vector equality (#76)
```

**Is it breaking?** No. The public contract and runtime are unchanged; this adds one integration
regression and corrects an internal test-fixture type to match the data it already writes. It belongs
in the unreleased v3.x line but requires no migration note.

## §11 Definition of done

| # | Item |
| - | ---- |
| 1 | D1–D7 remain satisfied: one narrow decoded-read regression, no speculative runtime/API work. |
| 2 | Harness `VectorDoc.embedding` is required and typed with the existing internal `VectorValueLike` (D5, P7–P10). |
| 3 | I-1 writes two equal and one unequal genuine vectors and reaches `query().distinctValues('embedding')` after emulator decoding (I-1a). |
| 4 | I-1 asserts length 2 and exact public component arrays `[[1,2,3],[1,2,4]]` (I-1b–I-1d). |
| 5 | I-1 scopes the fixed collection to its three names, is in the existing vector suite, and uses existing cleanup (I-1e, T7, T10). |
| 6 | No private SDK constructor/property assertion, `any` cast, non-null assertion, direct transitive import, or structural-recognizer change was introduced (T2, T4–T6). |
| 7 | T9 mutation check fails with three identity-distinct decoded vectors, then I-1 passes after restoration; both outputs are in `notes.md`. |
| 8 | Targeted suite is 1 / 35; unit is unchanged at 32 / 426; integration is 36 / 545. |
| 9 | Probe output still matches P1–P4 and is recorded in `notes.md`. |
| 10 | §9 audit confirms no ADR, website, README, test-infrastructure doc, or changelog edit is warranted. |
| 11 | `git diff -- src/core src/utils src/vector` is empty after the mutation is restored. |
| 12 | Nothing in §7's anti-instruction list was violated. |
| 13 | Full fourteen-leg gate is green with real output; both coverage gates pass without threshold changes. |
| 14 | `notes.md` is committed with commands, results, deviations, and refute-first self-review dispositions. |
| 15 | External review completes while this plan directory remains present; all findings are resolved. |
| 16 | Final cleanup commit runs `git rm -r docs/plans/issue-76-decoded-vector-equality-coverage/`; this temporary plan directory is removed from the PR before merge. |

## §12 Pre-handoff verification

What the planner ran before pushing this plan. The implementer must repeat the relevant rows after the
actual test exists.

| Check | Command / method | Result |
| ----- | ---------------- | ------ |
| Baseline identity | `git log -1 --oneline`; `git rev-parse HEAD`; `gh issue view 76 --json ...` | `8c5ed6d`; issue open, title/acceptance quoted above, label `v3.x`. |
| SDK topology | `npm ls firebase-admin @google-cloud/firestore --all` | One `firebase-admin@14.2.0` → one `@google-cloud/firestore@8.6.0` (P2). |
| Decoded read probe | Final §10 probe command | Passed three times; final run used the exact three-name `in` filter + `orderBy` query from §6. Output: all decoded `VectorValue`, `instanceof` true, SDK equality true/false, ORM count 2, components `[[1,2,3],[1,2,4]]` (P1–P4). |
| §6 optional candidate | Scratch `src/issue76-plan-compile.ts` + `npm run test:types` | Rejected: TS18048, `value` possibly `undefined` (P9). |
| §6 blocks compile as written | Same scratch with required field + `npm run test:types` | Clean. Exact repository calls/query/assertion compiled (P10). Scratch removed. |
| Exact harness import/model against all call sites | Temporarily applied §6.1 to the actual harness + `npm run test:types` | Clean. Edit reverted; only plan artifacts remain (P10). |
| Declaration emit | Applicability review | Not applicable: no public/exported declaration changes; `VectorDoc` is test-only and excluded from package build. |
| Baseline unit count | `npm run test:unit` | 32 suites / 426 tests passed (G1). |
| Baseline integration count | `npx firebase emulators:exec ... "npm run test:integration"` | 36 suites / 544 tests passed (G2). One prior indirect npm invocation hit sandbox `listen EPERM`; recorded in B4, not represented as green. |
| Targeted vector baseline | Targeted §10 command | 1 suite / 34 tests passed (G3). |
| Gate headroom | Applicability review against `jest.config.base.js` and gate script | Not applicable: changed files are excluded tests and a type-only harness field; no uncovered production branch is added (G4–G5). Full gates remain mandatory. |
| Docs/README enumeration | `rg` commands in §3 and §9 | Existing claims found at P14–P16; no missing or contradictory consumer surface. Expected no README equality detail. |
| Full §10 gate on plan branch | Exact fourteen-leg chain, Node `v24.18.0`; output `/tmp/issue76-plan-gate.log` | **Exit 0.** Types, lint, format, unit 32/426, integration 36/544, both coverage reruns and all dual-gate groups, build, package (98 files), packed consumer on Admin `^14`, docs check (188 files), and 61-page docs build all passed. |
| Unresolved conditionals | Re-read §§2–9 | None. Optional-vs-required resolved by P9–P10; docs/ADR resolved by P14–P16; runtime-vs-test resolved by P1/D2. |
| Trap coverage inverse walk | §4 against §8.3 | Every trap × site maps to an observable; T9 explicitly handles the correct-baseline exception. |

## Appendix — probe inventory

| File | What it proves |
| ---- | -------------- |
| `probes/decoded-vector-read-path.mjs` | On the installed SDK/emulator, stored vectors decode as the write constructor today and the public ORM terminal returns exactly the documented two-component distinct set. It is observational; I-1 is the durable assertion. |
