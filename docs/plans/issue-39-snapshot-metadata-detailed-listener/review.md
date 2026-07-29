# Issue #39 — implementation review

**Reviewer:** Claude Opus 5 (external, `write-review`) · **Round:** 1 · **Reviewed:** `3d4a028`
(`feat(repository): add opt-in snapshot metadata and detailed docChanges listeners (#39)`) ·
**Branch:** `feat/issue-39-snapshot-metadata-detailed-listener` (ahead 1, **unpushed**, no PR) ·
**Plan:** `PLAN.md` @ baseline `32ce4c1` · **Tree:** unchanged by this review — all mutations and
probes reverted and the revert re-verified (`git diff HEAD` empty; only the pre-existing untracked
`.claude/worktrees/` remains, which I did not create and did not move).

**Base:** `main` is still `32ce4c1` and equals the merge-base — **no rebase owed**, and the plan's
§3.4 line numbers were still valid.

**Verdict: APPROVE WITH FIXES** — the implementation is correct, complete against §§1–11, and
independently gate-green on every leg except one that fails for a reason unrelated to this branch.
Two fixes remain, both small and independent: **M2** (document or dedupe the double `readConverter`
invocation in `onSnapshotDetailed`) and **N2** (move an I-3 fixture restore into its `finally`).
**M1 is a pre-existing repo-hygiene defect, not #39's** — it should become its own issue rather than
be folded in. Re-run after M2/N2: `npm run test:types && npm run lint && npm run test:integration:emulator`.

---

## What I ran

Every claim below traces to a row here.

