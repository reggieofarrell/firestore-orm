# Issue #38 — BulkWriter-backed high-throughput write API + explicit recursive delete

**Implementer:** next agent / teammate · **Reviewer:** maintainer · **Baseline:** `main` @ `0528c6d`
(`docs(skills): add implementation-review skill and write-review command (#68)`) · **Branch:**
`feat/issue-38-bulkwriter-recursive-delete` — already created and pushed with this plan on it; check
it out, do not cut a new one

**Issue:** [#38](https://github.com/reggieofarrell/firestore-orm/issues/38) — labels `enhancement`,
`parity`, `v3.x`. This **is** in ADR-0017's parity/`v3.x` deferral set (it is the `#38` in the current
`(#38–#41)` remaining-deferrals range), so the full deferral bookkeeping in §9 applies: new ADR,
ADR-0017 amendment blockquote, living-index footer decrements across every feature ADR that carries
one, and the capability-matrix row move.

> **Acceptance (verbatim from the issue):** "high-throughput writes with per-item results; recursive
> delete of descendants, opt-in."

> **Baseline note.** All §3 facts, probe results and the prototype were produced against `939d535`.
> `main` then advanced to `0528c6d`, which touches **only** agent config and `docs/plans/README.md`:
> `git diff --stat 939d535..HEAD -- src/ website/ docs/adr/ package.json` is **empty** (run, output
> empty). Every line number and measurement below therefore holds at `0528c6d`, and
> `prototype.patch` applies cleanly to it (`git apply --check` — verified).

---

## §0 How to use this plan

1. Read §1 (settled — do not re-litigate) and §4 (traps) **before** writing code. §4 is the highest
   value section here: this API sits on an SDK whose failure modes are a silent hang, an unhandled
   rejection that kills the process, and a 36 %-of-the-time coin flip.
2. §6 blocks are copy-verbatim. They are **not** a specification written from reading — they are
   excerpted from a full prototype that was applied to real source and passed **all fourteen gate
   legs** (§3.8), including five consecutive clean full-integration runs. §12 records the
   verification.
3. Every claim in §3 was produced by an executed probe on this baseline. Probes are in
   `docs/plans/issue-38-bulkwriter-recursive-delete/probes/` — re-run them if you doubt one (§10 has
   the commands). **Do not trust the issue body over §3**; §2 lists where it is stale.
4. **`prototype.patch`** (committed beside this file) is the byte-exact diff of the verified
   prototype: `src/core/FirestoreRepository.ts`, `src/index.ts`, the integration test file, and the
   type-test file. It contains **no `PROTOTYPE` markers** — the JSDoc in it is the real, final JSDoc.
   You may apply it wholesale (`git apply docs/plans/issue-38-bulkwriter-recursive-delete/prototype.patch`)
   and then do §9, or type §6 out by hand. Either way §7's ordering and §9's bookkeeping are still
   yours to do, and the patch does **not** contain a single doc, ADR, or website edit.
5. **Follow the `plan-execution` skill** — it owns the implementer's contract: `notes.md` written as
   you go, the mutation checks, and the independent refute-first self-review you must pass before
   declaring this ready for external review.

---

## §1 Owner-approved decisions

