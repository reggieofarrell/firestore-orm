# Plan review — `issue-37-query-explain/PLAN.md`

**Reviewed:** the plan, not an implementation. Nothing in `src/` was changed by this review.
**Reviewer:** agent (pre-handoff quality/completeness review) · **Reviewed at baseline:**
`c686df4 docs(plans): implementation plan for query explain (#37)` on branch
`cursor/issue-37-query-explain` (plan baseline `746bb7f`, unmoved) · **Peers:**
`firebase-admin@14.2.0` / `@google-cloud/firestore@8.6.0`

**Verdict:** structurally complete against the `implementation-planning` §0–§11 contract, and
unusually accurate in §3 — every line number and both suite counts check out. **Two
compile-blocking defects in §6**, both traceable to the one step the plan chose to skip (the
prototype). One of them (B1) requires an owner decision the implementer is not authorized to make,
so it must be resolved in §1 before handoff. Additionally: one trap has no test that can falsify it
(S1), and §9 is under-enumerated against the bookkeeping map (S4).

Graded against `.rulesync/skills/implementation-planning/SKILL.md` (section contract, evidence
discipline, probes-vs-prototypes table, docs/ADR bookkeeping map).

---

## What was executed for this review

| Check | Command / method | Result |
| ----- | ---------------- | ------ |
| §6.1 / §6.2 code compiles | temp probe under `src/`, `npx tsc --noEmit -p tsconfig.typecheck.json` (probe removed after) | **2 errors** — see B1, B2 |
| Alternative type sources compile | same, both candidates | both clean |
| Baseline unit counts | `npm run test:unit` | **30 suites / 370 tests** — matches §3.5 |
| Baseline integration counts | `npm run test:integration:emulator` | **30 suites / 452 tests** — matches §3.5 |
| All §3.3 line citations | read each `file:line` | all exact |
| Integration coverage headroom | parsed `coverage/integration/lcov.info` against `scripts/check-coverage-gates.mjs` | ample — see M1 |
| ADR footer sweep set | `grep -rc '#37–#41' docs/adr/*.md` | matches §9.3's list |
| Starlight pages named in §9.4 | existence check | all 5 exist |
| SDK explain surface / limitToLast | read `firestore.d.ts`, `build/src/reference/query.js`, `query-util.js` | see B1, M3 |
| eslint posture for the typeof guard | read `eslint.config.mjs` | no type-aware rules — see M2 |

---

## What holds up

- **Every line citation in §3.3 is exact.** `QueryBuilder.ts:359` (abstract `toResult`), `:1485`
  (collection `toResult`), `CollectionGroup.ts:182` (group `toResult`), `:1439–1444` (`get()`),
  `:1300–1308` (`stream()` limitToLast guard), `VectorQueryBuilder.ts:17–21` (local
  `FirestoreVectorQuery`), `:191–204` (vector `get()`), `ErrorParser.ts:72–73` (plain-`Error`
  rethrow).
- **Both baseline suite counts are exact** (verified by running both suites).
- **P4 confirmed.** The `VectorQuery` block in `@google-cloud/firestore@8.6.0`'s `firestore.d.ts`
  declares only `query`, `get()`, `isEqual()` — no `explain`. The local type widen really is
  required.
- **D5's peer-leak precedent is real.** `QueryBuilder.ts:661` (`startAt(snapshot: DocumentSnapshot)`)
  puts an SDK type in a public signature without re-exporting the name, so "reference but don't
  re-export" is the established pattern, not a new invention.
- **The footer sweep set is right**: `0017` (×2), `0023`, `0024`, `0025`, `0026`, `0027`, `0029`,
  `0030` (×2). `0028` correctly has none.
- **All five Starlight pages exist**, and the Deferred row the plan wants moved is real
  (`reference/scope-and-capabilities.md:51`).
- **The unit-mock harness the plan assumes for U-1…U-9 exists and works**:
  `queryBuilderTerminals.unit.test.ts:74` constructs a real `FirestoreQueryBuilder` over a plain
  mock query; `vectorQueryBuilder.unit.test.ts` mocks `findNearest()`'s return object. U-1…U-9 are
  feasible as written.
- **Test-file conventions are correct.** `src/tests/types/*.type-test.ts` matches the 12 existing
  files, and `tsconfig.typecheck.json`'s `exclude` of `**/*.test.ts` does **not** match
  `*.type-test.ts`, so the new type test really is checked by `test:types`.
