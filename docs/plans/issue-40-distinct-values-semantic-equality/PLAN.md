# Issue #40 — `distinctValues()` dedupes structured/reference values by semantic equality

**Implementer:** next agent / teammate (fresh clone or rebased branch) · **Reviewer:** maintainer ·
**Baseline:** `main` @ `3f0dd7a` (`feat(repository): opt-in snapshot metadata and detailed listeners
(#39) (#74)`) · **Branch:** `feat/issue-40-distinct-values-semantic-equality` — already created and
pushed with this plan on it, **rebased onto this baseline**; check it out, do not cut a new one

**Issue:** [#40](https://github.com/reggieofarrell/firestore-orm/issues/40) — labels `enhancement`,
`parity`, `v3.x`. The `parity`/`v3.x` pair puts this in ADR-0017's deferral set, so the **full §9
deferral bookkeeping applies**: a new ADR, an ADR-0017 amendment blockquote, the `docs/adr/README.md`
row, every living-index footer, and the capability-matrix row move.

> **Acceptance (verbatim from the issue):** "structured/reference values deduped by semantic
> equality, or a documented server-side alternative."

> **Issue body, verbatim:** "`distinctValues()` is client-side (downloads all matching docs; a JS Set
> dedupes structured values by identity). Either implement Firestore-aware deep equality for
> structured values, or expose true server-side distinct via a future Pipeline extension under a
> clearly different API. Keep the current method documented as client-side for Core."

