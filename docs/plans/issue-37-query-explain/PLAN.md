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

---

## §0 How to use this plan

1. Read §1 (settled — do not re-litigate) and §4 (traps) **before** writing code.
2. §6 blocks are **specifications** (not a gated prototype). §7 is the ordered build sequence, §8
   the tests, §9 docs/ADR, §10 the gate, §11 done.
3. Every claim in §3 was produced by an executed probe on this baseline against
   `@google-cloud/firestore@8.6.0` / `firebase-admin@14.2.0` and the Firestore emulator. Probes are
   in `docs/plans/issue-37-query-explain/probes/` — re-run them if you doubt one. **Do not trust the
   issue body over §3.**
4. **No prototype was applied** to `src/`. Blast radius is greppable (one terminal on
   `FirestoreQueryBuilderBase`, one on `VectorQueryBuilder`, one exported type, docs/ADR). What that
   leaves unverified is in §5.
5. **Follow the `plan-execution` skill** — write `notes.md` as you go, mutation-check load-bearing
   tests (`git stash`), and pass an independent refute-first self-review before declaring ready for
   external review. Commit `notes.md` on this branch — that is the return channel.

---

## §1 Owner-approved decisions

| Id | Fork | Decision | Rejected alternative and why |
| -- | ---- | -------- | ---------------------------- |
| **D1** | `explainStream` in this PR? | **Ship `explain()` only.** Defer `explainStream` to a Core-only follow-up issue (§9.6). (owner F1; issue body “and later”; P4/P8 — VectorQuery has no `explainStream`; emulator stream yields docs without metrics) | Shipping both now: acceptance does not require streaming; Vector cannot match; emulator stream is a false-green for diagnostics (P8). |
| **D2** | Return shape | Return **`QueryExplainResult<R> = { metrics: ExplainMetrics; documents: R[] \| null }`**. Map snapshot docs through `toResult` (collection / group) or the vector `get()` mapper when `analyze: true`; `documents` is **`null`** for plan-only. (owner F2:B) | Raw SDK `ExplainResults<QuerySnapshot>` (F2:A): leaves callers holding Admin snapshots instead of ORM `R`, fighting every other terminal. Metrics-only API: drops the analyze path the SDK offers and the issue’s “plans/statistics” pairing with optional execution. |
| **D3** | `AggregateQuery.explain`? | **Out of scope** — defer. (owner F3; not in acceptance) | Wrapping aggregate explain now: expands surface past “Core and vector” document queries; AggregateQuery has no `explainStream` either (P5). Escape hatch remains `query.aggregate(…).explain()` on the raw SDK. |
| **D4** | Emulator / CI testing | **Option A:** unit mocks own the success path; thin emulator integration asserts `explain()` throws `No explain results` (documents the limit); ADR + Starlight note that **real metrics require production Firestore**. (owner A; P6/P7) | Production CI smoke (C): needs credentials/cost; repo CI is emulator-only. Skipping the emulator assertion (B): easier to forget the caveat in docs. Soft-wrapping `No explain results` into a special ORM error: masks SDK/emulator behavior that production will not hit. |
| **D5** | Placement / inheritance | `explain()` on **`FirestoreQueryBuilderBase`** so collection + collection-group inherit (same as `get`/`stream`). **`VectorQueryBuilder.explain()`** after `findNearest()` only. Export **`QueryExplainResult`** from `src/index.ts` (and keep it available from the query module). Do **not** re-export SDK `ExplainOptions` / `ExplainMetrics` — consumers import those from `firebase-admin/firestore` if they need the names. (derived) | Only on `FirestoreQueryBuilder`: drops group explain. Re-exporting SDK types: peer leak the package has avoided for `DocumentSnapshot` / `QuerySnapshot`. |
| **D6** | Peer / missing `explain` | Capability-check **`typeof query.explain === 'function'`** (and the same on the vector query object) before calling; throw a plain local `Error` naming `@google-cloud/firestore` explain support (Query Profile since **7.4**; VectorQuery profiling since **7.8**). Do **not** bump the `firebase-admin` peer range. (derived, P1 + changelog; mirrors ADR-0022 / `assertVectorSearchSupported` style, but typeof-only — no object-form probe) | Silent `query.explain is not a function` on old admin-12 + firestore `<7.4`: bad DX. Raising peer to admin `^13`: punches admin-12 consumers who already resolved a new enough transitive firestore. |
| **D7** | Errors / `parseFirestoreError` | Wrap the SDK call in `try/catch` → `parseFirestoreError` (same as `get()`). Local guards (missing `explain`, vector-before-`findNearest`) throw plain `Error` **outside** the try. Do **not** teach `ErrorParser` a mapping for `"No explain results"`. (derived, D4; ErrorParser already rethrows plain `Error` instances) | Special-casing the emulator message: couples the ORM to an SDK string that is not a gRPC code. |
| **D8** | `null` vs `[]` for documents | **`documents: null`** iff the SDK snapshot is `null` (plan-only / not executed). **`documents: []`** iff analyze ran and matched zero docs. Never coerce empty → null or null → []. (derived, D2; T1) | Collapsing them: callers cannot tell “did not execute” from “executed, empty.” |