- **§10's fourteen legs match the skill's canonical gate command**, and the breaking-or-not ruling
  (additive, not `feat!`) is correct.
- **D1/D4/T6 follow correctly from P6/P8.** Treating the emulator throw as the integration contract
  and unit mocks as the only success-path proof is the right call for this SDK behavior.

---

## Blocking — §6 does not compile as written

### B1 — `ExplainOptions` / `ExplainMetrics` are **not** exported from `firebase-admin/firestore`

§6.1 and §6.2 both begin with `import type { ExplainMetrics, ExplainOptions } from
'firebase-admin/firestore'`. Compiling that:

```
error TS2305: Module '"firebase-admin/firestore"' has no exported member 'ExplainMetrics'.
error TS2305: Module '"firebase-admin/firestore"' has no exported member 'ExplainOptions'.
```

`firebase-admin@14.2.0`'s `lib/firestore/index.d.ts` re-exports an **explicit allowlist** from
`@google-cloud/firestore`. That list omits `ExplainOptions`, `ExplainMetrics`, `ExplainResults`,
`PlanSummary` and `ExecutionStats` — the same omission as `VectorQuery`, which the plan already
knows about via N5.

**P5b is a false green.** `probes/sdk-explain.mjs:90-91` tests
`@google-cloud/firestore/types/firestore.d.ts` for `export interface ExplainMetrics` — it never
tests the import path §6 prescribes. §5 then predicts the wrong remedy: "fix by importing types only
from `firebase-admin/firestore`" **is** the failure mode, not the fix.

This blocks §6.1, §6.2, §6.3, and type tests T-1/T-4.

**It is also an unresolved §1-class fork**, because both remedies have a consequence the implementer
is not authorized to choose between. Both were compiled clean during this review:

| Option | Spelling | Consequence |
| ------ | -------- | ----------- |
| **A** | `import type { ExplainMetrics, ExplainOptions } from '@google-cloud/firestore'` | `@google-cloud/firestore` is in **neither** `dependencies`, `peerDependencies`, nor `devDependencies` (only `firebase-admin` is a peer). The published `.d.ts` would reference a package reachable only by hoisting — fine under npm (so `check:consumer` would pass), not guaranteed under pnpm's strict layout. |
| **B** | derive from `Query`, which firebase-admin *does* re-export: `type ExplainOptions = NonNullable<Parameters<Query['explain']>[0]>`; `type ExplainMetrics = Awaited<ReturnType<Query<any>['explain']>>['metrics']` | No undeclared package in the published declaration graph. Slightly less readable; the derived names are local aliases, so D5's "do not re-export SDK names" still holds. |

Option B is the safer default given the peer situation, but it is the owner's call. Add it to §1 as
a decision (with the rejected alternative), and fix the imports in §6.1/§6.2 to match.

### B2 — §6.2's widened `FirestoreVectorQuery<T>` breaks the existing cast

§6.2 declares `explain` as a **required** member. `VectorQueryBuilder.ts:175` casts `findNearest()`'s
return with a plain `as FirestoreVectorQuery<T>`:

```
error TS2352: Conversion of type 'VectorQuery<any, DocumentData>' to type
'FirestoreVectorQuery<Row>' may be a mistake because neither type sufficiently overlaps with the
other. If this was intentional, convert the expression to 'unknown' first.
  Property 'explain' is missing in type 'VectorQuery<any, DocumentData>' but required in type
  'FirestoreVectorQuery<Row>'.
```

T4 warned about exactly this `.d.ts` gap, and then §6.2 walked into it. **Fix:** declare it optional
—

```ts
explain?: (options?: ExplainOptions) => Promise<{
  metrics: ExplainMetrics;
  snapshot: { docs: Array<QueryDocumentSnapshot<T>> } | null;
}>;
```

— which compiles with `VectorQueryBuilder.ts:175` untouched (verified) **and** is the honest shape
given D6's capability check. Do not "fix" it with `as unknown as`, which would erase the type's only
remaining safety.

### Root cause for both

The plan skipped the prototype (§0.4, §5) in exactly the case the skill's probes-vs-prototypes table
says to pay for one:

> **Someone else implements it**, and a wrong §6 costs them a full 14-leg cycle
> **The correct spelling of a type is genuinely uncertain** and two candidates need to be compiled
> against each other

Both conditions hold, and the skill even scopes the cost: "you need the type or signature edit plus
`npm run test:types`." That is ~2 minutes and would have caught B1 and B2. Probing the SDK's
*runtime* surface (which §3 did well) is not a substitute for compiling the *import path* the plan
prescribes.