| Id     | Fork | Decision | Rejected alternative and why |
| ------ | ---- | -------- | ---------------------------- |
| **D1** | Shape of the high-throughput write surface | **`bulkWrite(operations[], options?)`** — one method, mixed verbs in one call, array in → `BulkWriteResult[]` out. The ORM owns the whole writer lifecycle (create → enqueue → close → collect). | A **`repo.bulkWriter()` handle** (streaming-capable, results from `close()`): rejected as a larger surface — a new stateful public object with its own close/flush/use-after-close lifecycle — whose only real advantage is input that does not fit in memory, which the raw-SDK escape hatch already covers. **Per-verb methods** (`bulkWriteCreate/Update/Delete`): rejected — three surfaces to document and no mixed-op batches, which is the one thing BulkWriter is uniquely good at. Owning the lifecycle is also what makes T2 and T3 unreachable by callers. |
| **D2** | Lifecycle hooks on this path | **No hooks run, and `bulkWrite` throws when any of the six bulk hook events is registered**, unless the caller passes `{ skipHooks: true }`. | **No hooks, documented only**: rejected — a repository whose `afterBulkDelete` drives an audit trail silently stops firing when someone swaps `bulkDelete` for `bulkWrite`; a docs line is the only thing between the caller and the bug. **Before-hooks + after-hooks with succeeded ids**: rejected — it gives the same event names a second, weaker meaning (`afterBulkDelete` would no longer imply the set landed) and forces the `db.getAll` pre-read back onto the delete path, which is the cost this path exists to avoid. The loud guard matches the repo's existing fail-loudly style (`assertNoDuplicateIds`, `assertNonEmptyUpdatePayload`, the `select().onSnapshot()` guard). |
| **D3** | Recursive delete surface and return | **`recursiveDelete(id): Promise<void>`** — document-scoped (the document plus every descendant), no hooks, no count. "Opt-in" is satisfied by it being a separate, distinctly named, loudly documented method. | **`Promise<number>`**: rejected — a count is obtainable via a supplied writer's `onWriteResult` (R9) but would be dishonest: a delete of an already-absent document *succeeds* (P10), so the tally counts delete **operations**, not documents that existed. **A collection-wide variant**: deferred to §9.6 — genuinely fills a gap (`query().get()` + `bulkDelete` orphans subcollections) but is the most destructive call in the library and does not belong in the same PR. **A magic confirmation flag**: rejected as ceremony. |
| **D4** | Validation failures | **Per-item `{ ok: false, error: ValidationError }`** — one bad row out of 10 000 does not cost the import. Extends to every per-item input error: malformed id, empty update payload, dot-notation on create. | **Throw before any write** (today's `bulkCreate` behavior): rejected — it defeats the per-item contract in exactly the case it was added for. The precedent is already in the file: `safeValidate` exists so "one bad document should not fail the batch" (`src/core/FirestoreRepository.ts:1784`). **Split channels** (throw for data, per-item for backend): rejected — two failure channels out of one call. |
| **D5** | Duplicate ids in one call | **Rejected** (whole-call throw, reusing `assertNoDuplicateIds`). `(derived from evidence, not asked)` — the owner's D1 answer assumed duplicates would be *allowed* with enqueue-order semantics; probe 04 falsified that premise. | **Allow duplicates, last-enqueued wins**: rejected because it is not true. Two writes to one document go into separate batches whose commits **race** — measured **107/300 = 36 % inversions** (O1). The SDK's "writes to the same document will be executed sequentially" refers to batch *separation*, not commit order: its serializing `_lastOp` chain is global, not per-document. Allowing duplicates would ship a coin flip and a flaky test (it produced one — §5). |

---

## §2 Scope

### In scope

| Area | Change |
| ---- | ------ |
| `src/core/FirestoreRepository.ts` | Rename the existing **private** `bulkWrite` helper → `runBulkBatchWrite` (T1). Add four exported types, two private helpers, one private static const, and the public `bulkWrite` + `recursiveDelete` methods. |
| `src/index.ts` | Re-export the four new types (type-only). |
| `src/tests/integration/repository-bulk-writer.integration.test.ts` | New — 23 tests (§8.1). |
| `src/tests/types/bulk-write.type-test.ts` | New — 5 pinned type contracts (§8.2). |
| `docs/adr/0032-…` + ADR-0017 + 9 living-index footers + `docs/adr/README.md` | §9.2, §9.3. |
| 5 Starlight pages | §9.4. |

### Explicitly **out** of scope

- **A collection-wide recursive delete** (`db.recursiveDelete(collectionRef)`, verified working — R2).
  Deferred to the follow-up issue in §9.6 per D3. Do **not** add it here.
- **A `repo.bulkWriter()` streaming handle** — rejected in D1. Do not add it "while you're in there."
- **Exposing `onWriteError` / a retry-policy knob.** The SDK's default handler applies unchanged and is
  documented (P14). Wrapping it would mean exposing `BulkWriterError`, which is not even importable
  from the `firebase-admin/firestore` entry point (V2).
- **`set` with `merge: true`.** `patch` already covers merge-update semantics. A create-or-merge verb
  is a third semantic with no request behind it.
- **Any change to the fixed-batch helpers** (`bulkCreate`/`bulkCreateWithIds`/`bulkUpdate`/`bulkPatch`/`bulkDelete`).
  The issue is explicit: "do NOT silently replace the existing batch helpers." The only edit to them
  is the private-helper rename, which changes no behavior.
- **A new error class.** Every failure mode maps onto an existing one (P7/P8/P9 → `ConflictError` /
  `NotFoundError` / `PreconditionFailedError` through the *unchanged* `parseFirestoreError`). So
  `src/core/Errors.ts`, `src/core/ErrorParser.ts` and `src/express/index.ts` are all untouched (§3.6).

### Scope correction — where the issue is stale

The issue body lists no files or line numbers, so nothing there has rotted. Three of its framings do
need correcting, and the ADR must record the corrections rather than repeat the issue's wording:

1. **"per-write results, retry policy"** reads as if the ORM should expose a retry knob. It should
   not (out of scope above) — the SDK's default handler already retries its own transient set
   (codes `[8, 10, 14]` from `getRetryCodes('batchWrite')`, plus `INTERNAL` on deletes) up to
   `MAX_RETRY_ATTEMPTS = 10` (P14). Note the SDK's *own* d.ts JSDoc is stale here: it claims
   "UNAVAILABLE and ABORTED" and omits `RESOURCE_EXHAUSTED`. Describe it loosely in user docs
   ("transient statuses, up to 10 attempts") — that list is SDK-internal and may change.
2. **"parallel writes, throttling"** — throttling is exposed (`options.throttling`), parallelism is
   not configurable; it is a property of the writer, not a knob.
3. **"explicit `recursiveDelete` … with partial-failure documentation"** — partial failure is not
   representable in the return value, because the SDK returns `void` and rejects with an aggregate
   (R4/R8). The documentation obligation is therefore on the JSDoc + guide, not on a result type.

---

## §3 Verified facts

### 3.1 `BulkWriter` against the emulator — `probes/01-bulkwriter-emulator.mjs`

| Id | Expression / condition | Observed | Note |
| --- | --- | --- | --- |
| P1 | `db.bulkWriter()`, `create` + `set`, then `close()` | both fulfil; `WriteResult.writeTime` present | works on the emulator |
| **P2** | `await writer.set(ref, d)` with 1 op enqueued, no flush/close | **still pending after 1500 ms** | the deadlock. See T2 |
| P3 | 25 ops enqueued, await the first 20, no flush | first 20 settle **without** flush | `MAX_BATCH_SIZE = 20`, `bulk-writer.js:16`; a batch is scheduled only at `_opCount === maxBatchSize` or on flush/close (`bulk-writer.js:893–902`) |
| P4 | `close()` when an op failed | **`resolved`** | `close()` never rejects — success is *only* observable per-op |
| P5 | shape of a rejected per-op promise | `constructor.name === 'BulkWriterError'`, **`error.name === 'Error'`**, `code` is a **number**, keys `message, code, documentRef, operationType, failedAttempts` | `.name` is useless for detection. See T6 |
| P6 | colliding `create` + sibling `create` in one writer | sibling **landed**; collided doc kept its old value | not atomic |
| P7 | `create` on an existing id | `code: 6`, `operationType: 'create'` | → `ConflictError` via unchanged `parseFirestoreError` |
| P8 | `update` on a missing doc | `code: 5`, `operationType: 'update'` | → `NotFoundError` |
| P9 | stale `lastUpdateTime` on `update` **and** on `delete` | `code: 9` for both | → `PreconditionFailedError` |
| P10 | `delete` on a doc that does not exist | **fulfils** with a `writeTime` | not an error. See T8 |
| **P11** | a failing per-op promise left un-awaited | **1 unhandled rejection fired** | See T3 |
| P12 | `writer.set(...)` after `close()` | **throws synchronously**, plain `Error('BulkWriter has already been closed.')`, no `code` | See T7 |
| P13 | `close()` twice | second call `resolved` | safe in a `finally` |
| P14 | `onWriteError` returning `false` | handler called once, `failedAttempts: 1` | default handler retries `[8,10,14]` + delete-`13`, `failedAttempts < 10` (`bulk-writer.js:383–389`, `backoff.js:53`) |
| P15 | `db.bulkWriter({ throttling: { initialOpsPerSecond: 5, maxOpsPerSecond: 10 } })` | accepted, write succeeds | emulator honors the option object |
| **P16** | `db.terminate()` with one unclosed writer | **rejects**: "…There are 0 active listeners and 1 open BulkWriter instances." | See T4 |
| P17 | 600 `set` ops through one writer + `close()` | 600 fulfilled / 0 rejected, ~210 ms, 600 committed | exceeds the 500-op fixed-batch limit in one call |
| P18 | `set(ref, d, { merge: true })`, `update(ref, { 'nested.y': 42 })`, `create(col.doc(), d)` | all fulfil; merge left siblings intact; auto id is 20 chars | dot-notation and auto-ids behave as on `WriteBatch` |
| P19 | `flush()`, then more writes, then `close()` | both settle | flush does not close |

### 3.2 `Firestore.recursiveDelete()` against the emulator — `probes/02-…`, `probes/03-…`

| Id | Expression / condition | Observed | Note |
| --- | --- | --- | --- |
| R1 | `recursiveDelete(docRef)` on a doc with 4 descendants (depth 3) | target + all 4 gone; sibling doc and its descendant untouched | works on the emulator despite using a **kindless all-descendants** query (`QueryOptions.forKindlessAllDescendants`, `recursive-delete.js:getAllDescendants`) |
| R2 | `recursiveDelete(collectionRef)` | all docs + nested gone; a collection named `<id>X` **survived** | the null-byte upper bound is correct. Out of scope (§2) |
| R3 | missing document / never-written collection | both **resolve** | absence is not an error |
| R4 | resolved value | `undefined` | **no count**. Drives D3 |
| R5 | a caller-supplied `BulkWriter` after the call | still usable → **not closed** | `onQueryEnd` calls `writer.flush()`, never `close()` (`recursive-delete.js`). See T9 |
| R6 | an already-**closed** supplied writer | **throws synchronously** `Error('BulkWriter has already been closed.')` | `run()` calls `writer._verifyNotClosed()` synchronously. See T7 |
| R7 | two successive `recursiveDelete` calls, no writer supplied | both `ok` | the SDK's lazy `_bulkWriter` is reused **and is closed by `terminate()`** (`index.js:1209–1211`), so letting the SDK own it leaks nothing |
| R8 | forced delete failures | rejects with `GoogleError`, message `"2 deletes failed. The last delete failed with: "`, `code` = the **last** failure's | `.name` is `'Error'`; routed through `parseFirestoreError` it stays a `GoogleError` for unclassified codes |
| R9 | supplied writer + `onWriteResult` | counted **5** (3 kids + 1 grandkid + target) | a count *is* obtainable — deliberately not used (D3) |
| R10 | `recursiveDelete` on a **subcollection** document (`users/u1/posts/p1`) | `p1` + its `comments` gone; parent doc and sibling `p2` survive | subcollection repositories work unchanged |

### 3.3 Type resolution — temp file under `src/` + `npm run test:types` (removed after)

| Id | Expression | Observed |
| --- | --- | --- |
| V1 | `import type { BulkWriter, BulkWriterOptions } from 'firebase-admin/firestore'` | **resolves** — both are in the re-export allowlist (`firebase-admin/lib/firestore/index.d.ts`, single `export { … }` line) |
| **V2** | `import type { BulkWriterError } from 'firebase-admin/firestore'` | **FAILS**: `error TS2724: '"firebase-admin/firestore"' has no exported member named 'BulkWriterError'. Did you mean 'BulkWriter'?` |
| V3 | `FirebaseFirestore.BulkWriterError` / `.BulkWriter` / `.BulkWriterOptions` / `.WriteResult` / `.GrpcStatus`, and member access on each | all **resolve** via the global namespace |
| V4 | `tsc -p tsconfig.json --declaration --emitDeclarationOnly` on the prototype | emitted `core/FirestoreRepository.d.ts` contains **no** `@google-cloud/firestore` reference; `throttling?: FirebaseFirestore.BulkWriterOptions['throttling']` survives as a bare global reference |

V4 is the row that matters for packaging: `@google-cloud/firestore` is a transitive of the
`firebase-admin` peer and is in neither `dependencies` nor `peerDependencies`, so a direct import
would type-check locally and break a strict-pnpm consumer. §6 uses `FirebaseFirestore.*` throughout
for exactly this reason — **do not "clean it up" into an import** (T6).

### 3.4 Name collision — `grep`

| Id | Expression | Observed |
| --- | --- | --- |
| N1 | `bulkWrite` in `src/core/FirestoreRepository.ts` | already a **private** method at **`:2163`**, called at **`:2153`** (`bulkUpdate`) and **`:2256`** (`bulkPatch`). Adding a public one gives `error TS2393: Duplicate function implementation` at both sites. |
| N2 | `grep -rn "bulkWrite\b" src/ website/src/content/docs/ docs/ README.md npm-readme.md` excluding `FirestoreRepository.ts` | **no matches** — nothing outside that one file references the private helper, so renaming it is contained |

### 3.5 Same-document commit order — `probes/04-same-doc-commit-order.mjs`

| Id | Expression | Observed |
| --- | --- | --- |
| **O1** | 300 iterations of `set(ref,'first')` + `set(ref,'second')` in one writer, then read | last-enqueued won **193**, **first-enqueued won 107 (36 %)**, other 0 → **order is NOT guaranteed** |

Mechanism, from source: `_sendFn` starts a new batch when the current one already holds a write to
that ref (`bulk-writer.js:888–891`), so the two never share a batch — but each batch is dispatched by
its own `delayedExecution.promise.then(() => this._sendBatch(...))` microtask and awaits its own
`bulkCommit()` RPC. The chain that *does* serialize, `_lastOp` (`bulk-writer.js:830`), is **global to
the writer**, not per document. `processLastOperation` only asserts that one batch holds no duplicate
ref (`bulk-writer.js:212`). This is what D5 rests on.

### 3.6 Authoritative site enumeration (`main` @ `0528c6d`)

| File | Lines | What |
| ---- | ----- | ---- |
| `src/core/FirestoreRepository.ts` | insert new types **before `:58`** (`export type SafeResult`) | four exported types |
| `src/core/FirestoreRepository.ts` | `:2153`, `:2163`, `:2256` | rename private `bulkWrite` → `runBulkBatchWrite` (N1) |
| `src/core/FirestoreRepository.ts` | insert after `:2539` (end of `bulkDelete`), before `:2557` (`findByField`) | `BULK_HOOK_EVENTS`, `assertNoBulkHooksRegistered`, `toBulkWriteItemError`, `bulkWrite`, `recursiveDelete` |
| `src/index.ts` | `:2–12` (the `FirestoreRepository` type-export block) | add four type names |

Reused unchanged: `validateId` (`:346`), `toPrecondition` (`:1032`), `assertNoDuplicateIds`
(`:1043`), `normalizeUpdateDataForMerge` (`:1070`), `validateCreateData` (`:1109`),
`validateUpdateData` (`:1138`), `sanitizeUpdateData` (`:988`), `assertNonEmptyUpdatePayload`
(`:1002`), `writeCol` (`:980`).

**Deliberately NOT changed** (justify in your notes if you touch them):

- `src/core/Errors.ts`, `src/core/ErrorParser.ts`, `src/express/index.ts` — **no new error class.**
  Every backend refusal on this path is gRPC 5 / 6 / 9 (P7, P8, P9), all three already normalized by
  the existing `parseFirestoreError` (`ErrorParser.ts:25`, `:53`, `:68`) and already mapped to
  404 / 409 / 412 by the adapter (`express/index.ts:94`, `:112`, `:119`).
- `src/vector/index.ts` — **no `/vector` re-export needed.** The `VectorValueLike` and
  `QueryExplainResult` precedents (`src/vector/index.ts:21`, `:24`) exist because those types are
  returned by `/vector`-**only** surfaces. `bulkWrite` is a core-repository method; `withVectorSearch`
  takes a `FirestoreRepository` the consumer must construct from the root entry
  (`src/vector/withVectorSearch.ts:47`), so a `/vector` user already imports the root and can name
  `BulkWriteResult` there. The proxy forwards the new methods for free (`withVectorSearch.ts:58–62`),
  and `VectorEnabledRepository` is `FirestoreRepository<…> & { vectorQuery() }` (`:18`), so no type
  change is required either.
- `src/core/CollectionGroup.ts` — read-only surface by decision (ADR-0024); it has no `update`/`delete`
  precisely because bulk hooks are `id`-keyed and ids are not unique across a group. A group-wide
  recursive delete would inherit that problem and is not in the issue.
- `ReadOnlyTransactionalRepository` (`FirestoreRepository.ts:81–140`) — a positive **allowlist**
  interface listing pure/transaction-scoped members explicitly (rule stated at `:64`). Adding write
  methods to the class cannot widen it, and `bulkWrite`/`recursiveDelete` must stay absent from it.
- `docs/development/testing.md` — the `testing-docs-sync` rule fires on test *infrastructure*. This
  adds no harness, factory, mock, config, or script; and testing.md refers to test files only by glob
  (`:20`, `:22`, `:49`, `:162`), never individually. Verified by reading — no edit.
- Both READMEs — `grep -n "bulkCreate\|bulkDelete\|bulkUpdate\|BulkWriter\|recursiveDelete" README.md npm-readme.md`
  returns **nothing** (expected result: empty). No install/peer/quick-start/pitch change either, and
  the Roadmap section is a placeholder (`README.md:253–257`). §9.5.

### 3.7 Gate headroom — measured from `coverage/*/lcov.info` vs `scripts/check-coverage-gates.mjs`

Baseline `src/core/FirestoreRepository.ts` in the **integration** LCOV: `LF 3432 / LH 3354`,
`BRF 368 / BRH 335`, `FNF 77 / FNH 71`.

| Gate metric | Baseline | Threshold | Wholly-uncovered new units tolerated |
| --- | --- | --- | --- |
| lines | 97.73 % | 90 % | **294** |
| branches | 91.03 % | 75 % | **78** |
| functions | 92.21 % | 85 % | **6** ← binding constraint |

Functions is the tight one, and Istanbul counts arrow callbacks: `bulkWrite` adds several
(`fail`, `enqueue`, the two `then` handlers, the `flatMap`, the `forEach`, the `run` thunks). §8.1
exercises every one, so this is headroom you do not need — **measured after the change**, the gate
*improved*: lines 97.93 %, branches 91.47 %, functions 92.77 %.

`src/index.ts` (unit gate) needs its own note: its **lines threshold is 100 %**. The four additions
are `export type` only, which tsc erases, so the file's LCOV is untouched — verified, still
`100.00 / 100.00 / 75.00` after the change. Adding a **value** export not touched by
`packageExports.unit.test.ts` would fail the unit gate immediately (T10).

### 3.8 Prototype gate results

Full prototype applied to real source, then reverted; diff saved as `prototype.patch`. Legs run:

| Leg | Result |
| --- | --- |
| `test:types` | pass (after the N1 rename; see T1 for the two `TS2393` it produced first) |
| `lint` | pass |
| `check:format` | pass (needed `prettier --write` on the two new test files first) |
| `test:unit` | 31 suites / **383** tests — unchanged |
| `test:integration:emulator` | 32 suites / **479** tests · run **5 consecutive times, all green** |
| `test:unit:coverage` + `test:coverage:gate:unit` | all 3 unit gates pass; `src/index.ts` unchanged |
| `test:integration:coverage` + `test:coverage:gate:integration` | all 5 integration gates pass; FirestoreRepository improved (§3.7) |
| `build` | pass (dual ESM+CJS) |
| `check:package` | pass — 86 files, allowlist satisfied |
| `check:consumer` | pass — ESM+CJS root+vector compile and load, `/express` subpath OK (`firebase-admin@^14` only; see §5) |
| `check:docs` | pass — 178 doc files |
| `docs:build` | pass — 61 pages, Pagefind index built |

---

## §4 Traps

Ordered by how badly a reasonable implementer gets them wrong.

### T1 — `bulkWrite` is **already taken** by a private method; renaming the wrong one is the trap (N1)

`src/core/FirestoreRepository.ts:2163` declares `private async bulkWrite(updates, merge)` — the shared
batch pipeline behind `bulkUpdate` (`:2153`) and `bulkPatch` (`:2256`). Adding a public `bulkWrite`
produces two `error TS2393: Duplicate function implementation` (observed at `:2247` and `:2726` in the
prototype). This one is *not* silent — but the tempting fix is to rename the **public** method
(`bulkWriteMany`, `highThroughputWrite`), which quietly degrades the public API to dodge a private
name. Rename the **private** helper to `runBulkBatchWrite`. It is safe: N2 shows nothing outside that
file references it. Three edits — the declaration and its two call sites. Also update the two
`{@link bulkWrite}` references in the new JSDoc so they point at the public method, not the helper.

### T2 — Awaiting a per-operation promise before `flush()`/`close()` hangs forever, and only below 20 ops (P2, P3)

The SDK schedules a batch only when it reaches `MAX_BATCH_SIZE = 20` or when flush/close is called
(`bulk-writer.js:893–902`). Below 20 enqueued ops nothing is ever sent, so `await writer.create(...)`
before closing never settles: **no error, no timeout, no output** — the process just stops. Worse, it
is invisible to a large test: P3 shows 25 enqueued ops settle their first 20 with no flush at all, so
a "does it work at scale" test passes while a 3-op call deadlocks. §6 is structured so this cannot
happen: every per-op promise is collected into `settlements` and `Promise.all(settlements)` runs
**after** the `finally` block has closed the writer. **Do not** move that `await Promise.all` into the
`try`, and do not `await` inside the `forEach`. Guarded by I-1 (a 6-op call — below 20 — that must
resolve at all; if you reintroduce the bug the test times out at 30 s rather than failing an
assertion).

### T3 — An unobserved per-operation rejection kills the process (P11)

The SDK's per-op promise genuinely rejects, and Node's default `--unhandled-rejections=throw`
terminates on an unhandled one. P11 fired exactly one unhandled rejection from a single un-awaited
failing `create`. In §6 every promise returned by `run()` is immediately given a
`.then(onFulfilled, onRejected)` — both handlers present, so the chain always *fulfils* and nothing
escapes. **Do not** refactor that into `.then(...)` + a separate `.catch(...)`, and do not push the
raw promise into `settlements`. In Jest this fails loudly enough; in a consumer's server it is a crash
on a data-dependent code path.

### T4 — The writer must be closed on **every** path, or `db.terminate()` rejects forever (P16)

`bulkWriter()` increments `firestore.bulkWritersCount` and only `close()` decrements it
(`index.js:1138`, `:1148`); `terminate()` rejects while the count is above zero (`:1213`), with
"There are 0 active listeners and 1 open BulkWriter instances." Any early `return`/`throw` between
creating the writer and closing it leaks one permanently — invisible in tests, because nothing in the
suite calls `terminate()`, and only visible to a consumer at graceful shutdown. §6 puts
`await writer.close().catch(() => {})` in a `finally`. `close()` never rejects (P4) and is safe twice
(P13), so the `finally` is unconditional. The empty-input short-circuit deliberately returns **before**
the writer is created, for the same reason.

### T5 — Two writes to one document commit in an undefined order (O1)

36 % inversion measured. If you "improve" §6 by dropping the duplicate-id guard to allow a
create-then-update in one call, you ship a coin flip. It also produces a *low-frequency* flake, not an
obvious one: the first draft of this plan's test asserted last-write-wins and failed once in five
full-suite runs while passing in isolation — the tight-loop probe inverts 36 % of the time, but a
single lightly-loaded call usually lands in enqueue order because the rate limiter defers the second
batch. Believing the SDK's own "executed sequentially" JSDoc is the trap. Guarded by I-3.

### T6 — `BulkWriterError` is not importable from `firebase-admin/firestore`, and its `.name` lies (V2, P5)

`firebase-admin/firestore` re-exports an **allowlist** that includes `BulkWriter` and
`BulkWriterOptions` but **not** `BulkWriterError` — `import type { BulkWriterError } from
'firebase-admin/firestore'` is `TS2724`. Use `FirebaseFirestore.*` (V3), which is also what keeps
`@google-cloud/firestore` out of the emitted `.d.ts` (V4). Two follow-on hazards: `error.name` is
`'Error'`, not `'BulkWriterError'`, so any `name`-based detection silently never matches; and `code`
is a **number** (5/6/9), which is why `parseFirestoreError` already handles it — do not add a string
status branch.

### T7 — Some failures arrive as **synchronous** throws, not rejections (P12, R6)

`writer.create/set/update` throw synchronously on data the SDK cannot serialize and on a closed
writer (P12: plain `Error`, no `code`), and `db.recursiveDelete(ref, closedWriter)` throws
synchronously from `_verifyNotClosed()` (R6). A `.catch()`-only guard misses both, and the throw
escapes as a whole-call rejection instead of the intended per-item result. §6 wraps the `run()`
invocation itself in `try`/`catch`, separately from the promise handlers. **Do not** collapse those
two into one.

### T8 — `delete` on an already-absent document **succeeds** (P10)

It fulfils with a real `writeTime`. Two wrong "fixes": mapping it to `NotFoundError` for symmetry with
`delete(id)` (which only throws because of its own existence pre-read — `FirestoreRepository.ts:2398`),
and synthesizing a `deletedCount` from successful deletes, which would count an absent document as
deleted. This is precisely why D3 returns `void`. Guarded by I-6.

### T9 — Do not pass your own `BulkWriter` to `recursiveDelete` (R5, R7)

`recursiveDelete` only `flush()`es a supplied writer, never closes it, so supplying one hands you T4.
The SDK's internal lazy writer *is* closed by `terminate()` (`index.js:1209`), so passing nothing is
the option with no lifecycle to manage. The only reason to supply one is to count deletes via
`onWriteResult` (R9), which D3 rejected. §6 passes nothing — keep it that way.

### T10 — `src/index.ts` has a **100 %** lines threshold (§3.7)

`UNIT_GATES` requires `lines: 100, branches: 100` for `src/index.ts`
(`scripts/check-coverage-gates.mjs`). The four new exports are `export type` and are erased, so the
file's coverage is unchanged (verified). If you add a **value** export here, add a matching assertion
to `src/tests/unit/packageExports.unit.test.ts` or the unit gate fails on the very next run. Type-only
exports cannot be asserted at runtime — that is what §8.2's T-1 is for.

---

## §5 Could not verify / scope bounds

- **The one unreproduced suite failure.** During prototype gating, one full-integration run reported
  `1 failed, 477 passed` in the new file; I did not capture which assertion. Eight subsequent full
  runs (3 before the D5 change, 5 after) were green. Probe 04 then demonstrated the same-document
  commit race independently at 36 %, and that assertion was the only order-dependent one in the file,
  so it was removed on mechanism grounds rather than by reproduction. Residual risk: if you see a new
  intermittent failure in this file, **do not assume it is this**; capture the output.
- **`check:consumer` covered one peer major.** It defaults to the dev `firebase-admin@^14`, and that
  is the only leg I ran (its output names it). CI fans out over `^12` / `^13` / `^14` plus a
  pinned-firestore `^12` leg via `FIRESTORE_ORM_ADMIN_VERSION` / `FIRESTORE_ORM_FIRESTORE_VERSION`.
  Unverified locally: that `BulkWriter`/`BulkWriterOptions` are in the **`firebase-admin@^12` and
  `^13`** re-export allowlists, and that `FirebaseFirestore.BulkWriterError` exists in those older
  `@google-cloud/firestore` majors. V1–V3 were measured on `firebase-admin@14.2.0` only. This is the
  one place CI could still fail; if it does, the fallback is a locally declared structural type for
  the error shape (`{ code: number; operationType: string; failedAttempts: number; documentRef: { path: string } }`),
  which is the pattern `src/vector/` already uses for `VectorQuery`.
- **Emulator vs production for `recursiveDelete`.** R1/R2/R10 are emulator results. `recursiveDelete`
  uses a kindless all-descendants query; the emulator served it without an index. Whether production
  ever demands an index for it is unverified — if it does, the failure arrives as `FirestoreIndexError`
  through the existing parser, which is the right surface anyway.
- **Throughput numbers are emulator-local.** P17's ~210 ms for 600 ops says the path is not
  pathological; it is not a production benchmark, and no claim of the kind belongs in the docs.
- **Carried over, explicitly deferred** — a collection-wide recursive delete (§9.6), a
  `bulkWriter()` streaming handle, and any retry-policy surface. All three stay deferred.

---

## §6 API specification

Every block below is verbatim from the gated prototype (§3.8) and is reproduced byte-exactly in
`prototype.patch`. They compiled together as written, with these exact module specifiers, and
survived declaration emit without pulling in `@google-cloud/firestore` (V4). Recorded in §12.

### 6.1 `src/core/FirestoreRepository.ts` — rename the private helper (T1, N1)

Three edits, no behavior change:

- `:2163` `private async bulkWrite(` → `private async runBulkBatchWrite(`
- `:2153` `return this.bulkWrite(updates, false);` → `return this.runBulkBatchWrite(updates, false);`
- `:2256` `return this.bulkWrite(updates, true);` → `return this.runBulkBatchWrite(updates, true);`

Leave its JSDoc at `:2157` ("Shared batched-write pipeline for {@link bulkUpdate}…") as is — it
already describes the helper accurately and links only to public methods.

### 6.2 `src/core/FirestoreRepository.ts` — four exported types, inserted before `:58`

```ts
/**
 * The write verbs accepted by {@link FirestoreRepository.bulkWrite}.
 *
 * Each maps 1:1 onto a fixed-batch helper: `create` → {@link FirestoreRepository.bulkCreate} (or
 * {@link FirestoreRepository.bulkCreateWithIds} when `id` is supplied), `set` → the create branch of
 * {@link FirestoreRepository.upsert} minus its existence pre-read, `update` →
 * {@link FirestoreRepository.bulkUpdate}, `patch` → {@link FirestoreRepository.bulkPatch}, `delete` →
 * {@link FirestoreRepository.bulkDelete}.
 */
export type BulkWriteOperationKind = 'create' | 'set' | 'update' | 'patch' | 'delete';

/**
 * One entry in a {@link FirestoreRepository.bulkWrite} operation list.
 *
 * Discriminated on `op`, so each verb carries exactly the fields it supports: only `create` may omit
 * `id` (one is generated), and only the update/delete verbs accept a `lastUpdateTime` precondition.
 */
export type BulkWriteOperation<W extends object> =
  | { op: 'create'; id?: ID; data: CreateInput<W> }
  | { op: 'set'; id: ID; data: CreateInput<W> }
  | {
      op: 'update';
      id: ID;
      data: UpdateInput<W>;
      lastUpdateTime?: FirebaseFirestore.Timestamp;
    }
  | {
      op: 'patch';
      id: ID;
      data: UpdateInput<W>;
      lastUpdateTime?: FirebaseFirestore.Timestamp;
    }
  | { op: 'delete'; id: ID; lastUpdateTime?: FirebaseFirestore.Timestamp };

/**
 * Per-operation outcome from {@link FirestoreRepository.bulkWrite}, positional: `results[i]`
 * describes `operations[i]`, and `index` repeats that position so a filtered subset stays traceable.
 *
 * Discriminate on `ok`. A `BulkWriter` batch is **not** atomic, so a mixed array of successes and
 * failures is the normal outcome — never infer from one entry what happened to its siblings.
 */
export type BulkWriteResult =
  | {
      index: number;
      id: ID;
      op: BulkWriteOperationKind;
      ok: true;
      writeTime: FirebaseFirestore.Timestamp;
    }
  | {
      index: number;
      id: ID;
      op: BulkWriteOperationKind;
      ok: false;
      /**
       * Normalized library error — `ValidationError` for a schema/payload rejection,
       * `InvalidDocumentIdError` for a malformed id, and the usual
       * `NotFoundError` / `ConflictError` / `PreconditionFailedError` mapping for a backend refusal
       * (gRPC 5 / 6 / 9). Anything unclassified is preserved as-is.
       */
      error: Error;
      /**
       * How many times the SDK attempted this write before giving up. Present only for a failure the
       * backend reported (absent for a validation/id rejection, where no write was attempted).
       */
      failedAttempts?: number;
    };

/**
 * Options for {@link FirestoreRepository.bulkWrite}.
 */
export type BulkWriteOptions = {
  /**
   * Acknowledge that this path runs **no lifecycle hooks**. Required when the repository has any
   * bulk hook registered — without it `bulkWrite` throws rather than silently skipping them.
   */
  skipHooks?: boolean;
  /**
   * Forwarded verbatim to `db.bulkWriter({ throttling })`. Omit for the SDK default (ramping 500
   * ops/second); `false` disables throttling.
   */
  throttling?: FirebaseFirestore.BulkWriterOptions['throttling'];
};
```

`FirebaseFirestore.BulkWriterOptions['throttling']` is deliberate, not lazy: the importable
`BulkWriterOptions` (V1) would work in `.ts` but the global form is what keeps the emitted `.d.ts`
free of `@google-cloud/firestore` (V4, T6).

### 6.3 `src/core/FirestoreRepository.ts` — guards, inserted after `bulkDelete` (`:2539`)

```ts
  /**
   * Bulk hook events a fixed-batch helper would have run. {@link bulkWrite} runs none of them, so it
   * refuses to start when any is registered unless the caller passes `{ skipHooks: true }`.
   */
  private static readonly BULK_HOOK_EVENTS: readonly BulkHookEvent[] = [
    'beforeBulkCreate',
    'afterBulkCreate',
    'beforeBulkUpdate',
    'afterBulkUpdate',
    'beforeBulkDelete',
    'afterBulkDelete',
  ];

  /**
   * Refuses a {@link bulkWrite} on a repository whose bulk hooks would silently not fire.
   *
   * A hook bypass is exactly the failure the scope docs warn about for raw batches: audit trails and
   * cache invalidation stop running with no error and no log. The fixed-batch helpers cannot be
   * reused here — `afterBulkUpdate({ ids })` promises an all-or-nothing set, and BulkWriter is
   * per-item — so the honest options are "no hooks, loudly" or "no hooks, silently". This is the loud
   * one.
   */
  private assertNoBulkHooksRegistered(): void {
    const registered = FirestoreRepository.BULK_HOOK_EVENTS.filter(
      event => (this.hooks[event]?.length ?? 0) > 0,
    );
    if (registered.length === 0) return;
    throw new Error(
      `bulkWrite() runs no lifecycle hooks, but this repository has ${registered.join(', ')} ` +
        'registered. Use bulkCreate/bulkCreateWithIds/bulkUpdate/bulkPatch/bulkDelete (fixed 500-op ' +
        'batches, hooks run), or pass { skipHooks: true } to acknowledge that these hooks will not ' +
        'fire for this call.',
    );
  }

  /**
   * Normalizes a per-item failure the same way every other write path normalizes a whole-call one: a
   * raw `ZodError` becomes {@link ValidationError}, everything else goes through
   * {@link parseFirestoreError}.
   */
  private toBulkWriteItemError(error: unknown): Error {
    if (error instanceof z.ZodError) return new ValidationError(error.issues);
    return parseFirestoreError(error);
  }
```

`BulkHookEvent` is the existing private type at `:160` — in scope, no import needed. The `z.ZodError`
branch matters because `Validator.parseCreate/parseUpdate` throw a **raw** `ZodError`; every other
method converts it in its own `catch` (e.g. `:1425`), and per-item results need the same conversion
per item.

### 6.4 `src/core/FirestoreRepository.ts` — `bulkWrite`

The full method, JSDoc included, is `prototype.patch` hunk for `:2539+`. Reproduced here in full
because §6 must be executable from its own text:

```ts
  /**
   * High-throughput, **non-atomic** writes backed by the Admin SDK's `BulkWriter`, with a result per
   * operation.
   *
   * This is a *separate contract* from the fixed-batch helpers
   * (`bulkCreate`/`bulkCreateWithIds`/`bulkUpdate`/`bulkPatch`/`bulkDelete`), not a faster version of
   * them. Pick deliberately:
   *
   * | | Fixed batch (`bulk*`) | `bulkWrite` |
   * | --- | --- | --- |
   * | Atomicity | atomic at or below 500 ops | **never** — each op succeeds or fails alone |
   * | Failure | first failure throws; nothing after it is applied | per-item result; siblings still land |
   * | Hooks | run | **none** (throws if any bulk hook is registered — see `skipHooks`) |
   * | Retries | none | SDK default: transient statuses, up to 10 attempts per op |
   * | Throughput | 500-op sequential commits | parallel, rate-limit ramped |
   * | Duplicate ids | rejected | rejected (see below) |
   *
   * Duplicate ids are rejected here for a **stronger** reason than on the fixed-batch helpers. The
   * SDK puts two writes to one document in separate batches, but those batches are dispatched
   * concurrently and their commits race — `BulkWriter`'s internal ordering chain is global, not
   * per-document — so which of the two lands last is genuinely undefined. Sequence such writes with
   * separate `bulkWrite` calls (or a transaction) instead.
   *
   * Results are **positional**: `results[i]` describes `operations[i]`. Because a failure is a
   * normal, expected outcome, nothing here throws for a bad *item* — a malformed id, a schema
   * rejection, an empty update payload, or a backend refusal all land as that item's
   * `{ ok: false, error }` while every other operation still writes. Only whole-call problems throw
   * (registered hooks without `skipHooks`).
   *
   * Validation is unchanged per verb: `create` / `set` validate as a full create (dot-notation keys
   * and `FieldValue.delete()` rejected, ADR-0019), `update` / `patch` as a partial update, and
   * `patch` normalizes nested objects into field paths first — exactly as
   * {@link bulkPatch} does.
   *
   * @param operations - Operations to apply, in enqueue order
   * @param options - `{ skipHooks }` to acknowledge the no-hooks contract, `{ throttling }` to
   *   override the SDK's rate-limit ramp
   * @returns One {@link BulkWriteResult} per input operation, in input order
   * @throws {Error} If a bulk hook is registered and `skipHooks` is not `true`, or if two operations
   *   target the same explicit id
   *
   * @example
   * // Mixed operations in one high-throughput pass
   * const results = await userRepo.bulkWrite([
   *   { op: 'create', data: { name: 'Ada' } },
   *   { op: 'update', id: 'user-1', data: { status: 'active' } },
   *   { op: 'delete', id: 'user-2' },
   * ]);
   *
   * @example
   * // A 10k-row import where one bad row must not cost the other 9,999
   * const results = await userRepo.bulkWrite(rows.map(data => ({ op: 'create', data })));
   * const failed = results.filter(result => !result.ok);
   * console.log(`${results.length - failed.length} written, ${failed.length} rejected`);
   * for (const failure of failed) console.error(failure.index, failure.error.message);
   *
   * @example
   * // Cap the write rate, and acknowledge that hooks will not fire
   * await userRepo.bulkWrite(operations, {
   *   skipHooks: true,
   *   throttling: { maxOpsPerSecond: 200 },
   * });
   */
  async bulkWrite(
    operations: BulkWriteOperation<W>[],
    options?: BulkWriteOptions,
  ): Promise<BulkWriteResult[]> {
    if (options?.skipHooks !== true) this.assertNoBulkHooksRegistered();
    // Whole-call input misuse, checked before any I/O: two writes to one document commit in an
    // undefined order here (the SDK's ordering chain is global, not per-document), so an ambiguous
    // call is refused rather than resolved by a coin flip. Generated `create` ids cannot collide and
    // are excluded.
    this.assertNoDuplicateIds(
      operations.flatMap(operation => (operation.id === undefined ? [] : [operation.id])),
      'bulkWrite',
    );
    // Short-circuit before `db.bulkWriter()` so an empty call allocates nothing (and cannot leave an
    // unclosed writer behind, which would block `db.terminate()` forever).
    if (operations.length === 0) return [];

    const writeCol = this.writeCol();
    const writer =
      options?.throttling === undefined
        ? this.db.bulkWriter()
        : this.db.bulkWriter({ throttling: options.throttling });

    const results = new Array<BulkWriteResult>(operations.length);
    // Every settlement is a `.then(onOk, onErr)` chain that always fulfills, so no per-op rejection
    // ever escapes unhandled (the SDK's raw per-op promise DOES reject, and an unobserved one takes
    // the process down under Node's default `--unhandled-rejections=throw`).
    const settlements: Promise<void>[] = [];

    const fail = (index: number, id: ID, op: BulkWriteOperationKind, error: unknown): void => {
      results[index] = { index, id, op, ok: false, error: this.toBulkWriteItemError(error) };
    };

    const enqueue = (
      index: number,
      id: ID,
      op: BulkWriteOperationKind,
      run: () => Promise<FirebaseFirestore.WriteResult>,
    ): void => {
      let pending: Promise<FirebaseFirestore.WriteResult>;
      try {
        // `writer.create/set/update` throw SYNCHRONOUSLY on data the SDK cannot serialize (and on a
        // closed writer), so the call itself has to be guarded, not just its promise.
        pending = run();
      } catch (error) {
        fail(index, id, op, error);
        return;
      }
      settlements.push(
        pending.then(
          writeResult => {
            results[index] = { index, id, op, ok: true, writeTime: writeResult.writeTime };
          },
          (error: unknown) => {
            const failedAttempts = (error as { failedAttempts?: unknown })?.failedAttempts;
            results[index] = {
              index,
              id,
              op,
              ok: false,
              error: this.toBulkWriteItemError(error),
              ...(typeof failedAttempts === 'number' ? { failedAttempts } : {}),
            };
          },
        ),
      );
    };

    try {
      operations.forEach((operation, index) => {
        // Resolve the id first: it is the one field a failure result still needs, and `validateId`
        // must run before any ref is built (a slash-bearing id would address another collection).
        // Across the union `operation.id` is `ID | undefined` — only `create` can leave it out.
        const rawId: ID | undefined = operation.id;
        let id: ID;
        try {
          id = rawId === undefined ? writeCol.doc().id : this.validateId(rawId);
        } catch (error) {
          fail(index, typeof rawId === 'string' ? rawId : '', operation.op, error);
          return;
        }

        const docRef = writeCol.doc(id);

        try {
          switch (operation.op) {
            case 'create': {
              const validData = this.validateCreateData(operation.data);
              enqueue(index, id, 'create', () => writer.create(docRef, validData as any));
              return;
            }
            case 'set': {
              const validData = this.validateCreateData(operation.data);
              enqueue(index, id, 'set', () => writer.set(docRef, validData as any));
              return;
            }
            case 'update':
            case 'patch': {
              // `patch` normalizes nested objects into field paths BEFORE validating, so each leaf is
              // validated independently — the same order as `patch()` / `bulkPatch()`.
              const normalized =
                operation.op === 'patch'
                  ? this.normalizeUpdateDataForMerge(operation.data)
                  : operation.data;
              const validData = this.validateUpdateData(normalized);
              const writePayload = this.sanitizeUpdateData(validData);
              this.assertNonEmptyUpdatePayload(writePayload as Record<string, any>);
              const precondition = this.toPrecondition(operation.lastUpdateTime);
              enqueue(index, id, operation.op, () =>
                precondition
                  ? writer.update(docRef, writePayload as any, precondition)
                  : writer.update(docRef, writePayload as any),
              );
              return;
            }
            case 'delete': {
              const precondition = this.toPrecondition(operation.lastUpdateTime);
              enqueue(index, id, 'delete', () =>
                precondition ? writer.delete(docRef, precondition) : writer.delete(docRef),
              );
              return;
            }
          }
        } catch (error) {
          fail(index, id, operation.op, error);
        }
      });
    } finally {
      // ALWAYS close, on every path: a per-op promise stays pending until flush/close (below 20
      // enqueued ops nothing is even scheduled), and an unclosed BulkWriter makes `db.terminate()`
      // reject forever. `close()` itself never rejects and is safe to call twice.
      await writer.close().catch(() => {});
    }

    await Promise.all(settlements);
    return results;
  }
```

Structural invariants, each pinned to a trap — do not "simplify" any of them: the `finally` close
(T4), `Promise.all(settlements)` **after** the try/finally (T2), both handlers in one `.then` (T3),
the separate `try` around `run()` (T7), the duplicate guard before any I/O (T5), the empty
short-circuit before the writer exists (T4).

### 6.5 `src/core/FirestoreRepository.ts` — `recursiveDelete`

```ts
  /**
   * **Destructive.** Permanently deletes the document at `id` **and every descendant** — all
   * subcollections, at any depth — via the Admin SDK's `Firestore.recursiveDelete()`.
   *
   * Separate from {@link delete} on purpose. `delete(id)` removes one document and *orphans* its
   * subcollections (they survive, unreachable through the parent); this removes the whole subtree and
   * cannot be undone. Nothing outside the subtree is touched: siblings survive, and so does a
   * collection whose id merely shares a prefix with one being deleted.
   *
   * Three contract differences from every other write on this class:
   *
   * 1. **No lifecycle hooks run** — not `beforeDelete`/`afterDelete` for the target, and nothing for
   *    the descendants. The SDK streams name-only snapshots (`select(__name__)`), so there is no
   *    document data to hand a hook, and descendants live in collections this repository does not
   *    model. If your delete hooks are load-bearing, read + delete through concrete repositories
   *    instead.
   * 2. **No count is returned.** The SDK reports none, and one cannot be synthesized honestly: a
   *    delete of an already-absent document *succeeds*, so any tally would count delete operations
   *    rather than documents that existed.
   * 3. **Partial failure is possible and is reported as a whole-call error.** Deletes are issued in
   *    parallel with no atomicity across the subtree, so a rejection means "some deletes failed" —
   *    the SDK's error states how many, and carries the *last* failure's status code. Documents
   *    already deleted stay deleted; re-running is safe and idempotent.
   *
   * A missing document is **not** an error: there is simply nothing to delete, and the call resolves.
   *
   * @param id - Id of the document whose subtree is deleted
   * @throws {InvalidDocumentIdError} If `id` is not a single valid path segment
   * @throws {Error} If any delete in the subtree failed (message states the count; status code is the
   *   last failure's)
   *
   * @example
   * // Delete a user and everything beneath them (posts, posts' comments, …)
   * await userRepo.recursiveDelete('user-123');
   *
   * @example
   * // Works from a subcollection repository too — the subtree is scoped to that document
   * const postRepo = userRepo.subcollection('user-123', 'posts', postSchema);
   * await postRepo.recursiveDelete('post-1'); // deletes post-1 and its comments
   */
  async recursiveDelete(id: ID): Promise<void> {
    this.validateId(id);
    try {
      // Deliberately NOT passing our own BulkWriter: `recursiveDelete` only ever `flush()`es a
      // supplied writer (never closes it), and an unclosed writer blocks `db.terminate()`. The SDK's
      // own lazily-created writer is closed by `terminate()`, so letting it own the lifecycle is the
      // option with no leak to manage. We return `void`, so there is no count to collect either.
      await this.db.recursiveDelete(this.writeCol().doc(id));
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }
```

`validateId` is outside the `try` on purpose: a malformed id is a caller bug that must surface as
`InvalidDocumentIdError`, not get re-wrapped by `parseFirestoreError`.

### 6.6 `src/index.ts` — type-only re-exports

Add to the existing `export type { … } from './core/FirestoreRepository.js'` block (`:2–12`), after
`ReadOnlyTransactionalRepository`:

```ts
  BulkWriteOperationKind,
  BulkWriteOperation,
  BulkWriteResult,
  BulkWriteOptions,
```

Type-only, so `src/index.ts` coverage is unchanged (T10). No `src/vector/index.ts` change (§3.6).

### 6.7 Size

4 files. Measured with `git apply --numstat prototype.patch`:

| File | + | − |
| --- | --- | --- |
| `src/core/FirestoreRepository.ts` | 386 | 3 |
| `src/index.ts` | 4 | 0 |
| `src/tests/integration/repository-bulk-writer.integration.test.ts` | 444 | 0 |
| `src/tests/types/bulk-write.type-test.ts` | 180 | 0 |

So **+390 / −3** source, **+624** test. The 3 deletions are the private-helper rename's three lines
(§6.1) — nothing else in existing code changes. Runtime behavior change to existing methods: **none**.
Two new public methods, four new public types. Docs/ADR work (§9) is on top of this.

---

## §7 Implementation sequence and anti-instructions

1. Check out `feat/issue-38-bulkwriter-recursive-delete` — it already exists and carries this plan.
   If `main` has moved past `0528c6d`, rebase onto it and **re-verify the §3.6 line numbers before
   editing anything** (`FirestoreRepository.ts` is 3432 lines and every insertion point is stated by
   line).
2. **Rename the private helper first** (§6.1). If you add the public `bulkWrite` before this, you get
   two `TS2393` errors and no useful signal about your own code (T1).
3. Add the four types (§6.2), then the two guards + the static const (§6.3), then `bulkWrite` (§6.4),
   then `recursiveDelete` (§6.5). `bulkWrite` will not compile before §6.3 exists.
4. `src/index.ts` (§6.6). Run `npm run test:types` here — it should be clean before you write a test.
5. Tests (§8). **Verify each new test fails on the unfixed baseline**: `git stash` the source changes
   (keeping the test files) and confirm the whole file fails to compile/run, then unstash. For the two
   load-bearing behavioral ones, mutate instead of stashing — §8.3 says exactly what to mutate and
   what you must see.
6. Docs + ADR + bookkeeping (§9). This is where this repo's defects come from; work the tables row by
   row and tick them off in `notes.md`.
7. Full gate (§10), `prettier --write` (the two new test files need it — the prototype did),
   `notes.md`. Leave the plan directory in place for review — the cleanup commit that removes it comes
   after.

### Anti-instructions

- **Do not** rename the *public* `bulkWrite`; rename the private helper (T1).
- **Do not** restructure §6.4's promise plumbing. The `finally`-close, the `Promise.all` placement,
  the two-handler `.then`, and the separate `try` around `run()` each guard a specific measured
  failure (T2, T3, T4, T7). Every one of them looks like dead ceremony and none of it is.
- **Do not** allow duplicate ids "because the SDK executes same-document writes sequentially." It does
  not — 36 % inversions measured (T5, O1).
- **Do not** `import { BulkWriterError } from 'firebase-admin/firestore'` — it is not exported (V2),
  and do not swap any `FirebaseFirestore.*` reference for an import (V4, T6).
- **Do not** map a delete of an absent document to `NotFoundError`, and do not add a `deletedCount`
  to `recursiveDelete` (T8, D3).
- **Do not** pass a `BulkWriter` to `db.recursiveDelete` (T9).
- **Do not** touch `bulkCreate`/`bulkCreateWithIds`/`bulkUpdate`/`bulkPatch`/`bulkDelete` behavior,
  add a collection-wide recursive delete, add a `bulkWriter()` handle, or add a retry-policy option
  (§2 out of scope).
- **Do not** add a new error class or edit `Errors.ts` / `ErrorParser.ts` / `express/index.ts` (§3.6).
- **Do not** hand-edit `CHANGELOG.md`, or any generated agent config under `.cursor/`, `.claude/`,
  `.agents/`, `AGENTS.md`, `CLAUDE.md`.
- **Do not** commit unless asked; leave the tree clean and report the subject line (§10).

---

## §8 Test specification

The complete text of both files is in `prototype.patch` (they were written, run, and gated — 23
integration tests green five times, all type assertions firing). The tables below are the contract;
take the code from the patch.

### 8.1 Integration — `src/tests/integration/repository-bulk-writer.integration.test.ts`

Gate owner: **integration** (`FirestoreRepository.ts`). Harness: `createUserRepoHarness`,
`createValidatedRepo` + `getIntegrationDb`.

| Id | Asserts | Observable when it fails | Guards |
| --- | --- | --- | --- |
| I-1 | All five verbs in one 6-op call succeed; `index` matches position; `writeTime instanceof Timestamp`; `op` sequence exact; auto id is 20 chars and was the real write target; all six documents in their expected final state | 6 ops is **below** the 20-op auto-flush threshold, so a reintroduced T2 shows as a 30 s Jest timeout, not an assertion diff | T2, D1 |
| I-2 | `bulkWrite([])` resolves to `[]` | non-empty array, or a leaked writer | T4 |
| I-3 | Two ops on the same explicit id reject with `/bulkWrite\(\) received duplicate document id\(s\): bw-dup/`, and **nothing is written** | resolves instead of throwing → the ambiguity shipped | T5, D5 |
| I-4 | Two `create`s without ids are **not** duplicates; both succeed with distinct ids | throws "duplicate" → the guard wrongly counts generated ids | T5 |
| I-5 | Delete of an absent document reports `ok: true` | `ok: false` with `NotFoundError` → someone "fixed" P10 | T8 |
| I-6 | `{ throttling: { initialOpsPerSecond, maxOpsPerSecond } }` accepted, write succeeds | throw from `validateBulkWriterOptions` | P15 |
| I-7 | 600 ops in one call, all `ok` | any `ok: false`, or a timeout → the >500 claim is false | P17 |
| I-8 | A failing `update` (missing doc) yields `NotFoundError` + `failedAttempts: 1` + correct `id`/`op`, **while its sibling `set` lands** | sibling absent → atomicity assumed; whole call rejects → per-item contract broken | P6, P8, D1 |
| I-9 | `create` on a taken id → `ConflictError`, and the stored document is **unmodified** | `ok: true`, or the doc overwritten | P7 |
| I-10 | Stale `lastUpdateTime` → `PreconditionFailedError` on `update` **and** on `delete` (separate calls, per I-3); neither write applied | wrong error class, or the write landed | P9 |
| I-11 | A still-matching `lastUpdateTime` succeeds and the write lands | `ok: false` → the precondition is passed even when absent | T7 |
| I-12 | `id: 'nested/slash'` → per-item `InvalidDocumentIdError`, `failedAttempts` **undefined**, sibling lands, no whole-call throw | the call rejects → a bad id kills the batch | D4 |
| I-13 | `{}` as an update payload → per-item `ValidationError` | whole-call throw, or an empty write reaching Firestore | D4 |
| I-14 | Dot-notation keys on `create` → per-item failure matching `/Dot-notation keys are not supported/`, document absent | a literal dotted field name written | D4 |
| I-15 | On a schema repo: 3 creates, the middle one invalid → `ok/ValidationError/ok`, and **exactly** the two valid rows stored | all three rejected → per-item validation lost | D4 |
| I-16 | With `afterBulkDelete` registered, `bulkWrite` rejects with `/runs no lifecycle hooks/` | resolves → hooks silently bypassed | D2 |
| I-17 | `{ skipHooks: true }` proceeds, the write lands, and the registered bulk hooks **did not fire** | hook fired → the contract is a lie; still throws → opt-out broken | D2 |
| I-18 | A repo with only `afterCreate` (single-doc) registered runs **without** the guard, and that hook does not fire | throws → the guard is over-broad (the fixed-batch helpers do not run single hooks either) | D2 |
| I-19 | `recursiveDelete` on a subtree (2 posts, 1 nested comment, 1 tag) removes target + all 4; a sibling subtree keeps its doc, 2 posts and 1 comment | sibling data gone → over-deletion, the worst possible failure here | R1 |
| I-20 | `recursiveDelete` on a never-existing id resolves; a second call on an already-deleted subtree resolves | throws → absence treated as error / not idempotent | R3 |
| I-21 | `recursiveDelete('nested/slash')` **throws** `InvalidDocumentIdError` | resolves, or a per-item-style result | §6.5 |
| I-22 | `recursiveDelete` fires no `beforeDelete` / `afterDelete` / `beforeBulkDelete`, and the doc is gone | any hook fired → an undocumented hook contract | D3 |
| I-23 | From a subcollection repo, `recursiveDelete('p1')` removes `p1` + its comments, leaving the parent doc and sibling `p2` | parent or `p2` gone → path scoping wrong | R10 |

### 8.2 Type — `src/tests/types/bulk-write.type-test.ts`

Gate: `test:types`. Every `@ts-expect-error` fails the build if its line stops erroring.

| Id | Asserts | Observable when it fails |
| --- | --- | --- |
| Y-1 | All four types nameable from `../../index.js`; `throttling: false` and an object form both assignable | TS2305 on the import → §6.6 missed |
| Y-2 | `create` may omit `id`; `set`/`delete` may **not**; `create` rejects `lastUpdateTime`; `delete` rejects `data`; `'upsert'` is not a verb | an unused-`@ts-expect-error` error → the union stopped discriminating |
| Y-3 | `create` requires the full create input; `update` accepts a partial; a wrong field type is rejected | same |
| Y-4 | `BulkWriteResult` narrows on `ok`: `writeTime` only when `ok`, `error`/`failedAttempts` only when not | same |
| Y-5 | `bulkWrite` returns `Promise<BulkWriteResult[]>`; `recursiveDelete` returns `Promise<void>` and takes exactly one argument | a second parameter silently accepted |

### 8.3 Mutation checks (do these, record the output in `notes.md`)

| Mutation | Test that must fail | What you must see |
| --- | --- | --- |
| Move `await Promise.all(settlements)` from after the try/finally to inside the `try`, before the `finally` | I-1 | Jest **timeout at 30 s** (not an assertion failure) — proves I-1 can observe T2 |
| Delete the `finally` block's `await writer.close()` | I-1 | timeout — every per-op promise stays pending |
| Replace the two-handler `.then(onOk, onErr)` with `.then(onOk).catch(onErr)` | I-8 | still green — **so also** run the file with `node --unhandled-rejections=strict` reasoning in mind and note in `notes.md` that T3 is guarded by review, not by a test (see the gap below) |
| Remove the `assertNoDuplicateIds` call | I-3 | I-3 fails (resolves instead of rejecting) |
| Drop `skipHooks` from the guard condition | I-17 | I-17 fails with the guard's message |
| Change `recursiveDelete` to pass `this.db.bulkWriter()` | none | **no test fails** — T9 is a review-only invariant (see the gap below) |

### 8.4 Trap coverage — the inverse direction

| Trap | Site | Falsifying test | What it observes |
| --- | --- | --- | --- |
| T1 | `FirestoreRepository.ts:2153/2163/2256` | `test:types` | `TS2393 Duplicate function implementation` — a compile failure, not a runtime one |
| T2 | `bulkWrite` promise plumbing | I-1 (6 ops, under the 20-op threshold) | 30 s timeout; I-7's 600 ops would **not** catch it (P3) |
| T3 | `enqueue`'s `.then` | **none — gap.** Jest installs its own `unhandledRejection` handling, so a leaked rejection does not fail the suite | Mitigated by: both handlers are in one `.then` in §6.4, the §7 anti-instruction, and the §8.3 mutation row. Named here rather than left implicit. |
| T4 | `finally` close | I-1 / I-2 indirectly (a missing close hangs I-1); **no test calls `db.terminate()`** | Gap acknowledged: the terminate symptom is unobservable in this suite (the harness shares one app across all 32 suites, so terminating it would break them). Guarded by the `finally` + review. |
| T5 | `bulkWrite` duplicate guard | I-3 | rejection message names the duplicated id; and no document written |
| T5 | same-document ordering claim in docs/JSDoc | `probes/04` (re-run in §10) | 36 % first-enqueued wins — pins the *reason* the guard exists |
| T6 | type of `BulkWriteOptions.throttling`, `failedAttempts` read | `test:types` + `build` | TS2724 if someone switches to the import; `build` emits the `.d.ts` that `check:consumer` then compiles |
| T7 | `enqueue`'s `try` around `run()` | I-11 (precondition present) and I-14 (sync validation throw path) | I-14's failure surfaces as a per-item result rather than a rejected call |
| T8 | `bulkWrite` delete verb | I-5 | `ok: true` for an absent document |
| T8 | `recursiveDelete` return type | I-20, Y-5 | resolves to `undefined`; `Promise<void>` pinned at type level |
| T9 | `recursiveDelete` writer argument | **none — gap.** Passing a writer still works; the leak is only visible via `terminate()` | Guarded by the §6.5 comment, the §7 anti-instruction, and the §8.3 mutation row |
| T10 | `src/index.ts` | `test:coverage:gate:unit` | `lines: <100% (threshold 100%)` the moment a value export goes untested |

Three honest gaps (T3, T4, T9) share a root cause: their symptoms are process-lifecycle events that
an emulator suite sharing one Firebase app cannot observe. They are the reason §7's
anti-instruction list exists. **Do not** invent a test that appears to cover them.

### 8.5 Coverage gates

| Changed path | Gate |
| --- | --- |
| `src/core/FirestoreRepository.ts` | `test:coverage:gate:integration` |
| `src/index.ts` | `test:coverage:gate:unit` (100 % lines — T10) |
| `src/tests/types/*.type-test.ts` | none (excluded from coverage); enforced by `test:types` |

Measured headroom is §3.7 — after the change the integration gate *improves*. Do not reason about
gate risk here.

---

## §9 Docs and ADR bookkeeping

### 9.1 What does **not** apply

- **No new error class** → `src/core/Errors.ts`, `src/core/ErrorParser.ts`, `src/express/index.ts`
  and `website/src/content/docs/reference/errors.md` need **no** edit for a new type. Evidence: §3.6,
  P7/P8/P9. (`errors.md` does get one small edit — 9.4 — but for *where* those errors now appear, not
  for a new one.)
- **No `readme-sync` run.** Both READMEs grepped (§3.6) — no bulk-helper mention, no install/peer/
  quick-start/pitch change. Say so in the PR body.
- **No `testing-docs-sync` edits.** No test infrastructure added; `docs/development/testing.md`
  references test files only by glob (§3.6). `docs/development/test-coverage-followups.md` — grep it
  for `bulkWrite|BulkWriter|recursiveDelete` and only edit if it lists this as a gap (expected: no
  match, therefore no edit).
- **No `src/vector/index.ts` re-export** — reasoning and evidence in §3.6.
- **No sidebar entry** in `website/astro.config.mjs` — no new page is created; every edit lands in an
  existing one.
- **No `guides/migration-v2-to-v3.md` edit** — and this one is a trap worth naming, because **#37 did
  edit it** (`:176–179` documents `explain()`), so copying #37's checklist leads you to look for a
  slot. Read why it does not apply: that page is organized as v2→v3 *breaking changes* plus a
  migration checklist. `aggregate(spec)` (#34) and `explain()` (#37) appear inside **breaking section
  9, "Aggregations"** (`:165`), because they attach to an aggregation contract the reader is already
  being told changed. `bulkWrite` / `recursiveDelete` have no v2 equivalent and break nothing, so
  there is nothing to migrate *from*. The "Recommended upgrades (non-breaking)" section (`:460`) holds
  one entry, and it is a v2-workaround replacement, not a v3.x feature list. Verified by reading the
  whole page.
- **No `src/benchmarks/performance.test.ts` edit** — it benchmarks `bulkCreate` (`:51`),
  `bulkUpdate` (`:73`) and `bulkDelete` (`:78`), so a `bulkWrite` row would be a natural companion. It
  is deliberately skipped: the file runs only under the manual `test:performance` script, is in
  `eslint.config.js` `ignores` and `collectCoverageFrom`'s exclusions, and is in **no** gate leg and
  no CI job. A benchmark that nothing runs is not evidence. If you want one, open it as a separate
  chore — do not fold it into this PR.

### 9.2 New ADR — `docs/adr/0032-bulkwriter-high-throughput-writes-and-recursive-delete.md`

From `docs/adr/0000-template.md`. Status `Accepted (v3.x, pending merge/release)`, Date `2026-07-28`
(or the day you write it), Deciders `maintainer`. **Claim the next free number by listing
`docs/adr/` — do not assume `0032` if another issue merged first.** Must contain:

1. **Context** — ADR-0017 deferred `BulkWriter` + recursive delete as #38. The fixed-batch helpers are
   atomic-at-500, throw on first failure, and run hooks; a 10k-row import needs the opposite on every
   axis. State the SDK facts that shape the contract: not atomic (P6), `close()` never rejects (P4),
   per-op promises pend until flush/close (P2/P3), a leaked rejection is fatal (P11), an unclosed
   writer blocks `terminate()` (P16), and same-document commit order is undefined (O1, 36 % measured).
2. **Decision** — D1–D5 verbatim in substance: `bulkWrite(operations[], options?)` with positional
   per-item results; no hooks, enforced by a loud guard with `skipHooks`; per-item validation
   failures; duplicate ids rejected *because ordering is undefined*; `recursiveDelete(id)` returning
   `void`, document-scoped, hook-free.
3. **Consequences** — two write contracts now coexist and callers must choose; the capability matrix
   moves #38 Deferred → Supported; the raw-SDK `BulkWriter` escape-hatch example in the scope page is
   no longer the only route; no count from `recursiveDelete`; a collection-wide variant stays deferred
   (link §9.6's issue); `bulkWrite` is the first ORM write path that runs no hooks by design.
4. **Alternatives considered** — the rejected column of §1, including why a `bulkWriter()` handle and
   a retry-policy knob were rejected, and why "allow duplicates, last write wins" is not merely
   undesirable but **false**.
5. **References** — `src/core/FirestoreRepository.ts` (`bulkWrite`, `recursiveDelete`), the two test
   files, ADR-0017, ADR-0019 (delete-sentinel rejection on the create verbs), ADR-0029 (`bulkDelete`'s
   consistent pre-read — the contrast case), and issue #38. Do **not** link the mutable usage docs.
6. **Living-index footer** — it closes an ADR-0017 deferral, so end with the standard blockquote-style
   footer naming the **new** remaining range `(#39–#41)` and listing every already-shipped issue.
   Copy the shape from `docs/adr/0031-query-explain.md:101–105` (the trailing
   `This record **amends ADR-0017**: …` paragraph).

Then add the row to `docs/adr/README.md` after line **61** (the `0031` row), matching the existing
column widths.

### 9.3 ADR bookkeeping edits

| File:line | Edit | Expected after |
| --- | --- | --- |
| `docs/adr/0017-v3-core-operations-scope.md` — new blockquote **after** `:114` | Add `> Amendment (3.0.0, issue #38):` — BulkWriter high-throughput writes + explicit recursive delete are no longer deferred; name `bulkWrite(operations)` and `recursiveDelete(id)`, the no-hooks contract, and that a collection-wide recursive delete stays deferred. End with "The remaining deferrals (#39–#41) are unchanged…". Rationale: ADR-0032. | a 9th amendment blockquote |
| `docs/adr/0017-…:51–114` | **Do not touch** the eight existing amendment blockquotes — including `:113`'s `(#38–#41)`. They are historical snapshots (`docs/adr/README.md` Conventions). | unchanged |
| `docs/adr/0017-…:143` | References bullet: `#38–#41` → `#39–#41`, and append the `#38 is closed by the 3.0.0 bulkWrite / recursiveDelete API (ADR-0032)` clause to the existing chain. | `#39–#41` |
| `docs/adr/0023-…:200` | living-index footer: `(#38–#41)` → `(#39–#41)`; add `#38` + ADR-0032 to the "have since shipped" list | `(#39–#41)` |
| `docs/adr/0024-…:149` | same | `(#39–#41)` |
| `docs/adr/0025-…:93` | same | `(#39–#41)` |
| `docs/adr/0026-…:136` | same | `(#39–#41)` |
| `docs/adr/0027-…:163` | same | `(#39–#41)` |
| `docs/adr/0029-…:127` | same | `(#39–#41)` |
| `docs/adr/0030-…:85` and `:116` | **two** occurrences in this file — a Consequences bullet *and* the footer | both `(#39–#41)` |
| `docs/adr/0031-…:65` and `:102` | **two** occurrences — a Consequences bullet *and* the footer | both `(#39–#41)` |

Re-derive that list rather than trusting it — the set grows with every shipped issue:

```bash
grep -rn "#38–#41" docs/adr/ website/
```

Expected **before** your edits: **12** hits — the 12 rows above (10 in feature ADRs + `0017:113` and
`0017:143`). Expected **after**: exactly **one** —
`docs/adr/0017-v3-core-operations-scope.md:113`, the #37 amendment's frozen snapshot. **A completely
empty result means you also rewrote history — that is a defect.**

Scope the grep to `docs/adr/` as written, **not** `docs/`: this PLAN.md contains the literal string
`#38–#41` seven times, so a `docs/`-wide grep matches itself and the counts stop meaning anything.
All real hits are under `docs/adr/`; `website/` has none (verified — it is in the command only to
prove that). `docs/adr/0028-distributive-omit-id.md` carries no footer (absent from the grep) — leave
it alone.

### 9.4 Website — 5 pages

`website/**/*.md` is **prettier-exempt** (`.prettierignore`) — match surrounding style by hand.

| Page:line | Change |
| --- | --- |
| `reference/scope-and-capabilities.md:53` | **Delete** the `BulkWriter high-throughput API + recursive delete` row from "Deferred to v3.x" |
| `reference/scope-and-capabilities.md:38` | Retitle the fixed-batch row to distinguish it, and **add** a Supported row after it: `High-throughput writes (bulkWrite)` — non-atomic, per-item results, no hooks — and `Recursive delete (recursiveDelete)` — document + descendants, no hooks, no count |
| `reference/scope-and-capabilities.md:97–110` | Rewrite the raw-SDK escape-hatch example: it currently uses `BulkWriter` as *the* illustration and says "until #38 lands" (`:102`). Pick a still-unwrapped capability, or keep `BulkWriter` and reframe it as "for cases `bulkWrite` does not cover, e.g. streaming input larger than memory" — drop the `#38` link either way |
| `reference/repository.md:231–237` | After the `bulkDelete` block, add `bulkWrite(...)` and `recursiveDelete(...)` signature blocks in the existing bold-signature style. Include: non-atomic, positional results, no hooks + `skipHooks`, duplicate ids rejected with the ordering reason, and for `recursiveDelete` the destructive/no-count/no-hooks contract |
| `reference/repository.md:296–303` | In the hooks payload-notes paragraph, add that `bulkWrite` and `recursiveDelete` run **no** hooks and that `bulkWrite` throws when bulk hooks are registered unless `skipHooks` is set |
| `guides/working-with-data/crud-operations.md:167–172` | In "Bulk Operations", add a subsection contrasting the two write contracts, with the §6.4 table's substance and a `bulkWrite` example that filters failures |
| `guides/working-with-data/crud-operations.md:213–218` | Extend the existing hooks note to cover `bulkWrite`'s no-hooks contract |
| `guides/concepts/lifecycle-hooks.md:38–39, 50–54, 113–115` | Add an explicit "operations that run **no** hooks" note naming `bulkWrite` (with the guard + `skipHooks`) and `recursiveDelete`. This page currently implies every bulk write fires `*Bulk*` hooks |
| `reference/errors.md:61, 104` | Note that on `bulkWrite` these errors arrive **inside** `BulkWriteResult.error` per item rather than being thrown — `ValidationError`, `InvalidDocumentIdError`, `NotFoundError`, `ConflictError`, `PreconditionFailedError` |
| `guides/designing/performance.md:33, 88–97, 220–228` | Add `bulkWrite` to the cost table and the timing table with an honest note that it is still 1 write per op — the win is parallelism and failure isolation, not cost. Do **not** copy P17's emulator millisecond figure into a production-looking benchmark row |

If you add a `:::note` / `:::caution` aside, run `npm run docs:build` and then grep the built HTML for
a leaked literal `:::` — neither `check:docs` nor `docs:build` catches a mis-terminated directive, and
it shipped live twice (#33, #34):

```bash
grep -rn ':::' website/dist --include='*.html'; echo "grep exit=$? (1 = no match = PASS)"
```

Expected: **no output, `grep exit=1`.** This check passes by matching nothing, so read the exit code —
do not pipe it into `head`/`wc`, which would replace grep's status with theirs. Verified on the
current build at this baseline: 0 lines, exit 1.

### 9.5 READMEs

Grepped both; neither is affected (§3.6). State that explicitly in the PR body so the omission reads
as a decision, not an oversight.

### 9.6 Follow-up issue to open

**Title:** Collection-wide `recursiveDelete` (delete every document in a collection, including
subcollections)

**Body:** `#38` shipped document-scoped `repo.recursiveDelete(id)`. The SDK's
`Firestore.recursiveDelete()` also accepts a `CollectionReference`, verified working against the
emulator: it deletes every document in the collection plus all nested subcollections, and correctly
spares a collection whose id merely *prefixes* the target (the null-byte upper bound in
`recursive-delete.js`). This fills a real gap — `query().get()` + `bulkDelete` leaves orphaned
subcollections behind — but it is the most destructive call the library could expose, so it was held
out of #38 deliberately (ADR-0032, alternatives). Decide the guard (a distinct method name, a required
confirmation option, or nothing) before implementing.

**Labels:** `enhancement`, `parity`, `v3.x`

Reference it from ADR-0032's Consequences and from the ADR-0017 amendment.

---

## §10 Gate and commit

```bash
npm run test:types && npm run lint && npm run check:format && npm run test:unit && npm run test:integration:emulator && npm run test:unit:coverage && npm run test:coverage:gate:unit && npm run test:integration:coverage && npm run test:coverage:gate:integration && npm run build && npm run check:package && npm run check:consumer && npm run check:docs && npm run docs:build
```

Fourteen legs. Report failures with output — never claim a leg passed that you did not execute. All
fourteen passed on the prototype (§3.8); the `check:consumer` bound is in §5.

**Baseline before your change:** unit **31 suites / 383 tests**, integration **31 suites / 456 tests**
(measured on this baseline with a clean tree).

- Unit **must stay 31 / 383** — this change adds no unit test. If it moves, you added one; say why.
- Integration **must become 32 / 479** (+1 suite, +23 tests) if you use the patch's test file as-is.
- Watch **`test:coverage:gate:integration`** — `FirestoreRepository.ts` is the changed file and
  `functions` is its tightest metric (§3.7). It improved in the prototype; a *drop* means some
  callback in `bulkWrite` is never exercised.
- Run the integration suite **at least twice**. One flake was seen during prototyping (§5), and this
  file is the newest thing in it.

Re-run the probes against the finished code:

```bash
firebase emulators:exec --project demo-firestoreorm-test --only firestore \
  "node docs/plans/issue-38-bulkwriter-recursive-delete/probes/01-bulkwriter-emulator.mjs"
firebase emulators:exec --project demo-firestoreorm-test --only firestore \
  "node docs/plans/issue-38-bulkwriter-recursive-delete/probes/02-recursive-delete-emulator.mjs"
firebase emulators:exec --project demo-firestoreorm-test --only firestore \
  "node docs/plans/issue-38-bulkwriter-recursive-delete/probes/03-design-questions.mjs"
firebase emulators:exec --project demo-firestoreorm-test --only firestore \
  "node docs/plans/issue-38-bulkwriter-recursive-delete/probes/04-same-doc-commit-order.mjs"
```

Probes 01–03 characterize the SDK, not the ORM, so their output should match §3.1/§3.2 unchanged —
a *difference* means the SDK moved under you and §3 needs revisiting. Probe 04 must still report
`firstEnqueuedWon > 0`; if it reports 0, do **not** conclude ordering became safe (the probe's own
verdict string says why — absence of evidence).

**Commit subject** (Conventional Commits; commitlint runs on `commit-msg`):

```
feat(repository): add BulkWriter-backed bulkWrite and explicit recursiveDelete (#38)
```

**Is it breaking?** **No.** Two additive methods, four additive type exports, and one **private**
rename with no external referents (N2). No existing signature, return contract, or behavior changes.
`bulkWrite` throwing when bulk hooks are registered cannot break anyone — the method did not exist.
This folds into the unreleased `3.0.0`, so `feat` (not `feat!`) is correct.

---

## §11 Definition of done

| # | Item |
| --- | --- |
| 1 | §1 decisions implemented as written; none re-litigated |
| 2 | Nothing from §2's out-of-scope list added |
| 3 | §3.6 line numbers re-verified after any rebase; drift recorded in `notes.md` |
| 4 | Private `bulkWrite` → `runBulkBatchWrite` at all three sites (§6.1, T1) |
| 5 | Four types + two guards + static const + `bulkWrite` + `recursiveDelete` match §6 |
| 6 | `src/index.ts` re-exports the four types, type-only (§6.6) |
| 7 | Every §6.4 structural invariant intact (`finally` close, `Promise.all` placement, two-handler `.then`, separate `try` around `run()`, duplicate guard, empty short-circuit) |
| 8 | 23 integration tests (§8.1) + 5 type contracts (§8.2) present and green |
| 9 | §8.3 mutation checks run, with output in `notes.md` — including the two rows that must show **no** failure |
| 10 | The three acknowledged coverage gaps (T3, T4, T9 in §8.4) left as review-only invariants — no fake test invented for them |
| 11 | ADR created (next free number), with all six §9.2 content items incl. the `(#39–#41)` footer; row added to `docs/adr/README.md` |
| 12 | ADR-0017: new #38 amendment blockquote added; the eight existing blockquotes untouched; References bullet updated |
| 13 | `grep -rn "#38–#41" docs/adr/ website/` returns **exactly one** hit (`0017:113`) — not zero, not twelve |
| 14 | All 5 website pages in §9.4 updated; `grep -rn ':::' website/dist/**/*.html` returns nothing |
| 15 | READMEs declared unaffected in the PR body (§9.5) |
| 16 | Follow-up issue from §9.6 opened and referenced from the ADR |
| 17 | Nothing in the §7 anti-instruction list violated |
| 18 | Full gate green (§10) with real output; suite counts unit 31/383, integration 32/479; integration run at least twice |
| 19 | Probes re-run (§10); probe 04 still reports `firstEnqueuedWon > 0` |
| 20 | `notes.md` committed: deviations, unverified items, adversarial self-review dispositions |
| 21 | Assertion probes promoted to committed tests (§8), not left in `probes/` — probes 01–04 are all *investigation* probes and stay |
| 22 | `git rm -r docs/plans/issue-38-*/` — this plan directory is removed in this PR, **after** review |

---

## §12 Pre-handoff verification

What the **planner** ran before pushing this plan — not the implementer's checklist (that is §11).

| Check | Command / method | Result |
| --- | --- | --- |
| §6 blocks compile as written | Applied as a real prototype to `src/`, `npm run test:types` | **Clean.** First attempt produced `TS2393 Duplicate function implementation` ×2 (N1) — fixed by renaming the *private* helper, which became §6.1 and T1. Second attempt clean. |
| Every `from '…'` specifier §6 uses | Same compile. §6 introduces **no new import** — `BulkHookEvent`, `CreateInput`, `UpdateInput`, `ID`, `z`, `ValidationError`, `parseFirestoreError` are all already in scope in `FirestoreRepository.ts` | resolved |
| The specifier §6 deliberately **avoids** | temp `src/__probe38_types.ts` + `test:types` | `import type { BulkWriterError } from 'firebase-admin/firestore'` → `TS2724 … Did you mean 'BulkWriter'?`. Replaced by `FirebaseFirestore.BulkWriterError` (V2, V3, T6). File removed. |
| Declaration emit (new public types) | `npx tsc -p tsconfig.json --declaration --emitDeclarationOnly --outDir /tmp/dts38` | Emitted `core/FirestoreRepository.d.ts` has **no** `@google-cloud/firestore` reference; `FirebaseFirestore.BulkWriterOptions['throttling']` survives as a global reference (V4) |
| Prototype behavior | 23 integration tests written and run | 23/23 green in isolation; **5 consecutive** clean full-suite runs (32/479) |
| Full gate on the prototype | All 14 legs (§3.8) | All pass. `check:format` needed `prettier --write` on the two new test files first — that is why §7 step 7 says so. |
| Every §9 / §10 shell command | Ran each | `grep -rn "#38–#41" docs/adr/ website/` → **12 hits** (per-file breakdown matches §9.3's 12 rows). First draft of §9.3 said "13 hits (11 in feature ADRs)" and scoped the grep to `docs/` — both wrong, and the `docs/` scope self-matched PLAN.md 7×; corrected. `grep -n "bulkCreate\|bulkDelete\|bulkUpdate\|BulkWriter\|recursiveDelete" README.md npm-readme.md` → **empty, exit 1, and empty is the pass**; `grep -rn "bulkWrite\b"` outside `FirestoreRepository.ts` → **empty** (N2); `grep -n "bulkWrite\|BulkWriter\|recursiveDelete" docs/development/test-coverage-followups.md` → **empty**, confirming §9.1's no-edit claim; `grep -rn ':::' website/dist --include='*.html'` → 0 lines, exit 1; `git apply --check prototype.patch` → clean at `0528c6d`; `npm run check:docs` with PLAN.md present → **179 files scanned, OK**; all four probe commands → §3.1/§3.2/§3.5 |
| Baseline suite counts | Both suites, clean tree | unit **31 / 383**, integration **31 / 456** |
| Gate headroom | LCOV parse vs `check-coverage-gates.mjs`, before **and** after | §3.7 — binding metric is `functions` (6 wholly-uncovered tolerated); measured *improvement* after the change |
| Unresolved conditionals | Re-read §§2–9 | None. Six resolved by reading/grepping rather than left to the implementer: `/vector` re-export **not** needed (`withVectorSearch.ts:47`), `testing.md` **not** affected (globs only, `:20/:22/:49/:162`), READMEs **not** affected (grep), `0028` carries **no** living-index footer (grep), `migration-v2-to-v3.md` **not** affected despite #37 having edited it (read the whole page — §9.1), `src/benchmarks/**` **not** affected (in no gate leg — §9.1) |
| Trap coverage inverse walk | §4 against §8.4, per trap **per site** | Every trap mapped. **Three honest gaps declared** (T3, T4, T9) — their symptoms are process-lifecycle events an emulator suite sharing one Firebase app cannot observe; §8.4 names them rather than letting a test stand in for them |
| Owner forks settled before §1 | 4 questions asked with evidence, all answered | D1–D4 approved as recommended. **D5 is labelled derived**: probe 04 falsified the premise of the duplicate-handling assumption in D1's option text after the answer, so the plan changed and says so |

---

## Appendix — probe inventory (`probes/`, beside this file)

| File | What it proves |
| --- | --- |
| `01-bulkwriter-emulator.mjs` | P1–P19: BulkWriter works on the emulator; the sub-20-op deadlock; `close()` never rejects; `BulkWriterError` shape and numeric codes 5/6/9; non-atomicity; delete-of-absent succeeds; unhandled rejection; sync throw after close; default retry attempts; throttling accepted; unclosed-writer/`terminate()` interaction; 600-op run; merge/dot-notation/auto-id |
| `02-recursive-delete-emulator.mjs` | R1–R8: subtree deletion to depth 3 with sibling isolation; collection form + prefix safety; missing/empty resolve; no count; a supplied writer is not closed; a closed writer throws synchronously; lazy-writer reuse; the aggregate `GoogleError` failure shape |
| `03-design-questions.mjs` | R9, R10, P16, P17, P18: counting via `onWriteResult`; subcollection-document scoping; `terminate()` rejection text; 600-op scale; merge/dot-notation/auto-id write shapes |
| `04-same-doc-commit-order.mjs` | O1: 300 iterations, **107 (36 %) first-enqueued wins** — same-document commit order is not guaranteed. The evidence D5 rests on, and the explanation for the one observed flake (§5) |

All four are **investigation** probes (they ask what the SDK does); none carries an assertion to
promote. The assertions live in the two committed test files (§8), already written and green in
`prototype.patch`.
