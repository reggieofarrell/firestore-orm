# Issue #37 — Query Explain (`explain()` + vector)

**Implementer:** agent (plan-execution) · **Reviewer:** maintainer · **Baseline:** `main` @
`746bb7f24777be70eb02802b7ad4f9315fbae0d3` (`746bb7f docs: add optional review.md for adversarial
review`) · **Branch:** `cursor/issue-37-query-explain` — already created and pushed with this plan
on it; check it out, do not cut a new one

**Issue:** [#37](https://github.com/reggieofarrell/firestore-orm/issues/37) — labels `enhancement`,
`parity`, `v3.x`. This issue is in ADR-0017's `#37–#41` parity / v3.x deferral set — §9 ADR
bookkeeping (amendment + living-index footers + capability matrix move) **applies**.

> **Acceptance (verbatim from the issue):** "explain plans/statistics are retrievable for Core and
> vector queries."

Issue body (for context, not authority — §3 is authoritative):

> Add `explain()` (and later `explainStream()`) for normal and vector queries, returning the SDK
> diagnostic structure (plan summary, execution stats, index use, read metrics) without pretending
> it is an ORM document result.

**Plan revision:** post-handoff review (`plan-review.md` on this branch) found compile-blocking §6
defects (B1/B2) and completeness gaps (S1–S6, M1–M3). This file incorporates those fixes; D9 was
settled by the owner as Option B (derive explain types from `Query`).

---

## §0 How to use this plan

1. Read §1 (settled — do not re-litigate) and §4 (traps) **before** writing code.
2. §6 blocks are **specifications**. The **type spelling** in §6.1/§6.2 was compile-checked against
   `tsconfig.typecheck.json` after the plan review (Option B aliases + optional vector `explain?`);
   the full feature was **not** prototyped into `src/`. §7 is the ordered build sequence, §8 the
   tests, §9 docs/ADR, §10 the gate, §11 done.
3. Every claim in §3 was produced by an executed probe or a file read on this baseline against
   `@google-cloud/firestore@8.6.0` / `firebase-admin@14.2.0` and the Firestore emulator. Probes are
   in `docs/plans/issue-37-query-explain/probes/` — re-run them if you doubt one. **Do not trust the
   issue body over §3.**
4. Blast radius is greppable (one terminal on `FirestoreQueryBuilderBase`, one on
   `VectorQueryBuilder`, type export(s), docs/ADR). Remaining unverified items are in §5.
5. **Follow the `plan-execution` skill** — write `notes.md` as you go, mutation-check load-bearing
   tests (`git stash`), and pass an independent refute-first self-review before declaring ready for
   external review. Commit `notes.md` on this branch — that is the return channel.

---

## §1 Owner-approved decisions

| Id | Fork | Decision | Rejected alternative and why |
| -- | ---- | -------- | ---------------------------- |
| **D1** | `explainStream` in this PR? | **Ship `explain()` only.** Defer `explainStream` to a Core-only follow-up issue (§9.6). (owner F1; issue body “and later”; P3/P8 — VectorQuery has no `explainStream`; emulator stream yields docs without metrics) | Shipping both now: acceptance does not require streaming; Vector cannot match; emulator stream is a false-green for diagnostics (P8). |
| **D2** | Return shape | Return **`QueryExplainResult<R> = { metrics: ExplainMetrics; documents: R[] \| null }`**. Map snapshot docs through `toResult` (collection / group) or the vector `get()` mapper when `analyze: true`; `documents` is **`null`** for plan-only. (owner F2:B) | Raw SDK `ExplainResults<QuerySnapshot>` (F2:A): leaves callers holding Admin snapshots instead of ORM `R`, fighting every other terminal. Metrics-only API: drops the analyze path the SDK offers and the issue’s “plans/statistics” pairing with optional execution. |
| **D3** | `AggregateQuery.explain`? | **Out of scope** — defer. (owner F3; not in acceptance) | Wrapping aggregate explain now: expands surface past “Core and vector” document queries; AggregateQuery has no `explainStream` either (P5). Escape hatch remains `query.aggregate(…).explain()` on the raw SDK. |
| **D4** | Emulator / CI testing | **Option A:** unit mocks own the success path; thin emulator integration asserts `explain()` throws `No explain results` (documents the limit); ADR + Starlight note that **real metrics require production Firestore**. (owner A; P6/P7) | Production CI smoke (C): needs credentials/cost; repo CI is emulator-only. Skipping the emulator assertion (B): easier to forget the caveat in docs. Soft-wrapping `No explain results` into a special ORM error: masks SDK/emulator behavior that production will not hit. |
| **D5** | Placement / inheritance / exports | `explain()` on **`FirestoreQueryBuilderBase`** so collection + collection-group inherit. **`VectorQueryBuilder.explain()`** after `findNearest()` only. Export **`QueryExplainResult`** from `src/index.ts` **and** re-export it from `src/vector/index.ts` (same precedent as `VectorValueLike` — core module has no `/vector` export-map path). Do **not** re-export SDK type names. (derived + S6) | Only on `FirestoreQueryBuilder`: drops group explain. Re-exporting SDK `ExplainOptions`/`ExplainMetrics`: peer-leak pattern the package avoided for `DocumentSnapshot`. Root-only export: `/vector`-only consumers cannot name the return type without reaching into the main entry. |
| **D6** | Peer / missing `explain` | Capability-check **`typeof this.query.explain === 'function'`** on Core before calling. On vector, keep a **defense-in-depth** `typeof this.vectorQuery.explain === 'function'` check even though `assertVectorSearchSupported` already requires firestore `>= 7.10` and VectorQuery.explain landed in **7.8** — so the public path cannot reach a vector builder without `explain` (N10). Do **not** bump the `firebase-admin` peer range. (derived, P1 + changelog; owner-confirmed retained guard) | Silent `explain is not a function` on old admin-12 + firestore `<7.4`: bad DX. Raising peer to admin `^13`: punches admin-12 consumers who already resolved a new enough transitive firestore. Dropping the vector typeof check: slightly less code, but loses a clear error if someone constructs a `FirestoreVectorQuery` stub without `explain` in tests / future SDK quirks. |
| **D7** | Errors / `parseFirestoreError` | Wrap the SDK call in `try/catch` → `parseFirestoreError` (same as `get()`). Local guards (missing `explain`, vector-before-`findNearest`) throw plain `Error` **outside** the try. Do **not** teach `ErrorParser` a mapping for `"No explain results"`. (derived, D4; ErrorParser already rethrows plain `Error` instances) | Special-casing the emulator message: couples the ORM to an SDK string that is not a gRPC code. |
| **D8** | `null` vs `[]` for documents | **`documents: null`** iff the SDK snapshot is `null` (plan-only / not executed). **`documents: []`** iff analyze ran and matched zero docs. Never coerce empty → null or null → []. Applies to **both** Core and vector. (derived, D2; T1) | Collapsing them: callers cannot tell “did not execute” from “executed, empty.” |
| **D9** | Explain type import source | **Derive local aliases from the re-exported `Query` signature** (firebase-admin *does* export `Query`, whose `.explain` is typed): `ExplainOptions = NonNullable<Parameters<Query['explain']>[0]>`; `ExplainMetrics = Awaited<ReturnType<Query['explain']>>['metrics']`. Keep them **file-local** (or module-private) — not public re-exports. (owner B; plan-review B1) | Importing from `firebase-admin/firestore`: **does not compile** — admin’s allowlist omits Explain\* (P5c). Importing from `@google-cloud/firestore`: readable, but that package is in neither deps/peers/devDeps — fine under npm hoist, fragile under pnpm’s strict layout; published `.d.ts` would reference an undeclared package. |

Do not re-litigate §1. Deviations belong in `notes.md` with rationale.

---

## §2 Scope

### In scope

| Area | Change |
| ---- | ------ |
| `FirestoreQueryBuilderBase` | Add `explain(options?: ExplainOptions): Promise<QueryExplainResult<R>>`; capability check; map via `toResult` |
| `QueryExplainResult<R>` type | Defined in `QueryBuilder.ts`; exported from `src/index.ts` + `src/vector/index.ts` |
| `VectorQueryBuilder` | Widen local vector-query type with **optional** `explain?`; add `explain()` after `findNearest`; map docs like `get()` |
| Unit tests | Mocked success path + guards + **required** group `toResult` case (§8.1) |
| Integration tests | Emulator “No explain results” on collection, group, and vector (§8.2) |
| Type tests | Return shape / projection / vector distance field (§8.3) |
| Docs + ADR | Capability matrix move; queries / query-builder / vector-search; ADR-0031; ADR-0017 amendment; living-index footers |
| Follow-up issue | `explainStream` Core-only, including `limitToLast` guard note (§9.6) |

### Explicitly **out** of scope

- `explainStream()` on Core or vector (D1) — follow-up issue.
- `AggregateQuery.explain` (D3).
- Re-exporting `ExplainOptions` / `ExplainMetrics` / `PlanSummary` / `ExecutionStats` as public names (D5/D9).
- Teaching `ErrorParser` / express status maps about explain (D7) — no new error class.
- Changing `getUnderlyingQuery()` visibility or documenting it as the explain escape hatch (it stays
  `@internal`).
- Peer dependency range bump (D6).
- Declaring `@google-cloud/firestore` as a direct dependency just to import Explain\* types (D9).
- Production Firestore CI smoke (D4) — optional maintainer-local; §5.
- README / `npm-readme.md` pitch changes (grepped: no Query Explain / stream marketing to update).
- Frozen `website/src/content/docs/2.0/**` archive.
- BulkWriter (#38), listener metadata (#39), distinct (#40), Pipelines (#41).
- Editing `src/tests/unit/packageExports.unit.test.ts` — that suite only asserts **runtime** exports;
  `QueryExplainResult` is type-only. T-4 + `check:consumer` own the guarantee (S5).

### Scope correction — where the issue is stale / incomplete

- Issue cites `docs/development/v3-release-review.md` — **not in the tree** (maintainer-local
  `reviews/` per ADR-0017). Authoritative committed sources: issue #37, ADR-0017, scope matrix.
- Issue says “returning the SDK diagnostic structure … without pretending it is an ORM document
  result.” Owner **F2:B** settles the documents half as ORM-mapped `R[] | null` while metrics stay
  the SDK metrics object — not a raw `QuerySnapshot` return. Do not implement F2:A.
- Issue title includes `explainStream`; body defers it (“and later”); owner **F1** confirms deferral.
- Issue does not name collection-group inheritance, the emulator `No explain results` failure mode,
  the VectorQuery **`.d.ts` omission**, the **firebase-admin Explain\* allowlist omission** (P5c),
  or the admin-12 / firestore `<7.4` capability gap — all required by the current tree / probes (§3).

---

## §3 Verified facts

Probes run on baseline `746bb7f` via:

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
firebase emulators:exec --project demo-firestoreorm-test --only firestore \
  "node docs/plans/issue-37-query-explain/probes/sdk-explain.mjs"
```

Type-import compile checks (post-review, same peers) used temporary files under `src/` removed after
`npx tsc --noEmit -p tsconfig.typecheck.json`.

### 3.1 SDK surface — `probes/sdk-explain.mjs` + d.ts / admin allowlist reads

| Id | Expression / condition | Observed | Note |
| -- | ---------------------- | -------- | ---- |
| P1 | `@google-cloud/firestore` version | `8.6.0` | bundled under `firebase-admin@14.2.0` |
| P2 | `typeof Query#explain` / `explainStream` | `function` / `function` | both on Core `Query` |
| P3 | `typeof VectorQuery#explain` / `explainStream` | `function` / `undefined` | runtime explain exists |
| P4 | gcloud `firestore.d.ts` `VectorQuery` block contains `explain(` | **false** | **local type widen required**; declare `explain?` optional (B2) so `as FirestoreVectorQuery<T>` at `findNearest` still compiles |
| P5 | `typeof AggregateQuery#explain` / `explainStream` | `function` / `undefined` | gcloud types include explain; no stream |
| P5b | gcloud `firestore.d.ts` exports `ExplainOptions` / `ExplainMetrics` | true / true | **only proves the gcloud package**, not the import path §6 may use |
| P5c | `firebase-admin/firestore` re-exports `ExplainOptions` / `ExplainMetrics` | **false** | admin `lib/firestore/index.d.ts` is an **explicit allowlist** that omits Explain\*; `import type { ExplainOptions } from 'firebase-admin/firestore'` → **TS2305**. `Query` *is* re-exported and its `.explain` is typed → D9 |
| P5d | `@google-cloud/firestore` in package.json deps/peers/devDeps | **absent** | only reachable via firebase-admin’s dependency; importing it in published `.d.ts` is the pnpm hazard (D9 rejected A) |

Upstream changelog (read, not in probe file): Explain types landed in **`@google-cloud/firestore@7.4.0`**
(“Query Profile”); VectorQuery profiling in **7.8.0**. `firebase-admin@12` can still resolve firestore
`<7.4` — hence D6 Core guard.

### 3.2 Emulator behavior — same probe

| Id | Expression / condition | Observed | Note |
| -- | ---------------------- | -------- | ---- |
| P6 | `Query.explain()` / `{analyze:true}` / `{analyze:false}` | all throw `Error: No explain results` | SDK throws when response lacks `explainMetrics` |
| P7 | `VectorQuery.explain()` plan + analyze | same `No explain results` | |
| P7b | `AggregateQuery.explain()` plan + analyze | same `No explain results` | out of scope (D3) but confirms emulator gap |
| P8 | `Query.explainStream({analyze:true})` | resolves; **2 doc chunks, 0 metrics chunks** | why D1 must not treat emulator stream as proof of diagnostics |

### 3.3 Existing ORM terminals + SDK limitToLast (read, cited)

| Id | Fact | Cite |
| -- | ---- | ---- |
| N1 | All document terminals materialize rows via abstract `toResult` | `QueryBuilder.ts:359`, collection `1485`, group `CollectionGroup.ts:182` |
| N2 | `get()` maps `snapshot.docs` through `toResult` + `parseFirestoreError` | `QueryBuilder.ts:1439–1444` |
| N3 | `stream()` rejects `hasLimitToLast` locally; `get()` does not | `1300–1308` vs `1439` |
| N4 | Vector `get()` requires `findNearest`; maps `{...data, id}` inline; `parseFirestoreError` | `VectorQueryBuilder.ts:191–204` |
| N5 | Vector already uses a minimal local `FirestoreVectorQuery` type | `17–21`; cast at `175` |
| N6 | `ErrorParser` rethrows plain `Error` instances unchanged | `ErrorParser.ts:72–73` |
| N7 | Integration gate owns `QueryBuilder.ts` + `src/vector/**` | `scripts/check-coverage-gates.mjs` |
| N8 | Living-index footers currently say remaining deferrals `(#37–#41)` | see §9.3 occurrence counts |
| N9 | SDK `Query.explain` uses `_getResponse`, which **reverses** docs for `LimitType.Last` — analyzed `limitToLast` explain returns correctly ordered documents; **no local `hasLimitToLast` guard** (same as `get`) | gcloud `query.js:878` + `query-util.js` LimitType.Last flip (~70) |
| N10 | SDK `explainStream` **throws** for `limitToLast` (mirrors `stream`) | gcloud `query.js:959–965` — follow-up issue must guard (M3) |
| N11 | `assertVectorSearchSupported` requires object-form `findNearest` → firestore `>= 7.10` | `VectorSearch.ts:235–261`; VectorQuery.explain since 7.8 → public vector path already has explain |
| N12 | Group unit harness pattern exists | `queryBuilderBounds.unit.test.ts:165` — `new FirestoreCollectionGroupQueryBuilder(query, 'posts', db)` |

### 3.4 Authoritative site enumeration (`main` @ `746bb7f`)

| File | Lines / what changes |
| ---- | -------------------- |
| `src/core/QueryBuilder.ts` | Local `ExplainOptions` / `ExplainMetrics` aliases (D9); `QueryExplainResult` export; `explain()` on `FirestoreQueryBuilderBase` near `get()` (~1439) |
| `src/core/CollectionGroup.ts` | **No method body** — inherits from base; `toResult` already overlays path identity (`182`) |
| `src/vector/VectorQueryBuilder.ts` | Widen `FirestoreVectorQuery` with **`explain?` optional**; add `explain()` beside `get()` (~191); import `QueryExplainResult` |
| `src/index.ts` | Export type `QueryExplainResult` (~15) |
| `src/vector/index.ts` | Re-export type `QueryExplainResult` from `../core/QueryBuilder.js` (D5/S6) |
| `src/tests/unit/packageExports.unit.test.ts` | **No edit** — runtime-only assertions (S5) |
| Docs / ADR | §9 |

**Deliberately NOT changed** (justify in your notes if you touch them):

- `src/core/ErrorParser.ts` / `src/express/index.ts` — no new error class (D7).
- `getUnderlyingQuery` / `getQueryRef` — stay `@internal`; explain is first-class (D5).
- `stream()` / `paginate` / `limitToLast` **guards** — explain behaves like `get`, not `stream`
  (**proven** N9; do not add a `hasLimitToLast` reject on `explain`).
- Aggregate terminals (`count` / `sum` / `average` / `aggregate`) — D3.
- `README.md` / `npm-readme.md` — grepped unaffected.
- `website/src/content/docs/2.0/**` — frozen archive.

### 3.5 Baseline suite counts (executed on this baseline, clean tree)

| Suite | Suites / tests |
| ----- | -------------- |
| Unit (`npm run test:unit`) | **30 / 370** |
| Integration (`npm run test:integration:emulator`) | **30 / 452** |

After the change both must go **up** (new unit file and/or cases + new integration cases; type tests do not appear in these counts).

### 3.6 Integration coverage headroom (measured on this baseline)

From `coverage/integration/lcov.info` vs `scripts/check-coverage-gates.mjs` thresholds:

| Gate | lines (thr.) | branches (thr.) | functions (thr.) | Slack |
| ---- | ------------ | --------------- | ---------------- | ----- |
| `QueryBuilder.ts` | 97.27% (90) | 89.16% (75) | 100% (95) | ≈154 lines · 38 branch paths · 3 functions |
| `src/vector/*` | 94.69% (90) | 91.89% (75) | 96.43% (90) | ≈34 lines · 25 branch paths · **2 functions** |
| `CollectionGroup.ts` | 99.55% (90) | 97.22% (75) | 100% (95) | ample |

`explain()` adds roughly two functions per file (method + `.map` arrow). The arrow is never reached
in integration (emulator always throws before a snapshot). Vector functions land ≈93% vs 90 thr. —
still passing. **No gate risk** from unit-only capability-miss branches (M1).

---

## §4 Traps

Ordered by how badly a reasonable implementer gets them wrong.

### T1 — Collapsing `documents: null` and `documents: []` (D8)

Plan-only → SDK `snapshot === null` → ORM **`documents: null`**. Analyze with zero matches →
**`documents: []`**. Coercing either way silently lies about whether the query executed (and billed).
Tests **U-2 / U-3** (Core) and **U-2v / U-3v** (vector) lock both sides — the vector copy is where a
paste slip is most likely (S2).

### T2 — Returning raw `ExplainResults` / `QuerySnapshot` despite D2

The issue’s “SDK diagnostic structure” phrase tempts F2:A. Owner chose **F2:B**. Metrics stay the
SDK metrics object (via local `ExplainMetrics` alias); documents are ORM `R[]`. Returning
`ExplainResults` breaks projection / collection-group identity.

### T3 — Forgetting collection-group `toResult` (N1)

Implementing explain only on `FirestoreQueryBuilder` (or mapping with `{...data, id}` only) drops
group path identity. Put the method on **`FirestoreQueryBuilderBase`** and always use `this.toResult`.
**U-4g is mandatory** — I-3 only proves the emulator throw is wired to the group builder; it never
reaches `toResult` (S1). Mutation-check U-4g: a `{...data, id}` mapping still type-checks.

### T4 — Vector `.d.ts` gap: required `explain` breaks the `findNearest` cast (P4, B2)

`VectorQuery.explain` exists at runtime but is **absent** from gcloud `firestore.d.ts`. Widening
`FirestoreVectorQuery` with a **required** `explain` makes `as FirestoreVectorQuery<T>` at
`VectorQueryBuilder.ts:175` fail TS2352. Declare **`explain?` optional** — honest for D6 and
compiles without `as unknown as`.

### T5 — Shipping `explainStream` “while you’re there” (D1, P8)

Emulator stream returns documents **without** metrics. Vector has no stream API. Do not add it.

### T6 — Treating emulator success as the integration happy path (D4, P6)

`explain()` **always** throws on the emulator today. Happy path = **unit mocks**. Integration =
assert the known emulator error.

### T7 — Wrapping `"No explain results"` in `ErrorParser` (D7)

Plain SDK `Error` when metrics are missing. Parser already rethrows `Error` (N6). No new class.

### T8 — Missing Core capability check on old firestore (D6)

admin-12 can resolve firestore `<7.4` where `Query.explain` is absent. Guard with
`typeof this.query.explain === 'function'` **outside** `parseFirestoreError`.

### T9 — Calling vector `explain()` before `findNearest()` (N4)

Mirror `get()`: throw requiring `findNearest()` first. Do not fall through to the core prefilter
query (silent wrong diagnostics).

### T10 — Living-index / ADR-0017 partial sweep (§9)

Grep with a working pattern (see §9.3) — a broken grep that matches nothing is itself the T10
failure mode. Remaining range must be `(#38–#41)`. ADR-0017 and ADR-0030 each have **two**
occurrences.

### T11 — Starlight `:::` fence leak

After `docs:build`, grep the built HTML for leaked `:::`.

### T12 — Importing Explain\* from `firebase-admin/firestore` (D9, P5c)

Looks natural; **does not compile** (TS2305). Do not “fix” by switching to
`@google-cloud/firestore` either (undeclared package). Use D9 aliases only.

---

## §5 Could not verify / scope bounds

- **Production metrics shape** — never executed against a real Firestore project. Unit tests mock
  metrics objects structurally. §10 does **not** require a production smoke.
- **Peer matrix legs** — local probes used admin 14 + firestore 8.6.0 only. CI still owns the
  admin/firestore fan-out. Explain’s typeof guard should be fine on 7.4+; that exact floor was not
  installed locally.
- **Feature unprototyped** — no production `src/` edit was left in the tree. The **type spelling**
  (D9 aliases + optional vector `explain?`) **was** compile-verified after the plan review; the
  earlier false claim that “import from `firebase-admin/firestore`” would fix type surprises is
  **retracted** (that import *is* the failure — P5c).
- **Carried over, explicitly deferred** — `explainStream` (D1; needs `hasLimitToLast` guard per N10);
  `AggregateQuery.explain` (D3); opaque-paginate token evolution; Enterprise Pipeline explain options.

---

## §6 API specification

### 6.1 `src/core/QueryBuilder.ts` — type + base method

Near the other exported query types (alongside `PaginatedResult` / aggregation types). **Do not**
import `ExplainOptions` / `ExplainMetrics` from `firebase-admin/firestore` or
`@google-cloud/firestore` (D9 / T12).

```ts
import type { Query } from 'firebase-admin/firestore';

/**
 * Options for {@link FirestoreQueryBuilderBase.explain}, derived from the Admin SDK
 * `Query.explain` signature. firebase-admin's public allowlist does not re-export `ExplainOptions`
 * by name (D9).
 */
type ExplainOptions = NonNullable<Parameters<Query['explain']>[0]>;

/**
 * Metrics object returned by Admin SDK Query Explain, derived from `Query.explain`'s return type.
 * Not re-exported as a public name — consumers use {@link QueryExplainResult}.
 */
type ExplainMetrics = Awaited<ReturnType<Query['explain']>>['metrics'];

/**
 * Result of {@link FirestoreQueryBuilderBase.explain}.
 *
 * `metrics` is the Admin SDK explain-metrics object (plan summary, and execution stats when the
 * query was analyzed). `documents` is the ORM-mapped page of results when `analyze: true`, or
 * `null` when the query was plan-only (`analyze` false/omitted) and the SDK returned no snapshot.
 *
 * An analyzed query that matches nothing yields `documents: []` — not `null`. Do not collapse the
 * two; callers use `null` vs `[]` to distinguish “did not execute” from “executed, empty.”
 */
export type QueryExplainResult<R> = {
  readonly metrics: ExplainMetrics;
  readonly documents: R[] | null;
};
```

On `FirestoreQueryBuilderBase`, beside `get()`. `Query.explain` **is** on the typed `Query` (P2),
so call it directly — no structural re-cast (M2). The typeof guard is intentional defense for older
peers; eslint has no type-aware `no-unnecessary-condition` rule enabled.

```ts
  /**
   * Plans this query and optionally executes it (Admin SDK Query Explain).
   *
   * Pass `{ analyze: true }` to execute the query and receive execution statistics plus the
   * matching documents mapped through this builder's result shape (`R`). Omit `analyze` (or pass
   * `false`) for a plan-only request: `documents` is `null` and `metrics.executionStats` is null.
   *
   * Returns `{ metrics, documents }` — SDK diagnostics plus ORM-mapped rows — not a raw
   * `ExplainResults` / `QuerySnapshot`. Use {@link get} when you only need documents.
   *
   * Composes with `limitToLast` the same way `get()` does (SDK reverses the page for
   * `LimitType.Last`); there is no local `hasLimitToLast` reject.
   *
   * ⚠️ The Firestore **emulator does not return explain metrics** today; the Admin SDK then throws
   * `Error: No explain results`. Real plan/execution stats require production Firestore.
   *
   * Requires a Firestore SDK that exposes `Query.explain` (`@google-cloud/firestore` >= 7.4).
   *
   * @example
   * const plan = await userRepo.query().where('status', '==', 'active').explain();
   * console.log(plan.metrics.planSummary.indexesUsed);
   *
   * const analyzed = await userRepo.query().where('status', '==', 'active').explain({ analyze: true });
   * // analyzed.documents: User[] (possibly empty); analyzed.metrics.executionStats is non-null
   */
  async explain(options?: ExplainOptions): Promise<QueryExplainResult<R>> {
    if (typeof this.query.explain !== 'function') {
      throw new Error(
        'explain() is not available: the installed Firestore SDK does not expose Query.explain(). ' +
          'Query Explain requires @google-cloud/firestore >= 7.4 (firebase-admin 12 only when the ' +
          'resolved @google-cloud/firestore is new enough; firebase-admin >= 13 typically bundles it). ' +
          'Upgrade firebase-admin (or @google-cloud/firestore).',
      );
    }

    try {
      const results = await this.query.explain(options);
      return {
        metrics: results.metrics,
        documents:
          results.snapshot === null || results.snapshot === undefined
            ? null
            : results.snapshot.docs.map(doc => this.toResult(doc)),
      };
    } catch (error: unknown) {
      throw parseFirestoreError(error);
    }
  }
```

### 6.2 `src/vector/VectorQueryBuilder.ts` — widen + method

Reuse the same local alias pattern (import `Query` + derive, or import `QueryExplainResult` and
duplicate the tiny aliases — prefer deriving once in this file for the method signature). Widen with
**optional** `explain?`:

```ts
type FirestoreVectorQuery<T> = {
  get(): Promise<{ docs: Array<QueryDocumentSnapshot<T>> }>;
  /** Present on @google-cloud/firestore >= 7.8 at runtime; omitted from current firestore.d.ts (P4). */
  explain?: (options?: ExplainOptions) => Promise<{
    metrics: ExplainMetrics;
    snapshot: { docs: Array<QueryDocumentSnapshot<T>> } | null;
  }>;
};
```

```ts
  /**
   * Plans / optionally executes this vector query (Admin SDK VectorQuery.explain).
   *
   * Requires {@link findNearest} first — explaining the prefilter query alone would silently omit
   * the nearest-neighbor stage.
   *
   * Same `{ metrics, documents }` contract as {@link FirestoreQueryBuilderBase.explain}, including
   * `documents: null` for plan-only and `documents: []` for an empty analyzed result. Emulator:
   * throws `No explain results` (no metrics from the emulator).
   *
   * Note: `explainStream` does not exist on VectorQuery in the Admin SDK; it is not offered here.
   * The typeof guard below is defense-in-depth: `findNearest` already requires firestore >= 7.10,
   * which includes VectorQuery.explain (since 7.8).
   */
  async explain(options?: ExplainOptions): Promise<QueryExplainResult<R>> {
    if (!this.vectorQuery) {
      throw new Error('explain() on a vector query requires findNearest() to be called first.');
    }
    if (typeof this.vectorQuery.explain !== 'function') {
      throw new Error(
        'explain() is not available on this VectorQuery: the installed Firestore SDK does not ' +
          'expose VectorQuery.explain() (added in @google-cloud/firestore >= 7.8). Upgrade ' +
          'firebase-admin (or @google-cloud/firestore).',
      );
    }

    try {
      const results = await this.vectorQuery.explain(options);
      return {
        metrics: results.metrics,
        documents:
          results.snapshot === null || results.snapshot === undefined
            ? null
            : (results.snapshot.docs.map((doc: QueryDocumentSnapshot<T>) => ({
                ...(doc.data() as T),
                id: doc.id,
              })) as unknown as R[]),
      };
    } catch (error: unknown) {
      throw parseFirestoreError(error);
    }
  }
```

Reuse the same document mapping as `get()` so projection / `distanceResultField` shaping stays
aligned (N4). Import `QueryExplainResult` from `../core/QueryBuilder.js`.

### 6.3 Exports

`src/index.ts`:

```ts
export type { PaginatedResult, QueryFilterFactory, QueryExplainResult } from './core/QueryBuilder.js';
```

`src/vector/index.ts` (after the existing type re-exports; comment why — D5/S6):

```ts
// Re-exported so /vector consumers can name explain()'s return type without importing the main
// entry (QueryBuilder has no export-map subpath) — same rationale as VectorValueLike above.
export type { QueryExplainResult } from '../core/QueryBuilder.js';
```

### 6.4 Size

~4 source files (`QueryBuilder.ts`, `VectorQueryBuilder.ts`, `index.ts`, `vector/index.ts`), roughly
**+90–130** LOC runtime/types; plus unit + integration + type tests; ADR-0031; Starlight edits;
living-index footers. **No** intentional runtime behavior change to existing terminals.

---

## §7 Implementation sequence and anti-instructions

1. Check out `cursor/issue-37-query-explain` — it already exists and carries this plan. If `main`
   has moved past `746bb7f`, rebase onto it and **re-verify the §3 line numbers before editing**.
2. Add D9 aliases + `QueryExplainResult` + `explain()` on `FirestoreQueryBuilderBase` (§6.1).
   **Why first:** vector and docs depend on the type export.
3. Export `QueryExplainResult` from `src/index.ts` and `src/vector/index.ts` (§6.3).
4. Vector optional widen + `explain()` (§6.2). **Why after core:** imports `QueryExplainResult`;
   optional `explain?` keeps the existing `findNearest` cast compiling (T4).
5. Tests (§8) — **verify each new test fails on the unfixed baseline** (`git stash` the
   implementation, or write tests first). Mutation-check **U-2, U-3, U-2v, U-3v, U-4g, U-5, I-1**
   at minimum (U-4g especially — T3 fails silently).
6. Docs + ADR + bookkeeping (§9). Open the `explainStream` follow-up issue (§9.6).
7. Full gate (§10), `prettier --write` on touched non-exempt files, `notes.md`. Leave the plan
   directory in place for review — the cleanup commit that removes it comes after.

### Anti-instructions

- **Do not** implement `explainStream` (D1 / T5).
- **Do not** wrap `AggregateQuery.explain` (D3).
- **Do not** return raw `ExplainResults` / `QuerySnapshot` (D2 / T2).
- **Do not** coerce `null` ↔ `[]` for `documents` (T1).
- **Do not** put `explain` only on `FirestoreQueryBuilder` — base class only (T3).
- **Do not** explain the core prefilter when vector mode is unset — require `findNearest` (T9).
- **Do not** add `ErrorParser` / express mappings for `"No explain results"` (T7).
- **Do not** bump `firebase-admin` peer range (D6).
- **Do not** `import type { ExplainOptions | ExplainMetrics } from 'firebase-admin/firestore'`
  or from `@google-cloud/firestore` (T12 / D9).
- **Do not** make vector `explain` a **required** member of `FirestoreVectorQuery` (T4).
- **Do not** add a `hasLimitToLast` reject on `explain()` (N9) — that belongs on the deferred
  `explainStream` only (N10).
- **Do not** claim emulator metrics work in docs (T6).
- **Do not** edit `website/src/content/docs/2.0/**` or hand-edit `CHANGELOG.md`.
- **Do not** edit generated agent config (`.cursor/`, `.claude/`, `.agents/`, root `AGENTS.md`).
- **Do not** commit unless asked; leave the tree clean and report the subject line (§10).

---

## §8 Test specification

### 8.1 Unit — `src/tests/unit/query-explain.unit.test.ts` (new)

Gate: **unit** coverage does **not** own `QueryBuilder.ts` / `src/vector/**` (integration gate does
— N7). Still write unit tests: they are the **only** success-path proof (D4). Harness pattern:
`queryBuilderTerminals.unit.test.ts` (real `FirestoreQueryBuilder` over a mock query) and
`queryBuilderBounds.unit.test.ts:165` for the group builder.

| Id | Asserts | Guards |
| -- | ------- | ------ |
| U-1 | Forwards `options` to SDK `explain` (including `{ analyze: true }` and `undefined`) | D2 wiring |
| U-2 | Plan-only mock (`snapshot: null`) → `{ metrics, documents: null }` | T1 |
| U-3 | Analyze mock with 0 docs → `{ documents: [] }` (not null) | T1 |
| U-4 | Analyze mock with docs → collection `documents` mapped via `toResult` (`{…data, id}`) | T2 |
| **U-4g** | **Required:** `FirestoreCollectionGroupQueryBuilder` + analyze mock → `documents[0]` has `path` and `parentPath` (N12 harness) | **T3 / S1** |
| U-5 | SDK throw → `parseFirestoreError` path (plain Error message preserved for `No explain results`) | D7 |
| U-6 | Missing `query.explain` → local capability Error (message mentions upgrade) | T8 |
| U-7 | Vector: before `findNearest` → throws /requires findNearest/ | T9 |
| U-8 | Vector: after `findNearest`, explain maps docs like `get` and returns metrics | P3/D2 |
| **U-2v** | Vector plan-only (`snapshot: null`) → `documents: null` | T1 / S2 |
| **U-3v** | Vector analyze empty docs → `documents: []` | T1 / S2 |
| U-9 | Vector: `explain` missing on the object returned from mocked `findNearest` → capability Error | D6 defense-in-depth (unreachable via real SDKs that pass `assertVectorSearchSupported`, but hit by a deliberate mock — S3) |

Prefer keeping all of the above in this one new file for discoverability.

### 8.2 Integration — `src/tests/integration/query-explain.integration.test.ts` (new)

Gate: **integration** (`test:coverage:gate:integration`).

| Id | Asserts | Guards |
| -- | ------- | ------ |
| I-1 | `userRepo.query().explain()` rejects with `/No explain results/` | T6/D4 |
| I-2 | same with `{ analyze: true }` | T6 |
| I-3 | collection-group `query().explain()` same rejection (wiring only — **not** `toResult`; see U-4g) | T6 |
| I-4 | vector `findNearest(…).explain()` same rejection | T6/P7 |

Do **not** assert on `indexesUsed` / `executionStats` against the emulator.

### 8.3 Type — `src/tests/types/query-explain.type-test.ts` (new)

| Id | Asserts | Guards |
| -- | ------- | ------ |
| T-1 | `explain()` return type is `QueryExplainResult<FirestoreDocument<…>>` | D2 |
| T-2 | after `select('name')`, `documents` elements are projected (`@ts-expect-error` on removed field) | T2 |
| T-3 | vector after `findNearest` + optional `distanceResultField`: `documents` carries distance typing when narrowed from null | D2/N4 |
| T-4 | `QueryExplainResult` importable from package root **and** from `@reggieofarrell/firestore-orm/vector` | §6.3 / D5 |

### 8.4 Coverage gates

| Changed path | Gate |
| ------------ | ---- |
| `src/core/QueryBuilder.ts` | `test:coverage:gate:integration` |
| `src/vector/VectorQueryBuilder.ts` | `test:coverage:gate:integration` |
| `src/index.ts` | `test:coverage:gate:unit` (export surface) |
| `src/vector/index.ts` | integration gate via `src/vector/**` matcher |
| Type-only / test files | neither coverage gate |

Measured headroom is in §3.6 — **no gate risk** from unit-only capability-miss / map branches. Do not
add an emulator mock to force the analyze-success path in integration.

---

## §9 Docs and ADR bookkeeping

### 9.1 Bookkeeping — what **does** apply

This is a **parity / v3.x deferral** (labels), not a plain bug. ADR-0017 amendment + living-index
footers + capability matrix move **all apply**.

### 9.2 New ADR — claim the next free number in `docs/adr/`

Do **not** hardcode `0031` if a predecessor merged — `ls docs/adr/` and take the next free
`NNNN`. On this baseline the next free is **0031**. Filename e.g.
`0031-query-explain.md`. Status `Accepted (v3.x, pending merge/release)`, Date implementer-day,
Deciders `maintainer`. From `docs/adr/0000-template.md` via the `adr` skill. Must contain:

1. **Context** — issue #37; Core vs vector; emulator `No explain results` (P6); VectorQuery d.ts gap
   (P4); firebase-admin Explain\* allowlist omission (P5c) → D9; explainStream deferred; AggregateQuery
   deferred.
2. **Decision** — D1–D9 in ADR voice.
3. **Consequences** — capability matrix move; production required for real metrics; follow-up for
   `explainStream` (incl. `limitToLast` guard); remaining deferrals `#38–#41`.
4. **Alternatives considered** — F2:A raw ExplainResults; shipping explainStream; wrapping
   AggregateQuery.explain; production CI smoke; importing Explain\* from `@google-cloud/firestore`.
5. **References** — issue #37, ADR-0017, Firebase Query Explain docs, probe summary.
6. **Living-index footer** — remaining `(#38–#41)` + “have since shipped” list including this ADR.

Add the row to `docs/adr/README.md` (append after the 0030 row).

### 9.3 ADR bookkeeping edits

Working sweep (the pattern with a space after `\(` matches **nothing** — do not use it):

```bash
grep -rc '#37–#41' docs/adr/*.md | grep -v ':0'
```

| File | Occurrences on this baseline | Edit |
| ---- | ---------------------------- | ---- |
| `docs/adr/0017-v3-core-operations-scope.md` | **2** (`:104` amendment text, `:134` References) | Append `> Amendment (3.0.0, issue #37): …` **after** the #36 amendment at `:99` — **never rewrite** earlier amendments. Update References bullet so #37 points at the new ADR; remaining `#38–#41`. |
| `docs/adr/0023-composite-filter-factory.md` | 1 (`:200`) | Footer → `(#38–#41)`; note #37 shipped |
| `docs/adr/0024-collection-group-queries.md` | 1 (`:149`) | same |
| `docs/adr/0025-transaction-options-readonly-pitr.md` | 1 (`:93`) | same |
| `docs/adr/0026-conditional-writes-preconditions.md` | 1 (`:136`) | same |
| `docs/adr/0027-generic-multi-aggregation.md` | 1 (`:163`) | same |
| `docs/adr/0029-get-many-multi-document-reads.md` | 1 (`:127`) | same |
| `docs/adr/0030-typed-query-bounds-and-limit-to-last.md` | **2** (`:85` Consequences, `:115` footer) | both → `(#38–#41)` |
| `docs/adr/README.md` | — | New index row for the claimed ADR number |

`0028` correctly has **no** living-index footer — leave it alone.

### 9.4 Website — pages

| Page | Line (baseline) | Change |
| ---- | --------------- | ------ |
| `website/src/content/docs/reference/scope-and-capabilities.md` | Deferred row **`:51`** | Split: add Supported row for `explain()` (Core + vector; emulator caveat in Notes). Retitle Deferred row to **`explainStream` only**, linking the §9.6 follow-up issue. |
| `website/src/content/docs/reference/query-builder.md` | Terminal reads **`:134`**, after `get()` **`:136`** | Document `explain(options?): Promise<QueryExplainResult<R>>`; `null` vs `[]`; emulator warning; `limitToLast` composes like `get`. |
| `website/src/content/docs/guides/working-with-data/queries.md` | terminal list ~`:46–47`; streaming ~`:498` | Add `explain()` to the terminal list; short section + example; emulator / production note. |
| `website/src/content/docs/guides/advanced/vector-search.md` | limitations ~`:215`, `:251` | Document `explain()` after `findNearest`; still no `stream` / `onSnapshot` / `orderBy`; no `explainStream`. |
| `website/src/content/docs/guides/migration-v2-to-v3.md` | near `aggregate(spec)` bullet **`:173`** | One bullet: `explain()` is new in 3.0.0 for Core + vector (emulator caveat). |

`website/**/*.md` is prettier-exempt — match style by hand. If you add an aside, run
`npm run docs:build` and grep the built HTML for a leaked literal `:::`.

### 9.5 READMEs

Grepped both `README.md` and `npm-readme.md` for explain / capability pitch — **neither affected**.
Say so in the PR body. Do not run readme-sync for this change.

### 9.6 Follow-up issue to open

**Title:** `Query explainStream() for Core queries`  
**Labels:** `enhancement`, `parity`, `v3.x`  
**Body must note:**

- Deferred from #37 (D1); acceptance for #37 is satisfied by `explain()` alone.
- VectorQuery has no SDK `explainStream` (P3) — Core-only.
- Emulator `explainStream` currently yields documents **without** a metrics chunk (P8).
- SDK `explainStream` **throws** for `limitToLast` (N10) — the ORM wrapper must add a local
  `hasLimitToLast` guard mirroring `stream()`, unlike `explain()` which follows `get()` (N9).
- Optionally mention `AggregateQuery.explain` as a separate future item (D3).

After opening, link it from the scope matrix Deferred row for `explainStream` and from the new ADR.

---

## §10 Gate and commit

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
npm run test:types && npm run lint && npm run check:format && npm run test:unit && npm run test:integration:emulator && npm run test:unit:coverage && npm run test:coverage:gate:unit && npm run test:integration:coverage && npm run test:coverage:gate:integration && npm run build && npm run check:package && npm run check:consumer && npm run check:docs && npm run docs:build
```

Fourteen legs. Report failures with output — never claim a leg passed that you did not execute.

Baseline before your change: unit **30 suites / 370 tests**, integration **30 suites / 452 tests**.
Both suite counts and both test counts must **go up**. Coverage headroom: §3.6.

Re-run the probe (still expect emulator failures — that is the point):

```bash
firebase emulators:exec --project demo-firestoreorm-test --only firestore \
  "node docs/plans/issue-37-query-explain/probes/sdk-explain.mjs"
```

After implementation, also re-check:

```bash
grep -rc '#37–#41' docs/adr/*.md | grep -v ':0'   # must be empty
grep -rc '#38–#41' docs/adr/*.md | grep -v ':0'   # footers updated
# built docs HTML: no leaked :::
```

**Commit subject** (Conventional Commits; commitlint runs on `commit-msg`):

```
feat(query): add explain() for Core and vector queries (#37)
```

**Is it breaking?** **No.** Additive API on existing builders; folds into unreleased `3.0.0` as a
non-breaking feature relative to published 2.x, and does not change existing method contracts.
(Not `feat!`.)

---

## §11 Definition of done

| # | Item |
| - | ---- |
| 1 | D1–D9 honored; nothing in §7 anti-instructions violated |
| 2 | `explain()` on `FirestoreQueryBuilderBase` + `VectorQueryBuilder`; `QueryExplainResult` exported from root **and** `/vector` |
| 3 | Collection-group inherits explain via base; **U-4g** proves `path` / `parentPath` |
| 4 | Core capability check; vector defense-in-depth check (D6) |
| 5 | D9 aliases only — no Explain\* imports from admin or `@google-cloud/firestore` |
| 6 | Unit tests U-1…U-9 + U-2v/U-3v/U-4g fail on unfixed baseline; mutation-checked |
| 7 | Integration I-1…I-4 assert emulator `No explain results` |
| 8 | Type tests T-1…T-4 green under `test:types` |
| 9 | New ADR claimed; ADR-0017 amendment; living-index footers → `(#38–#41)`; README index row |
| 10 | Scope matrix + query-builder + queries + vector-search (+ migration bullet) updated; emulator caveat documented |
| 11 | `explainStream` follow-up issue opened and linked (incl. `limitToLast` note) |
| 12 | READMEs declared unaffected in PR body; `packageExports.unit.test.ts` untouched |
| 13 | Full gate green (§10) with real output; suite counts up as predicted |
| 14 | `notes.md` committed: deviations, unverified items (§5), adversarial self-review |
| 15 | Assertion probes promoted to committed tests (§8), not left only in `probes/` |
| 16 | `git rm -r docs/plans/issue-37-query-explain/` — this plan directory is removed in this PR **after** review |

---

## Appendix — probe inventory (`probes/`, beside this file)

| File | What it proves |
| ---- | -------------- |
| `probes/sdk-explain.mjs` | P1–P8 / P5b: SDK runtime surface, VectorQuery d.ts gap, gcloud Explain\* exports, emulator `No explain results`, explainStream docs-without-metrics |
| `plan-review.md` | Pre-handoff adversarial review that drove D9 / B2 / S1–S6 / M1–M3 (historical; dies with the plan directory) |