---

## Significant — completeness and falsifiability

### S1 — T3 (collection-group path identity) has no test that can prove it

- **I-3 cannot.** `No explain results` is thrown by the SDK *before* any snapshot exists, so the
  rejection assertion never reaches `toResult`. It proves the method is wired to the group builder;
  it proves nothing about `path` / `parentPath`.
- **U-4 makes it optional** — "optional group harness if cheap."

Net: the trap the plan ranks **third** is unfalsifiable under the specified suite. Make the group
case a **required** unit test: build a `FirestoreCollectionGroupQueryBuilder` over a mocked query
whose `explain` resolves an analyze-shaped snapshot, and assert `documents[0]` carries `path` and
`parentPath`. Mutation-check it (T3's failure mode is a silent `{...data, id}` mapping that still
type-checks).

### S2 — the vector half of D8 has no test

U-2/U-3 lock `null` vs `[]` for Core. U-8 covers vector mapping + metrics. Nothing covers the vector
`snapshot === null` branch — the same T1 failure mode, duplicated in a second file, where a
copy-paste slip is most likely. Add vector equivalents of U-2 and U-3.

### S3 — the vector capability guard is unreachable through the ORM's own API

`findNearest()` calls `assertVectorSearchSupported()` (`VectorQueryBuilder.ts:162`), which hard-fails
anything below `@google-cloud/firestore` **7.10** (`VectorSearch.ts:235–261`, object-form probe).
`VectorQuery.explain` landed in **7.8**. So every SDK that can reach `VectorQueryBuilder.explain()`
already has `explain` on the vector query.

Keeping the guard as defense-in-depth is fine, but D6 presents it as parity-necessary with the Core
guard and never notices the interaction — despite citing `assertVectorSearchSupported` as its model.
Either say so in D6 (defensive, unreachable via the public path, retained for direct/edge use) or
drop the second guard and U-9. As written, U-9 tests a branch no supported configuration can hit.

### S4 — §9 is not enumerated "by file and line"

The bookkeeping map says: "Enumerate these **by file and line** in §9. Silent omissions here are the
repo's main defect mode." §9.3/§9.4 name files only. Add at least:

- `reference/scope-and-capabilities.md:51` — the single Deferred row to split (Supported row for
  `explain()`; the Deferred row retitled to `explainStream` only, linking the new follow-up issue).
- `0017-v3-core-operations-scope.md` — **2** occurrences of the range; append after the #36
  amendment, never rewrite it.