Do not re-litigate §1. Deviations belong in `notes.md` with rationale.

---

## §2 Scope

### In scope

| Area | Change |
| ---- | ------ |
| `FirestoreQueryBuilderBase` | Add `explain(options?: ExplainOptions): Promise<QueryExplainResult<R>>`; capability check; map via `toResult` |
| `QueryExplainResult<R>` type | Exported from `QueryBuilder.ts` + `src/index.ts` |
| `VectorQueryBuilder` | Widen local vector-query type with `explain`; add `explain()` after `findNearest`; map docs like `get()` |
| Unit tests | Mocked success path + guards (§8.1) |
| Integration tests | Emulator “No explain results” on collection, group, and vector (§8.2) |
| Type tests | Return shape / projection / vector distance field (§8.3) |
| Docs + ADR | Capability matrix move; queries / query-builder / vector-search; ADR-0031; ADR-0017 amendment; living-index footers |
| Follow-up issue | `explainStream` Core-only (§9.6) |

### Explicitly **out** of scope

- `explainStream()` on Core or vector (D1) — follow-up issue.
- `AggregateQuery.explain` (D3).
- Re-exporting `ExplainOptions` / `ExplainMetrics` / `PlanSummary` / `ExecutionStats` (D5).
- Teaching `ErrorParser` / express status maps about explain (D7) — no new error class.
- Changing `getUnderlyingQuery()` visibility or documenting it as the explain escape hatch (it stays
  `@internal`).
