# Issue #40 — implementation review

**Reviewer:** Claude Code (Opus 5), external reviewer session · **Round:** 1 ·
**Reviewed:** working tree on `6620b9e` (`docs(plans): fix a never-correct anchor and restore two
weakened §12 claims`) — **the implementation is uncommitted**, see "Where the work lives" ·
**Branch:** `feat/issue-40-distinct-values-semantic-equality` · **Plan:** `PLAN.md` @ baseline
`3f0dd7a` · **Tree:** unchanged by this review (mutations and probes reverted and re-verified — see
"What I ran")

**Verdict: APPROVE WITH FIXES** — the 14-leg gate is green on the tree as reviewed and every §11
item I audited holds against source. One documented invariant is provably false (**M1**): the
canonicalizer *can* crash on `readConverter` output that is neither cyclic nor deeper than
`MAX_DEPTH`. Narrow the claim in `firestoreValueEquality.ts:34-35` and ADR-0034 §Decision 5, fix the
two nits, then re-run `test:unit`, `check:format`, `check:docs` and `docs:build`.

---

## Where the work lives

`git log --oneline main..HEAD` contains **only the three plan commits** (`6910cc1`, `7b50087`,
`6620b9e`). All of the implementation — the new util, the QueryBuilder wiring, all tests, ADR-0034
and the Starlight/ADR bookkeeping — is **uncommitted working-tree state**. `notes.md` says so
("Plan directory left in place; not committed"), and that matches. Nothing is pushed.

`main` is an ancestor of `HEAD` (`git merge-base --is-ancestor main HEAD` → true), so **no rebase is
owed** and the plan's §3.1 / §6.2 line anchors have not drifted.

Two consequences the implementer should note:

- `src/utils/firestoreValueEquality.ts` and `src/tests/unit/firestoreValueEquality.unit.test.ts` are
  **untracked**. `git checkout --` cannot revert them; I backed the util up by hash before mutating
  it. Anyone else mutation-testing these files must do the same or they will lose the file.
- Until it is committed, this work is one `git checkout .` away from gone.

---

## What I ran

Every claim below traces to a row here. Node was pinned to v24.18.0 (`$HOME/.nvm/versions/node/v24.18.0/bin`)
per `AGENTS.md`.

| Check | Command | Result |
| ----- | ------- | ------ |
| Full §10 gate, all 14 legs | `(test:types && lint && check:format && test:unit && test:integration:emulator && test:unit:coverage && test:coverage:gate:unit && test:integration:coverage && test:coverage:gate:integration && build && check:package && check:consumer && check:docs && docs:build) > log 2>&1; echo "CHAIN_EXIT=$?"` | **`CHAIN_EXIT=0`** — no leg short-circuited, all fourteen ran |
| Failing-leg scan | `grep -niE '^(npm ERR\|error\|✗\|✖)\|failed\|FAIL \|exited with' log` | **no matches** |
| Suite counts | from the gate log itself | unit **32 / 407** (baseline 31 / 383) · integration **34 / 504** (baseline 34 / 497) — both up; integration *suite* count unchanged as §3.5 requires |
| Unit coverage gate | gate leg's own output | `src/utils` incl. `firestoreValueEquality.ts`: lines **98.92%** (≥95), branches **94.47%** (≥90), functions **100%** (≥90) — passed |
| Integration coverage gate | gate leg's own output | all groups passed (e.g. vector ext lines 93.26% ≥ 90) |
| `check:docs` | leg 13 | `✓ documentation links OK (183 doc files scanned)` |
| `docs:build` | leg 14 | `[build] Complete!`, 61 pages, Pagefind index built |
| Mutation **T4** | removed `.sort()` on plain-object keys | **4 failed / 28 passed** — U-1, U-3, U-22, U-24 only; all four genuinely assert key-order insensitivity |
| Mutation **T2** | fresh `IdentityRegistry` per value instead of per call | **1 failed / 31 passed** — U-14 alone |
| Mutation **T3** | `['r', identityKey(obj, ids)]` instead of `['r', obj.path]` | **1 failed / 31 passed** — U-7 alone |
| Mutation **T5** | `if (value == null) continue` instead of `=== undefined` | **2 failed / 30 passed** — U-12, U-13 only |
| Mutation **T8** | duck-typed `typeof obj.path === 'string'` branch inserted *before* the nominal `instanceof DocumentReference` check | **1 failed / 31 passed** — U-19 alone |
| Revert verified | `shasum -a 256` vs pre-mutation backup + re-run both unit suites | hash `87fd6965…93d0a` identical; **32 / 32 passed** |
| Probe (unnamed): vector wrapper | `grep -rn distinctValues src --include=*.ts` + read `src/vector/VectorQueryBuilder.ts:53` | `VectorQueryBuilder` is a **standalone class**, does not extend the core builder and exposes **no** `distinctValues` — the "missed consumer" mode `AGENTS.md` warns about is genuinely absent |
| Probe (unnamed): `VectorValue` across the real read path | emulator probe: wrote 3 vector docs, read them back, checked ctor identity + `distinctFirestoreValues` | `same ctor identity: true`, `isGenuineVectorValue: true,true,true`, equal pair → **1**, all three → **2** — the docs' claim holds on decoded reads |
| Probe (unnamed): shared-subtree DAG | see **M1** | **`FATAL ERROR: … JavaScript heap out of memory`, node exit 134** on acyclic depth-26 converter output |
| Probe (unnamed): public export surface | `grep` `src/index.ts` / `src/vector/index.ts`; `package.json` `exports` | util is in neither entrypoint, and `exports` has no `./utils/*` subpath — **D6** holds |
| Tree cleanliness | `git status --porcelain` | identical to the session-start snapshot; util hash matches backup |