- `0030-typed-query-bounds-and-limit-to-last.md` — **2** occurrences (the plan's list implies one).

**And fix the grep.** §9.3 says to grep `` \( #37–#41\) `` — the stray space after `\(` matches
**nothing** in the tree. An implementer who trusts it concludes the sweep is already done, which is
precisely the T10 failure the instruction exists to prevent. The working greps are:

```bash
grep -rc '#37–#41' docs/adr/*.md | grep -v ':0'
```

### S5 — `packageExports.unit.test.ts` was left as a conditional the planner could have settled

§3.4 says "Assert `QueryExplainResult` is a type-only export **if** the suite checks type exports;
otherwise rely on `test:types` + build." It does not — the file only asserts runtime values
(`expect(typeof errorHandler).toBe('function')` and similar). One read settles it: **no edit
needed**, and T-4 plus `check:consumer` own that guarantee. The skill's map lists this file as a
required consideration for public-API changes, so the plan should state the resolution rather than
delegate the lookup.

### S6 — `src/vector/index.ts` re-export not considered

`VectorQueryBuilder.explain()` returns `QueryExplainResult<R>`, whose source module
(`src/core/QueryBuilder.ts`) has no export-map subpath. `src/vector/index.ts:21-22` sets an explicit
precedent for exactly this case:

> The value type of `vectorEmbeddingSchema` — re-exported so consumers can name it through the
> public `/vector` specifier (its source module `utils/pathTypes` has no export-map subpath) (T5).

§6.3 touches only `src/index.ts`. A `/vector`-only consumer can still reach the type through the
package root, so this is a consistency call rather than a defect — but it is the same class of miss
that T-4 exists to catch, and the plan should decide it explicitly.

---

## Minor

### M1 — §8.4 guesses where it tells the implementer to measure

The paragraph says "measure; do not guess" while itself guessing, and its final sentence
contradicts itself ("add an integration-accessible mock is the wrong fix; instead call explain
through a builder whose underlying query is replaced only in unit tests"). Measured from
`coverage/integration/lcov.info` against `scripts/check-coverage-gates.mjs`:

| Gate | lines (thr. 90) | branches (thr. 75) | functions | slack |
| ---- | --------------- | ------------------ | --------- | ----- |
| `src/core/QueryBuilder.ts` | 97.27% (1856/1908) | 89.16% (181/203) | 100% (58/58), thr. 95 | ≈154 lines · 38 branch paths · 3 functions |
| `src/vector/*` | 94.69% (624/659) | 91.89% (102/111) | 96.43% (27/28), thr. 90 | ≈34 lines · 25 branch paths · **2 functions** |
| `src/core/CollectionGroup.ts` | 99.55% (446/448) | 97.22% (35/36) | 100% (20/20), thr. 95 | ≈47 lines · 10 branch paths · 1 function |

`explain()` adds two functions per file (the method plus the `.map()` arrow), of which the arrow is
never reached in integration because the emulator always throws. Vector therefore lands at ≈93.3%
functions against a 90 threshold — the tightest number, and still passing. **No gate risk.** Replace
the paragraph with these figures and one sentence.

### M2 — §6.1's structural cast is unnecessary

`Query.explain` **is** in the d.ts (`firestore.d.ts:1923`), so this compiles fully typed, with
`results.snapshot` already `QuerySnapshot | null`:

```ts
if (typeof this.query.explain !== 'function') { throw new Error(/* capability message */); }
const results = await this.query.explain(options);
```

`@typescript-eslint/no-unnecessary-condition` would flag the always-true guard, but it is **not
enabled** — `eslint.config.mjs` uses `tseslint.configs.recommended`, not the type-aware/strict
configs. The hand-rolled `{ explain?: … }` type re-declares the SDK contract for no gain and must be
kept in sync by hand. (The vector side genuinely needs a local type; the Core side does not.)

### M3 — the limitToLast decision is correct but unproven, and the follow-up issue inherits the gap

§3.4 asserts "explain behaves like `get`, not `stream`" with no probe. Verified during this review:

- `Query.explain()` (`build/src/reference/query.js:878`) calls `_getResponse()`, and
  `query-util.js`'s `_getResponse` **reverses** `docs` for `LimitType.Last`. So an analyzed
  `limitToLast` explain returns correctly ordered documents — the no-guard decision is right.
- `explainStream()` (`query.js:959-965`) **throws** for `limitToLast`, mirroring `stream()`.

Add the first as a §3 row (it is load-bearing for a "deliberately NOT changed" entry), and note the
second in §9.6 — the deferred `explainStream` will need a `hasLimitToLast` guard like `stream()`
has, and the issue body as specified does not mention it.

### M4 — the plan file is currently dirty

The uncommitted working-tree edit strips the trailing-double-space markdown hard breaks in §9.6, so
Title / Labels / Body will render as one run-on paragraph. No gate impact — `docs/plans/*/**` is in
`.prettierignore`, so neither version is checked — but commit or revert it before handoff so the
implementer reads a clean baseline.

---

## Recommended edits before handoff

1. **§1** — add a decision for the explain-type import source (B1 Option A vs B), with the rejected
   alternative and the pnpm/undeclared-package rationale.
2. **§6.1 / §6.2 / §6.3** — fix the imports to match that decision; make vector `explain` **optional**
   (B2); optionally simplify the Core path to the uncast form (M2).
3. **§3** — correct P5b to state what was actually tested, and add the `explain()`-honors-limitToLast
   row (M3). Move the `@google-cloud/firestore`-vs-`firebase-admin` export distinction into §3.1.
4. **§5** — replace the "importing types only from `firebase-admin/firestore`" remedy, which is the
   bug; keep the honest "unprototyped" admission but name B1/B2 as now-verified.
5. **§8** — make the collection-group `toResult` unit test mandatory (S1); add vector null-vs-`[]`
   cases (S2); resolve or drop U-9 (S3).
6. **§8.4** — replace with the measured numbers in M1.
7. **§9** — add line anchors, fix the broken grep, note ADR-0017 and ADR-0030 each carry two
   occurrences (S4); state the `packageExports.unit.test.ts` resolution (S5); decide the
   `src/vector/index.ts` re-export (S6); add the limitToLast note to §9.6 (M3).

With those in place the plan is executable end-to-end. As it currently stands, an implementer burns
their first cycle on TS2305/TS2352 and then has to make a peer-dependency call §1 told them not to
re-litigate.