✅ **#39 has merged** (ADR-0033, `3f0dd7a`) and this plan is rebased onto it — every line number in §3,
every ADR anchor in §9, and both baseline suite counts were **re-derived against `3f0dd7a`**, not
carried over. #40 is now the **second-to-last** ADR-0017 deferral: after it ships only
[#41](https://github.com/reggieofarrell/firestore-orm/issues/41) remains, which makes §9.1's range
arithmetic determinate (see **T11**). Still re-run the §3 enumeration if `main` moves again before you
start (§7 step 1).

---

## §0 How to use this plan

1. Read **§1** (settled — do not re-litigate) and **§4** (traps) before writing any code. §4 is the
   highest-value section here: every trap in it is a silent over-merge or a crash, not a compile
   error.
2. **§6 is copy-verbatim.** The whole of `src/utils/firestoreValueEquality.ts` was written into
   `src/`, compiled with `npm run test:types`, checked with `npx prettier --check` and
   `npx eslint`, emitted through `tsc --declaration --emitDeclarationOnly`, and then removed. See
   §12 for the record. The `QueryBuilder.ts` edits in §6 are a spec, not a run diff — see §5.
3. **There is no `prototype.patch` and no full prototype.** The change never ran against the real
   `QueryBuilder.ts`, so the gate has not been executed with it. §5 says exactly what that leaves
   unverified. The *algorithm* is separately verified — see §3.4.
4. Every claim in §3 came out of an executed probe on this baseline. Probes live in
   `docs/plans/issue-40-distinct-values-semantic-equality/probes/`; each one's run command is in its
   header comment, and the appendix maps file → what it proves. **Re-run any you doubt. Do not trust
   the issue body over §3** — §2.3 lists where the issue is stale.
5. Two probes **assert** rather than ask, and §8 promotes them to committed tests:
   `P-canonical-key-algorithm.mjs` → the unit suite (U-1…U-23),
   `N-instanceof-across-read-path.mjs` → integration test I-1. Do not delete them from `probes/`
   before doing that; do not ship them as the tests.
6. **Follow the `plan-execution` skill.** It owns your contract: `notes.md` written as you go and
   committed on this branch, the mutation checks §8 requires, and the independent refute-first
   self-review you must pass before calling this ready for external review. Your self-review stays in
   chat + `notes.md`; do **not** write `review.md` (that slot is the external reviewer's).

### Environment

Node 24 per `.nvmrc` — the Husky hooks hard-fail on any other major. A JDK is required for
`test:integration:emulator`. If port 8080 is already taken by another session's emulator, run against
an alternate port with a temp config rather than killing it:

```bash
printf '{\n  "emulators": { "firestore": { "host": "127.0.0.1", "port": 8099 }, "ui": { "enabled": false } }\n}\n' > /tmp/firebase.alt.json && FIRESTORE_EMULATOR_HOST=127.0.0.1:8099 npx firebase emulators:exec --config /tmp/firebase.alt.json --project demo-firestoreorm-test --only firestore "npm run test:integration"
```

---

## §1 Owner-approved decisions

Settled with the owner against the §3 evidence. **Do not re-litigate any of these.**

| Id     | Fork                                                                                                            | Decision                                                                                                                                                                                                                              | Rejected alternative and why                                                                                                                                                                                                                                                                                              |
| ------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | The issue's two acceptance paths: client-side semantic equality, or a documented server-side alternative.        | **Client-side semantic equality.** Dedupe by a Firestore-aware canonical key. The method stays documented as client-side. #40 closes; #41 keeps the Enterprise Pipeline path.                                                          | *Document-only, no code change* — rejected: Firestore Core has **no** server-side `DISTINCT` (only the pre-GA Pipeline model, already #41), so this path collapses to prose, and `QueryBuilder.ts:1314-1318` already carries that prose. The acceptance line would not be met. Measured cost of doing nothing: **P1**.        |
| **D2** | Default-on, or opt-in via an options argument.                                                                   | **Default-on; the signature and return type do not change.** Only dedupe semantics change.                                                                                                                                            | *`distinctValues(field, { equality })`* — rejected: adds a public options type to ship a fidelity fix as opt-in. ADR-0020 (aggregate `null` fidelity) and ADR-0028 are the precedent — fidelity fixes ship as the default. 3.0.0 is unreleased (`package.json` `version` is still `2.2.1`, **R12**), so there is no compat burden. |
| **D3** | The issue also complains `distinctValues()` "downloads all matching docs". Add an internal field-mask projection? | **No — out of scope, deferred to a follow-up issue.**                                                                                                                                                                                 | *Add `select(field)` internally* — rejected on evidence: the method reads the field as a **literal top-level key** (`doc.data()[field as string]`, `QueryBuilder.ts:1296`), so a model key containing a `.` works today; handing that same string to `select()` makes the SDK read it as a nested path — a silent behavior change. It also saves bytes, not billed document reads. |
| **D4** | How to treat values the canonicalizer does not recognize (a `readConverter` can return `Date`, `Map`, `Set`, a custom class, even a cycle). | **Identity fallback, plus a `Date` special case.** Recognized Firestore types + plain objects/arrays/primitives/`Date` dedupe semantically; everything else falls back to per-instance identity and is never merged. Cycles terminate on a marker. | *Throw on unrecognized instances* — rejected: turns a working (if imprecise) call into a runtime failure for existing converter users. *No `Date` case* — rejected: `Date` is the most likely converter output and costs one branch. Over-merging silently drops a caller's distinct values; under-merging is exactly today's behavior, so the fallback direction is the safe one. |
| **D5** | Where the logic lives.                                                                                          | **A new internal util, `src/utils/firestoreValueEquality.ts`**, exporting only `distinctFirestoreValues`. `QueryBuilder.distinctValues` becomes a one-line call. *(derived, not asked)*                                                | *Inline it in `QueryBuilder.ts`* — rejected: `src/utils/**` is owned by the **unit** coverage gate, so a branch-heavy walker gets fast, exhaustive unit coverage; `QueryBuilder.ts` is integration-gated and would need emulator round-trips per branch. `src/utils/safeObject.ts` and `src/utils/vectorValue.ts` are the precedent for an internal, non-exported util (**R5**). |
| **D6** | Public export?                                                                                                  | **No.** The util is internal — not added to `src/index.ts` and not re-exported from `src/vector/index.ts`. *(derived, not asked)*                                                                                                       | *Export it* — rejected: nothing in the public contract needs to name it; the exported signature is unchanged. Keeps `packageExports.unit.test.ts` and `reference/types.md` untouched (**R5**).                                                                                                                             |

---

## §2 Scope

### 2.1 In scope

| Area                                                       | Change                                                                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/utils/firestoreValueEquality.ts` (**new**)             | Canonicalizing keyer + `distinctFirestoreValues()`. Full source in §6.1.                                                                    |
| `src/core/QueryBuilder.ts`                                  | Import the util; replace the `new Set(...)` expression at line 1364; rewrite the `LIMITATION` JSDoc paragraph at lines 1314-1318. §6.2.       |
| `src/tests/unit/firestoreValueEquality.unit.test.ts` (**new**) | U-1…U-23 — the behavior matrix. Owns the `src/utils` unit gate for the new file.                                                          |
| `src/tests/unit/queryBuilderTerminals.unit.test.ts`         | U-24 — call-site wiring on a mocked query.                                                                                                  |
| Three integration test files                                | I-1…I-6 — real decoded SDK values, the collection-group site, and the converter site. §8.                                                    |
| Docs + ADR bookkeeping                                      | New ADR, ADR-0017 amendment, every living-index footer, `docs/adr/README.md` row, capability-matrix row move, 3 Starlight pages. §9.          |

### 2.2 Explicitly **out** of scope

- **Any field-mask / projection optimization** (D3). Do not touch line 1296 or the `hasSelect` guard
  at 1250-1293.
- **Server-side / Pipeline distinct** — stays with
  [#41](https://github.com/reggieofarrell/firestore-orm/issues/41). Do not open a `/pipeline` subpath.
- **Any options argument, or any change to the signature, constraint, or return type** (D2). The
  existing type tests must keep passing *unchanged* — see §8.1.
- **Extracting a shared `isPlainObject` out of `src/utils/safeObject.ts`'s `deepFreeze`** — see §7
  anti-instructions.
- **Sorting or otherwise reordering the result.** First-seen order is preserved; that is the current
  contract and no test or doc promises anything else.
- **Any other `Set`-based dedupe.** `grep -rn "new Set(" src --include="*.ts" | grep -v "/tests/"`
  returns exactly two hits (**R1**): `QueryBuilder.ts:1300` (this change) and
  `src/utils/dotNotation.ts:32`, a static `Set` of forbidden path segments — unrelated.

### 2.3 Where the issue is stale or incomplete

| Issue says                                                                                                   | Actually                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "See the 'Server-side Firestore feature parity follow-up' in `docs/development/v3-release-review.md`"        | **That file does not exist.** `ls docs/development/` returns `releasing.md`, `test-coverage-followups.md`, `testing.md` (**R9**). ADR-0017's own References section says those review records are "maintainer-local under `reviews/`, not committed to the repo." Use ADR-0017 as the citation; do not add a link to the missing file (`check:docs` would fail). |
| "a JS Set dedupes structured values by identity"                                                             | True, and **also** worse than stated: the `Set` splits `Timestamp`, `GeoPoint`, `DocumentReference`, `Bytes` and `VectorValue` — types that all carry an SDK `isEqual` — and it splits a BigInt from the numerically equal number (**P1**, **N3**). It is *right* about `NaN` and `-0`, which `SameValueZero` already merges and which must not regress (**T6**). |
| Implies the fix is about "deep equality"                                                                      | A **pairwise** deep-equality pass is O(n²) over an already-downloaded page. The prescription is an O(n) canonical key (§3.4). Do not implement pairwise comparison.                                                                                              |
| Silent on the vector surface                                                                                  | `VectorQueryBuilder` exposes **no** `distinctValues` (**R4**), so `src/vector/**` needs no source change. Stated here because "did you check the vector wrapper" is this repo's standard review question.                                                        |

---

## §3 Verified facts

Every row was produced by running something on **`3f0dd7a`**. Ids are cited from §4, §6, §8 and §11.

### 3.1 Authoritative site enumeration

| Id      | Site                                                                        | Fact                                                                                                                                                            |
| ------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1**  | `src/core/QueryBuilder.ts:1364`                                             | The **only** identity dedupe of Firestore values in the codebase: `return [...new Set(values)].filter(val => val !== undefined) as ValueAtKey<T, K>[];`           |
| **R2**  | `src/core/QueryBuilder.ts:1310-1368`                                        | `distinctValues` is defined once, on `FirestoreQueryBuilderBase` (declared at **1343**). JSDoc **1310-1342**; the `LIMITATION` paragraph to rewrite is **1314-1318**; the `hasSelect` guard is **1350-1357**; the raw field read is **1360**; the `try`/`catch` spans **1358-1367**. (File is 2186 lines after #39.) |
| **R3**  | `src/core/CollectionGroup.ts`                                               | `grep -c "distinctValues" src/core/CollectionGroup.ts` → **0**. `FirestoreCollectionGroupQueryBuilder` (declared line 155) does **not** override it; the group inherits R2. #39 did not touch this file. No source edit needed — but the site still needs its own test (**T9**). |
| **R4**  | `src/vector/VectorQueryBuilder.ts`                                          | Its whole method surface: `where` (91), `whereFilter` (117), `select` (131), `findNearest` (154), `get` (216), `explain` (246), `getOne` (281), and `orderBy` (289) / `onSnapshot` (302) / `stream` (312) which throw. **No `distinctValues`** — the terminal is unreachable from the vector surface. |
| **R5**  | `src/index.ts`                                                              | Only three util modules are re-exported: `dotNotation.js` (**89**), `pathTypes.js` (**91**), `timestamps.js` (**98**). `safeObject.ts` and `vectorValue.ts` are internal — the precedent for D5/D6. |
| **R6**  | —                                                                           | No new error class, so `src/core/Errors.ts`, `src/core/ErrorParser.ts` and `src/express/index.ts`'s status mapping are untouched.                                  |
| **R7**  | `README.md`, `npm-readme.md`                                                | `grep -n "distinctValues" README.md npm-readme.md` → **no output, exit 1**. `readme-sync` does **not** fire. (Expected result: no rows. A match would mean §9 is incomplete.) |
| **R8**  | `website/src/content/docs/2.0/**`                                           | `distinctValues` appears at `2.0/guides/queries.md:36,129,134` and `2.0/guides/api-reference.md:266`. **Frozen archive — do not touch** (§7 anti-instructions).      |
| **R9**  | `docs/development/**`                                                       | `grep -rn "distinctValues\|#40" docs/development/*.md` → **no output**. No dev-doc edit. No test *infrastructure* changes either (no new harness, factory, mock, jest config, or gate matcher), so the `testing-docs-sync` rule does not fire. |
| **R10** | `scripts/check-coverage-gates.mjs:110-113`                                  | The unit gate matches `file => file.startsWith('src/utils/')` — a **prefix** predicate, so the new file is gated automatically. **No matcher change.** (Contrast: the ADR-0023 footer notes the exact-path matching used elsewhere.) |
| **R11** | 6 existing `distinctValues` assertions across 5 tests                       | All assert **scalars only**, so none should break: `repository-query-builder.integration.test.ts:96-101` (`['books','games']`) and `:103-124` (`'gold'`/`null`, assertions at 120-123) — #39 did not touch this file; `repository-collection-group.integration.test.ts:359-362` (`['draft','published']`), `:397-399` (the `select()` rejection), `:539-562` (`['/var/a.txt','/var/b.txt']` at 552-553) — shifted +3 by #39; `repository-read-only-converter.integration.test.ts:142-158` (`['DUP','UNIQ']` at 154, `[100,101]` at 157) — unchanged. |
| **R12** | `package.json`                                                              | `version: "2.2.1"` (3.0.0 is unreleased and generated at release time); peers `firebase-admin: ^12.0.0 \|\| ^13.0.0 \|\| ^14.0.0`, `zod: ^4.0.0`; `engines.node: >=22.0.0`. |
| **R13** | `jest.config.base.js`                                                       | `collectCoverageFrom: ['src/**/*.ts', …]` — an **untested new file reports 0%** and is included in the `src/utils` gate. A unit test file is therefore mandatory, not optional (**T10**). |
| **R14** | `src/core/FirestoreRepository.ts:166-225` (`ReadOnlyTransactionalRepository`) | Its **entire** member surface, re-enumerated after #39: `getManyInTransaction` (×2 overloads), `getInTransaction`, `fromSnapshot`, `validate` (×2), `id`, `newId`, `getCollectionPath`, and two `readonly` schema properties — 11 signatures, and **no `query()`**. No transactional or PITR path can reach `distinctValues`; the read-only transaction surface is not a site for this change. |

### 3.2 SDK value shapes and equality — probe `N-sdk-value-shapes.mjs`, `N-ref-equality-and-converter.mjs`

Versions in the dev tree: `firebase-admin@14.2.0`, `@google-cloud/firestore@8.6.0`.

| Id     | Expression                                                       | Observed                                                                                                            |
| ------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **N1** | `typeof x.isEqual` for `Timestamp` / `GeoPoint` / `DocumentReference` / `VectorValue` | `'function'` on all four; each returns `true` for a semantically equal sibling.                                       |
| **N2** | `typeof Buffer.from([1,2,3]).isEqual`                            | `'undefined'` — Firestore `Bytes` decode to a Node `Buffer`, which has **no** `isEqual`. `a.bytes.equals(b.bytes)` → `true`. Bytes need explicit handling. |
| **N3** | `new Set([1, 1n]).size`                                          | `2`. With `Firestore.settings({ useBigInt: true })` integers decode to BigInt; Firestore treats an integer and the equal double as one value, so the keyer must share a numeric tag. |
| **N4** | `plainRef.isEqual(convertedRef)` for the same path               | **`false`** — `DocumentReference.isEqual` also compares the attached converter (own keys are `_firestore`, `_path`, `_converter`). `plainRef.path === convertedRef.path` → `true`. Cross-`Firestore`-instance: `isEqual` `false`, `.path` equal. **Key by `.path`, not `isEqual`** (**T3**). |
| **N5** | `Object.keys(docA.m)` vs `Object.keys(docB.m)` for two documents written `{x,y}` and `{y,x}` | **`['x','y']` vs `['y','x']`** — the emulator preserves each document's written key order. Two semantically equal maps genuinely arrive with different key order, so `.sort()` is load-bearing (**T4**). |
| **N6** | `new Set([NaN, NaN]).size`                                       | `1` — `SameValueZero` already merged `NaN`. Firestore's total ordering agrees (`NaN` is one value). Must not regress. |
| **N7** | `new Set([0, -0]).size`; `Object.is(readBack, -0)`               | `1`; and Firestore round-trips `-0` as `-0`. So `-0`/`0` merge today and must keep merging (Firestore's ordering compares them equal). |
| **N8** | `Timestamp.now().toJSON`                                         | `undefined` — no `toJSON` in `@google-cloud/firestore@8.6.0`. Do not rely on one.                                     |
| **N9** | `Object.keys(readBackRef)`                                       | `['_firestore','_path','_converter']` — a `DocumentReference` owns the whole `Firestore` client. `JSON.stringify` on one does not throw here, but it is not a canonicalization: nothing about that output is a stable value identity. |

### 3.3 Do the nominal checks hold on values the SDK actually decoded? — probe `N-instanceof-across-read-path.mjs`

"The class is exported from `firebase-admin/firestore`" and "a value out of `doc.data()` is an
`instanceof` that class" are different claims. This probe asserts the second one, on both an
unconverted and a `withConverter`-wrapped read of the same document. **All checks hold on both
paths:**

| Id      | Check                                                                                                | Unconverted read | Converted read |
| ------- | ---------------------------------------------------------------------------------------------------- | ---------------- | -------------- |
| **N10** | `data.ts instanceof Timestamp`                                                                       | `true`           | `true`         |
| **N10** | `data.gp instanceof GeoPoint`                                                                        | `true`           | `true`         |
| **N10** | `data.ref instanceof DocumentReference`                                                              | `true`           | `true`         |
| **N10** | `data.bytes instanceof Uint8Array` / `Buffer.isBuffer(...)`                                          | `true` / `true`  | `true` / `true` |
| **N10** | `data.vec instanceof` the ctor `FieldValue.vector()` produces (i.e. `isGenuineVectorValue`)          | `true`           | `true`         |
| **N11** | `Object.getPrototypeOf(data.ts / .ref / .bytes / .vec) === Object.prototype`                         | **`false`** ×4   | **`false`** ×4 |
| **N11** | `Object.getPrototypeOf(data.map) === Object.prototype`; `Array.isArray(data.arr)`                    | `true`; `true`   | `true`; `true` |

**N11 is the safety invariant behind D4:** because no Firestore value class has `Object.prototype`,
a *failed* nominal check falls through to the **identity fallback** (today's behavior), never into the
plain-object branch. Degradation can only ever under-merge.

| Id      | Check                                                                       | Observed                                                                             |
| ------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **N12** | An own, enumerable `__proto__` **data** property: `Object.keys(o)`, `o['__proto__']`, `Object.getPrototypeOf(o)` | `['__proto__']`, `'own-value'`, unchanged (`Object.prototype`). The keyer's `Object.keys` + `record[key]` walk reads it faithfully and does not pollute — no `safeAssign` needed on a read-only walk. |

### 3.4 Does the algorithm work? — probe `P-canonical-key-algorithm.mjs`

27 cases, three encodings compared: today's `new Set`, a **NAIVE** hand-rolled delimiter join, and the
**NESTED** JSON-safe tagged tree §6.1 prescribes. `node docs/plans/issue-40-distinct-values-semantic-equality/probes/P-canonical-key-algorithm.mjs`
exits `0` iff NESTED is right on all 27.

| Id     | Encoding                     | Wrong on | Which cases                                                                                                                                                    |
| ------ | ---------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1** | `new Set` (today)            | **9/27** | equal maps w/ different key order · equal nested maps · equal arrays · equal `Timestamp`s · equal `GeoPoint`s · equal refs · equal `Bytes` · equal `VectorValue`s · `1n` vs `1`. **This is the measured size of the bug.** |
| **P2** | NAIVE delimiter join         | **2/27** | `['a','b']` merged with `['a,s:b']`; `{'a=s:x,b':1}` merged with `{a:'x',b:1}`. **Silent over-merge** — the caller's list is short by one, no error (**T1**).     |
| **P3** | NESTED (prescribed)          | **0/27** | —                                                                                                                                                              |

| Id     | Additional finding                                                                             | Observed                                                                                                                                                       |
| ------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P4** | NAIVE on two structurally-equal **cyclic** objects                                             | `THREW RangeError: Maximum call stack size exceeded`. NESTED: `1 distinct (no throw)` (**T7**).                                                                  |
| **P5** | NAIVE on `[new Custom(1), new Map(), new Set()]`                                               | `1` — all three collapse to the tag `'x'`. Cross-type over-merge (**T8**).                                                                                      |
| **P6** | NESTED with a **fresh identity registry per key computation** on the same three values          | `1`, and two equal `Custom` instances → `1`. With a **call-scoped** registry: `3` and `2`. The counter restarting at `0` makes every unrecognized instance key to `["ident",0]`. **Zero compile errors** (**T2**). This was a real bug in the first draft of the algorithm. |
| **P7** | NESTED, call-scoped: equal `Date`s → `1`; the same instance twice → `1`                         | Confirms D4's `Date` case and that identity is stable within a pass.                                                                                             |

### 3.5 Measured gate headroom

Baseline, clean tree, **`3f0dd7a`** (re-measured after #39 merged):

| Suite       | Suites / tests | Gate                      | lines             | branches          | functions     |
| ----------- | -------------- | ------------------------- | ----------------- | ----------------- | ------------- |
| Unit        | **31 / 383**   | `src/utils` (95/90/90)    | 98.91 % (723/731) | 94.67 % (160/169) | 100 % (28/28) |
| Integration | **34 / 497**   | `QueryBuilder` (90/75/95) | 96.80 %           | 87.83 %           | 100 %         |

The unit row is **byte-identical to the pre-#39 measurement** — #39 added no util and no unit test, so
the headroom formulas below are unchanged. The integration row moved (#39 added two test files and
+220 lines to `QueryBuilder.ts`); its gate still clears every threshold with room to spare.

Headroom for the new util. With the existing `src/utils` totals above, a new file adding `a` counters
of which `u` are **uncovered** keeps the gate green while:

| Metric    | Constraint         | For a ~150-line / ~45-branch / ~7-function file |
| --------- | ------------------ | ------------------------------------------------ |
| lines     | `u ≤ 28.55 + 0.05a` | `u ≤ 36` uncovered lines                         |
| branches  | `u ≤ 7.90 + 0.10a`  | `u ≤ 12` uncovered branches                      |
| functions | `u ≤ 2.80 + 0.10a`  | `u ≤ 3` uncovered functions                      |

Comfortable, **but only with a real test file** (**R13**/**T10**) — at `u = a` the gate fails outright.
`src/core/QueryBuilder.ts` gains no new branch (an expression is replaced by a call), so the
integration gate is materially unchanged; `src/utils/**` matches **no** integration gate, so the new
file has no effect there (`INTEGRATION_GATES` covers only `FirestoreRepository.ts`, `QueryBuilder.ts`,
`CollectionGroup.ts`, `Validation.ts`, `src/vector/`).

### 3.6 Deliberately **NOT** changed

Every entry cites the fact that proves it is safe to leave alone.

| Left alone                                                              | Proof              |
| ----------------------------------------------------------------------- | ------------------ |
| `src/vector/**`, incl. the `/vector` subpath re-exports                  | **R4** (no `distinctValues` on the vector surface) + **D6** (nothing new is public) |
| `src/core/CollectionGroup.ts`                                            | **R3** (no override; inherits R2). Tests still added — **T9**                       |
| The read-only / PITR transaction surface (`ReadOnlyTransactionalRepository`) | **R14** (no `query()`, so `distinctValues` is unreachable there)                 |
| `src/index.ts`, `src/tests/unit/packageExports.unit.test.ts`, `reference/types.md` | **R5** + **D6**                                                          |
| `src/core/Errors.ts`, `ErrorParser.ts`, `src/express/index.ts`            | **R6** (no new error class)                                                          |
| `README.md`, `npm-readme.md`                                             | **R7** (grep returns nothing)                                                        |
| `website/src/content/docs/2.0/**`                                        | **R8** (frozen archive)                                                              |
| `docs/development/*.md`, incl. `testing.md` and `test-coverage-followups.md` | **R9**                                                                           |
| `scripts/check-coverage-gates.mjs`                                       | **R10** (prefix predicate already matches)                                           |
| `CHANGELOG.md`                                                           | Generated from Conventional Commits — never hand-edited                              |
| `QueryBuilder.ts:1296` (the raw field read) and 1286-1293 (`hasSelect`)   | **D3** (no projection) — and the existing rejection test at `repository-collection-group.integration.test.ts:394` pins the guard |
| `src/utils/dotNotation.ts:32`                                            | **R1** (a static string `Set`, unrelated)                                            |
| The `distinctValues` signature, constraint and return type               | **D2**; existing type tests pin them (§8.1)                                          |

---

## §4 Traps

Ordered by how badly a reasonable implementer gets it wrong. **Every one of these fails silently or
crashes — none is a compile error.**

> **T1 — A delimiter-joined canonical key silently merges distinct values (P2).**
> The natural first implementation is a string join: `a[s:a,s:b]` for `['a','b']`, `o{k=v,…}` for a
> map. Probe P measures the result: `['a','b']` and `['a,s:b']` produce the **same** key, as do
> `{'a=s:x,b':1}` and `{a:'x',b:1}`. There is no compile error and no throw — the caller's distinct
> list is simply one value short. Use §6.1's **nested tagged tree** and let `JSON.stringify` own the
> quoting and escaping. Observable: U-10 and U-11 assert length `2`; with a delimiter join they
> return `1`.

> **T2 — A per-value identity registry collapses every unrecognized instance into one (P6).**
> D4's fallback keys unrecognized objects as `['ident', n]` from a counter. If the registry is created
> inside the keyer instead of once per dedupe pass, `n` restarts at `0` for every value, so
> `new Custom(1)`, `new Map()` and `new Set()` all key to `["ident",0]` and collapse to a single
> value. Zero compile errors, and it is the exact over-merge the fallback exists to prevent — **the
> fallback becomes the bug**. This was a real defect in the first draft of the algorithm. `distinctFirestoreValues`
> must build one `IdentityRegistry` per call and thread it. Observable: U-14 asserts `3`; with a
> per-value registry it returns `1`.

> **T3 — `DocumentReference.isEqual` is converter-sensitive, so it is the wrong key (N4).**
> Reaching for the SDK's own equality looks obviously right and is not: `plainRef.isEqual(convertedRef)`
> is **`false`** for the same document path, because `isEqual` compares `_converter` too. Within one
> query every ref decodes with the same converter so it happens to work — which is why a
> single-collection test passes and the bug ships. Firestore's own reference equality is the resource
> path. Key by `ref.path`. Observable: U-7's converted-vs-unconverted pair asserts `1`; with `isEqual`
> it returns `2`.

> **T4 — Not sorting map keys leaves the headline case broken (N5).**
> A Firestore map is an unordered key/value set, but the emulator **preserves each document's written
> key order**: two documents written `{x:1,y:2}` and `{y:2,x:1}` come back with `Object.keys` of
> `['x','y']` and `['y','x']`. Without `.sort()` on the plain-object branch, every scalar test still
> passes and the very case the issue is about still fails. Observable: U-1 (unit) and I-1 (integration,
> real round-trip) assert length `1`; unsorted they return `2`.

> **T5 — Moving the `undefined` filter must not lose the `null` distinction (R1, ADR-0020 B9).**
> Today's line is `[...new Set(values)].filter(val => val !== undefined)` — dedupe, *then* a **strict**
> filter. §6.1 moves the drop inside `distinctFirestoreValues`. Writing `!= undefined` there also
> strips `null` (because `null == undefined`), conflating "field absent" with "field is `null`", which
> ADR-0020 explicitly settled the other way. Nested `undefined` must also stay tagged apart from
> nested `null`. Observable: the existing test at
> `repository-query-builder.integration.test.ts:103-124` asserts `toContain(null)` (line 121) and
> `toHaveLength(2)` (line 123); a loose filter collapses it to `['gold']`.

> **T6 — Regressing `NaN` or `-0` (N6, N7).**
> `Set` uses `SameValueZero`, so `NaN`/`NaN` and `0`/`-0` **already merge** — and Firestore's total
> ordering agrees (`NaN` is a single value; `-0.0`, `0.0` and integer `0` compare equal). Two ways to
> break it: `JSON.stringify(NaN)` emits `null`, which would make a stored `NaN` collide with a stored
> `null` (a cross-type over-merge); and any encoding that distinguishes `-0` from `0` splits a value
> that used to merge (a regression). §6.1's `numberKey` + the `['d', …]` tag closes both. Observable:
> U-16 asserts `NaN` vs `null` → `2` and `NaN` twice → `1`; U-17 asserts `0`/`-0` → `1`.

> **T7 — Recursing without a cycle guard crashes on converter output (P4).**
> `doc.data()` returns `readConverter` output — arbitrary caller code — so a cyclic object is
> reachable. The naive walker threw `RangeError: Maximum call stack size exceeded` in the probe: a
> crash inside a read terminal, triggered by data. §6.1 carries a per-path `Set<object>` and a
> `MAX_DEPTH` ceiling; both emit a terminal marker, so the worst case is a *merge*, never a throw.
> Observable: U-18 asserts two structurally-equal cyclic objects → `1` **and that the call does not
> throw**; U-20 asserts the same for depth past `MAX_DEPTH`.

> **T8 — Duck-typing a recognizer over-merges across types (P5, N11).**
> Two shapes of this. (a) A duck-typed reference check such as
> `'path' in v && typeof v.isEqual === 'function'` lets a plain map `{ path: 'a/b' }` key as a
> reference, so it collides with a real ref to `a/b`. (b) NAIVE's single `'x'` tag for "some object"
> merged a `Custom`, a `Map` and a `Set` into one value. Use `instanceof` (nominal) for every Firestore
> type, ordered **before** the plain-object branch, and the identity fallback for everything else.
> N11 is what makes that safe: no Firestore value class has `Object.prototype`, so a failed
> `instanceof` degrades to identity rather than to the plain-object branch. Observable: U-19 asserts a
> plain `{path:'a/b'}` vs a real ref to `a/b` → `2`; U-12 asserts `ref` vs the equal string → `2`.

> **T9 — Testing the trap at only one of the sites it spans (R2, R3).**
> `distinctValues` is defined **once** on `FirestoreQueryBuilderBase` and inherited by both
> `FirestoreQueryBuilder` and `FirestoreCollectionGroupQueryBuilder`. One implementation, but three
> distinct read paths reach it — collection, collection group, and a `readConverter`-wrapped
> collection — and the group path also carries ADR-0024's deliberate stored-`path` carve-out. "One
> integration test exists" is not coverage. I-1 (collection), I-4 (group) and I-6 (converter) are all
> required.

> **T10 — Shipping the new util without a unit test fails the gate outright (R13).**
> `collectCoverageFrom` is `src/**/*.ts`, so an untested `src/utils/firestoreValueEquality.ts` reports
> **0 %** and is aggregated into the `src/utils` gate (lines 95 / branches 90 / functions 90). Do not
> defer the unit test to a follow-up commit. Observable: `npm run test:coverage:gate:unit` prints
> `← below threshold` on `Pure utilities (src/utils)`.

> **T11 — Blindly decrementing the deferral range writes a range that is wrong (§9.1).**
> All ten living-index footers currently read `(#40–#41)`. #39 has merged, so when #40 ships the
> remaining deferral set is a **single issue**: #41. The correct text is therefore **`(#41)`** — not
> `(#41–#41)`, which is what a mechanical "decrement the low end" edit produces, and not `(#40–#41)`,
> which is what leaving it alone produces. The same collapse applies to ADR-0017's References bullet
> (line 160, "GitHub issues #40–#41"), which becomes "GitHub issue **#41**", singular.
> Observable: **nothing automated catches this** — no test, no `check:docs`, no lint. It is a review
> finding, which is why §11 carries an explicit row for it.

---

## §5 Could not verify / bounds

- **No full prototype was run.** The §6.2 `QueryBuilder.ts` edits were never applied to real source
  and **the 14-leg gate has not been executed with this change.** Justified by the skill's decision
  table: the type contract is unchanged (D2), and the call site is a single greppable expression
  (**R1**) — there is no unenumerable blast radius for `tsc` to find. What it leaves unverified: the
  interaction with the five existing `distinctValues` tests is reasoned from **reading** them
  (**R11** — all five assert scalars), not from observing them pass. §6.1 *was* compiled, linted,
  format-checked and declaration-emitted in place (§12).
- **Everything behavioral is emulator-observed, not production.** Two specifics: (a) if real Firestore
  normalizes map key order in storage, T4's `.sort()` is belt-and-braces rather than load-bearing —
  the emulator demonstrably does **not** normalize (**N5**), and sorting is correct either way; (b)
  `-0` round-trip fidelity (**N7**) is emulator-observed.
- **One peer leg only.** Probes ran against the dev `firebase-admin@14.2.0` / `@google-cloud/firestore@8.6.0`
  (**N1**). The `instanceof` recognizers are the risk surface across `^12` / `^13`. `FieldValue.vector`
  postdates `12.0.0`, so on an exact `12.0.x` `isGenuineVectorValue` returns `false` — moot, since no
  `VectorValue` can exist there. CI's `admin-compat` (`^12`/`^13`/`^14`) and `firestore-floor-compat`
  matrices are the real check via `FIRESTORE_ORM_ADMIN_VERSION` / `FIRESTORE_ORM_FIRESTORE_VERSION`;
  **I did not run them.** A local `npm run check:consumer` covers only the dev peer.
- **Duplicated `@google-cloud/firestore` on disk** (strict pnpm, or a version conflict) defeats
  `instanceof`, and every Firestore class degrades to the identity fallback — i.e. exactly today's
  behavior, no crash and no over-merge (**N11**). Not reproduced.
- **Cycle-marker conflation.** Two *different* cyclic structures that agree on every key down to their
  first back-edge produce the same key and merge. Bounded and documented; only the equal-structure
  case is tested (U-18).
- **`MAX_DEPTH = 64` conflation.** Values that agree to depth 64 merge. Firestore's own map-nesting
  cap is 20, so unreachable for stored data; reachable only through converter output.
- **Deliberately still deferred:** server-side / Pipeline distinct (#41) and the field-mask projection
  (**D3**, needs its own follow-up issue — §9.5). Neither is in this PR.

---

## §6 API specification

**Copy-verbatim.** Both blocks were compiled as written — see §12.

### 6.1 `src/utils/firestoreValueEquality.ts` — new file

Passes `npm run test:types`, `npx eslint`, and `npx prettier --check` exactly as written. Do not
reformat it; do not strip the JSDoc — every paragraph records a §4 trap and a reviewer will ask.

```ts
import { DocumentReference, GeoPoint, Timestamp } from 'firebase-admin/firestore';
import { isGenuineVectorValue } from './vectorValue.js';

/**
 * Firestore-aware semantic deduplication of read field values (issue #40).
 *
 * `QueryBuilder.distinctValues()` is a **client-side** terminal: it downloads the matching documents
 * and dedupes `doc.data()[field]` in process. A JavaScript `Set` dedupes objects by *reference
 * identity*, so two structurally identical maps — or two `Timestamp`s naming the same instant read
 * from two documents — were reported as separate values. Firestore's own value equality is
 * structural (maps are unordered key/value sets; references compare by path), so identity dedupe
 * contradicted the method's documented contract for every non-scalar type.
 *
 * The fix canonicalizes each value into a **JSON-serializable, type-tagged tree** and dedupes on
 * `JSON.stringify` of that tree, keeping the first value seen for each key. Type tags keep values of
 * different Firestore types apart (`'1'` never keys the same as `1`, `NaN` never as `null`), and
 * letting `JSON.stringify` do the quoting is what makes the encoding injection-proof: a hand-rolled
 * delimiter join silently merges `['a', 'b']` with `['a,s:b']`.
 *
 * **Never over-merge.** Two values collapse only when the canonical form proves them equal. Anything
 * unrecognized — a `Map`, a `Set`, a custom class a `readConverter` returned — falls back to
 * per-instance identity, which is exactly the old behavior. That direction is safe (a distinct value
 * survives as distinct); the other direction silently drops results from a caller's list. Every
 * Firestore value class has a prototype other than `Object.prototype`, so a failed nominal check
 * lands in the identity fallback rather than in the plain-object branch.
 */

/** The canonical tree emitted by {@link canonicalize} — JSON-serializable by construction. */
type CanonicalNode = string | number | boolean | null | CanonicalNode[];

/**
 * Depth ceiling for the canonicalization walk. Firestore itself caps map nesting at 20 levels, but
 * `doc.data()` returns `readConverter` output, which is arbitrary caller code — so the walk needs its
 * own bound. Hitting it emits a terminal marker instead of recursing, which can only ever *merge*
 * values that agree down to this depth; it cannot crash.
 */
const MAX_DEPTH = 64;

/**
 * Per-instance identity registry for values the canonicalizer cannot describe structurally.
 *
 * Scoped to a whole dedupe pass, **not** to one key computation: a registry created per value would
 * restart the counter at `0`, so every unrecognized instance would key to `['ident', 0]` and they
 * would all silently collapse into a single value — the precise over-merge the identity fallback
 * exists to prevent.
 */
type IdentityRegistry = { readonly map: WeakMap<object, number>; next: number };

function identityKey(value: object, ids: IdentityRegistry): number {
  const existing = ids.map.get(value);
  if (existing !== undefined) {
    return existing;
  }
  const assigned = ids.next++;
  ids.map.set(value, assigned);
  return assigned;
}

/**
 * Canonical key for a number.
 *
 * `-0` collapses into `0` and `NaN` keys as the string `'NaN'`, matching both Firestore's total
 * ordering (where `-0.0`, `0.0` and integer `0` compare equal, and `NaN` is a single value) and the
 * `Set` behavior this replaces (`SameValueZero` already merged `-0`/`0` and `NaN`/`NaN`). Preserving
 * that is a compatibility requirement, not an incidental detail.
 */
function numberKey(value: number): string {
  return value === 0 ? '0' : String(value);
}

/** True for an object literal / `Object.create(null)` map — the shape a Firestore map decodes to. */
function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function canonicalize(
  value: unknown,
  seen: Set<object>,
  ids: IdentityRegistry,
  depth: number,
): CanonicalNode {
  if (depth > MAX_DEPTH) {
    return ['deep'];
  }
  if (value === undefined) {
    // Unreachable for a top-level field (dropped before keying) but reachable nested, because a
    // readConverter may return `{ a: undefined }`. Tagged distinctly from `null` (ADR-0020, B9).
    return ['u'];
  }
  if (value === null) {
    return ['n'];
  }
  switch (typeof value) {
    case 'boolean':
      return ['b', value];
    case 'number':
      return ['d', numberKey(value)];
    // With `Firestore.settings({ useBigInt: true })` integers decode to BigInt. Firestore treats an
    // integer and the equal double as one value, so BigInt shares the numeric tag: `1n` keys as `1`.
    case 'bigint':
      return ['d', String(value)];
    case 'string':
      return ['s', value];
    case 'symbol':
    case 'function':
      return ['ident', identityKey(value as object, ids)];
  }

  const obj = value as object;

  // Nominal checks first: each of these types has a non-`Object.prototype` prototype, so if the
  // check fails (e.g. a duplicated @google-cloud/firestore copy defeats `instanceof`) the value
  // falls through to the identity fallback, never to the plain-object branch.
  if (obj instanceof Timestamp) {
    return ['t', obj.seconds, obj.nanoseconds];
  }
  if (obj instanceof GeoPoint) {
    return ['g', numberKey(obj.latitude), numberKey(obj.longitude)];
  }
  if (obj instanceof DocumentReference) {
    // Keyed by document path, NOT `isEqual`: `DocumentReference.isEqual` also compares the attached
    // converter, so the same path read through a converted vs. unconverted reference is reported as
    // unequal. Firestore's own reference equality is the resource path.
    return ['r', obj.path];
  }
  if (obj instanceof Uint8Array) {
    // Firestore Bytes decode to a Node `Buffer`, which extends `Uint8Array`; neither has `isEqual`.
    return ['y', Buffer.from(obj).toString('base64')];
  }
  if (isGenuineVectorValue(obj)) {
    return ['v', (obj as { toArray(): number[] }).toArray().map(numberKey)];
  }
  if (obj instanceof Date) {
    // Firestore never stores a `Date` (it encodes to Timestamp), but a readConverter commonly
    // returns one, and this method is typed against the READ model.
    return ['date', numberKey(obj.getTime())];
  }

  if (seen.has(obj)) {
    // Cycle on the current path — only reachable through readConverter output. Terminating on a
    // marker keeps the walk total; a plain recursion overflows the stack.
    return ['cycle'];
  }

  if (Array.isArray(obj)) {
    seen.add(obj);
    const node: CanonicalNode = ['a', obj.map(entry => canonicalize(entry, seen, ids, depth + 1))];
    seen.delete(obj);
    return node;
  }

  if (isPlainObject(obj)) {
    seen.add(obj);
    const record = obj as Record<string, unknown>;
    // Keys are sorted because a Firestore map is an unordered key/value set, and the emulator
    // preserves each document's written key order — so two semantically equal maps genuinely arrive
    // with different `Object.keys` order.
    const entries: CanonicalNode = Object.keys(record)
      .sort()
      .map(key => [key, canonicalize(record[key], seen, ids, depth + 1)]);
    seen.delete(obj);
    return ['o', entries];
  }

  return ['ident', identityKey(obj, ids)];
}

/**
 * Returns the semantically distinct members of `values`, preserving first-seen order.
 *
 * Drops `undefined` (an absent field) but preserves a stored `null` as a real, distinct value — a
 * loose `!= undefined` would strip both, conflating "field absent" with "field is null" (ADR-0020).
 *
 * Structured and reference values (maps, arrays, `Timestamp`, `GeoPoint`, `DocumentReference`,
 * `Bytes`, `VectorValue`) are compared by Firestore-aware semantic equality rather than by object
 * identity. Values the canonicalizer cannot describe fall back to per-instance identity and are
 * therefore never merged — see the module JSDoc.
 */
export function distinctFirestoreValues<V>(values: Iterable<V>): V[] {
  const ids: IdentityRegistry = { map: new WeakMap(), next: 0 };
  const distinct = new Map<string, V>();
  for (const value of values) {
    if (value === undefined) {
      continue;
    }
    const key = JSON.stringify(canonicalize(value, new Set<object>(), ids, 0));
    if (!distinct.has(key)) {
      distinct.set(key, value);
    }
  }
  return [...distinct.values()];
}
```

**Invariants that must survive any refactor** (each is a §4 trap; a reviewer will check all six):

1. One `IdentityRegistry` per `distinctFirestoreValues` call, threaded through the walk (**T2**).
2. Nominal `instanceof` checks, ordered **before** the plain-object branch (**T8**).
3. `.sort()` on the plain-object keys (**T4**).
4. `ref.path`, never `ref.isEqual` (**T3**).
5. Strict `value === undefined` for the drop; `null` keeps its own tag (**T5**).
6. `numberKey`'s `value === 0` collapse and the `['d', …]` tag (**T6**).

### 6.2 `src/core/QueryBuilder.ts` — two edits

**Edit 1 — add the import.** Append to the existing local-util import group (currently
`import { deepFreeze, safeAssign } from '../utils/safeObject.js';` at line **20**):

```ts
import { distinctFirestoreValues } from '../utils/firestoreValueEquality.js';
```

**Edit 2 — replace the JSDoc `LIMITATION` paragraph at lines 1314-1318** (the five lines starting
`* LIMITATION — scalar values only:`). Delete them and put this in their place; the rest of the JSDoc
— the "Reads the document's own field" paragraph at 1320-1327 through the `@example` blocks ending at
1342 — is unchanged:

```ts
   * **Client-side, with Firestore-aware semantic equality.** This terminal downloads every matching
   * document and dedupes in process — Firestore Core has no server-side `DISTINCT` (the Enterprise
   * Pipeline model that does is out of scope; see issue #41). Deduplication is *not* reference
   * identity: maps and arrays compare structurally and map key order is irrelevant, and `Timestamp`,
   * `GeoPoint`, `DocumentReference` (by path), `Bytes` and `VectorValue` compare by value. Values a
   * `readConverter` produced that are not Firestore values — a `Map`, a `Set`, a custom class — fall
   * back to per-instance identity and are never merged. See {@link distinctFirestoreValues}.
```

**Edit 3 — replace lines 1361-1364** — the existing three-line `// Drop only \`undefined\` …` comment
plus the `return` beneath it. The `try`/`catch` (1358-1367), the `await this.query.get()` at 1359 and
the `snapshot.docs.map` at 1360 are unchanged. The replacement folds the ADR-0020 note into two lines:

```ts
      // Drops only `undefined` (an absent field), never a stored `null`, and dedupes by
      // Firestore-aware semantic equality rather than object identity (ADR-0020 B9; issue #40).
      return distinctFirestoreValues(values) as ValueAtKey<T, K>[];
```

### 6.3 Size estimate

| File                                                     | Change                          |
| -------------------------------------------------------- | ------------------------------- |
| `src/utils/firestoreValueEquality.ts`                    | new, **+218**                   |
| `src/core/QueryBuilder.ts`                               | **+11 / −6** (3 edits)          |
| `src/tests/unit/firestoreValueEquality.unit.test.ts`     | new, ~**+330**                  |
| `src/tests/unit/queryBuilderTerminals.unit.test.ts`      | ~**+30**                        |
| 3 integration test files                                 | ~**+190** total                 |
| New ADR                                                  | new, ~**+110**                  |
| `docs/adr/0017…`, `docs/adr/README.md`, 9 footer ADRs     | ~**+14 / −12**                  |
| 3 Starlight pages                                        | ~**+16 / −10**                  |
| **Total**                                                | ~13 files touched + 3 new       |

---

## §7 Implementation sequence

Order matters where stated; the reason is given.

1. **Check out and rebase — do not cut a branch.**
   ```bash
   git fetch origin && git checkout feat/issue-40-distinct-values-semantic-equality && git rebase origin/main
   ```
   **If that rebase is a no-op, everything in §3 / §6.2 / §9 is current** — it was all re-derived
   against `3f0dd7a` (§12). If it pulls in new commits, **re-run the §3.1 enumeration** and fix any
   drifted line numbers before editing: the §6.2 anchors (import 20, `LIMITATION` 1314-1318, `return`
   1364) moved by +64 when #39 landed, so assume they can move again. Also re-measure the §3.5 baseline
   suite counts on *your* tree — unit must go up by one suite, integration by six tests; the `3f0dd7a`
   numbers are `31/383` and `34/497`.
2. **Create `src/utils/firestoreValueEquality.ts` from §6.1 verbatim.** Run `npm run test:types` before
   writing a single test — the util must compile standalone.
3. **Write `src/tests/unit/firestoreValueEquality.unit.test.ts` (U-1…U-23) *before* editing
   `QueryBuilder.ts`.** Reason: the util is the whole substance of the change, and the unit suite runs
   in seconds with no emulator. Confirm the failure direction now, while the call site is still
   unchanged. Run `npm run test:unit` and `npm run test:coverage:gate:unit` — **T10** is checkable at
   this point and nowhere earlier.
4. **Do the §6.2 `QueryBuilder.ts` edits** (import, JSDoc, `return`). Run `npm run test:types`.
5. **Run the existing integration suite unchanged** — `npm run test:integration:emulator`. All five
   tests in **R11** must still pass with no edit. If any fails, stop and record it in `notes.md`:
   §5 flagged this as reasoned-from-reading, not observed, so a failure here is a planning miss, not
   your bug to paper over.
6. **Add U-24 and I-1…I-6** (§8). Then mutation-check the load-bearing ones (§8.4) — do this *before*
   the docs sweep, so a test that guards nothing is caught while the code is still in your head.
7. **Docs + ADR bookkeeping** (§9), in this order: file the ADR first so you have its number for the
   `docs/adr/README.md` row, the ADR-0017 amendment, and the footer sweep.
8. **Run the full 14-leg gate** (§10) and record real output in `notes.md`.
9. **Refute-first self-review** per the `plan-execution` skill, then walk §11.
10. **Do NOT commit until asked**, and **do NOT remove the plan directory yet** — §11's `git rm` is a
    separate final commit that lands *after* review, so the reviewer can still read `notes.md` and the
    plan in the PR's Files-changed view.

### Anti-instructions — do **NOT**

- **Do not use `DocumentReference.isEqual`, `Timestamp.isEqual`, `GeoPoint.isEqual`, or
  `VectorValue.isEqual` as the dedupe primitive.** They exist and they look right (**N1**). Pairwise
  `isEqual` is O(n²), and the reference one is converter-sensitive (**T3**/**N4**).
- **Do not build the key by joining strings with delimiters.** Measured to over-merge (**T1**/**P2**)
  and to blow the stack on a cycle (**P4**).
- **Do not duck-type the recognizers** (`'path' in v`, `typeof v.isEqual === 'function'`,
  `v.constructor.name === 'Timestamp'`). Cross-type over-merge (**T8**). `isGenuineVectorValue` from
  `src/utils/vectorValue.ts` is the established nominal check for `VectorValue` — reuse it, do not
  re-derive it.
- **Do not add a second parameter, an options object, or an overload to `distinctValues`** (**D2**).
- **Do not add `select(field)` / a field mask to the underlying query** (**D3**) — the dotted-key
  hazard is real and unhandled.
- **Do not refactor `deepFreeze`'s inline plain-object test in `src/utils/safeObject.ts` into a shared
  helper.** §6.1's `isPlainObject` deliberately duplicates those three lines: `deepFreeze` is a
  security-relevant walker (CWE-1321 hardening) and changing it for a cosmetic dedup is out of scope.
  If a reviewer raises the duplication, point at this line.
- **Do not export `distinctFirestoreValues` from `src/index.ts` or `src/vector/index.ts`** (**D6**), and
  do not touch `packageExports.unit.test.ts` / `vectorPackageExports.unit.test.ts`.
- **Do not edit `website/src/content/docs/2.0/**`** (**R8**) — frozen archive, even though it names
  `distinctValues` in four places.
- **Do not hardcode the ADR number.** #39 may claim the next one first (§9.1).
- **Do not write `(#40–#41)` into any footer.** See **T11** — the remaining set is not contiguous.
- **Do not sweep `docs/adr/README.md:17,19`** — those `(#32–#41)` occurrences are *examples in the
  Conventions prose*, not a live index. A blind `sed` over `–#41` corrupts the documentation of the
  convention you are following.
- **Do not hand-edit `CHANGELOG.md`.**
- **Do not write `review.md`** — that file is the external reviewer's slot. Your self-review goes in
  chat + `notes.md`.
- **Do not repeat §5's unverified claims as verified.** In particular: the CI peer matrix legs and
  production-Firestore behavior were not run.
- **Do not commit unless asked.**

---

## §8 Test specification

Every test below must **fail on the unfixed baseline**. §8.4 lists the ones to mutation-check.

### 8.1 Type suite — no new test, deliberately

The signature, constraint and return type are unchanged (**D2**), and §12 confirms
`distinctFirestoreValues(values) as ValueAtKey<T, K>[]` compiles at the call site. The existing type
tests already pin the contract and must keep passing **unchanged** — treat any edit to them as a
signal you broke D2:

| Existing test                                            | Pins                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| `src/tests/types/identity.type-test.ts:230-236` (A9)      | Keys derive from the read model; `id` is excluded; `string[]` / `string[][]` element types |
| `src/tests/types/union-model-paths.type-test.ts:60-63` (U-3) | Branch-specific keys on a union model preserve the element type (ADR-0028 T2) |
| `src/tests/types/union-model-paths.type-test.ts:184-185`   | A typo is a compile error                                            |
| `src/tests/types/collection-group.type-test.ts:176`       | The group builder accepts the call                                   |

### 8.2 Unit suite — gate `test:coverage:gate:unit`, `src/utils` (95/90/90)

**New file: `src/tests/unit/firestoreValueEquality.unit.test.ts`.** Needs a JSDoc header stating
strategy and verification points (test-guardrails rule). Assert through the public
`distinctFirestoreValues` only — not the private `canonicalize` (behavior-focused, per the same rule).
No Firestore mock is needed; construct `Timestamp` / `GeoPoint` / `FieldValue.vector` directly and get
`DocumentReference`s from a `createMockFirestoreDb()`-independent real `Firestore` pointed at the
emulator host **without connecting** (`db.doc('a/b')` builds a ref without I/O — probe
`N-sdk-value-shapes.mjs` does exactly this).

| Id       | Asserts                                                            | Observable when it fails                       | Guards        |
| -------- | ------------------------------------------------------------------ | ---------------------------------------------- | ------------- |
| **U-1**  | `{x:1,y:2}` and `{y:2,x:1}` → **1**                                | length `2`                                     | T4            |
| **U-2**  | `{x:1}` and `{x:2}` → **2**                                        | length `1` (over-merge)                        | T1, T8        |
| **U-3**  | equal deep nested map/array → **1**                                | length `2`                                     | T4            |
| **U-4**  | `[1,2]` and `[2,1]` → **2** (array order is significant)           | length `1`                                     | T1            |
| **U-5**  | equal `Timestamp`s → **1**; differing only in nanoseconds → **2**  | `2` / `1`                                      | P1, T8        |
| **U-6**  | equal `GeoPoint`s → **1**; different → **2**                       | `2` / `1`                                      | P1            |
| **U-7**  | two refs to the same path, one from a `withConverter` collection → **1**; different paths → **2** | `2` — this is the `isEqual` failure | **T3** |
| **U-8**  | equal `Buffer`s → **1**; `[1,2]` vs `[2,1]` → **2**                | `2` / `1`                                      | N2, P1        |
| **U-9**  | equal `FieldValue.vector([1,2])` → **1**; `[1,3]` → **2**          | `2` / `1`                                      | P1            |
| **U-10** | `['a','b']` vs `['a,s:b']` → **2**                                 | length `1`                                     | **T1**        |
| **U-11** | `{'a=s:x,b':1}` vs `{a:'x',b:1}` → **2**                           | length `1`                                     | **T1**        |
| **U-12** | `'1'` vs `1` → 2; `NaN` vs `null` → 2; `{}` vs `[]` → 2; `{a:1}` vs `[1]` → 2; a ref to `targets/t1` vs the string `'targets/t1'` → 2 | any collapses to `1` | T6, T8 |
| **U-13** | `[null, undefined, null]` → **`[null]`**; nested `{a:undefined}` vs `{a:null}` → **2** | `[]`, or length `1`         | **T5**        |
| **U-14** | `[new Custom(1), new Map(), new Set()]` → **3**; two equal `Custom` → **2**; the same instance twice → **1** | `1` — the registry bug | **T2** |
| **U-15** | `new Date(5)` twice → **1**                                        | `2`                                            | D4            |
| **U-16** | `NaN` twice → **1**                                                | `2`                                            | **T6**        |
| **U-17** | `0` and `-0` → **1**                                               | `2` (regression vs `Set`)                      | **T6**        |
| **U-18** | two structurally-equal cyclic objects → **1**, `expect(...).not.toThrow()` | `RangeError` thrown                    | **T7**        |
| **U-19** | a plain `{ path: 'a/b' }` vs a real ref to `a/b` → **2**           | `1` — cross-type over-merge                    | **T8**        |
| **U-20** | a chain nested past `MAX_DEPTH` (65+) does not throw               | `RangeError`                                   | T7            |
| **U-21** | `{}` with an own enumerable `__proto__` data property vs `{}` → **2**, and the input's prototype is unchanged | `1`, or a polluted prototype | N12 |
| **U-22** | first-seen order is preserved, and the retained representative is the **first** instance (`toBe`, not `toEqual`) | reordered, or the wrong instance | — |
| **U-23** | `1n` and `1` → **1**                                               | `2`                                            | N3            |

**Existing file: `src/tests/unit/queryBuilderTerminals.unit.test.ts`.** Its `makeBuilder({ fullDocs })`
helper already mocks `Query.get()`, which is what `distinctValues` calls.

| Id       | Asserts                                                                                              | Observable when it fails | Guards |
| -------- | ---------------------------------------------------------------------------------------------------- | ------------------------ | ------ |
| **U-24** | `distinctValues('m')` over two mocked docs carrying `{x:1,y:2}` and `{y:2,x:1}` → **1** — i.e. the call site is wired to the util at all | length `2` | T4, and §6.2 edit 3 |

> `src/core/QueryBuilder.ts` matches **no** unit gate (`UNIT_GATES` covers `src/utils/`, the
> Errors/ErrorParser/Validation/express list, and `src/index.ts`), so U-24 adds confidence, not
> coverage. Its value is speed: it fails in seconds if edit 3 was missed.

### 8.3 Integration suite — gate `test:coverage:gate:integration`, `QueryBuilder.ts` (90/75/95)

| Id      | File (extend)                                              | Asserts                                                                                                                                                                                                     | Observable when it fails | Guards |
| ------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------ |
| **I-1** | `repository-query-builder.integration.test.ts`             | Write two documents carrying semantically equal `map` (written with **different key order**), `arr`, `ts`, `gp`, `ref`, `bytes` fields; each `distinctValues(field)` → length **1**. **The only test that proves `instanceof` holds on values the SDK decoded** — promotes probe `N-instanceof-across-read-path.mjs`. | length `2` on the failing type | T4, T8, N10, N11, P1 |
| **I-2** | same                                                       | Genuinely different structured values (`{x:1}` vs `{x:2}`, two `Timestamp`s differing by a nanosecond, two refs) → length **2**                                                                              | length `1` — over-merge  | T1, T8 |
| **I-3** | same, **existing test at :103-121**                        | Must pass **unchanged**: `toContain('gold')`, `toContain(null)`, `not.toContain(undefined)`, `toHaveLength(2)`                                                                                               | `['gold']`               | **T5** |
| **I-4** | `repository-collection-group.integration.test.ts`          | Two documents **at different depths** in the group carrying semantically equal maps → `distinctValues` length **1**; two different maps → **2**                                                              | length `2` / `1`         | **T9** |
| **I-5** | same, **existing tests at :357, :394, :549**               | Must pass **unchanged** — in particular the stored-`path` carve-out (ADR-0024) and the `select()` rejection                                                                                                  | either regresses         | D3, R2 |
| **I-6** | `repository-read-only-converter.integration.test.ts`       | A `readConverter` returning a `Date` for a field: two documents with the same instant → length **1**. A converter returning a **custom class** instance: two structurally equal instances → length **2** (identity fallback) | `2` / `1`        | D4, T2 |

All three files use `createUserRepoHarness()` / the existing harness from
`src/tests/integration/helpers/firestoreIntegrationHarness.ts`; call `resetTestFactoryCounters()` in
`beforeEach` only if factory id order matters.

### 8.4 Mutation checks (required — `git stash` is enough)

Revert the named part of §6.1, confirm the named test **fails**, restore. Record each in `notes.md`.

| Mutation                                                    | Must fail        |
| ----------------------------------------------------------- | ---------------- |
| Remove `.sort()` from the plain-object branch                | U-1, U-3, I-1, I-4, U-24 |
| Move the `IdentityRegistry` construction inside `canonicalize` | U-14           |
| Replace the nested tree with a delimiter join                 | U-10, U-11      |
| Change `numberKey` to `String(value)` (no `-0` collapse)      | U-17            |
| Drop the `['d', …]` tag so numbers key bare                   | U-12, U-16      |
| Change the drop to `value != undefined`                       | U-13, I-3       |
| Remove the `seen` cycle guard                                 | U-18            |
| Key refs by `isEqual` instead of `.path`                      | U-7             |

### 8.5 Trap-coverage matrix — every trap, at **every site it can occur**

| Trap    | Site                                             | Test        | Observable                                                     |
| ------- | ------------------------------------------------ | ----------- | -------------------------------------------------------------- |
| **T1**  | util                                             | U-10, U-11  | length `1` instead of `2`                                      |
| **T1**  | collection read path                             | I-2         | two different maps report as one                               |
| **T2**  | util                                             | U-14        | 3 unrecognized instances report as `1`                         |
| **T2**  | converter read path                              | I-6         | two equal custom-class instances report as `1`                 |
| **T3**  | util                                             | U-7         | converted vs unconverted same-path refs report as `2`          |
| **T4**  | util                                             | U-1, U-3    | length `2`                                                     |
| **T4**  | collection read path (mocked)                    | U-24        | length `2`                                                     |
| **T4**  | collection read path (real decode)               | I-1         | length `2`                                                     |
| **T4**  | collection-group read path                       | I-4         | length `2`                                                     |
| **T5**  | util                                             | U-13        | `[]` instead of `[null]`                                       |
| **T5**  | collection read path                             | I-3         | `['gold']`, `toHaveLength(2)` fails                            |
| **T6**  | util (`NaN`)                                     | U-16, U-12  | `2` instead of `1`; or `NaN` collides with `null`              |
| **T6**  | util (`-0`)                                      | U-17        | `2` instead of `1`                                             |
| **T7**  | util (cycle)                                     | U-18        | `RangeError` thrown                                            |
| **T7**  | util (depth)                                     | U-20        | `RangeError` thrown                                            |
| **T7**  | converter read path                              | I-6         | the read terminal throws instead of returning                  |
| **T8**  | util (duck-typed ref)                            | U-19        | plain map merges with a real ref                               |
| **T8**  | util (single object tag)                         | U-2, U-12, U-14 | distinct types report as one                                |
| **T8**  | real decode, collection                          | I-1         | `instanceof` fails → each Timestamp/ref reports separately (length `2`) |
| **T9**  | collection                                       | I-1, I-2    | —                                                              |
| **T9**  | collection group                                 | I-4, I-5    | —                                                              |
| **T9**  | converter                                        | I-6         | —                                                              |
| **T10** | build                                            | `test:coverage:gate:unit` | `✗ Pure utilities (src/utils)` + `← below threshold` |
| **T11** | docs                                             | none — **review finding only.** Nothing automated catches a wrong deferral range; §11 has an explicit row. |

---

## §9 Docs and ADR bookkeeping

The labels are `enhancement` + `parity` + `v3.x`, so this is a **deferral that ships** — the full
bookkeeping applies. This is the repo's main defect mode; work the list top to bottom.

### 9.1 ADR

1. **New ADR — `0034` on this baseline.** `ls docs/adr/` ends at
   `0033-snapshot-metadata-and-detailed-listeners.md` (#39), so the next free number is **0034** —
   but re-check with `ls` before writing it, in case `main` moved again. Start from
   `docs/adr/0000-template.md` via the `/adr` skill. Required content, as a numbered list:
   1. **Decision** — `distinctValues` dedupes by a Firestore-aware canonical key; default-on;
      signature, constraint and return type unchanged (**D1**, **D2**).
   2. **Why a canonical key, not pairwise deep equality** — O(n) vs O(n²) over an already-downloaded
      page; cite §2.3.
   3. **Why a JSON-serializable nested tagged tree, not a delimiter join** — cite the two measured
      collisions (**T1** / **P2**).
   4. **Why `ref.path`, not `DocumentReference.isEqual`** — `isEqual` compares the attached converter
      (**T3** / **N4**).
   5. **The never-over-merge invariant** and the identity fallback for unrecognized `readConverter`
      output, incl. the `Date` case (**D4**), and why **N11** makes degradation safe.
   6. **Cycle and depth bounds** — they can only merge, never crash (**T7** / **P4**).
   7. **Scope** — still client-side; no field-mask projection and why (**D3**); server-side distinct
      stays with #41.
   8. **Fidelity carried from ADR-0020** — `null` vs `undefined` (B9), `NaN`, `-0` (**T5**, **T6**).
   9. **Alternatives considered** — document-only (D1's rejected side); opt-in option (D2's); inline in
      `QueryBuilder.ts` (D5's); `isEqual`-based pairwise; delimiter join.
   10. **Status:** `Accepted (v3.x, pending merge/release)` — matching 0025-0032.
   11. A **living-index footer** in the current house style. **Read the range out of the tree** (step 4);
       do not copy a range from this plan.
2. **`docs/adr/README.md`** — append one row to the index table **after line 63** (the `0033` row,
   the current last), matching the existing column padding. Status
   `Accepted (v3.x, pending merge/release)`.
3. **`docs/adr/0017-v3-core-operations-scope.md`** — two edits:
   - Append a **new** `> Amendment (3.0.0, issue #40)` blockquote after the last existing one (the #39
     block, ending **line 131** with `> Rationale and contract: ADR-0033.`, immediately before
     `We explicitly do **not** block…` at line **133**). **Never edit an earlier blockquote** — they
     are historical snapshots (`docs/adr/README.md:16-21`, the "ADR-0017 deferral footers" convention
     bullet).
   - Update the **References** bullet list (section starts line **156**; the issues bullet is line
     **160**, which currently reads "GitHub issues #40–#41 (labels `parity`, `v3.x`); #30 is closed
     by…"). With #40 closed only #41 remains, so it becomes **"GitHub issue #41"** — see **T11** —
     and #40 joins the closed-by chain at the end of that bullet.
4. **Living-index footers — grep, do not trust a list.** The phrase wording varies (several ADRs wrap
   the line differently, so `grep "remaining deferrals"` misses them). Grep the **range**:
   ```bash
   grep -rl -- '–#41' docs/adr/
   ```
   **Expected on `3f0dd7a`: 12 files.** **Ten** are feature ADRs with a live footer to update —
   `0023 0024 0025 0026 0027 0029 0030 0031 0032 0033`. The other two are **not** to be swept:
   - `docs/adr/0017-…md` — the historical amendment blockquotes (append a new one instead, step 3).
   - `docs/adr/README.md:17,19` — `(#32–#41)` / `(#N–#41)` as *examples in the Conventions prose*.
     Editing these corrupts the documentation of the convention. See §7 anti-instructions.

   In each of the ten, replace the range per **T11** and add ADR-0034 to the "have since shipped"
   parenthetical. `docs/adr/0033`'s footer is the freshest example of the house wording — copy its
   shape. **Re-run the grep before you start** in case `main` moved again.

### 9.2 Capability matrix — `website/src/content/docs/reference/scope-and-capabilities.md`

- **Delete line 57** from the "Deferred to v3.x (tracked)" table (header 53-54, rows **55-58**; #39
  inserted a `Write metadata` row at 56, so #40's row is now the third).
- **Add a "Supported (first-class)" row** (table at lines 19-47) with a real Notes cell — e.g.
  `Distinct field values (`distinctValues`)` / "Client-side: downloads matching documents and dedupes
  in process by **Firestore-aware semantic equality** (maps/arrays structural, key order irrelevant;
  `Timestamp`/`GeoPoint`/`DocumentReference`/`Bytes`/`VectorValue` by value). Non-Firestore
  `readConverter` output falls back to identity. Server-side distinct remains
  [#41](https://github.com/reggieofarrell/firestore-orm/issues/41); the download-size optimization is
  [#75](https://github.com/reggieofarrell/firestore-orm/issues/75)."
- `website/**/*.md` is **prettier-exempt** (`.prettierignore`) — match the surrounding column padding
  by hand.

### 9.3 Starlight pages

| File : line                                                        | Edit                                                                                                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `website/src/content/docs/reference/query-builder.md:201-211`       | The signature line is 201, the internal-types note 203-205, the contract prose **207-211**. Rewrite the prose: keep the `undefined`/`null` sentence and the stored-`path` paragraph, add the semantic-equality contract and the identity fallback. (Shifted +3 by #39; `paginate` follows at 213.) |
| `website/src/content/docs/guides/working-with-data/queries.md:422, :430-431` | Update the code comment at **422** (`// Distinct values for a field — drops undefined but preserves stored null`; the call is at 423) and the prose at **430-431** ("`distinctValues(field)` returns the unique values for a field, dropping `undefined` but preserving stored `null`") to state semantic equality. |
| `website/src/content/docs/guides/migration-v2-to-v3.md:180-181`      | Extend the existing bullet (currently "now drops only `undefined` and preserves a stored `null`") with the semantic-equality change. This bullet is the user-facing record of the behavior change. |
| `website/src/content/docs/guides/working-with-data/queries.md:46, :297` | **No change** — both are terminal-name lists that stay accurate. Declared here so the omission is deliberate. (All four `queries.md` line numbers and `migration-v2-to-v3.md:180` survived #39 unchanged — verified, not assumed.) |

> ⚠️ If you add a `:::note` / `:::caution` aside, its closing `:::` must be on its own line with a
> blank line before it. A fence landing on a content line renders as a literal `:::` on the published
> page, and **neither `check:docs` nor `docs:build` catches it** — it shipped live twice (#33, #34).
> Verify in the built HTML:
> ```bash
> npm run docs:build && grep -rn ':::' website/dist --include='*.html' | grep -v 'aria\|class=' | head
> ```
> Expected result: **no rows**. A match means an aside is malformed. (A no-match is a pass **only**
> because you also added an aside — if you added none, this check is vacuous, so say so in `notes.md`
> rather than citing it as evidence.)

### 9.4 Declared unaffected

Each with the check that proves it — the greps were run on `3f0dd7a` and their expected results are
stated, because a pattern that matches nothing reads as "already done" otherwise.

| Surface                                              | Check                                                                                    | Expected                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------ |
| `README.md`, `npm-readme.md` (`readme-sync`)          | `grep -n "distinctValues" README.md npm-readme.md`                                       | **no rows** (verified, **R7**) |
| `docs/development/**`                                | `grep -rn "distinctValues\|#40" docs/development/*.md`                                    | **no rows** (verified, **R9**) |
| `website/src/content/docs/2.0/**`                    | frozen archive (**R8**) — 4 mentions exist and stay                                       | untouched                      |
| `src/index.ts`, `packageExports.unit.test.ts`, `reference/types.md` | **D6** / **R5** — nothing new is public                                  | untouched                      |
| `src/vector/**` and its subpath re-exports           | `grep -n "distinctValues" src/vector/*.ts`                                                | **no rows** (verified, **R4**) |
| `src/express/index.ts`                               | **R6** — no new error class                                                               | untouched                      |
| `scripts/check-coverage-gates.mjs`                   | **R10** — `src/utils/` is a prefix predicate                                              | untouched                      |
| `CHANGELOG.md`                                       | generated from Conventional Commits                                                       | untouched                      |
| Post-implementation sweep                            | `grep -n "new Set(values)" src/core/QueryBuilder.ts`                                       | **no rows** — a match means edit 3 was missed |

### 9.5 The D3 follow-up issue — filed as #75

**D3**'s deferred field-mask projection is tracked as
[#75](https://github.com/reggieofarrell/firestore-orm/issues/75) —
"distinctValues(): apply an internal field mask to cut download size". Cite it from §9.2's Notes cell
and from the ADR's scope section (§9.1 item 7), the same way ADR-0032 cites #69 and ADR-0031 cites #65.

It is labeled `enhancement` + `v3.x` but deliberately **not** `parity` (unlike #41 / #65 / #69): a
client-side bandwidth optimization of an already-wrapped method is not a server-side capability gap, so
it is **not** an ADR-0017 deferral and must **not** be added to any living-index footer or to the
capability matrix's "Deferred to v3.x" table. Mention it only in the Notes cell of #40's new
**Supported** row.

---

## §10 Gate and commit

Run all fourteen legs and paste **real output** into `notes.md`. Report failures honestly with the
output — do not summarize a red leg as green.

```bash
npm run test:types && npm run lint && npm run check:format && npm run test:unit && npm run test:integration:emulator && npm run test:unit:coverage && npm run test:coverage:gate:unit && npm run test:integration:coverage && npm run test:coverage:gate:integration && npm run build && npm run check:package && npm run check:consumer && npm run check:docs && npm run docs:build
```

`test:unit` / `test:integration:emulator` run first for a fast signal; the `:coverage` variants re-run
them to produce the LCOV the gates read. `npm run release:verify` is the release-time superset — not
needed here.

### Baseline suite counts

Measured on **`3f0dd7a`** with a clean tree, after #39 merged. Re-measure only if `main` moves again.

| Suite       | Baseline     | After this change                                                                             |
| ----------- | ------------ | --------------------------------------------------------------------------------------------- |
| Unit        | **31 / 383** | suites **+1** (`firestoreValueEquality.unit.test.ts`), tests up (U-1…U-24)                     |
| Integration | **34 / 497** | suites **unchanged** (all three files already exist), tests **+6** (I-1, I-2, I-4 ×2, I-6 ×2) |

Both totals must go **up**; the integration *suite* count must stay the same — a change there means you
created a file §8 did not ask for.

### Also re-run

`npm run check:docs` — on `3f0dd7a` **with this plan directory present** the baseline is
`✓ documentation links OK (181 doc files scanned)` (180 without it). Expect **182** once you add
ADR-0034, then **181** again after §11's final `git rm` of the plan directory. And re-run the plan's own
probes:

```bash
node docs/plans/issue-40-distinct-values-semantic-equality/probes/P-canonical-key-algorithm.mjs   # exits 0
npx firebase emulators:exec --only firestore --project demo-firestoreorm-test \
  "node docs/plans/issue-40-distinct-values-semantic-equality/probes/N-instanceof-across-read-path.mjs"   # "ALL NOMINAL CHECKS HOLD"
```

### Commit

Conventional Commits (commitlint runs on `commit-msg`):

```
feat(query): dedupe distinctValues() by Firestore-aware semantic equality (#40)
```

### Breaking-or-not ruling

**Not breaking.** Rationale: (a) `package.json` `version` is `2.2.1` and 3.0.0 is unreleased
(**R12**), so this folds into the unreleased major exactly as #30-#38 did; (b) the signature,
constraint and return type are unchanged (**D2**), so no consumer's code stops compiling; (c) for
scalar fields — the only usage the previous JSDoc sanctioned ("Use this only for scalar fields") — the
result is byte-for-byte identical, and `NaN`/`-0` merging is deliberately preserved (**T6**). The
observable change is confined to structured/reference values, where the old behavior contradicted the
documented contract. **No `BREAKING CHANGE:` footer.** The migration-guide bullet (§9.3) is the
user-facing record.

---

## §11 Definition of done

- [ ] Branch checked out and rebased onto `main`; §3.1 line numbers re-verified; §3.5 baseline counts
      re-measured on the rebased tree (§7 step 1)
- [ ] `src/utils/firestoreValueEquality.ts` created **verbatim** from §6.1, all six §6.1 invariants
      intact (**D5**)
- [ ] `QueryBuilder.ts` edits 1-3 applied as specified in §6.2; signature and return type unchanged
      (**D2**)
- [ ] No options argument, no field mask, no public export (**D2**, **D3**, **D6**)
- [ ] `src/tests/unit/firestoreValueEquality.unit.test.ts` covers U-1…U-23 with a JSDoc header
- [ ] U-24 added to `queryBuilderTerminals.unit.test.ts`
- [ ] I-1, I-2, I-4, I-6 added; I-3 and I-5 (the six existing tests, **R11**) pass **unedited**
- [ ] All eight §8.4 mutation checks performed and recorded in `notes.md`
- [ ] Every §8.5 matrix row has a passing test, and **T4 / T7 / T8 / T9 are covered at every site**,
      not just one
- [ ] New ADR filed as **0034** (re-checked with `ls docs/adr/`), all 11 required content items
      present, status `Accepted (v3.x, pending merge/release)` (§9.1)
- [ ] `docs/adr/README.md` index row added after line 63 (the `0033` row)
- [ ] `docs/adr/0017` — a **new** amendment blockquote appended after line 131 (no earlier one edited)
      **and** the References bullet at line 160 updated to singular "GitHub issue #41" (§9.1 step 3,
      **T11**)
- [ ] `grep -rl -- '–#41' docs/adr/` re-run; all **ten** live footers updated;
      `docs/adr/README.md:17,19` and `0017`'s historical blockquotes **not** swept (§9.1 step 4)
- [ ] No footer or reference reads `(#40–#41)` or `(#41–#41)` — every one reads **`(#41)`** (**T11**)
- [ ] #75 cited from the capability-matrix Notes cell and the ADR's scope section, and **not** added to
      any footer or to the Deferred table (§9.5)
- [ ] Capability-matrix row **moved**: line 57 deleted from Deferred, a Supported row added with a real
      Notes cell (§9.2)
- [ ] Three Starlight pages updated (§9.3); `queries.md:46` / `:297` deliberately untouched; any new
      `:::` aside verified in the built HTML (or `notes.md` states none was added)
- [ ] §9.4 unaffected-surface checks re-run, including the post-implementation
      `grep -n "new Set(values)" src/core/QueryBuilder.ts` → **no rows**
- [ ] All 14 §10 legs run with real output in `notes.md`; both suite totals up; integration suite count
      unchanged
- [ ] Both plan probes re-run and passing (§10)
- [ ] **Nothing in the §7 anti-instruction list violated** — walk it item by item
- [ ] Refute-first adversarial self-review passed; deviations and §5 carry-overs dispositioned in
      `notes.md` (committed on this branch). `review.md` **not** written by you.
- [ ] Commit subject matches §10; no `BREAKING CHANGE:` footer; `CHANGELOG.md` not hand-edited
- [ ] **Final cleanup commit, after review:** `git rm -r docs/plans/issue-40-distinct-values-semantic-equality/`
      — the plan directory is removed **in this PR**, and only once the reviewer has read it

---

## §12 Pre-handoff verification

What the planner actually executed, not just wrote. **Every row was re-run on `3f0dd7a`** after #39
merged and this branch was rebased — none is carried over from the `32ce4c1` pass.

| Check                                    | Command / method                                                                                                | Result                                                                                                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §6.1 compiles as written                 | wrote the file to `src/utils/firestoreValueEquality.ts`, ran `npm run test:types`, then removed it               | **clean** — no diagnostics                                                                                                                                                 |
| §6.2 call site compiles as written        | scratch `src/__plan40_scratch.ts` importing `distinctFirestoreValues` + `ValueAtKey`, returning the exact cast expression; `npm run test:types`; file removed | **clean** — `distinctFirestoreValues(values) as ValueAtKey<Row,'tags'>[]` type-checks                                                     |
| Every `from '…'` specifier §6 uses        | same compile — `'firebase-admin/firestore'` for `DocumentReference`, `GeoPoint`, `Timestamp` as **values**, and `'./vectorValue.js'` for `isGenuineVectorValue` | **all resolved.** No TS2305. (This is the check the skill warns about: `firebase-admin` re-exports an allowlist, so "in some `.d.ts`" ≠ "importable here.") |
| Declaration emit                         | `npx tsc --declaration --emitDeclarationOnly --outDir <tmp>`                                                     | `utils/firestoreValueEquality.d.ts` emits `export declare function distinctFirestoreValues<V>(values: Iterable<V>): V[];` and **names no package at all** — no `@google-cloud/firestore` leak |
| §6.1 passes the lint/format legs          | `npx prettier --check src/utils/firestoreValueEquality.ts`; `npx eslint <same>`                                    | both **exit 0** — the block is copy-verbatim *and* gate-clean                                                                                                              |
| Nominal checks hold on decoded values     | `N-instanceof-across-read-path.mjs` against the emulator, on both an unconverted and a converted read             | **ALL NOMINAL CHECKS HOLD** (exit 0). See §3.3                                                                                                                             |
| Algorithm correctness                     | `P-canonical-key-algorithm.mjs`, 27 cases × 3 encodings                                                            | NESTED **0/27 wrong**; `new Set` 9/27; NAIVE 2/27 (exit 0). Found and fixed the **T2** registry bug during planning                                                        |
| SDK/emulator semantics                    | `N-sdk-value-shapes.mjs`, `N-ref-equality-and-converter.mjs`                                                       | §3.2's table — all rows are probe output                                                                                                                                   |
| Every §9 / §10 shell command              | ran each one **on `3f0dd7a`**                                                                                     | `grep -rl -- '–#41' docs/adr/` → **12 files** (10 live footers + 2 not-to-sweep); `grep -n "distinctValues" README.md npm-readme.md` → **no rows, exit 1**; `grep -rn "distinctValues\|#40" docs/development/*.md` → **no rows**; `grep -rn "new Set(" src --include="*.ts" \| grep -v /tests/` → **2 rows** (`QueryBuilder.ts:1364`, `dotNotation.ts:32`); `grep -c "distinctValues" src/core/CollectionGroup.ts` → **0**; `grep -n "distinctValues" src/vector/*.ts` → **no rows**; `ls docs/adr/` → ends at `0033`, so `0034` is free; `npm run check:docs` → `✓ … (181 doc files scanned)` with this plan present (180 without). Expected results are stated in §9.4 for the ones that pass by matching nothing. |
| Post-#39 drift re-enumeration             | re-derived every §3 / §6.2 / §9 anchor against `3f0dd7a` rather than assuming                                       | `QueryBuilder.ts` shifted **+64** (import 15→20, `LIMITATION` 1250-1254→1314-1318, `return` 1300→1364); `src/index.ts` +6 (89/91/98); `FirestoreRepository.ts` interface 165→166-225, still **no `query()`**; `reference/query-builder.md` +3 (201-211); `scope-and-capabilities.md` #40 row 56→**57**; `docs/adr/README.md` last row 62→**63**; ADR-0017 amendment anchor 123→**131**, References 148→**156**, issues bullet →**160**. **Unchanged and verified so:** `queries.md:46/297/423/430`, `migration-v2-to-v3.md:180`, `repository-query-builder.integration.test.ts:96-124`, `repository-read-only-converter.integration.test.ts:142-158`, `CollectionGroup.ts:155`, `VectorQueryBuilder.ts` method lines, `package.json`, `jest.config.base.js`, `check-coverage-gates.mjs`. Collection-group tests shifted **+3**. |
| Plan itself passes the doc/format legs    | `npm run check:format`, `npm run lint`, `npm run check:docs` with the plan directory present                        | all three **clean**. `docs/**/*.md` is *not* prettier-exempt (only `website/**`), so `PLAN.md` and the `.mjs` probes are prettier-checked and pass. ESLint, by contrast, **ignores `docs/plans/**` entirely** (`npx eslint <probes dir>` reports "all of the files … are ignored"), so the probes are format-checked but not linted — `npm run lint` passes either way. |
| Baseline suite counts                     | both suites, clean tree, `3f0dd7a`                                                                                | unit **31 suites / 383 tests**; integration **34 suites / 497 tests**                                                                                                      |
| Gate headroom                             | parsed `coverage/unit/lcov.info` + `coverage/integration/lcov.info` against `scripts/check-coverage-gates.mjs`      | §3.5 — `src/utils` at 723/731 lines, 160/169 branches, 28/28 functions (**identical before and after #39**, which added no util); per-metric slack formulas given. Integration `QueryBuilder` 96.80 / 87.83 / 100 |
| Unresolved conditionals                   | re-read §§2-9                                                                                                     | **none.** Both conditionals from the `32ce4c1` pass are now **resolved by fact**: #39 has merged, so the ADR number is `0034`, the footer count is 10 live files, and T11's range collapses to the single issue `(#41)`; and the §9.5 follow-up is filed as **#75**. The only remaining hedge is "re-check if `main` moves again", which is a rebase instruction, not deferred research. |
| Full prototype                            | **not run** — deliberately (§5, first bullet)                                                                     | The type contract is unchanged and the call site is a single greppable expression (**R1**), so there is no unenumerable blast radius. Consequence recorded in §5.           |
| CI peer matrix / production Firestore     | **not run**                                                                                                        | §5, bullets 2-3                                                                                                                                                            |

---

## Appendix — probe inventory

| Probe                                   | Proves                                                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `probes/N-sdk-value-shapes.mjs`         | `isEqual` presence on each Firestore value class; `Buffer` has none; `Set` semantics for `NaN` / `-0` / BigInt / `Timestamp`; own-key shapes. → **N1-N3, N6-N7** |
| `probes/N-ref-equality-and-converter.mjs` | `DocumentReference.isEqual` is converter- and instance-sensitive while `.path` is not; the emulator preserves per-document map key order; `-0` round-trip; read-back kinds; SDK versions. → **N4-N5, N8-N9** |
| `probes/N-instanceof-across-read-path.mjs` | `instanceof` against the **firebase-admin re-exported** classes holds for values a real read decoded, on both converted and unconverted paths; no Firestore class has `Object.prototype`; own-`__proto__` read is faithful. → **N10-N12**. Promoted to test **I-1** |
| `probes/P-canonical-key-algorithm.mjs`  | 27-case comparison of `new Set` vs a delimiter join vs the prescribed nested tree; cycle crash; per-value-registry collapse; `Date` and same-instance handling. → **P1-P7**. Promoted to tests **U-1…U-23** |