---

## Blockers

None.

---

## Major

### M1 — the "cannot crash" invariant is false; the walk OOMs on an acyclic, in-depth-budget shared-subtree DAG (`src/utils/firestoreValueEquality.ts:34-35`, `docs/adr/0034-distinct-values-semantic-equality.md:53`)

Both artifacts state the guarantee absolutely:

- `src/utils/firestoreValueEquality.ts:34-35` — "Hitting it emits a terminal marker instead of
  recursing, which can only ever *merge* values that agree down to this depth; **it cannot crash.**"
- ADR-0034 Decision 5 (`:53`) — "The worst case is a merge of values that agree down to the bound;
  **the walk cannot crash on converter output.**"

Neither guard applies to a *shared-subtree DAG*: it is acyclic (so the path-scoped `seen` set at
`:140` never fires — correctly, since `seen.add`/`seen.delete` bracket the recursion at `:148-149`
and `:160-162`, which is the right choice for cycle detection) and it is shallow (so `MAX_DEPTH` at
`:83` never fires). But `canonicalize` materializes a **fully expanded** tree, so a node reused at
`k` keys per level costs `k^depth` visits.

Measured, against the built `dist/utils/firestoreValueEquality.js`, with
`node = { a: prev, b: prev }` repeated N times:

```
levels=14  nodes=2^14  ms=17.6
levels=16  nodes=2^16  ms=37.5
levels=18  nodes=2^18  ms=158.3
levels=20  nodes=2^20  ms=675.5
```

Clean doubling per level. At 25 levels (depth 26 — well inside `MAX_DEPTH` 64, fully acyclic):

```
node_exit=134
FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
```

**Failure scenario:** a `readConverter` returns a memoized/interned graph — the same nested object
attached at two keys, ~25 levels deep (e.g. a converter that builds a tree and reuses one shared
child node per level). `await repo.query().distinctValues('graph')` then hard-kills the Node process
with an OOM abort, not a catchable `RangeError` — so `parseFirestoreError` at
`QueryBuilder.ts:1368` never sees it and no caller can recover.

Reachability is genuinely narrow, and I want to be precise about it: **stored** Firestore data cannot
trigger this. `doc.data()` decodes each map into a fresh, unshared object, and Firestore caps nesting
at 20 levels anyway. The only path is `readConverter` output — which is exactly the reachability
class the plan judged worth guarding for T7 (the cycle case, pinned by U-18 and I-6c).

**What closes it:** narrow the two claims rather than redesign the walker — that is the smallest
change and it keeps §6.1's "never over-merge" preference intact. In
`firestoreValueEquality.ts:34-35`, say the marker bounds *recursion depth* (no stack overflow on
cyclic or over-deep input) and note that converter output sharing one subtree across many keys can
still exhaust memory, because the canonical form is fully expanded. Make the same narrowing in
ADR-0034 Decision 5. If a real fix is wanted instead, memoizing `canonicalize` on a per-pass
`WeakMap<object, CanonicalNode>` makes the walk linear in distinct nodes and would make the original
absolute claim true — but that is a §6.1 deviation and deserves its own decision, so I would take
the doc narrowing now and file the memoization as a follow-up issue if you want it.