| Check | Command | Result |
| ----- | ------- | ------- |
| Full §10 gate | `( leg1 && … && leg14 ) > gate.log 2>&1; echo "CHAIN_EXIT=$?"` | **`CHAIN_EXIT=1`** — short-circuited at leg 3 (`check:format`). The background-task notification reported "exit code 0" (the wrapper's `echo`), which is exactly why the chain code was captured separately. |
| Failing leg 3 | `npm run check:format` | 68 `[warn]` rows, **all** under `.claude/worktrees/issue-40-distinct-values/` — an untracked worktree for a different issue. Zero rows from this branch's files. |
| Leg 3, scoped to tracked files | `git ls-files -z \| xargs -0 npx prettier --check --ignore-unknown` | `All matched files use Prettier code style!` — the committed tree is clean |
| Legs 4–14 (skipped by the short-circuit) | run as their own chain, `echo "CHAIN2_EXIT=$?"` | **`CHAIN2_EXIT=0`** — all eleven pass |
| Suite counts (as-run) | legs 4/5 | unit `62/766`, integration `66/977` — **polluted**; jest's `testMatch: ['**/src/tests/…']` reaches into the untracked worktree (see M1) |
| Suite counts (clean) | `jest --testPathIgnorePatterns … '/.claude/worktrees/'` | unit **31 suites / 383 tests** (baseline 31/383 — unchanged, as §10 requires) · integration **34 suites / 497 tests** (baseline 32/480 → **+2 suites / +17 tests**, as §10 requires) |
| Coverage pollution check | `grep -c "^SF:.*FirestoreRepository" coverage/integration/lcov.info` → `1`; `grep -c worktrees … ` → `0` | coverage is **not** double-counted (`collectCoverageFrom` is rootDir-relative), so the gate figures below are trustworthy |
| Unit coverage gates | leg 7 output | all pass. `src/index.ts` lines **100.00%** / branches **100.00%** (both thresholds 100 — the zero-slack constraint §3.5 flagged held; only type exports were added) |
| Integration coverage gates | leg 9 output | all pass. `FirestoreRepository` 97.81/91.59/93.18 (was 97.94/91.45/92.77) · `QueryBuilder` 96.77/87.72/**100.00** functions vs 95 threshold — the §8 binding constraint held · `CollectionGroup` 99.55/97.22/100.00 · vector 93.26/88.03/96.55 |
| **Mutation — T1** (rank 1; **not** covered by the implementer's own table) | removed the `snapshot.exists` guard from `mapManySnapshotsWithMetadata` (`FirestoreRepository.ts:1650`) | **1 failed, 7 passed** — only I-1#7–8. Failure output was literally the trap's signature: `Received: {"doc":{"id":"ghost-meta-id"},"metadata":{"createTime":undefined,…,"updateTime":undefined}}` |
| **Mutation — T3** (rank 3; **not** covered by the implementer's own table) | `withMetadata && !fieldMask` in `getMany` (`FirestoreRepository.ts:1883`), so the 4th cell falls through to the bare mapper | **1 failed, 7 passed** — only I-1#7–8, at `expect(masked[0]!.doc.name).toBe('Many A')`, the exact runtime-shape-≠-declared-type failure T3 predicts |
| Revert verified | `git checkout -- src/core/FirestoreRepository.ts`; `git diff HEAD --stat` empty; re-ran all three new suites | **3 suites / 64 tests passed** |
| **Probe (unnamed surface) — `/vector` intersection** | temp `src/__rev39-vector-probe.ts` + `npm run test:types`, then deleted | clean, exit 0 — 8 assertions held (below) |
| **Probe (unnamed surface) — converter invocations** | temp integration test counting `fromFirestore` calls, then deleted | `onSnapshot -> 3 calls / 1 emission; onSnapshotDetailed -> 6 calls / 1 emission` over the same 3 docs → **M2** |
| §9.4 ADR sweep | `grep -rn "#39–#41" docs/adr/` | **exactly one row** — `0017:122`, the frozen #38 amendment. Precisely the expected result (zero would have meant the frozen snapshot was wrongly edited) |
| `:::` rendering check | `grep -rn ':::' website/dist/` after `docs:build` | no rows |
| Untouched-surface audit | `git diff 32ce4c1..3d4a028 --name-only \| grep -E 'CollectionGroup\.ts\|express/\|Errors\.ts\|ErrorParser\.ts\|DocumentId\.ts\|check-coverage-gates\|^README\.md$\|^npm-readme\.md$'` | no rows — every §7 anti-instruction target is untouched |

---

## Blockers

**None.** The one red gate leg is not caused by this branch — see M1.

---

## Major

### M2 — `onSnapshotDetailed` invokes a configured `readConverter` twice per document per emission (`src/core/QueryBuilder.ts:1512-1524`)

The callback body maps `snapshot.docs` and `snapshot.docChanges()` through `toResult`
**independently**:

```ts
docs: snapshot.docs.map(doc => this.toResult(doc)),
changes: snapshot.docChanges().map(change => ({
  …
  doc: this.toResult(change.doc),
```

Each `toResult` calls `snapshot.data()`, and this repo explicitly documents that a converter's
`fromFirestore` "runs lazily on every `.data()` invocation and **is not memoized**" —
`FirestoreRepository.ts:1729-1731`, where `mapManySnapshots` calls `.data()` exactly once per
snapshot *for that stated reason*. So the detailed listener silently breaks an invariant the
codebase maintains deliberately elsewhere.

**Evidence** (throwaway integration probe, since deleted — a repo with a counting `readConverter`,
3 documents, one emission each):

```
PROBE RESULT: onSnapshot -> 3 converter calls over 1 emission(s);
              onSnapshotDetailed -> 6 converter calls over 1 emission(s)
```

**Failure scenario:** a `readConverter` that is not pure — the documented and supported case is one
that transforms per-read state, but the sharpest version is a converter that stamps a value, e.g.
`snapshot => ({ ...data, readSeq: nextSeq() })`. On the initial emission over N documents,
`snapshot.docs[i].readSeq` and `snapshot.changes[i].doc.readSeq` **differ for the same document**,
because they came from two separate `fromFirestore` runs. A consumer that reconciles `changes`
against `docs` (the entire point of the delta API) then sees two inconsistent views of one document.
Even for a pure converter, `snapshot.docs[i] !== snapshot.changes[j].doc` by reference for the same
document, so `snapshot.docs.indexOf(change.doc)` is always `-1` — a natural thing to write, and
silently wrong. Independently, an expensive converter pays 2× on every emission.

**What closes it** — either, implementer's choice:

- *(preferred, ~4 lines)* map once and reuse. Removed documents are absent from `snapshot.docs`, so
  they still need their own mapping:

  ```ts
  const byPath = new Map<string, R>();
  const docs = snapshot.docs.map(doc => {
    const mapped = this.toResult(doc);
    byPath.set(doc.ref.path, mapped);
    return mapped;
  });
  callback({
    docs,
    changes: snapshot.docChanges().map(change => ({
      type: change.type,
      // 'removed' documents are not in `docs`; everything else reuses the single mapping so a
      // non-memoized readConverter runs exactly once per document per emission.
      doc: byPath.get(change.doc.ref.path) ?? this.toResult(change.doc),
      …
  ```

  Add an assertion to I-2#1–7 that `snapshot.changes.find(c => c.doc === snapshot.docs[0])` is
  defined, so the dedupe cannot silently regress.

- *(minimum, docs-only)* state the behavior in the `onSnapshotDetailed` JSDoc and ADR-0033: a
  configured `readConverter` runs once per entry in `docs` **and** once per entry in `changes`, and
  `changes[].doc` is not reference-equal to the corresponding `docs[]` entry.

---

### M1 — `.claude/worktrees/` breaks `check:format` and doubles every file-walking gate leg (repo-wide; **pre-existing, not caused by #39**)

I am recording this as Major because it made the §10 gate un-runnable as written and because it
makes the plan's own acceptance criterion ("integration suite count must go up") read wrong. It is
**not a #39 defect** and I do not think it belongs in this PR.

**Evidence:**

- `npm run check:format` → 68 `[warn]` rows, every one under
  `.claude/worktrees/issue-40-distinct-values/`. `.prettierignore` ignores `.claude/rules/`,
  `.claude/commands/` and `.claude/skills/` but **not** `.claude/worktrees/`.
- `jest.config.unit.js` uses `testMatch: ['**/src/tests/unit/**/*.test.ts']`, and
  `jest.config.base.js` `testPathIgnorePatterns` is `['/node_modules/', '/package/', '/dist/']`. The
  leading `**/` therefore matches the worktree's copy of the suite. Measured: unit **62/766** and
  integration **66/977** — exactly `383 + 383` and `480 + 497`, i.e. the worktree's baseline copy
  plus this branch's tree.
- `npm run check:docs` scanned **362 doc files**; the baseline is 180.

**Failure scenario:** any agent or reviewer with a `.claude/worktrees/` checkout present runs the
§10 gate, sees `check:format` red for 68 files it did not touch, and either (a) runs
`prettier --write .` and reformats another branch's working tree, or (b) — worse — reads
"integration: 66 suites / 977 tests" as a genuine count and concludes the suite grew by 34 suites.
The previous implementer hit exactly this and worked around it by physically moving the directory
out of the repo (`notes.md` "Deviations" 3), which is a manual step nobody will remember.

**What closes it:** two lines, in a **separate** issue/PR —

```
# .prettierignore
.claude/worktrees/
```

```js
// jest.config.base.js
testPathIgnorePatterns: ['/node_modules/', '/package/', '/dist/', '/.claude/worktrees/'],
```

(`scripts/check-doc-links.mjs` likely wants the same exclusion.) If you prefer, `.gitignore`-ing
`.claude/worktrees/` addresses the git noise but **not** prettier or jest, both of which walk the
filesystem rather than the index — so the two lines above are still needed.

---

## Minor / nits

### N1 — `get()` lost a pre-existing `@example` (`src/core/QueryBuilder.ts:1634-1637`)

The "Complex query with multiple conditions" example that stood at `QueryBuilder.ts:1458-1466` on
the baseline was replaced by the new metadata example rather than joined by it.

**This is the plan's defect, not the implementer's.** §6.2 presented the `get()` JSDoc as a
copy-verbatim block containing only the "Simple query" example, and §0.2 told them §6 blocks are
copy-verbatim. They followed the instruction correctly. Judged: **the deviation is the plan's, and
the implementer was right to copy it.**

**What closes it:** re-add the deleted `@example` block above the new one. No test or gate
implication.

### N2 — I-3#4's fixture restore is inside `try`, not `finally` (`src/tests/integration/repository-collection-group.integration.test.ts:817-822`)

```ts
      expect(removal!.metadata.updateTime).toBeInstanceOf(Timestamp);

      await db.doc(targetPath).set({ title: 'C', status: 'published', views: 30 });
    } finally {
      unsubscribe?.();
    }
```

The test deletes seeded document `u2p2` to prove a `removed` change carries last-known data, then
restores it. If **any** assertion above the restore throws, the restore never runs — only
`unsubscribe()` does.

**Failure scenario:** today the blast radius is nil, because I-3#4 is the last `it` in the file. The
moment someone appends a test after it, one failing assertion in I-3#4 silently deletes a shared
fixture and cascades into unrelated failures that look like flakiness. That is a hard bug to trace
back here.

**What closes it:** move the `set(...)` into the `finally`, before or after `unsubscribe?.()`.

### N3 — `notes.md` is stale on commit status

`notes.md:13-14` says "**Not committed** (per instruction)", and its adversarial finding F2 is
dispositioned as "not a defect… files exist on disk and are ready to stage". The work **is**
committed, as `3d4a028`. Not a code defect; worth correcting so the next reader does not go looking
for an uncommitted tree.

---

## Verified, and it held

Listed so these surfaces are settled and nobody re-checks them.

**Contract fidelity to §6**

- `src/core/SnapshotMetadata.ts` is §6.1 **verbatim**, JSDoc included, and carries **no imports** —
  the ambient `FirebaseFirestore.*` form the plan required to keep `@google-cloud/firestore` out of
  the emitted `.d.ts`. `check:package` and `check:consumer` both pass, including the ESM and CJS
  root-import legs.
- All six `QueryBuilder` terminals and all seven repository reads carry the paired overloads with
  the widened implementation signature. `getMany` has all **four** cells (`QueryBuilder`-side
  `mapDocs` and repository-side `toDocumentResult` / `mapManySnapshotsWithMetadata` as specified).
- **T2 handled correctly:** `stream`'s overload signatures at `QueryBuilder.ts:1394-1395` carry no
  `*`; only the implementation does. The pre-existing `hasLimitToLast` guard that §6.2 warned about
  survived intact at `1398-1404`.
- **T4 and T5 forwarding present** at `QueryBuilder.ts:1599` and `FirestoreRepository.ts:1765`, each
  with the explanatory comment.
- **T7 honored:** `mapManySnapshots` is unflagged and `getManyInTransaction` still calls the bare
  mapper; I-1#9 asserts the transaction result has no `.doc` property.
- **T8 honored:** `onSnapshotDetailed` rejects on `hasSelect` with the actionable message.

**Anti-instructions** — audited by diff, all clean: `CollectionGroup.ts`, `src/express/index.ts`,
`Errors.ts`, `ErrorParser.ts`, `DocumentId.ts`, `scripts/check-coverage-gates.mjs`, `README.md` and
`npm-readme.md` are untouched. `getByIdWithUpdateTime`, `listenOne`, `onSnapshot` and
`PaginatedResult` have no signature drift (`git diff … | grep '^-.*…'` returns nothing).
`buildDocumentMetadata` is **not** exported from `src/index.ts` or `src/vector/index.ts`.

**Probe — the `/vector` intersection surface, which the plan required re-exports for (R-6) but never
type-tested.** `VectorEnabledRepository` is `FirestoreRepository & { vectorQuery() }` behind a
`Proxy`; intersections can degrade overload resolution. All eight assertions compiled clean:
`vectorRepo.getById(id, { withMetadata: true })` resolves to `WithMetadata<…> | null`; the bare call
still resolves to the bare document; `vectorRepo.query().get({ withMetadata: true })`,
`.stream({ withMetadata: true })`, the `getMany` matrix and `listenOneDetailed` all resolve through
the intersection; `DetailedQuerySnapshot` is nameable from the `/vector` specifier. The **negative**
assertion held too — `vectorRepo.vectorQuery().get({ withMetadata: true })` is still a compile error,
confirming D3/R-5 was honored and the vector terminal was not quietly widened.

**Tests assert what they claim.** I read all four test files rather than the summary table.
I-2#11 (D5) is properly constructed: a 10s timeout rejects if `onError` never fires, and a second
callback invocation after deletion explicitly rejects — so it covers both halves of the contract
("routes to `onError`" **and** "does not invoke the callback"). I-3#1–2 asserts identity agreement
across `≥2` distinct parents rather than a single row. I-3#4 asserts `expect(removal).toBeDefined()`
*before* dereferencing it, so a dropped deletion fails loudly rather than vacuously.

**Bookkeeping** — §9 executed in full. ADR-0033 present; `docs/adr/README.md:63` row added with
matching column padding; the ADR-0017 amendment is inserted after the #38 block and before
"We explicitly do **not** block v3…", decrements to **(#40–#41)**, and does not rewrite any earlier
amendment; the living-index sweep leaves exactly the one frozen row; the capability matrix moves
#39 to Supported and replaces the Deferred row with **#72**.

**A gap in `notes.md`, not in the code:** the implementer's mutation table covers T4, T5, T6, T8, T9
but **not T1 or T3** — the plan's first- and third-ranked traps. I ran both myself (rows above) and
both pin precisely, one test each. So the implementation is fine; the record was incomplete.

---

## Round-1 disposition checklist (for `notes.md`)

| Id | Severity | Needs a disposition |
| -- | -------- | -------------------- |
| M2 | Major | Dedupe the mapping **or** document the double invocation + reference inequality |
| M1 | Major (pre-existing, out of scope) | Recommend: open a separate issue, disposition here as **deferred** with the link |
| N1 | Nit | Restore the deleted `@example` |
| N2 | Nit | Move the fixture restore into `finally` |
| N3 | Nit | Correct the commit-status lines in `notes.md` |

After remediation, re-run at minimum `npm run test:types && npm run lint && npm run test:integration:emulator`;
a full §10 re-run is only meaningful once M1 is resolved or the worktree is absent.

---

# Round 2

**Reviewer:** Claude Opus 5 (external, `write-review`) · **Round:** 2 · **Reviewed:** the
**uncommitted** working tree on top of `3d4a028` (4 files modified; nothing new committed —
`git log 3d4a028..HEAD` is empty) · **Tree:** unchanged by this review — the one mutation was
applied and reverted by targeted string replacement (never `git checkout --`, which would have
destroyed the uncommitted remediation), and `git diff HEAD --stat` afterward matches the
pre-review state byte-for-byte: `notes.md` 60, `QueryBuilder.ts` 26, collection-group 8,
detailed-listener 5.

**Verdict: APPROVE** — all five round-1 ids are properly disposed, the two code fixes are correct
and independently verified, the deferral is real and accurate, and every gate leg passes except the
pre-existing `check:format` pollution now tracked as
[#73](https://github.com/reggieofarrell/firestore-orm/issues/73). Nothing further is owed before
commit. Remaining step is bookkeeping only: commit the remediation, then the §11 cleanup commit
removing `docs/plans/issue-39-*/` after this review is visible in the PR.

## What I ran (round 2)

| Check | Command | Result |
| ----- | ------- | ------- |
| Full §10 gate | `( leg1 && … && leg14 ) > r2-gate.log 2>&1; echo "CHAIN_EXIT=$?"` | **`CHAIN_EXIT=1`** — again leg 3 only. `grep '^\[warn\]' \| grep -v '\.claude/worktrees/'` returns **only the summary line**, i.e. **68 of 68** warnings are the untracked worktree. Unchanged from round 1; this is M1/#73, not the branch. |
| Legs 4–14 | separate chain, `echo "CHAIN2_EXIT=$?"` | **`CHAIN2_EXIT=0`** — all eleven pass |
| Suite counts (clean) | `--testPathIgnorePatterns … '/.claude/worktrees/'` | unit **31/383**, integration **34/497** — identical to round 1, which is correct: M2/N2 added assertions to existing tests rather than new ones |
| Unit coverage gates | leg 7 | all pass; `src/index.ts` still **100.00 / 100.00** on the zero-slack thresholds |
| Integration coverage gates | leg 9 | all pass. `QueryBuilder` lines 96.77 → **96.80**, branches 87.72 → **87.77**, functions **100.00%** (threshold 95) — the new `map` callback in the M2 fix is covered, so the §8 binding constraint still holds |
| `check:package` / `check:consumer` | legs 11–12 | 90 files, allowlist satisfied; packed consumer OK for `firebase-admin@^14` (ESM + CJS root, `/express` subpath) |
| `check:docs` / `docs:build` | legs 13–14 | pass; `grep -rn ':::' website/dist/` → **no rows** |
| **Probe — M2 measurement, re-run** | throwaway integration test counting `readConverter` invocations, since deleted | `onSnapshot=3 calls \| onSnapshotDetailed initial=3 calls \| identity(docs[0] in changes)=true \| removedMapped={"name":"one","id":"kzdm…"}` |
| **Mutation — M2 guard** | reverted `byPath.get(…) ?? …` to `this.toResult(change.doc)` in `QueryBuilder.ts:1546` | **1 failed, 63 passed** across all three #39 suites — only I-2#1–7, at `expect(initial.changes.find(c => c.doc === initial.docs[0])).toBeDefined()`, `Received: undefined`. Precisely targeted. |
| Revert verified | reverse string replacement + full clean re-run | unit **31/383**, integration **34/497**, all green |
| Deferral is real | `gh issue view 73` | OPEN, labelled `bug`, and the body carries the measured evidence (68 warnings; 62/766 and 66/977 counts) plus all three exclusions |

## Disposition audit

| Id | Claimed | Verified |
| -- | ------- | -------- |
| **M2** | Fixed | **Confirmed, and it is the preferred variant.** `QueryBuilder.ts:1530-1546` maps `snapshot.docs` once into a `Map<string, R>` keyed by `doc.ref.path` and reuses those instances for `changes`. Converter invocations dropped **6 → 3** for 3 docs — exact parity with `onSnapshot`. Reference identity now holds (`docs.indexOf(change.doc) !== -1`). |
| **M1** | Deferred → #73 | **Confirmed appropriate.** Reproduced unchanged this round. #73 exists, is accurate, and proposes all three filesystem exclusions plus the correct note that `.gitignore` alone would not fix prettier or jest. Correct call not to fold it into #39. |
| **N1** | Fixed | **Confirmed.** The "Complex query with multiple conditions" `@example` is restored at `QueryBuilder.ts:1647-1654`, above the metadata example rather than replacing it. |
| **N2** | Fixed | **Confirmed.** `targetPath` is hoisted above `try` (`repository-collection-group.integration.test.ts:747-748`) and the `set(...)` restore is the first statement in `finally` (`:791-793`), before `unsubscribe?.()`. |
| **N3** | Fixed | **Confirmed.** Status block and the F2 self-review entry now reflect commit `3d4a028`. |

## The M2 fix reviewed on its own merits

New code deserves its own pass rather than a diff-matches-the-suggestion check.

- **The `removed` fallback is the part that could have gone wrong, and it works.** Removed documents
  are absent from `snapshot.docs`, so `byPath.get()` misses and `?? this.toResult(change.doc)` must
  fire. My probe deleted a document mid-listen and the removed change still mapped correctly
  (`{"name":"one","id":"kzdm…"}`) — so the dedupe did not silently break T6, which was the live risk.
  I-3#4 and I-2#5–6 independently cover the same ground.
- **Key uniqueness holds.** `ref.path` is a full document path, unique within any snapshot including
  a collection-group one, so the map cannot collide across parents.
- **The regression guard is real, not decorative.** Mutation-checked above: reverting the reuse
  fails exactly one test.
- **`??` rather than `has`/`get`** would re-map if `toResult` ever returned `null`/`undefined`.
  `toResult` returns `FirestoreDocument<T>` / `CollectionGroupDocument<T>`, always an object, and
  `FirestoreQueryBuilderBase` is not exported from `src/index.ts`, so no consumer subclass can make
  it nullish. Noted, not a finding.
- **The comment carries the reason,** not just the mechanism — it names the non-memoized converter
  and points at `mapManySnapshots`, so the next person cannot "simplify" it back.

## Carried forward, unchanged

Everything in round 1's "Verified, and it held" still holds — re-confirmed by this round's clean
gate: §6 fidelity, the anti-instruction audit, the `/vector` intersection type probe, the §9.4 ADR
sweep (still exactly one frozen row), and T1/T3 pinning. Round 1's could-not-verify items are
unchanged and correctly carried in `notes.md`: emulator-only behavioral evidence, `check:consumer`
exercising only the `^14` peer leg locally (CI owes `^12` / `^13` / pinned-firestore), and no
allocation benchmark.

## What remains (bookkeeping, not findings)

1. Commit the remediation (4 modified files) — the branch is still **unpushed**, and `notes.md`
   states it is awaiting an explicit commit request.
2. Per `docs/plans/README.md` and §11, review happens **while the plan directory is visible**, then
   a final cleanup commit runs `git rm -r docs/plans/issue-39-snapshot-metadata-detailed-listener/`,
   then merge. Both `review.md` rounds and `notes.md` should be committed first so the PR's
   Files-changed view carries the loop before it is deleted.
