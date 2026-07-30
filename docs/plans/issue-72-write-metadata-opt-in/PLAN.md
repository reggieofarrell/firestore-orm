# Issue #72 — Write metadata (`writeTime`) opt-in on write results

**Implementer:** unassigned · **Reviewer:** unassigned · **Baseline:** `main` @ `07f72c3`
(`feat(query): add Core explainStream diagnostics (#65) (#84)`) · **Branch:**
`codex/issue-72-write-metadata-plan` — already created; this plan is committed and pushed before
implementation starts, so check it out and do not cut a new branch.

**Issue:** [#72](https://github.com/reggieofarrell/firestore-orm/issues/72) — labels `enhancement`,
`parity`, `v3.x`. It is the remaining write-metadata half split from #39, so it is an ADR-0017
parity deferral and §9's amendment/living-index work applies.

> **Acceptance (verbatim from the issue):** `writeTime` available opt-in on the non-transactional
> write surface; existing return shapes unchanged; the transaction carve-out documented.

---

## §0 How to use this plan

1. Read §1 and §4 before editing. The decisions are settled for this handoff; do not re-litigate
   them. Rebase this existing branch onto current `main`, then re-run §3's enumerations before code.
2. The snippets in §6 are contracts, not optional examples. Implement all listed overloads and the
   named shared helpers; their spelling and exact `firebase-admin/firestore` types were type-checked
   before handoff (§12). Re-run `probes/sdk-write-results.ts` with the emulator before and after.
3. Add the permanent tests in §8, prove each new test fails with the issue's implementation stashed,
   and record that mutation check plus every deviation in `notes.md`. Follow `plan-execution` for the
   required self-review.
4. Leave this directory in the PR through external review. The final cleanup commit deletes the
   whole directory only after review approval (§11).

## §1 Owner-approved decisions

| Id | Fork | Decision | Rejected alternative and why |
| --- | --- | --- | --- |
| **D1** (derived) | Option name | Add `{ withMetadata: true }`, matching #39's opt-in spelling. | A distinct `returnWriteTime` flag creates two metadata idioms with no gain. |
| **D2** (derived) | Result shape | Enrich the natural write result: `{ id, writeTime }` for id-returning single writes; `{ writeTime }` for `delete`; positional `{ id, writeTime }[]` for fixed batches; bulk delete returns `{ count, writeTimes }`. | A universal `{ result, metadata }` wrapper is a new public abstraction, conflicts with the `bulkWrite` success precedent, and makes simple `id` access noisier. |
| **D3** (derived) | Read-back mode | `returnDoc: true` and `withMetadata: true` are mutually exclusive in overloads and runtime validation. | Combining a converted read-back document with a commit receipt requires inventing a wrapper shape not requested by #72; it also obscures that `writeTime` is a commit result while the document is a later read. |
| **D4** (issue constraint) | Transaction methods | Do not add `withMetadata` to any `*InTransaction` method. | Returning a guessed timestamp or the transaction object would falsely claim per-operation commit metadata that the Admin SDK does not expose. |

## §2 Scope

### In scope

| Area | Change |
| --- | --- |
| Direct writes | `create`, `createWithId`, `update`, `patch`, `upsert`, and `delete` gain true/false overloads and use their actual `WriteResult.writeTime`. |
| Fixed batches | `bulkCreate`, `bulkCreateWithIds`, `bulkUpdate`, `bulkPatch`, and `bulkDelete` gain opt-in overloads; `commitInChunks` preserves write-result order across 500-operation commits. |
| Public contract | Export `WriteMetadata` / `WriteResultWithMetadata<T>` from the root, type-test every overload, and document the transaction/returnDoc carve-outs. |
| Durable records | Add an ADR, amend ADR-0017, update every live deferral footer, capability matrix, site docs, and package export test. |

### Explicitly out of scope

- `bulkWrite` — its successful `BulkWriteResult` already contains `writeTime` (P3); adding a flag is
  redundant and would change its mixed success/failure contract.
- Query-builder `update()` / `delete()` — not named by the issue, and their count result/hook contract
  is not a repository write-helper result (P5).
- `recursiveDelete` — the SDK does not return per-descendant `WriteResult`s (P6).
- All transactional writes — D4/P4.
- Read metadata, query terminals, vector wrappers, collection-group reads, Express status mapping,
  and frozen `website/src/content/docs/2.0/**` — read feature #39 or unrelated APIs (P7).

### Scope correction

The issue's `src/core/FirestoreRepository.ts` reference is materially incomplete: fixed-batch
results flow through `commitInChunks` and its bound signature in `QueryBuilder.ts`; changing only
the named public methods would silently discard batch timestamps or break query-builder typing (P2,
P5). `bulkWrite` is already complete rather than a missing bulk variant (P3).

## §3 Verified facts

### 3.1 SDK result provenance — `probes/sdk-write-results.ts`

| Id | Expression / condition | Observed | Note |
| --- | --- | --- | --- |
| **P1** | `DocumentReference.set()` | `Promise<WriteResult>` | SDK declaration `node_modules/@google-cloud/firestore/types/firestore.d.ts:1355`; emulator probe must print `directIsTimestamp:true`. |
| **P2** | `WriteBatch.commit()` | `Promise<WriteResult[]>`, one item per enqueued action | Same declaration; order is suitable for pairing captured ids to chunk results. |
| **P3** | `bulkWrite` success mapping | `{ index, id, op, ok: true, writeTime }` | `src/core/FirestoreRepository.ts:2999-3003`; leave unchanged. |
| **P4** | Transaction writes | `tx.set/update/delete` return `Transaction`, not `WriteResult` | `src/core/FirestoreRepository.ts:3942-4180`; no honest per-operation timestamp. |

Run exactly (expected JSON contains `true`, `1`, `true`):

```bash
firebase emulators:exec --project demo-firestoreorm-test --only firestore "npx ts-node docs/plans/issue-72-write-metadata-opt-in/probes/sdk-write-results.ts"
```

### 3.2 Current return and dispatch sites

| Id | File | Lines | Fact |
| --- | --- | --- | --- |
| **P5** | `src/core/FirestoreRepository.ts` | 1429-1450, 1500-1545 | `create` uses `add()` (only a ref); `createWithId` discards `create()`'s result. Auto-id create must change to `doc().set()` to obtain a receipt. |
| **P6** | `src/core/FirestoreRepository.ts` | 2269-2400, 2579-2719 | `update`/`patch` share `runUpdate`; `upsert` has separate create/update branches; `delete` discards its `WriteResult`. |
| **P7** | `src/core/FirestoreRepository.ts` | 1578-1757, 2439-2553, 2767-2840, 3594-3637 | Fixed helpers enqueue actions then discard every `batch.commit()` result. `bulkDelete` filters missing ids before committing. |
| **P8** | `src/core/QueryBuilder.ts` | 38-43, 1860, 2202, 2274 | Its injected `commitInChunks` is typed `Promise<number>` and query update/delete ignore it; change its return type to `Promise<WriteResult[]>` without exposing metadata there. |
| **P9** | `src/core/FirestoreRepository.ts` | 2951-3103 | BulkWriter already delivers an independent per-item receipt contract. |
| **P10** | `src/core/SnapshotMetadata.ts` | 13-40 | Reads export `WithMetadata<D>`; write metadata needs distinct names because it is a commit receipt, not snapshot provenance. |

### 3.3 Authoritative implementation enumeration

| File | Lines to change |
| --- | --- |
| `src/core/FirestoreRepository.ts` | 35-52, 1429-1456, 1500-1551, 1578-1757, 2269-2400, 2439-2553, 2579-2719, 2767-2840, 3594-3637 |
| `src/core/QueryBuilder.ts` | 38-43 |
| `src/index.ts` | 2-15 |
| `src/tests/types/write-metadata.type-test.ts` | new |
| `src/tests/integration/repository-write-metadata.integration.test.ts` | new |
| `src/tests/unit/packageExports.unit.test.ts` | 10-67 |
| `website/src/content/docs/reference/repository.md` | 198-283 |
| `website/src/content/docs/reference/types.md` | 14-57 |
| `website/src/content/docs/reference/scope-and-capabilities.md` | 34-56 |
| `docs/adr/` and `docs/adr/README.md` | claim next number/rebase-sensitive index |

**Deliberately NOT changed**

- `src/core/FirestoreRepository.ts:3942-4180` — transaction methods lack `WriteResult` (P4).
- `src/core/FirestoreRepository.ts:2951-3103` — `bulkWrite` has `writeTime` already (P3/P9).
- `src/core/QueryBuilder.ts:2146-2279` — separate count-returning query contract (P8/D2).
- `src/vector/**`, `src/core/CollectionGroup.ts`, `src/express/index.ts` — no write helper/result
  surface (P10); no error class or HTTP mapping changes.

### 3.4 Coverage headroom

Measured from the baseline `coverage/*/lcov.info` after the §10 coverage runs. The changed runtime
files belong to the integration gate; `src/index.ts` belongs to the unit gate. New branches must be
covered rather than consuming this slack.

| Gate | Lines (threshold; slack) | Branches (threshold; slack) | Functions (threshold; slack) |
| --- | --- | --- | --- |
| FirestoreRepository integration | 98.00%; 90%; 8.00pp | 92.28%; 75%; 17.28pp | 93.33%; 85%; 8.33pp |
| QueryBuilder integration | 96.38%; 90%; 6.38pp | 86.44%; 75%; 11.44pp | 100.00%; 95%; 5.00pp |
| Package entry unit | 100.00%; 100%; 0pp | 100.00%; 100%; 0pp | 75.76%; 65%; 10.76pp |

## §4 Traps

### T1 — Retaining `CollectionReference.add()` makes auto-id `create` incapable of reporting a receipt (P5)

`add()` resolves to a `DocumentReference`, not a `WriteResult`. Use `const docRef = writeCol().doc()`
then await `docRef.set(...)`; the generated id is client-side and therefore remains identical in kind.
I-1 catches the otherwise silent `undefined` timestamp.

### T2 — Concatenating chunk results after a failure lies about partial commits (P7)

`commitInChunks` must retain only successfully committed chunks, preserve their action order, and
keep the existing `WriteOutcomeError.committedWrites` accounting. Do not manufacture receipts for a
failed chunk. I-4 tests the >500 happy path; existing write-outcome tests remain the partial-failure
guard.

### T3 — Mapping `bulkDelete` against requested input instead of surviving snapshots invents timestamps (P7)

Missing ids are filtered before batch construction and return count zero today. Pair write results to
`capturedIds` / `targetRefs`, not the original normalized input; I-5 observes only existing ids.

### T4 — Forwarding both `returnDoc` and `withMetadata` creates an ambiguous, undocumented shape (D3)

Overloads must reject the combination and runtime must reject JavaScript callers before any write.
T-2 and I-6 make this observable; do not silently choose one flag.

### T5 — Re-typing the shared helper without QueryBuilder breaks its constructor injection (P8)

Update the private callback alias in `QueryBuilder.ts` to the new receipt-array return type while
continuing to ignore it at query write call sites. `test:types` catches the compile break.

## §5 Could not verify / bounds

- No full prototype was made: the public overload matrix is broad, but every runtime write site is
  statically enumerable. The implementer must expect type errors at every delegated `patch`/`upsert`
  call until options are threaded deliberately.
- The emulator probe is limited to `set` and `WriteBatch.commit`; permanent integration tests must
  cover `create`, `createWithId`, update, patch, both upsert branches, delete, all fixed batches, and
  the >500 boundary.
- A local `check:consumer` run validates only the installed Firebase Admin peer line; CI's peer
  matrix remains unverified until PR checks run.

## §6 API specification

### 6.1 `src/core/FirestoreRepository.ts` — public receipt types and options

```ts
/** Commit metadata returned only by a non-transactional write called with `{ withMetadata: true }`. */
export type WriteMetadata = { readonly writeTime: FirebaseFirestore.Timestamp };

/** A write's ordinary result paired with its commit metadata. */
export type WriteResultWithMetadata<R> = R & WriteMetadata;

type WriteMetadataOptions = { withMetadata: true; returnDoc?: false };
type NoWriteMetadataOptions = { withMetadata?: false };
```

Add `withMetadata?: boolean` to `UpdateOptions`; retain `merge`, `returnDoc`, and `lastUpdateTime`.
For each `returnDoc`-capable direct method, supply three overload cells: `{ returnDoc: true;
withMetadata?: false } → FirestoreDocument<T>`, `{ withMetadata: true; returnDoc?: false } →
WriteResultWithMetadata<{ id: ID }>`, and default/false → the existing result. The implementation
uses the actual `WriteResult` and returns `{ id, writeTime: result.writeTime }`; it runs after-hooks
before read-back exactly as today.

For `delete`, `{ withMetadata: true } → WriteMetadata`; default remains `void`. `patch` must forward
the flag to `update`; `upsert` must preserve it through both the existing and new-document branches.
Reject the impossible flag pair before any I/O with a clear error for JavaScript callers.

### 6.2 Fixed batches and chunk plumbing

```ts
private async commitInChunks(
  actions: ((batch: FirebaseFirestore.WriteBatch) => void)[],
): Promise<FirebaseFirestore.WriteResult[]>;

type FirestoreWriteBatch = (
  actions: ((batch: FirebaseFirestore.WriteBatch) => void)[],
) => Promise<FirebaseFirestore.WriteResult[]>;
```

Accumulate each `await batch.commit()` array in enqueue order, then return it; preserve the existing
500 action boundary and partial-error accounting. When false/omitted, fixed helpers retain their
current returns. When true, `bulkCreate`, `bulkCreateWithIds`, `bulkUpdate`, and `bulkPatch` return
`WriteResultWithMetadata<{ id: ID }>[]`; `bulkDelete` returns
`WriteResultWithMetadata<{ count: number; writeTimes: FirebaseFirestore.Timestamp[] }>` with count
equal to its existing surviving-document count and timestamps aligned to those writes.

Do not add the flag to QueryBuilder write terminals; only change their private callback type.

### 6.3 Root exports and JSDoc

```ts
export type {
  // existing exports …
  WriteMetadata,
  WriteResultWithMetadata,
} from './core/FirestoreRepository.js';
```

Every changed public method owes JSDoc: the opt-in return shape, `returnDoc` incompatibility, and
the transaction exclusion. The two new types must explain that `writeTime` is a successful commit
timestamp, not `DocumentMetadata.updateTime` and not a JSON-serialized server field.

### 6.4 Size

Approximately 8 files / 350–450 lines: one core implementation, one private callback type, root
exports, two new test files, package export test, website docs, ADR/index/amendments. Runtime changes
are confined to non-transactional repository writes.

## §7 Implementation sequence and anti-instructions

1. Check out this branch, rebase onto `main`, and re-run the §3 grep/line enumeration; claim the
   next free ADR number only after rebase.
2. Add receipt types/options and refactor `commitInChunks` first, then adjust QueryBuilder's private
   callback alias (T5). Preserve its count/error behavior before exposing it.
3. Implement direct writes: change auto-id `create` to `doc().set`, capture all direct receipts, and
   thread the flag through patch/upsert branches (T1/T4).
4. Implement batch projections by pairing receipts with already-captured ids/surviving delete refs
   (T2/T3), leaving false/default paths byte-for-byte semantically unchanged.
5. Add §8 type and emulator regression tests, mutation-check them against the unstaged implementation,
   then complete §9 docs/ADR bookkeeping.
6. Run §10, format only the intended implementation files, update `notes.md`, self-review, and leave
   this plan directory until external review.

### Anti-instructions

- **Do not** use `add()` for metadata-enabled `create`; it cannot return `writeTime` (T1).
- **Do not** change default return shapes, hooks, validation ordering, or `WriteOutcomeError` counts.
- **Do not** add write metadata to transactions, `bulkWrite`, query writes, or `recursiveDelete` (D4/P3/P4).
- **Do not** use `DocumentMetadata`/`WithMetadata` for commit receipts; those promise snapshot fields (P10).
- **Do not** edit frozen 2.0 docs or historic ADR-0017 amendment text; add a new amendment only.
- **Do not** commit implementation unless asked; report the §10 subject instead.

## §8 Test specification

### 8.1 Type — `src/tests/types/write-metadata.type-test.ts`

| Id | Asserts | Observable when it fails | Guards |
| --- | --- | --- | --- |
| T-1 | Each direct/fixed batch `{ withMetadata: true }` resolves to its exact enriched type; `writeTime` is `Timestamp`. | `ExpectEqual` or assignment fails. | T1-T3, T5 |
| T-2 | Default/false calls retain old shapes and `{ returnDoc: true, withMetadata: true }` is `@ts-expect-error`. | Old callers change type or the forbidden combination stops erroring. | T4 |
| T-3 | Every transaction helper rejects `withMetadata`. | `@ts-expect-error` becomes unused. | D4 |
| T-4 | Root import of both new types from `../../index.js` compiles. | Public export is missing. | §9 API bookkeeping |

### 8.2 Integration — `src/tests/integration/repository-write-metadata.integration.test.ts`

| Id | Asserts | Observable when it fails | Guards |
| --- | --- | --- | --- |
| I-1 | `create` auto-id, `createWithId`, `update`, `patch`, and both `upsert` branches return expected id plus `Timestamp`. | Missing/non-Timestamp `writeTime`, wrong id, or state not written. | T1, T4 |
| I-2 | Defaults for every direct method keep `{id}`/`void`; `returnDoc` still returns only converted doc. | A new `writeTime` leaks into legacy/default shape. | acceptance, T4 |
| I-3 | `bulkCreate`, explicit-id create, bulk update, bulk patch return positional ids/timestamps. | Receipt index no longer matches input id. | T2 |
| I-4 | 501-entry fixed batch returns 501 ordered timestamps and writes both chunk edges. | A chunk drops/reorders receipts. | T2 |
| I-5 | bulk delete metadata has count/timestamps only for existing docs; a missing requested id has no invented receipt. | Count/timestamp count diverges or absent id gains a receipt. | T3 |
| I-6 | JavaScript-shaped combined `returnDoc`/`withMetadata` options reject before write. | Ambiguous options silently choose a shape. | T4 |

Use `createUserRepoHarness`, a JSDoc strategy header, `trackUser`, and `cleanupTrackedUsers`; the
501 test may use a dedicated collection and `recursiveDelete` in `afterAll`. Test all new cases fail
on the unfixed baseline before retaining them.

### 8.3 Unit — `src/tests/unit/packageExports.unit.test.ts`

Add a compile/runtime-root-surface assertion appropriate for type-only exports by importing the
types in T-4; do not pretend type aliases exist at runtime. The runtime package export test remains
unchanged unless a runtime symbol is added (it is not).

### 8.4 Trap coverage

| Trap | Site | Falsifying test | Observable |
| --- | --- | --- | --- |
| T1 | auto-id `create` | I-1 | `writeTime instanceof Timestamp` after auto-id creation. |
| T2 | `commitInChunks`, batch 1 and 2 | I-3, I-4 | result index/id and 501 length remain positional. |
| T3 | `bulkDelete` filtered input | I-5 | `count === writeTimes.length === existing count`. |
| T4 | direct overload/runtime boundary | T-2, I-2, I-6 | compiler rejects pair; JS call rejects; legacy output has no receipt. |
| T5 | QueryBuilder injection | T-1 plus `test:types` | callback binding compiles while query helpers preserve count contract. |

Changed runtime paths (`FirestoreRepository.ts`, `QueryBuilder.ts`) are owned by
`test:coverage:gate:integration`; `src/index.ts` is owned by `test:coverage:gate:unit`; type tests
are excluded from coverage. Cover both branches rather than relying on coverage slack.

## §9 Docs and ADR bookkeeping

### 9.1 Required ADR work

1. Claim next `docs/adr/NNNN-write-metadata-opt-in.md` from `0000-template.md`; status `Accepted
   (v3.x, pending merge/release)`, date actual decision date, decider `maintainer`.
2. State D1-D4, Firestore receipt provenance, existing-shape compatibility, fixed-batch ordering,
   transaction exclusion, and rejected wrapper/combined-mode alternatives.
3. Add its row to `docs/adr/README.md` after rebase.
4. Add an ADR-0017 `> Amendment (3.0.0, issue #72)` snapshot stating write metadata now ships and
   the original #39 deferral is fully closed; never revise the issue #39 block at 133-139.
5. Grep every feature ADR with the living deferral footer, update its `(#N–#41)` wording and
   "have since shipped" references to include the new ADR. Do not hardcode the current file list;
   it is rebase-sensitive.

### 9.2 Website and API docs

| File | Baseline line | Edit |
| --- | --- | --- |
| `website/src/content/docs/reference/repository.md` | 198-283 | Add overloads/examples and explain metadata result, 500-chunk ordering, `returnDoc` conflict, and transaction exclusion. |
| `website/src/content/docs/reference/types.md` | 33-57 | Document `WriteMetadata`, `WriteResultWithMetadata`, and amended `UpdateOptions`. |
| `website/src/content/docs/reference/scope-and-capabilities.md` | 34, 56 | Move write metadata from deferred to supported and delete/replace #72 deferred row. |
| `src/index.ts` | 2-15 | Re-export both public types. |
| `src/tests/unit/packageExports.unit.test.ts` | 1-67 | Import-level public export coverage only. |

Website Markdown is prettier-exempt. Match surrounding style; run `npm run docs:build`, then grep
the built HTML for leaked literal `:::` (expected: no output) if adding an aside.

### 9.3 READMEs

Run `rg -n "writeTime|withMetadata|bulkWrite|returnDoc" README.md npm-readme.md`; expected current
output has existing generic write examples but no package-pitch/installation change. Document the
result and explicitly leave both READMEs unchanged unless a snippet would become inaccurate. The
`readme-sync` skill is not otherwise triggered.

## §10 Gate and commit

Run with Node 24 (`export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"`) and a clean tree:

```bash
npm run test:types && npm run lint && npm run check:format && npm run test:unit && npm run test:integration:emulator && npm run test:unit:coverage && npm run test:coverage:gate:unit && npm run test:integration:coverage && npm run test:coverage:gate:integration && npm run build && npm run check:package && npm run check:consumer && npm run check:docs && npm run docs:build
```

Measure baseline suite counts immediately after rebase; type and integration test counts must rise,
all unrelated suites must retain their passing count. Re-run the §3 probe and the README/docs greps;
the HTML grep's expected result is no matches. Report every failure verbatim rather than claiming a
green gate.

**Commit subject:** `feat(repository): add opt-in write metadata (#72)`

**Breaking?** No. Omitted/false options retain every existing return type and runtime shape; the only
new behavior is an opt-in overload. Rejection of the new invalid flag pair affects no previously
typed API.

## §11 Definition of done

| # | Item |
| --- | --- |
| 1 | D1-D4 implemented exactly, including transaction exclusion. |
| 2 | All §3 sites re-enumerated after rebase; all non-sites remain justified. |
| 3 | Direct and batch receipts are actual SDK write times; 500-chunk ordering and partial accounting survive. |
| 4 | Every §4 trap has its §8 observable test and every new test mutation-fails on baseline. |
| 5 | Root exports, JSDoc, website, ADR, ADR-0017 amendment, and all living indexes are updated. |
| 6 | README grep result and docs HTML `:::` check are recorded. |
| 7 | §10 fourteen-leg gate and probe rerun completed honestly; `notes.md` includes self-review. |
| 8 | Nothing in §7 anti-instructions was violated. |
| 9 | After external review, final cleanup commit runs `git rm -r docs/plans/issue-72-write-metadata-opt-in/`; the plan directory is absent before merge. |

## §12 Pre-handoff verification

| Check | Command / method | Result |
| --- | --- | --- |
| Baseline | `git log -1 --oneline` | `07f72c3 feat(query): add Core explainStream diagnostics (#65) (#84)` |
| Issue facts | `gh issue view 72 --json …` | Open; labels enhancement/parity/v3.x; acceptance copied verbatim. |
| SDK declaration + emulator probe | declaration grep and `firebase emulators:exec … npx ts-node probes/sdk-write-results.ts` | `WriteBatch.commit(): Promise<WriteResult[]>` at line 1355; probe printed `{"directIsTimestamp":true,"batchLength":1,"batchIsTimestamp":true}`. |
| Current site enumeration | `rg -n` write/metadata symbols in repository, query builder, tests, docs | P3-P10 sites recorded in §3. |
| §6 type spelling | temporary `src/__issue72-plan-spec.ts` containing every §6 alias + `npm run test:types`; removed with `apply_patch` afterward | zero diagnostics under Node 24. Exact `firebase-admin/firestore` `WriteBatch` import resolved. |
| Full baseline gate | exact fourteen-leg §10 command under Node 24 | all passed: types/lint/format; unit 32 suites / 425 tests; integration 35 suites / 534 tests; both coverage gates; build/package/consumer/docs/site build. First coverage retry had a transient emulator port conflict; the immediate retry passed. |
| Gate headroom | coverage outputs vs `scripts/check-coverage-gates.mjs` | exact measurements in §3.4. |
| §9 commands | README and living-footer `rg` commands in §§9-10 | Executed: only `npm-readme.md:121` matched the requested README terms; living footer matches enumerated in §3 evidence command output. |
| Unresolved conditionals | Re-read §§1-9 | None; D1-D4 are derived, settled decisions. |

## Appendix — probe inventory

| File | What it proves |
| --- | --- |
| `probes/sdk-write-results.ts` | Emulator-level `Timestamp` receipt behavior for direct set and one batch commit; permanent assertions belong in I-1/I-3. |