Note this is a *documentation-accuracy* defect with a real crash behind it: the code is defensible as
written, the promise about it is not. Because `test:unit`'s U-18/U-20 assert `not.toThrow()` on the
guarded shapes only, nothing in the suite fails today — which is why the gate is green and this still
needs fixing.

---

## Minor / nits

- **N1** — stale comment contradicts the test it introduces
  (`src/tests/integration/repository-query-builder.integration.test.ts:188`). The header comment
  reads "Timestamps differing by **a nanosecond**", but the test deliberately uses a **full second**
  (`new Timestamp(1700000000, 0)` vs `new Timestamp(1700000001, 0)` at `:206`/`:214`), and the inline
  comment at `:204-205` explains exactly why. This is `notes.md` deviation #2 applied to the code but
  not to the comment above it. A future reader who trusts `:188` will conclude the test is broken.
  **What closes it:** reword `:188` to "Timestamps a full second apart (see the note below)".

- **N2** — `VectorValue` by-value equality is claimed on the read path but pinned only in-process
  (`src/core/QueryBuilder.ts:1319`, `website/src/content/docs/reference/query-builder.md:210`,
  ADR-0034). The JSDoc, the Starlight reference and the ADR all promise `VectorValue` "compare[s] by
  value". The only test is U-9 (`src/tests/unit/firestoreValueEquality.unit.test.ts:115`), which
  builds values with `FieldValue.vector([...])` — a *write sentinel* constructed in process, never a
  value the SDK decoded. `isGenuineVectorValue` resolves its constructor from
  `FieldValue.vector([0])` (`src/utils/vectorValue.ts:33-35`), so if a future firebase-admin decoded
  vector fields to a different class, every claim above would silently become false and **no test
  would fail** — the value would land in the identity fallback. I verified the behavior is correct
  today (probe: `same ctor identity: true`, equal decoded pair → 1, three values → 2), so this is a
  coverage gap, not a defect. **What closes it:** one integration assertion on a read-decoded vector
  field — the existing `createVectorDocRepoHarness()`
  (`src/tests/integration/helpers/firestoreIntegrationHarness.ts:231`) already provides the fixture.
  Reasonable to defer to an issue; §8.5's T9 row does not list the vector read path, so this is a
  plan gap rather than an implementer miss.

- **N3** — the plan's `check:docs` prediction is off by one (`PLAN.md` §10 "Also re-run"). It expects
  **182** after adding ADR-0034; the actual green run reports **183**. The difference is `notes.md`,
  which the plan's arithmetic did not count (181 baseline + ADR-0034 + notes.md = 183). No action on
  the code — worth correcting only if the number is re-quoted later.

---

## Verified and holding

- **§6.1 util is byte-for-byte verbatim.** I extracted the fenced block from `PLAN.md` §6.1
  programmatically and compared to `src/utils/firestoreValueEquality.ts`: **`VERBATIM MATCH: True`**.
  All six §6.1 invariants are present and each is independently pinned — I broke five of them myself
  (T2/T3/T4/T5/T8 rows above) and each mutation failed a precisely targeted test set.
- **§6.2 edits 1-3 applied as specified, signature unchanged.** Import at `QueryBuilder.ts:20`; the
  `LIMITATION` paragraph replaced by the new contract paragraph at `:1315-1321`; the call site at
  `:1364-1366` is `return distinctFirestoreValues(values) as ValueAtKey<T, K>[]`. The signature
  (`:1346-1348`), the `hasSelect` guard (`:1355-1359`) and the `try`/`catch` are untouched.
  `grep -rn "new Set(values)" src/` → **none**. **D2 / D3 hold.**
- **D6 — not publicly exported.** Absent from `src/index.ts` and `src/vector/index.ts`, and
  `package.json` `exports` declares only `.`, `./vector`, `./express` — there is no `./utils/*`
  subpath, so `dist/utils/firestoreValueEquality.d.ts` is unreachable through a supported import.
- **Vector wrapper is not a missed consumer.** `VectorQueryBuilder` (`src/vector/VectorQueryBuilder.ts:53`)
  is a standalone class, not a subclass of `FirestoreQueryBuilderBase`, and has no `distinctValues`.
  There is no second dedupe site: the only other `new Set(` in `src/core`/`src/vector`/`src/utils` is
  the unrelated `FORBIDDEN_PATH_SEGMENTS` at `src/utils/dotNotation.ts:32`.