- Peer dependency range bump (D6).
- Production Firestore CI smoke (D4) — optional maintainer-local; §5.
- README / `npm-readme.md` pitch changes (grepped: no Query Explain / stream marketing to update).
- Frozen `website/src/content/docs/2.0/**` archive.
- BulkWriter (#38), listener metadata (#39), distinct (#40), Pipelines (#41).

### Scope correction — where the issue is stale / incomplete

- Issue cites `docs/development/v3-release-review.md` — **not in the tree** (maintainer-local
  `reviews/` per ADR-0017). Authoritative committed sources: issue #37, ADR-0017, scope matrix.
- Issue says “returning the SDK diagnostic structure … without pretending it is an ORM document
  result.” Owner **F2:B** settles the documents half as ORM-mapped `R[] | null` while metrics stay
  the SDK `ExplainMetrics` object — not a raw `QuerySnapshot` return. Do not implement F2:A.
- Issue title includes `explainStream`; body defers it (“and later”); owner **F1** confirms deferral.
- Issue does not name collection-group inheritance, the emulator `No explain results` failure mode,
  the VectorQuery **`.d.ts` omission**, or the admin-12 / firestore `<7.4` capability gap — all
  required by the current tree / probes (§3).

---

## §3 Verified facts

Probes run on baseline `746bb7f` via:

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
firebase emulators:exec --project demo-firestoreorm-test --only firestore \
  "node docs/plans/issue-37-query-explain/probes/sdk-explain.mjs"
```

### 3.1 SDK surface — `probes/sdk-explain.mjs` (env + vector/aggregate surface)

| Id | Expression / condition | Observed | Note |
| -- | ---------------------- | -------- | ---- |
| P1 | `@google-cloud/firestore` version | `8.6.0` | bundled under `firebase-admin@14.2.0` |
| P2 | `typeof Query#explain` / `explainStream` | `function` / `function` | both on Core `Query` |
| P3 | `typeof VectorQuery#explain` / `explainStream` | `function` / `undefined` | runtime explain exists |
| P4 | `firestore.d.ts` `VectorQuery` block contains `explain(` | **false** | **local type widen required** (same pattern as today’s `FirestoreVectorQuery`) |
| P5 | `typeof AggregateQuery#explain` / `explainStream` | `function` / `undefined` | types include explain; no stream |
| P5b | `ExplainOptions` / `ExplainMetrics` exported from d.ts | true / true | import as `import type` from `firebase-admin/firestore` |

Upstream changelog (read, not in probe file): Explain types landed in **`@google-cloud/firestore@7.4.0`**
(“Query Profile”); VectorQuery profiling in **7.8.0**. `firebase-admin@12` can still resolve firestore
`<7.4` — hence D6.

### 3.2 Emulator behavior — same probe

| Id | Expression / condition | Observed | Note |
| -- | ---------------------- | -------- | ---- |
| P6 | `Query.explain()` / `{analyze:true}` / `{analyze:false}` | all throw `Error: No explain results` | SDK throws when response lacks `explainMetrics` |
| P7 | `VectorQuery.explain()` plan + analyze | same `No explain results` | |
| P7b | `AggregateQuery.explain()` plan + analyze | same `No explain results` | out of scope (D3) but confirms emulator gap |
| P8 | `Query.explainStream({analyze:true})` | resolves; **2 doc chunks, 0 metrics chunks** | why D1 must not treat emulator stream as proof of diagnostics |

### 3.3 Existing ORM terminals (read, cited)

| Id | Fact | Cite |
| -- | ---- | ---- |
| N1 | All document terminals materialize rows via abstract `toResult` | `QueryBuilder.ts:359`, collection `1485`, group `CollectionGroup.ts:182` |
| N2 | `get()` maps `snapshot.docs` through `toResult` + `parseFirestoreError` | `QueryBuilder.ts:1439–1444` |
| N3 | `stream()` rejects `hasLimitToLast` locally; `get()` does not | `1300–1308` vs `1439` |
| N4 | Vector `get()` requires `findNearest`; maps `{...data, id}` inline; `parseFirestoreError` | `VectorQueryBuilder.ts:191–204` |
| N5 | Vector already uses a minimal local `FirestoreVectorQuery` type (admin does not re-export VectorQuery cleanly) | `17–21` |
| N6 | `ErrorParser` rethrows plain `Error` instances unchanged | `ErrorParser.ts:72–73` |
| N7 | Integration gate owns `QueryBuilder.ts` + `src/vector/**` | `scripts/check-coverage-gates.mjs` |
| N8 | Living-index footers currently say remaining deferrals `(#37–#41)` | ADR-0023/24/25/26/27/29/30 + ADR-0017 amendment for #36 |

### 3.4 Authoritative site enumeration (`main` @ `746bb7f`)

| File | Lines / what changes |
| ---- | -------------------- |
| `src/core/QueryBuilder.ts` | Add `QueryExplainResult` export (~near other exported types); add `explain()` on `FirestoreQueryBuilderBase` near `get()` (~1439) |
| `src/core/CollectionGroup.ts` | **No method body** — inherits from base; `toResult` already overlays path identity (`182`) |
| `src/vector/VectorQueryBuilder.ts` | Widen `FirestoreVectorQuery` with `explain`; add `explain()` beside `get()` (~191) |
| `src/index.ts` | Export type `QueryExplainResult` alongside `PaginatedResult` / aggregation types (~15–23) |
| `src/tests/unit/packageExports.unit.test.ts` | Assert `QueryExplainResult` is a type-only export if the suite checks type exports; otherwise rely on `test:types` + build |
| Docs / ADR | §9 |

**Deliberately NOT changed** (justify in your notes if you touch them):

- `src/core/ErrorParser.ts` / `src/express/index.ts` — no new error class (D7).
- `getUnderlyingQuery` / `getQueryRef` — stay `@internal`; explain is first-class (D5).
- `stream()` / `paginate` / `limitToLast` guards — explain behaves like `get`, not `stream` (N3).
- Aggregate terminals (`count` / `sum` / `average` / `aggregate`) — D3.
- `README.md` / `npm-readme.md` — grepped unaffected.
- `website/src/content/docs/2.0/**` — frozen archive.

### 3.5 Baseline suite counts (executed on this baseline, clean tree)

| Suite | Suites / tests |
| ----- | -------------- |
| Unit (`npm run test:unit`) | **30 / 370** |
| Integration (`npm run test:integration:emulator`) | **30 / 452** |

After the change both must go **up** (new unit file and/or cases + new integration cases; type tests do not appear in these counts).

---

## §4 Traps

Ordered by how badly a reasonable implementer gets them wrong.

### T1 — Collapsing `documents: null` and `documents: []` (D8, P6 semantics)

Plan-only (`analyze` false/omitted) → SDK `snapshot === null` → ORM **`documents: null`**. Analyze with
zero matches → SDK empty snapshot → ORM **`documents: []`**. Coercing either way silently lies about
whether the query executed (and billed). Tests U-2 / U-3 lock both sides.

### T2 — Returning raw `ExplainResults` / `QuerySnapshot` despite D2 (issue wording temptation)

The issue’s “SDK diagnostic structure” phrase tempts F2:A. Owner chose **F2:B**. Metrics stay SDK
`ExplainMetrics`; documents are ORM `R[]`. Returning `ExplainResults` fails acceptance of the owner
decision and breaks projection / collection-group identity (`path` / `parentPath` via `toResult`).

### T3 — Forgetting collection-group `toResult` (N1)

Implementing explain only on `FirestoreQueryBuilder` (or mapping with `{...data, id}` only) drops
group path identity. Put the method on **`FirestoreQueryBuilderBase`** and always use `this.toResult`.

### T4 — Vector `.d.ts` gap: calling `vq.explain` without widening (P3/P4)

`VectorQuery.explain` exists at runtime but is **absent** from `firestore.d.ts` on 8.6.0. Without
widening the local `FirestoreVectorQuery` type, `test:types` / the package build will fail (or
force unsafe casts at the wrong layer). Widen the local type; do not `as any` the call site alone.

### T5 — Shipping `explainStream` “while you’re there” (D1, P8)

Emulator stream returns documents **without** metrics — a false sense of diagnostic coverage. Vector
has no stream API. Do not add `explainStream` in this PR.

### T6 — Treating emulator success as the integration happy path (D4, P6)

`explain()` **always** throws on the emulator today. An integration test that expects metrics will
be red forever. Happy path = **unit mocks**. Integration = assert the known emulator error (and
document production in ADR/Starlight).

### T7 — Wrapping `"No explain results"` in `ErrorParser` (D7)

It is a plain SDK `Error` when metrics are missing (emulator). Parser already rethrows `Error` (N6).
Adding a dedicated class couples us to a string and invents an HTTP mapping for a non-production
path.

### T8 — Missing capability check on old firestore (D6)

admin-12 can resolve firestore `<7.4` where `explain` is absent. A bare call becomes
`explain is not a function`. Guard with `typeof … === 'function'` and a deterministic message
**outside** `parseFirestoreError`.

### T9 — Calling vector `explain()` before `findNearest()` (N4)

Mirror `get()`: throw a clear local Error requiring `findNearest()` first. Do not fall through to
the core builder’s query (that would explain the **prefilter**, not the vector query — silent wrong
diagnostics).

### T10 — Living-index / ADR-0017 partial sweep (§9)

This is an ADR-0017 deferral. Missing the amendment blockquote, any footer still saying `#37–#41`,
or leaving the capability matrix row under Deferred will fail review the same way earlier parity PRs
did. Grep `(#37–#41)` after edits; remaining range must be `(#38–#41)`.

### T11 — Starlight `:::` fence leak

`website/**/*.md` is prettier-exempt. A `:::note` whose closing `:::` lands on a content line ships
literal `:::` to GitHub Pages. After `docs:build`, grep the built HTML for leaked `:::`.

---

## §5 Could not verify / scope bounds

- **Production metrics shape** — never executed against a real Firestore project in this planning
  session. Unit tests mock `ExplainMetrics` / `PlanSummary` / `ExecutionStats` from the published
  d.ts. §10 does **not** require a production smoke; maintainers may run one offline.
- **Peer matrix legs** — local probes used admin 14 + firestore 8.6.0 only. CI’s
  `FIRESTORE_ORM_ADMIN_VERSION` / `FIRESTORE_ORM_FIRESTORE_VERSION` fan-out still owns admin 12/13/14
  and the 7.9/7.10 firestore-floor job (vector). Explain’s typeof guard should be fine on 7.4+, but
  that exact floor was **not** installed locally.
- **Unprototyped** — no `src/` edit was applied. Gate impact is reasoned: new methods are additive;
  existing tests should stay green. If `test:types` surprises on `ExplainOptions` resolution under
  an older `@types` path, fix by importing types only from `firebase-admin/firestore`.
- **Carried over, explicitly deferred** — `explainStream` (D1); `AggregateQuery.explain` (D3);
  opaque-paginate token evolution; Enterprise Pipeline explain options (`mode` / `outputFormat` on
  the Pipeline API — unrelated Core surface).

---

## §6 API specification

### 6.1 `src/core/QueryBuilder.ts` — type + base method

Add near the other exported query types (alongside `PaginatedResult` / aggregation types):

```ts
import type { ExplainMetrics, ExplainOptions } from 'firebase-admin/firestore';

/**
 * Result of {@link FirestoreQueryBuilderBase.explain}.
 *
 * `metrics` is the Admin SDK {@link ExplainMetrics} object (plan summary, and execution stats when
 * the query was analyzed). `documents` is the ORM-mapped page of results when `analyze: true`, or
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

On `FirestoreQueryBuilderBase`, beside `get()`:

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
    const explainFn = (this.query as { explain?: (opts?: ExplainOptions) => Promise<{
      metrics: ExplainMetrics;
      snapshot: { docs: Array<import('firebase-admin/firestore').QueryDocumentSnapshot> } | null;
    }> }).explain;
    if (typeof explainFn !== 'function') {
      throw new Error(
        'explain() is not available: the installed Firestore SDK does not expose Query.explain(). ' +
          'Query Explain requires @google-cloud/firestore >= 7.4 (firebase-admin 12 only when the ' +
          'resolved @google-cloud/firestore is new enough; firebase-admin >= 13 typically bundles it). ' +
          'Upgrade firebase-admin (or @google-cloud/firestore).',
      );
    }

    try {
      const results = await explainFn.call(this.query, options);
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

JSDoc must mention emulator limitation (T6) and `null` vs `[]` (T1). Prefer calling
`this.query.explain(options)` once types allow; the typeof cast is for the capability guard (D6).

### 6.2 `src/vector/VectorQueryBuilder.ts` — widen + method

Widen the local type:

```ts
type FirestoreVectorQuery<T> = {
  get(): Promise<{ docs: Array<QueryDocumentSnapshot<T>> }>;
  explain(options?: ExplainOptions): Promise<{
    metrics: ExplainMetrics;
    snapshot: { docs: Array<QueryDocumentSnapshot<T>> } | null;
  }>;
};
```

(Import `ExplainOptions` / `ExplainMetrics` as types from `firebase-admin/firestore`.)

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
   */
  async explain(options?: ExplainOptions): Promise<QueryExplainResult<R>> {
    if (!this.vectorQuery) {
      throw new Error('explain() on a vector query requires findNearest() to be called first.');
    }
    const explainFn = this.vectorQuery.explain;
    if (typeof explainFn !== 'function') {
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

### 6.3 `src/index.ts`

```ts
export type { PaginatedResult, QueryFilterFactory, QueryExplainResult } from './core/QueryBuilder.js';
```

(Merge into the existing `export type { PaginatedResult, QueryFilterFactory }` line.)

### 6.4 Size

~3 source files (`QueryBuilder.ts`, `VectorQueryBuilder.ts`, `index.ts`), roughly **+80–120** LOC
runtime/types; plus unit + integration + type tests; ADR-0031; Starlight edits; living-index
footers. **No** intentional runtime behavior change to existing terminals.

---

## §7 Implementation sequence and anti-instructions

1. Check out `cursor/issue-37-query-explain` — it already exists and carries this plan. If `main`
   has moved past `746bb7f`, rebase onto it and **re-verify the §3 line numbers before editing**.
2. Add `QueryExplainResult` + `explain()` on `FirestoreQueryBuilderBase` (§6.1). **Why first:**
   vector and docs depend on the type export.
3. Export `QueryExplainResult` from `src/index.ts` (§6.3).
4. Vector widen + `explain()` (§6.2). **Why after core:** imports `QueryExplainResult`.
5. Tests (§8) — **verify each new test fails on the unfixed baseline** (`git stash` the
   implementation, or write tests first). Mutation-check U-2/U-3/U-5/I-1 at minimum.
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
- **Do not** claim emulator metrics work in docs (T6).
- **Do not** edit `website/src/content/docs/2.0/**` or hand-edit `CHANGELOG.md`.
- **Do not** edit generated agent config (`.cursor/`, `.claude/`, `.agents/`, root `AGENTS.md`).
- **Do not** commit unless asked; leave the tree clean and report the subject line (§10).

---

## §8 Test specification

### 8.1 Unit — `src/tests/unit/query-explain.unit.test.ts` (new)

Gate: **unit** coverage does **not** own `QueryBuilder.ts` / `src/vector/**` (integration gate does
— N7). Still write unit tests: they are the **only** success-path proof (D4). They exercise the
methods with mocked `query.explain` / vector `explain` spies; they do not need to move gate
ownership.

Strategy: construct builders the same way existing query-builder unit tests do (mock `Query` with
`jest.fn` explain). JSDoc header: strategy + verification points.

| Id | Asserts | Guards |
| -- | ------- | ------ |
| U-1 | Forwards `options` to SDK `explain` (including `{ analyze: true }` and `undefined`) | D2 wiring |
| U-2 | Plan-only mock (`snapshot: null`) → `{ metrics, documents: null }` | T1 |
| U-3 | Analyze mock with 0 docs → `{ documents: [] }` (not null) | T1 |
| U-4 | Analyze mock with docs → `documents` mapped via `toResult` (collection: `{…data, id}`; optional group harness if cheap) | T2/T3 |
| U-5 | SDK throw → `parseFirestoreError` path (plain Error message preserved for `No explain results`) | D7 |
| U-6 | Missing `query.explain` → local capability Error (message mentions upgrade) | T8 |
| U-7 | Vector: before `findNearest` → throws /requires findNearest/ | T9 |
| U-8 | Vector: after `findNearest`, explain maps docs like `get` and returns metrics | P3/D2 |
| U-9 | Vector: `explain` missing on vector object → capability Error | T8/T4 |

Also extend `src/tests/unit/vectorQueryBuilder.unit.test.ts` **or** keep vector cases in the new
file — one place is enough; prefer the new file for discoverability, and add a single cross-link
comment in the existing vector unit file only if needed.

### 8.2 Integration — `src/tests/integration/query-explain.integration.test.ts` (new)

Gate: **integration** (`test:coverage:gate:integration`) — exercises `QueryBuilder` / vector paths.

| Id | Asserts | Guards |
| -- | ------- | ------ |
| I-1 | `userRepo.query().explain()` rejects with `/No explain results/` | T6/D4 |
| I-2 | same with `{ analyze: true }` | T6 |
| I-3 | collection-group `query().explain()` same rejection | T3/T6 |
| I-4 | vector `findNearest(…).explain()` same rejection (use existing vector integration patterns / harness) | T6/P7 |

Do **not** assert on `indexesUsed` / `executionStats` against the emulator.

### 8.3 Type — `src/tests/types/query-explain.type-test.ts` (new)

| Id | Asserts | Guards |
| -- | ------- | ------ |
| T-1 | `explain()` return type is `QueryExplainResult<FirestoreDocument<…>>` | D2 |
| T-2 | after `select('name')`, `documents` elements are projected (`@ts-expect-error` on removed field) | T2 |
| T-3 | vector after `findNearest` + optional `distanceResultField`: `documents` carries distance typing when analyze shape is non-null (narrow carefully — may need a user-defined guard in the test) | D2/N4 |
| T-4 | `QueryExplainResult` is importable from package root types | §6.3 |

### 8.4 Coverage gates

| Changed path | Gate |
| ------------ | ---- |
| `src/core/QueryBuilder.ts` | `test:coverage:gate:integration` |
| `src/vector/VectorQueryBuilder.ts` | `test:coverage:gate:integration` |
| `src/index.ts` | `test:coverage:gate:unit` (export surface) |
| Type-only / test files | neither coverage gate |

Watch the QueryBuilder + vector integration thresholds — new branches in `explain()` must be hit by
I-\* and/or unit tests that still contribute to integration coverage when those files are loaded.
Prefer ensuring I-1…I-4 and unit tests that import the real classes cover both the capability-miss
path (unit) and the emulator throw path (integration). If the capability-miss branch is only hit in
unit tests, confirm whether integration coverage still meets the path threshold; if not, add a
focused unit test file that the integration suite does **not** need — and if the gate still fails,
add an integration-accessible mock is the wrong fix; instead call explain through a builder whose
underlying query is replaced only in unit tests, and accept that the typeof-miss branch may be
unit-only **if** the gate’s line threshold still passes (measure; do not guess — N7).

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
   (P4); explainStream deferred; AggregateQuery deferred.
2. **Decision** — D1–D8 in ADR voice (explain only; `QueryExplainResult`; base + vector; capability
   check; testing strategy A; no ErrorParser special-case).
3. **Consequences** — capability matrix move; production required for real metrics; follow-up for
   `explainStream`; remaining deferrals `#38–#41`.
4. **Alternatives considered** — F2:A raw ExplainResults; shipping explainStream; wrapping
   AggregateQuery.explain; production CI smoke.
5. **References** — issue #37, ADR-0017, Firebase Query Explain docs, probe summary.
6. **Living-index footer** — remaining `(#38–#41)` + “have since shipped” list including this ADR.

Add the row to `docs/adr/README.md`.

### 9.3 ADR bookkeeping edits

| File | Edit |
| ---- | ---- |
| `docs/adr/0017-v3-core-operations-scope.md` | Append `> Amendment (3.0.0, issue #37): …` after the #36 amendment — **do not rewrite** earlier amendments. State explain ships; remaining `#38–#41`. Add References bullet for #37 → new ADR. |
| Every feature ADR whose footer still says `(#37–#41)` | Decrement to `(#38–#41)` and note #37 / new ADR shipped. **Grep** `\( #37–#41\)` / `(#37–#41)` — do not trust a fixed file list. On this baseline at least: `0023`, `0024`, `0025`, `0026`, `0027`, `0029`, `0030`. |
| `docs/adr/README.md` | New index row |

### 9.4 Website — pages

| Page | Change |
| ---- | ------ |
| `website/src/content/docs/reference/scope-and-capabilities.md` | Move “Query Explain / `explainStream`” **out of Deferred**. Supported row for `explain()` (Core + vector); note `explainStream` still deferred (link follow-up issue once opened). Emulator caveat in Notes. |
| `website/src/content/docs/reference/query-builder.md` | Document `explain(options?): Promise<QueryExplainResult<R>>` under Terminal reads; `null` vs `[]`; emulator warning. |
| `website/src/content/docs/guides/working-with-data/queries.md` | Short section + example; list `explain()` among terminals; emulator / production note. |
| `website/src/content/docs/guides/advanced/vector-search.md` | Document `explain()` after `findNearest`; still no `stream` / `onSnapshot` / `orderBy`; no `explainStream`. |
| `website/src/content/docs/guides/migration-v2-to-v3.md` | One bullet under new 3.0.0 query features if that section lists parity landings — only if a natural anchor exists; do not invent a large migration section. |

`website/**/*.md` is prettier-exempt — match style by hand. If you add an aside, run
`npm run docs:build` and grep the built HTML for a leaked literal `:::`.

### 9.5 READMEs

Grepped both `README.md` and `npm-readme.md` for explain / capability pitch — **neither affected**.
Say so in the PR body. Do not run readme-sync for this change.

### 9.6 Follow-up issue to open

**Title:** `Query explainStream() for Core queries`  
**Labels:** `enhancement`, `parity`, `v3.x`  
**Body must note:** deferred from #37 (D1); VectorQuery has no SDK `explainStream` (P3); emulator
stream currently omits metrics (P8); acceptance for #37 is satisfied by `explain()` alone.  
Optionally mention AggregateQuery.explain as a separate future item (D3) — either in this issue’s
“Out of scope” or a second lightweight issue; do not block #37’s close on it.

After opening, link it from the scope matrix Deferred row for `explainStream` and from ADR-0031.

---

## §10 Gate and commit

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
npm run test:types && npm run lint && npm run check:format && npm run test:unit && npm run test:integration:emulator && npm run test:unit:coverage && npm run test:coverage:gate:unit && npm run test:integration:coverage && npm run test:coverage:gate:integration && npm run build && npm run check:package && npm run check:consumer && npm run check:docs && npm run docs:build
```

Fourteen legs. Report failures with output — never claim a leg passed that you did not execute.

Baseline before your change: unit **30 suites / 370 tests**, integration **30 suites / 452 tests**.
Both suite counts and both test counts must **go up**. Watch integration coverage for
`QueryBuilder.ts` and `src/vector/**`.

Re-run the probe (still expect emulator failures — that is the point):

```bash
firebase emulators:exec --project demo-firestoreorm-test --only firestore \
  "node docs/plans/issue-37-query-explain/probes/sdk-explain.mjs"
```

After implementation, also re-check: `rg '(#37–#41)' docs/adr` → no hits; `rg '(#38–#41)' docs/adr`
→ footers updated; built docs HTML has no leaked `:::`.

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
| 1 | D1–D8 honored; nothing in §7 anti-instructions violated |
| 2 | `explain()` on `FirestoreQueryBuilderBase` + `VectorQueryBuilder`; `QueryExplainResult` exported |
| 3 | Collection-group inherits explain via base (`toResult` path identity) |
| 4 | Capability checks for missing SDK `explain` (Core + vector) |
| 5 | Unit tests U-1…U-9 (or equivalent coverage) fail on unfixed baseline; mutation-checked |
| 6 | Integration I-1…I-4 assert emulator `No explain results` |
| 7 | Type tests T-1…T-4 green under `test:types` |
| 8 | New ADR claimed; ADR-0017 amendment; living-index footers → `(#38–#41)`; README index row |
| 9 | Scope matrix + query-builder + queries + vector-search updated; emulator caveat documented |
| 10 | `explainStream` follow-up issue opened and linked |
| 11 | READMEs declared unaffected in PR body |
| 12 | Full gate green (§10) with real output; suite counts up as predicted |
| 13 | `notes.md` committed: deviations, unverified items (§5), adversarial self-review |
| 14 | Assertion probes promoted to committed tests (§8), not left only in `probes/` |
| 15 | `git rm -r docs/plans/issue-37-query-explain/` — this plan directory is removed in this PR **after** review |

---

## Appendix — probe inventory (`probes/`, beside this file)

| File | What it proves |
| ---- | -------------- |
| `probes/sdk-explain.mjs` | P1–P8: SDK surface, VectorQuery d.ts gap, emulator `No explain results`, explainStream docs-without-metrics |