- **T11 bookkeeping is correct, including the part that looks wrong.** All ten live feature-ADR
  footers (0023, 0024, 0025, 0026, 0027, 0029, 0030, 0031, 0032, 0033) now read `(#41)`.
  `grep -rn -- '#40–#41\|#41–#41' docs/adr/` returns exactly **one** hit —
  `0017-v3-core-operations-scope.md:129` — and that line is **inside the #39 historical amendment
  blockquote**, which `docs/adr/README.md:16-21` forbids rewriting. The new `> Amendment (3.0.0,
  issue #40)` block was appended *after* it (`0017:133-142`), and the References bullet is now
  singular "GitHub issue #41" with #40 added to the closed-by chain. `docs/adr/README.md:17,19` were
  correctly not swept.
- **ADR-0034 carries all 11 §9.1 content items** — decision + default-on + unchanged signature;
  canonical key vs O(n²) pairwise; tagged tree vs delimiter join with both measured collisions;
  `ref.path` vs `isEqual`; never-over-merge + `Date` + N11; cycle/depth bounds; client-side scope
  with #75 and #41 placed; ADR-0020 fidelity; five alternatives; status
  `Accepted (v3.x, pending merge/release)`; living-index footer. README index row is appended after
  the 0033 row. The F1 fix held: **#75 is not in the footer**, only in Related and Decision scope.
- **Capability matrix row was moved, not duplicated.** `scope-and-capabilities.md` gains a Supported
  row with a real Notes cell and deletes the Deferred `#40` row; `grep -rn "issues/40"
  website/src/content/docs/` → **none**. `queries.md:46` and `:297` are deliberately untouched.
- **Test isolation is sound.** I-1/I-2 write via the raw SDK but call `trackUser(idA/idB)`, and the
  suite's `afterEach` runs `cleanupTrackedUsers()` (`repository-query-builder.integration.test.ts:32-34`),
  so the extra documents cannot leak into the neighbouring exact-count assertions (`:104`, `:127`).
  I-4a/I-4b clean up in `finally` blocks; I-6a/b/c use per-test collections named with `Date.now()`.
- **Deviations from the plan — all four judged right:**
  1. **I-1/I-2 seed via raw `db.…set()` rather than `bulkCreate`** — **right.** §8.3 mandates the
     harness, not a write API, and the harness cleanup contract is preserved via `trackUser`. Writing
     a `DocumentReference` through `bulkCreate` would hit `collectSentinelPaths` recursing into the
     ref's `_firestore` client; that is an unrelated bug and routing around it here is correct.
  2. **I-2 uses a one-second delta, not one nanosecond** — **right,** and the reason is sound:
     Firestore truncates timestamps below nanosecond resolution, so a 1-2 ns delta round-trips to
     equality and the over-merge assertion would have been vacuous. U-5 still pins nanosecond
     discrimination in-process (`firestoreValueEquality.unit.test.ts:76-82`). Only the stale comment
     above it needs fixing — **N1**.
  3. **I-6c added, making integration +7 instead of the planned +6** — **right.** §8.5 requires T7 at
     the converter site and §8.3's I-6 list omitted it; the plan was incomplete, not the
     implementation. Suite count stayed at 34 as §3.5 requires.
  4. **Mutations M4/M5/M7 strengthened to be falsifiable** — **right,** and the reasoning checks out:
     the plan's literal `numberKey → String(value)` is a no-op for `-0` (`String(-0) === '0'`), and
     removing only the `seen` guard still terminates via `MAX_DEPTH`. A mutation that cannot fail
     proves nothing; adjusting it to bite was the correct call.

---

## Not defects

- **`0017:129` still reads `(#40–#41)`.** Correct — historical amendment blockquote, protected by
  `docs/adr/README.md:16-21`. Do not "fix" this; the plan's §11 checkbox means live footers.
- **`MAX_DEPTH` merging values that agree to depth 64.** A real exception to "never over-merge", but
  explicitly documented in both the JSDoc and ADR-0034 Decision 5, and unreachable for stored data
  (Firestore caps nesting at 20). Deliberate and disclosed. (The *memory* behavior of the same walk
  is **M1** — a separate issue from the merge semantics.)
- **`seen` is path-scoped (`add`/`delete` around recursion) rather than a global visited set.** This
  is correct for cycle detection: a global set would falsely report a shared subtree as a cycle and
  over-merge. It is also the direct cause of M1's cost profile, but the trade-off is the right way
  round — under-merge/expense over silent data loss.
- **N3 mixed BigInt/number keying** (`['d', String(value)]` vs `['d', numberKey(value)]`). I checked
  the divergence case: `String(number)` goes exponential at |x| ≥ 1e21, which no Firestore int64
  (max ~9.2e18) can reach, so a BigInt-decoded integer and an equal double always produce the same
  digit string. U-23 pins the common case. Holds.
- **`Buffer` vs a plain `Uint8Array` merging.** Both hit `obj instanceof Uint8Array` and key by
  base64 content. Correct — Firestore Bytes equality is byte equality.
- **Marker/tag collisions.** I checked whether a real value can forge `['n']`, `['u']`, `['deep']`,
  `['cycle']` or `['ident', N]`: primitives all return ≥2-element arrays and containers carry `'a'`
  / `'o'` tags, so the one-element markers are unambiguous. Holds.
- **U-21's `__proto__` test.** It does assert what it appears to: the own enumerable `__proto__` data
  property is picked up by `Object.keys` and read via bracket access, so the two objects key
  differently, and the assertion on `Object.getPrototypeOf` proves no pollution occurred.

---

## Could-not-verify

Carried forward from `notes.md`, and I did not close any of them:

- CI peer matrix (`admin-compat` / `firestore-floor-compat`) — only `check:consumer` against
  `firebase-admin@^14.0.0` ran locally, and it passed (ESM + CJS, root + `/vector`).
- Production Firestore behavior (emulator only), including map key-order normalization and `-0`
  round-trip.
- A duplicated `@google-cloud/firestore` defeating `instanceof`. Not reproduced. Worth noting the
  design already makes this degrade safely: a failed nominal check falls to the identity fallback,
  never to the plain-object branch — which my T8 mutation confirms is the load-bearing ordering.

---

## What to do next

1. Fix **M1** (narrow the two claims), **N1** (one comment line). Decide **N2** and **N3** —
   both are legitimately "defer with an issue" or "not a defect", and I would not block on either.
2. Re-run at minimum `test:unit`, `check:format`, `check:docs`, `docs:build`; a full 14-leg re-run is
   cheap enough that the plan asks for it anyway.
3. Disposition **M1, N1, N2, N3** in `notes.md` — fixed / not a defect / deferred + issue.
4. **Commit the implementation.** It is currently untracked/unstaged working-tree state; the plan's
   §10 commit subject is
   `feat(query): dedupe distinctValues() by Firestore-aware semantic equality (#40)`.

**Verdict: APPROVE WITH FIXES.** The contract is right, the util is verbatim, every §6.1 invariant is
independently pinned by a mutation I ran myself, the bookkeeping is correct down to the historical
blockquote, and the 14-leg gate is green with both suite counts up. M1 is the one thing that must
change before merge, and it is a two-sentence documentation edit.

---

## Round 2

**Reviewer:** Claude Code (Opus 5), same external session · **Reviewed:** working tree on `6620b9e`
(implementation still uncommitted) · **Dispositions checked against `notes.md`:** M1, N1, N2, N3 —
**all four dispositioned**, none left open · **Tree:** unchanged by this review (one mutation
re-applied and reverted, verified byte-identical) · **`review.md` was not edited by the
implementer** — confirmed, no round-2 section was written into it.

**Verdict: APPROVE.**

| Finding | Implementer disposition | Reviewer check |
| ------- | ---------------------- | -------------- |
| **M1** | fixed — narrowed the claim in the `MAX_DEPTH` JSDoc and ADR-0034 Decision 5; memoization filed as #77 | **confirmed.** `src/utils/firestoreValueEquality.ts:32-44` now says the bound covers *recursion depth* only and states plainly that it "does **not** bound memory", naming the acyclic shared-subtree DAG, why `seen` correctly treats it as a DAG, and that stored data cannot reach it. ADR-0034 Decision 5 (`:53-62`) carries the same narrowing. Both point at #77. This is exactly the fix I asked for, and it is accurate against the behavior I measured in round 1 |
| **N1** | fixed — reworded the I-2 header comment | **confirmed.** `repository-query-builder.integration.test.ts:188-190` now reads "Timestamps a full second apart (see the note below)", consistent with the seed site at `:204-205` and with deviation #2 |
| **N2** | deferred → [#76](https://github.com/reggieofarrell/firestore-orm/issues/76) | **confirmed.** `gh issue view 76` → `#76 [OPEN] Pin VectorValue by-value equality on the decoded read path`. Real, open, accurately titled. Linked from ADR-0034 Related (`:9`) and References (`:105`). Correctly **not** added to any living footer or to ADR-0017 — it is not an ADR-0017 deferral |
| **N3** | not a defect — `PLAN.md` §10 arithmetic miss, no code action | **agreed.** The count is now **184** (183 + `review.md`), which is self-consistent: the number tracks files in the plan directory, not the change. Nothing re-quotes 182 |

### What I ran (round 2)

| Check | Command | Result |
| ----- | ------- | ------ |
| Fresh full §10 gate, all 14 legs | same chain as round 1, `; echo "CHAIN_EXIT=$?"` | **`CHAIN_EXIT=0`** — no leg short-circuited |
| Failing-leg scan | `grep -niE '^(npm ERR\|error\|✗\|✖)\|failed\|FAIL \|exited with'` over the log | **no matches** |
| Suite counts | from this run's log | unit **32 / 407**, integration **34 / 504** — unchanged from round 1, as expected for a comment-only delta; still above baseline (31/383, 34/497) |
| Coverage gates | this run's own output | `All unit coverage gates passed.` · `All integration coverage gates passed.` |
| `check:docs` / `docs:build` | legs 13-14 | `✓ documentation links OK (184 doc files scanned)` · `[build] Complete!` |
| Executable code unchanged? | comment-stripped diff of the util vs my round-1 backup | **IDENTICAL** — the only change is the JSDoc block, so every round-1 mutation result carries over unchanged |
| Mutation **T4** re-run on the *current* file | removed `.sort()` again | **4 failed / 28 passed** — U-1, U-3, U-22, U-24 only, same precise set as round 1 |
| Revert verified | `diff -q` vs pre-mutation copy + re-run both suites | identical; **32 / 32 passed** |
| T11 bookkeeping not regressed | `grep -rn -- '#40–#41\|#41–#41' docs/adr/` | still exactly one hit — `0017:129`, the protected #39 historical blockquote |
| #76 / #77 placement | `grep -rn '#76\|#77' docs/adr/ website/src/content/docs/` | present **only** in ADR-0034 (Related, Decision 5, References) — no footer or capability-table contamination |

Both new claims were verified against source rather than taken from `notes.md`, and the gate was
re-run by me rather than read from the notes' "Run 3" block.

### One note for #77 — not a finding against this change

Worth recording before someone implements the memoization, because the naive version would introduce
the over-merge this whole design exists to prevent: **the `['cycle']` marker is path-dependent**, so
a `WeakMap<object, CanonicalNode>` keyed on object identity is unsound.

Concretely — `root`/`mid` form a two-edge cycle, `m2` is a plain self-loop:

```js
const root = {}; const mid = { r: root }; root.x = mid; root.y = mid;
const m2 = {}; m2.r = m2;
```

Reached *from* `root`, `mid` canonicalizes to `['o',[['r',['cycle']]]]` — byte-identical to `m2`'s
key. Reached as a top-level value, `mid`'s correct key is the longer
`['o',[['r',['o',[['x',['cycle']],['y',['cycle']]]]]]]`. A memo would serve the cached truncated node
and silently collapse `mid` into `m2`. Verified against the current implementation:

```
TODAY (no memo) distinct([root, mid, m2]) = 3 (correct: 3)
```

So #77 needs either a memo that excludes any node whose subtree emitted a `['cycle']` marker, or a
cache keyed on `(object, cycle-free)` rather than object identity alone. The current unmemoized code
is correct here; this is only a trap for the follow-up.

### Verdict: APPROVE

The 14-leg gate is green on the tree as it stands (`CHAIN_EXIT=0`, all legs accounted for, both suite
counts above baseline, both coverage gates passing from the run's own output). All four round-1
findings are dispositioned in `notes.md` and each disposition holds against source. M1's fix is
accurate rather than merely reassuring — it states the real limit and names the reachability class.
The two deferrals point at real, open, correctly-scoped issues placed in the right sections. The
executable code is byte-identical to what I mutation-tested in round 1, and the T4 mutation still
bites the same four tests on the current file.

**Remaining, and outside the review loop:** the implementation is still **uncommitted working-tree
state** (`main..HEAD` holds only the three plan commits; `src/utils/firestoreValueEquality.ts` and
`src/tests/unit/firestoreValueEquality.unit.test.ts` are untracked). Commit it with the plan's §10
subject — `feat(query): dedupe distinctValues() by Firestore-aware semantic equality (#40)` — then
remove the plan directory in the final cleanup commit per `docs/plans/README.md`. Note that `git rm`
of the plan directory will drop `check:docs` back to 181.
