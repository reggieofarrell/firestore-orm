# Issue #36 — Typed lower-level query bounds + `limitToLast()`

**Implementer:** agent (plan-execution) · **Reviewer:** maintainer · **Baseline:** `main` @
`387db6f820406f615629fabec937fde95ede0fcb` (`387db6f chore: enhance implementation planning and
execution documentation`) · **Branch:** `cursor/issue-36-typed-query-bounds-3dc6` — already created
and pushed with this plan on it; check it out, do not cut a new one

**Issue:** [#36](https://github.com/reggieofarrell/firestore-orm/issues/36) — labels `enhancement`,
`parity`, `v3.x`. This issue is in ADR-0017's `#36–#41` parity / v3.x deferral set — §9 ADR
bookkeeping (amendment + living-index footers + capability matrix move) **applies**.

> **Acceptance (verbatim from the issue):** "bounded ranges, inclusive cursors, and reverse
> pagination available and guarded."

Issue body (for context, not authority — §3 is authoritative):

> Expose typed lower-level cursor bounds (`startAt`/`startAfter`/`endAt`/`endBefore`, `offset`,
> `limitToLast`) alongside the existing opaque pagination helper. `limitToLast()` must require
> `orderBy()` and be rejected by native `stream()`. Consider cursor tokens encoding ordered field
> values (not only a document path).

---

## §0 How to use this plan

1. Read §1 (settled — do not re-litigate) and §4 (traps) **before** writing code.
2. §6 blocks are **specifications** (not a gated prototype). §7 is the ordered build sequence, §8
   the tests, §9 docs/ADR, §10 the gate, §11 done.
3. Every claim in §3 was produced by an executed probe on this baseline against
   `@google-cloud/firestore@8.6.0` / `firebase-admin@14.2.0` and the Firestore emulator. Probes are
   in `docs/plans/issue-36-typed-query-bounds/probes/` — re-run them if you doubt one. **Do not trust
   the issue body over §3.**
4. **No prototype was applied** to `src/`. Blast radius is greppable (new methods on
   `FirestoreQueryBuilderBase` + two `select()` flag copies + `stream`/`paginate`/`limit` guards).
   What that leaves unverified is in §5.
5. **Follow the `plan-execution` skill** — write `notes.md` as you go, mutation-check load-bearing
   tests (`git stash`), and pass an independent refute-first self-review before declaring ready for
   external review. Commit `notes.md` on this branch — that is the return channel.

---

## §1 Owner-approved decisions

| Id | Fork | Decision | Rejected alternative and why |
| -- | ---- | -------- | ---------------------------- |
| **D1** | Opaque `paginate` cursor token format vs encoding ordered field values | **Keep path-only base64url tokens for `paginate` / `paginateWithCount`.** Typed bounds take `DocumentSnapshot` or ordered field values as **direct method arguments**. (derived from issue “alongside” + ADR-0001 + P18/N1) | Evolving tokens to carry field values: breaks projected `paginate` (cursor re-fetches full snapshot by path — composite-filter integration test relies on this), weakens the path membership binding that is the only forged-cursor check, and conflates two APIs the issue asks to keep side by side. |
| **D2** | Bound method shape | Ship **`startAt` / `startAfter` / `endAt` / `endBefore`** on `FirestoreQueryBuilderBase` with SDK-matching overloads: `(snapshot: DocumentSnapshot): this` and `(...fieldValues: unknown[]): this`. Field values are `unknown` (stored-shape rule, ADR-0018 / `where`). (issue method list + P1–P7) | Typing field values from prior `orderBy` generics: requires tracking orderBy field types in the builder type parameter — large, unrequested generic change. Snapshot-only API: rejects the field-value form needed for range bounds without a prior read (P7). Field-values-only: rejects the snapshot form that carries full orderBy arity for free (P5/P6). |
| **D3** | Public `offset(n)` clause | Ship **`offset(n: number): this`** on the base (mutates `this.query`). Keep `offsetPaginate` unchanged. Validate **non-negative finite integer** (0 allowed — P13a; negatives reject — P13b). (issue lists `offset`) | Only documenting the escape hatch: fails acceptance. Replacing `offsetPaginate`: out of scope and would break existing callers. |
| **D4** | `limitToLast` guards | **`limitToLast(n)`** requires `hasOrderBy` (local `Error`, same voice as `paginate`). Sets `hasLimitToLast = true`. **`stream()`** throws locally when `hasLimitToLast`. Non-negative finite integer for `n` (0 → empty — P28a). (issue + P9/P10) | Relying only on SDK errors: issue explicitly requires guarded `stream` rejection; local `orderBy` check matches `paginate` and fails before an RPC. Also rejecting `onSnapshot`: **wrong** — P20 shows listeners work with `limitToLast`. |
| **D5** | `limit` ↔ `limitToLast` last-wins | When `limit()` is called after `limitToLast()`, clear `hasLimitToLast` (P30 — SDK last-wins). When `limitToLast()` is called after `limit()`, set the flag (P29). (derived, P29/P30) | Leaving the flag sticky after `limit()`: `stream()` would falsely reject a query that is no longer `limitToLast`. |
| **D6** | `paginate` / `offsetPaginate` + `limitToLast` | **Reject** both terminals locally if `hasLimitToLast` — `paginate` applies `.limit(pageSize+1)` which would silently override `limitToLast` (P30) and produce forward pages. Document: reverse pagination = `orderBy` + bounds + `limitToLast` + `get()`; forward opaque paging stays `paginate`. (derived) | Letting them compose: silent wrong results (T2). Inventing a reverse opaque helper / `prevCursor`: not in the issue; defer. |
| **D7** | Snapshot membership checks on typed bounds | **Do not** add `assertCursorBelongsToSource` to `startAt`/`startAfter`/… . Callers already hold a `DocumentSnapshot` (no existence-oracle). Mirror SDK errors (collection foreign throws — F7; group foreign → empty — F2). Opaque `paginate` binding **unchanged**. (derived, F2/F3/F7) | Applying paginate’s binding to every snapshot bound: extra I/O policy the issue did not ask for; blocks legitimate same-group cross-parent cursors that F1 shows the SDK accepts. |
| **D8** | Placement / vector / exports | Methods live on **`FirestoreQueryBuilderBase`** so collection + group inherit (ADR-0024). **`VectorQueryBuilder` unchanged** (already rejects `orderBy`, which `limitToLast` requires). No new `src/index.ts` exports (methods are on existing classes). Import `DocumentSnapshot` from `firebase-admin/firestore`. (derived) | Wrapping bounds on vector: nonsense without `orderBy`. Re-exporting snapshot types: unnecessary peer leak. |
| **D9** | Error / `parseFirestoreError` | Local guards throw plain `Error` **outside** `parseFirestoreError` (same as `paginate`’s orderBy check and `select`+`onSnapshot`). Do **not** teach `ErrorParser` new mappings for cursor/`limitToLast` SDK messages. (derived, ADR-0023/0027 stance) | Normalizing gRPC `INVALID_ARGUMENT` for negative offset: would broaden parser scope for authoring mistakes. |

Do not re-litigate §1. Deviations belong in `notes.md` with rationale.

---

## §2 Scope

### In scope

| Area | Change |
| ---- | ------ |
| `FirestoreQueryBuilderBase` | Add `startAt` / `startAfter` / `endAt` / `endBefore`, `offset`, `limitToLast`; `hasLimitToLast` flag; `limit()` clears flag; `stream` / `paginate` / `offsetPaginate` guards; `assertNonNegativeInt` helper (or equivalent) |
| `FirestoreQueryBuilder.select` | Copy `hasLimitToLast` onto the replacement builder |
| `FirestoreCollectionGroupQueryBuilder.select` | Same flag copy |
| Integration + unit + type tests | §8 |
| Docs | Starlight queries / query-builder / scope matrix / subcollections; ADR-0030; ADR-0017 amendment; living-index footers |
| Aggregate JSDoc | Line ~879 already claims `limitToLast`/cursors/offset apply — becomes true; no API change |

### Explicitly **out** of scope

- Changing opaque `paginate` / `encodeCursor` / `decodeCursor` token format (D1) — belongs to a future issue if ever.
- Reverse opaque pagination helper / `prevCursor` (D6).
- Typing cursor field values from `orderBy` generics (D2).
- `VectorQueryBuilder` bounds / `limitToLast` (D8).
- Membership checks on typed snapshot bounds (D7).
- Changing `limit(n)`’s lack of positive-int validation (pre-existing; only add flag clearing).
- Fixing unused `PaginatedResult` vs `paginate` return-type mismatch (pre-existing).
- `ErrorParser` / express status maps (no new error class).
- README / `npm-readme.md` pitch changes (grep: marketing “pagination” only — unaffected).
- Frozen `website/src/content/docs/2.0/**` archive.
- Query Explain (#37), BulkWriter (#38), listener metadata (#39), distinct (#40), Pipelines (#41).

### Scope correction — where the issue is stale / incomplete

- Issue cites `docs/development/v3-release-review.md` — **not in the tree** (maintainer-local
  `reviews/` per ADR-0017). Authoritative committed sources: issue #36, ADR-0017, scope matrix.
- Issue does not name `FirestoreQueryBuilderBase` / collection-group inheritance / `select()` flag
  copy / `paginate`+`limitToLast` interaction — all required by the current tree (see §3.4).
- Issue “consider cursor tokens encoding field values” is settled as **no** for the opaque helper
  (D1); field values are the typed-bounds argument form instead.
- ADR-0024’s claim that foreign `startAfter` “succeeds silently and returns the whole result set”
  is **stale on this emulator** for single-collection queries (F7 throws). Collection-group foreign
  snapshots now return **empty** (F2), not the whole set. Do not repeat the old claim; document
  current behavior.

---

## §3 Verified facts

Probes run on baseline `387db6f` via:

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
firebase emulators:exec --project demo-firestoreorm-test --only firestore \
  "node docs/plans/issue-36-typed-query-bounds/probes/sdk-cursor-bounds.mjs"
firebase emulators:exec --project demo-firestoreorm-test --only firestore \
  "node docs/plans/issue-36-typed-query-bounds/probes/sdk-foreign-cursor.mjs"
```

Seed for P\* cases: docs `a..e` with `score` 10..50, `orderBy('score','asc')` unless noted.

### 3.1 Inclusive / exclusive bounds & ranges — `probes/sdk-cursor-bounds.mjs`

| Id | Expression / condition | Observed | Note |
| -- | ---------------------- | -------- | ---- |
| P1 | `startAt(30)` | `['c','d','e']` | Inclusive |
| P2 | `startAfter(30)` | `['d','e']` | Exclusive |
| P3 | `endAt(30)` | `['a','b','c']` | Inclusive |
| P4 | `endBefore(30)` | `['a','b']` | Exclusive |
| P5 | `startAt`/`startAfter`(snapshot of `c`) | same as P1/P2 | Snapshot overload |
| P6 | `endAt`/`endBefore`(snapshot of `c`) | same as P3/P4 | Snapshot overload |
| P7 | `startAt(20).endAt(40)` | `['b','c','d']` | Bounded inclusive range — acceptance |
| P18 | `select('tag').orderBy('score').startAt(30)` | projected rows `c,d,e` | Field-value cursor OK with select |
| P19 | `select('tag').startAt(fullSnapshot)` | same | Full snapshot OK as bound on projected query |
| P26 | `orderBy(score).orderBy(tag).startAt(30,'x')` | starts at `c` | Multi-field values |
| P27 | `orderBy(documentId).startAt('c')` | `['c','d','e']` | Doc-id cursor string |
| P14 | multi-`orderBy` + **too few** `startAt` values | succeeds (prefix) | Do **not** add arity==orderBy.length local check |
| P15 | `startAt(30)` without `orderBy` | throws “Too many cursor values…” | Field values need orderBy |
| P16/F8 | `startAt(snapshot)` without `orderBy` | succeeds; implies **documentId** order | Snapshot-only exception — document in JSDoc |
| P25 | `startAt()` zero args | throws “requires at least 1 argument” | Local empty-args guard OK |

### 3.2 `limitToLast`, `offset`, stream, listeners, aggregates

| Id | Expression / condition | Observed | Note |
| -- | ---------------------- | -------- | ---- |
| P8 | `orderBy(score).limitToLast(2).get()` | `[{d,40},{e,50}]` | Last N, still ascending orderBy order |
| P9 | `limitToLast(2)` no orderBy | throws “require specifying at least one orderBy()” | Local guard should match voice |
| P10 | `stream()` after `limitToLast` | throws “cannot be streamed. Use Query.get()” | **Must** local-guard in ORM `stream()` |
| P11 | `stream()` after `startAfter` | works | Bounds alone OK to stream |
| P20 | `onSnapshot` after `limitToLast` | `['d','e']` | **Do not** reject listeners |
| P12 | `offset(2).limit(2)` | `['c','d']` | |
| P13a | `offset(0)` | first page | 0 must be legal |
| P13b | `offset(-1)` | gRPC 3 “offset is negative” | Local non-negative guard |
| P21 | `limitToLast(2).count()` | `{count:2}` | ADR-0027 claim confirmed |
| P22 | `startAt(20).endAt(40).count()` | `{count:3}` | |
| P23 | `endAt(40).limitToLast(2)` | `['c','d']` | Reverse page ending at bound — acceptance |
| P28a | `limitToLast(0)` | `[]` | Allow 0 |
| P28b | `limitToLast(-1)` | gRPC 3 “limit is negative” | Local non-negative guard |
| P29 | `limit(3).limitToLast(2)` | `['d','e']` | **Last wins** → limitToLast |
| P30 | `limitToLast(2).limit(3)` | `['a','b','c']` | **Last wins** → limit; clear flag (D5) |

### 3.3 Foreign cursors & DocumentReference — `probes/sdk-foreign-cursor.mjs`

| Id | Expression / condition | Observed | Note |
| -- | ---------------------- | -------- | ---- |
| F1 | group `startAfter`(same-group other parent) | succeeds | Cross-parent group cursors OK |
| F2 | group `startAfter`(foreign collection snap) | **empty** `{count:0}` | Silent empty — not whole set (ADR-0024 stale) |
| F3 | collection `startAfter`(sibling collection) | throws “not part of the query result set” | |
| F7 | collection `startAfter`(totally foreign) | plain `Error`, same message | |
| F4 | `startAfter(DocumentReference)` + `orderBy(score)` | **silent empty** | Field-value overload mistreats ref |
| F5 | `startAfter(DocumentReference)` + `orderBy(documentId)` | works (`a2`) | Ref meaningful only for doc-id order |
| F6 | `startAfter`(missing snapshot) | throws missing orderBy field | |

**N1 (read, not probe):** Opaque `paginate` cursor is `{ path }` → base64url (`QueryBuilder.ts:422–425`);
`decodeCursor` re-fetches and runs `assertCursorBelongsToSource` (`:435–464`). Projected pagination
depends on path re-fetch (see `repository-composite-filters.integration.test.ts` path-cursor notes).

**N2 (read):** `select()` returns a **new** builder and copies `hasOrderBy` / sets `hasSelect`
(`QueryBuilder.ts:1433–1434`, `CollectionGroup.ts:309–310`). Any new flag **must** be copied or it
silently drops after projection (T3).

**N3 (read):** `VectorQueryBuilder.orderBy()` throws; no `paginate`/`limit`/`offset` surface
(`VectorQueryBuilder.ts:218–226`).

### 3.4 Authoritative site enumeration (`main` @ `387db6f`)

| File | Lines / symbol | Role |
| ---- | -------------- | ---- |
| `src/core/QueryBuilder.ts` | `320` `FirestoreQueryBuilderBase` | **Add methods + `hasLimitToLast`** |
| `src/core/QueryBuilder.ts` | `322–325` `hasOrderBy` / `hasSelect` | Pattern for new flag |
| `src/core/QueryBuilder.ts` | `16–27` imports | Add `DocumentSnapshot` |
| `src/core/QueryBuilder.ts` | `471–475` `assertPositiveInt` | Sibling `assertNonNegativeInt` |
| `src/core/QueryBuilder.ts` | `552–558` `orderBy` | Sets `hasOrderBy` |
| `src/core/QueryBuilder.ts` | `582–585` `limit` | **Clear `hasLimitToLast` (D5)** |
| `src/core/QueryBuilder.ts` | `637–672` `paginate` | **Reject if `hasLimitToLast` (D6)** |
| `src/core/QueryBuilder.ts` | `692–725` `offsetPaginate` | **Reject if `hasLimitToLast` (D6)** |
| `src/core/QueryBuilder.ts` | `1089–1102` `stream` | **Reject if `hasLimitToLast` (D4)** |
| `src/core/QueryBuilder.ts` | `1127+` `onSnapshot` | Unchanged (P20) |
| `src/core/QueryBuilder.ts` | `1413–1436` `select` | **Copy `hasLimitToLast`** |
| `src/core/QueryBuilder.ts` | `1476–1480` `orderById` | Already sets `hasOrderBy` |
| `src/core/QueryBuilder.ts` | `879` aggregate JSDoc | Already lists limitToLast/cursors/offset |
| `src/core/CollectionGroup.ts` | `155+` group builder | Inherits base methods |
| `src/core/CollectionGroup.ts` | `260+` `orderByPath` | Sets `hasOrderBy` |
| `src/core/CollectionGroup.ts` | `303–310` `select` | **Copy `hasLimitToLast`** |
| `src/vector/VectorQueryBuilder.ts` | `218+` | **Deliberately unchanged** |
| `src/index.ts` | QueryBuilder exports | **No new exports** |
| `website/.../reference/query-builder.md` | `105–106` | Remove “no public startAt…”; document new methods |
| `website/.../guides/working-with-data/queries.md` | `42–43`, `314+` | Same |
| `website/.../guides/working-with-data/subcollections.md` | `106–107` | Same |
| `website/.../reference/scope-and-capabilities.md` | `29–30`, `50` | Move #36 row to Supported |
| `docs/adr/0017-…` | amendments + refs | New `#36` amendment |
| `docs/adr/0023`–`0027`, `0029` | living-index footers | Decrement to `#37–#41` |

**Deliberately NOT changed** (justify in `notes.md` if you touch them):

- `encodeCursor` / `decodeCursor` / `assertCursorBelongsToSource` — opaque helper stays (D1/D7).
- `VectorQueryBuilder` — no orderBy (N3/D8).
- `ErrorParser.ts` / `src/express/index.ts` — no new error class (D9).
- `PaginatedResult` type alias — pre-existing mismatch, out of scope.
- `getUnderlyingQuery` — escape hatch unchanged.
- `README.md` / `npm-readme.md` — no install/pitch/API change.

### 3.5 Baseline suite counts (measured on clean tree @ `387db6f`)

| Suite | Suites | Tests |
| ----- | ------ | ----- |
| Unit (`npm run test:unit`) | **29** | **356** |
| Integration (`npm run test:integration:emulator`) | **29** | **429** |

After the change both suite counts and both test counts must **go up** (§8 adds files/cases).

---

## §4 Traps

Ordered by how badly a reasonable implementer gets them wrong.

### T1 — Forgetting to clear `hasLimitToLast` in `limit()` (P30, D5)

SDK last-wins: `limitToLast(2).limit(3)` is a forward `limit(3)` query. If the flag stays true,
`stream()` falsely rejects. **Fix:** `limit()` sets `hasLimitToLast = false`. Test U-1 / I-stream.

### T2 — Letting `paginate` compose with `limitToLast` (P30, D6)

`paginate` does `finalQuery.limit(pageSize+1)`, which overrides `limitToLast` and silently returns a
**forward** page. Same for `offsetPaginate`. **Fix:** local throw before building `finalQuery`.
Test I-pag-reject.

### T3 — `select()` drops `hasLimitToLast` (N2)

`select()` constructs a new builder and today only copies `hasOrderBy`. Missing the new flag means
`orderBy().limitToLast(n).select(...).stream()` incorrectly streams. **Fix:** copy on **both**
collection and group `select()` (two sites). Test I-select-flag / U-select-copy.

### T4 — Rejecting `onSnapshot` after `limitToLast` (P20)

Copy-pasting the `stream` guard onto `onSnapshot` breaks a legal SDK combination. Listeners work.
Only `stream()` is forbidden.

### T5 — Arity check `fieldValues.length === orderByCount` (P14)

Prefix cursors are legal. A “helpful” local arity equality check rejects valid queries. **Do not**
count orderBy clauses for bounds validation.

### T6 — Changing opaque cursor tokens to carry field values (D1)

Looks like responding to the issue’s “consider,” but breaks projected pagination and the path
binding security model. Leave `encodeCursor` alone; field values go to `startAt`/`endAt`/….

### T7 — Adding bounds only on `FirestoreQueryBuilder` (not the base)

Collection-group builders would lack parity; ADR-0024 put shared reads on the base deliberately.
Add to `FirestoreQueryBuilderBase`.

### T8 — `offset` using `assertPositiveInt` (P13a)

`assertPositiveInt` rejects `0`. Offset 0 is valid. Use non-negative validation.

### T9 — DocumentReference silently empty (F4)

`startAfter(docRef)` with a field `orderBy` hits the field-value overload and can return `[]` with
no throw. Overloads + JSDoc must say **DocumentSnapshot or field values**, not DocumentReference
(unless ordering by document id, where F5 shows a ref can work — still prefer snapshot / id string).
Do not add a fragile runtime ref detector unless tests demand it; document the footgun.

### T10 — Website aside fence leak

`website/**/*.md` is prettier-exempt. A `:::note` whose closing `:::` lands on a content line ships
literal `:::` on the page (`check:docs` / `docs:build` miss it). After docs edits, grep built HTML.

### T11 — ADR bookkeeping partial sweep

Issue is a deferral ship: need **new ADR**, **0017 amendment**, **living-index footers on every
feature ADR still carrying `#36–#41`**, capability matrix move, `docs/adr/README.md` row. Grep for
the range — do not trust a hardcoded file list (set grows). Skipping footers is the repo’s main
defect mode.

---

## §5 Could not verify / scope bounds

- **No prototype on `src/`.** Gate impact of the new methods is reasoned (additive methods + guards).
  Implementer may discover `tsc` overload friction at the `this.query.startAt(...)` call — use a
  narrow cast if needed; do not weaken public typings.
- **Production Firestore** foreign-cursor behavior may differ from emulator F2/F7. Pin emulator
  contracts in integration tests; do not claim production equivalence for foreign snapshots.
- **Peer matrix:** probes used the workspace’s `firebase-admin@14` → `@google-cloud/firestore@8.6.0`.
  `check:consumer` locally covers one peer major; CI fans out `^12`/`^13`/`^14`. Cursor APIs exist
  on the peer floor — **no peer bump** expected; say so in the ADR. Do not claim all CI peer legs
  passed unless you ran them.
- **Missing review artifact** `docs/development/v3-release-review.md` — not recoverable from the
  repo; do not invent citations to it.
- **Carried over / deferred:** reverse opaque `prevCursor` helper; field-value token format for
  `paginate`; `PaginatedResult` cleanup; `limit()` positive-int hardening.

---

## §6 API specification

### 6.1 `src/core/QueryBuilder.ts` — imports + flag

Add `DocumentSnapshot` to the `firebase-admin/firestore` import list (beside `QueryDocumentSnapshot`).

```ts
// On FirestoreQueryBuilderBase, next to hasOrderBy / hasSelect:
protected hasOrderBy = false;
/** True once limitToLast() has been applied more recently than limit() (SDK last-wins — P29/P30). */
protected hasLimitToLast = false;
protected hasSelect = false;
```

### 6.2 Non-negative int helper

Beside `assertPositiveInt`:

```ts
/**
 * Validates a non-negative finite integer (including 0). Used by offset() and limitToLast() where
 * zero is a legal SDK input (empty page / no skip) but negatives and non-integers are not.
 */
private assertNonNegativeInt(name: string, value: number): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer (received ${String(value)}).`);
  }
}
```

### 6.3 `limit` — clear flag (T1)

```ts
limit(n: number): this {
  this.query = this.query.limit(n);
  // SDK last-wins with limitToLast (P30): a subsequent limit() replaces limitToLast on the query,
  // so the stream()/paginate() guards must stop treating this builder as limitToLast.
  this.hasLimitToLast = false;
  return this;
}
```

Keep existing JSDoc; add one sentence that `limit()` after `limitToLast()` replaces it.

### 6.4 Bounds methods (insert after `limit`, before `count`)

```ts
/**
 * Start the result set at the given cursor position (**inclusive**).
 *
 * Overloads match the Admin SDK: pass a `DocumentSnapshot` whose data includes every `orderBy` /
 * inequality field, **or** pass field values in the same order as the query's `orderBy` clauses.
 * Field values are typed `unknown` (stored-shape rule — same as `where`).
 *
 * A snapshot bound without a prior `orderBy()` is legal in the SDK and implies document-id order;
 * field-value bounds require `orderBy()`. Prefer an explicit `orderBy` / `orderById` either way.
 *
 * Pass a `DocumentReference` only if you intend it as a *field value* (almost never correct for a
 * field `orderBy` — it can yield an empty result with no throw). Prefer snapshots or scalar values.
 *
 * @example
 * await repo.query().orderBy('score').startAt(20).endAt(40).get();
 * await repo.query().orderBy('score').startAt(await db.doc('…').get()).get();
 */
startAt(snapshot: DocumentSnapshot): this;
startAt(...fieldValues: unknown[]): this;
startAt(...args: unknown[]): this {
  if (args.length === 0) {
    throw new Error(
      'startAt() requires a DocumentSnapshot or at least one field value matching the orderBy() clauses.',
    );
  }
  // Forward to the Admin SDK overloads. Narrow cast: public signatures are the overloads above.
  this.query = this.query.startAt(...(args as [DocumentSnapshot]));
  return this;
}

/** Start after the cursor (**exclusive**). See {@link startAt} for overload and typing rules. */
startAfter(snapshot: DocumentSnapshot): this;
startAfter(...fieldValues: unknown[]): this;
startAfter(...args: unknown[]): this {
  if (args.length === 0) {
    throw new Error(
      'startAfter() requires a DocumentSnapshot or at least one field value matching the orderBy() clauses.',
    );
  }
  this.query = this.query.startAfter(...(args as [DocumentSnapshot]));
  return this;
}

/** End at the cursor (**inclusive**). See {@link startAt} for overload and typing rules. */
endAt(snapshot: DocumentSnapshot): this;
endAt(...fieldValues: unknown[]): this;
endAt(...args: unknown[]): this {
  if (args.length === 0) {
    throw new Error(
      'endAt() requires a DocumentSnapshot or at least one field value matching the orderBy() clauses.',
    );
  }
  this.query = this.query.endAt(...(args as [DocumentSnapshot]));
  return this;
}

/** End before the cursor (**exclusive**). See {@link startAt} for overload and typing rules. */
endBefore(snapshot: DocumentSnapshot): this;
endBefore(...fieldValues: unknown[]): this;
endBefore(...args: unknown[]): this {
  if (args.length === 0) {
    throw new Error(
      'endBefore() requires a DocumentSnapshot or at least one field value matching the orderBy() clauses.',
    );
  }
  this.query = this.query.endBefore(...(args as [DocumentSnapshot]));
  return this;
}
```

(Same empty-args message pattern for each; feel free to share a tiny private helper for the
zero-args check + SDK forward if it stays readable.)

### 6.5 `offset` + `limitToLast`

```ts
/**
 * Skip the first `n` matching documents. `n` must be a non-negative integer (`0` is allowed).
 * Prefer cursor bounds / `paginate()` for large offsets — Firestore still scans skipped docs.
 */
offset(n: number): this {
  this.assertNonNegativeInt('offset', n);
  this.query = this.query.offset(n);
  return this;
}

/**
 * Return the last `n` documents of the ordered result set (results still in `orderBy` order).
 *
 * Requires at least one prior `orderBy()` / `orderById()` / `orderByPath()` (local guard).
 * Cannot be combined with native `stream()` — call `get()` instead. Real-time `onSnapshot()`
 * **is** supported. If both `limit` and `limitToLast` are chained, the **last** call wins (SDK).
 *
 * Reverse pagination pattern: `orderBy(...).endAt(cursor).limitToLast(pageSize).get()`.
 * Do not use opaque `paginate()` for reverse pages — it is forward-only.
 */
limitToLast(n: number): this {
  this.assertNonNegativeInt('limitToLast', n);
  if (!this.hasOrderBy) {
    throw new Error('limitToLast() requires at least one orderBy() call.');
  }
  this.query = this.query.limitToLast(n);
  this.hasLimitToLast = true;
  return this;
}
```

### 6.6 Terminal guards

In `stream()`, **before** opening the SDK stream:

```ts
if (this.hasLimitToLast) {
  throw new Error(
    'stream() is not supported after limitToLast(): Firestore cannot stream limitToLast queries. ' +
      'Use get() instead.',
  );
}
```

In `paginate()` and `offsetPaginate()`, after existing input checks / beside the `hasOrderBy` check:

```ts
if (this.hasLimitToLast) {
  throw new Error(
    'paginate() cannot be used after limitToLast(): reverse pages use orderBy + bounds + ' +
      'limitToLast + get(); opaque paginate() is forward-only.',
  );
}
```

(Adjust the method name in the message for `offsetPaginate`.)

### 6.7 `select()` flag copies — both builders

`FirestoreQueryBuilder.select` (`QueryBuilder.ts` ~1433):

```ts
next.hasOrderBy = this.hasOrderBy;
next.hasLimitToLast = this.hasLimitToLast;
next.hasSelect = true;
```

`FirestoreCollectionGroupQueryBuilder.select` (`CollectionGroup.ts` ~309): same two assignments.

### 6.8 Size

| Area | Estimate |
| ---- | -------- |
| `QueryBuilder.ts` | ~+120–160 lines (methods + JSDoc + guards) |
| `CollectionGroup.ts` | ~+1 line (flag copy) |
| Tests | new integration file + unit additions + type tests — see §8 |
| ADR + Starlight + footers | ~6–10 doc files |

Runtime behavior change: additive clause methods + new local throws for illegal combinations.
Existing happy paths unchanged when the new methods are unused.

---

## §7 Implementation sequence and anti-instructions

1. Check out `cursor/issue-36-typed-query-bounds-3dc6` — it already exists and carries this plan. If
   `main` has moved past `387db6f`, rebase onto it and **re-verify the §3.4 line numbers before
   editing anything**.
2. Implement §6.1–6.6 on `FirestoreQueryBuilderBase` (flag, helper, methods, `limit` clear, terminal
   guards). Order matters: flag + `limit` clearing before `stream`/`paginate` guards, or T1 is easy
   to miss.
3. Copy `hasLimitToLast` in **both** `select()` implementations (T3) — do this in the same commit
   slice as the flag introduction so a half-built tree cannot compile-green with a silent drop.
4. Tests (§8) — **verify each new test fails on the unfixed baseline** (`git stash` the
   implementation, or write tests first). Promote assertion probes; do not leave them only under
   `probes/`.
5. Docs + ADR + bookkeeping (§9). Grep `\#36–#41` / living-index footers after editing.
6. Full gate (§10), `prettier --write` on non-exempt paths, update `notes.md`. Leave
   `docs/plans/issue-36-typed-query-bounds/` in place for review — cleanup commit after review.

### Anti-instructions

- **Do not** change `encodeCursor` / `decodeCursor` / opaque token payload (T6/D1).
- **Do not** add `startAt` only on `FirestoreQueryBuilder` (T7).
- **Do not** reject `onSnapshot` after `limitToLast` (T4).
- **Do not** add orderBy-arity equality checks on field-value bounds (T5).
- **Do not** apply `assertCursorBelongsToSource` to typed snapshot bounds (D7).
- **Do not** modify `VectorQueryBuilder` to “support” bounds.
- **Do not** add exports to `src/index.ts` or new error classes / `ErrorParser` mappings (D8/D9).
- **Do not** rewrite earlier ADR-0017 amendment blockquotes — append a new one for #36.
- **Do not** edit `website/src/content/docs/2.0/**`.
- **Do not** hand-edit `CHANGELOG.md`.
- **Do not** delete the plan directory until after review (§11).
- **Do not** claim production foreign-cursor behavior beyond what §5 allows.
- **Do not** commit unless asked by the plan-execution flow’s gate step; leave a clean tree and
  report the §10 subject line when ready — then commit/push on this branch as that skill directs.

---

## §8 Test specification

Every new test must **fail on the unfixed baseline**. Mutation-check the load-bearing ones.

### 8.1 Integration — `src/tests/integration/query-bounds.integration.test.ts` (new)

JSDoc header: strategy = emulator Admin SDK via `createUserRepoHarness`; verifies inclusive/exclusive
bounds, bounded ranges, `limitToLast` reverse pages, local guards, collection-group inheritance.

| Id | Asserts | Guards |
| -- | ------- | ------ |
| I-1 | `orderBy('…').startAt(v).get()` inclusive | P1, acceptance |
| I-2 | `startAfter` / `endAt` / `endBefore` exclusive/inclusive | P2–P4 |
| I-3 | `startAt(low).endAt(high)` bounded range | P7, acceptance |
| I-4 | Snapshot overloads for start/end (read a doc, pass snapshot) | P5/P6 |
| I-5 | `limitToLast(n)` returns last n in orderBy order | P8, acceptance |
| I-6 | `endAt(cursor).limitToLast(n)` reverse page | P23, acceptance |
| I-7 | `limitToLast` without `orderBy` throws local message | P9, D4 |
| I-8 | `limitToLast` then `stream()` throws local message | P10, D4 |
| I-9 | `limitToLast` then `paginate` / `offsetPaginate` throw | T2/D6 |
| I-10 | `offset(0)` ok; `offset(-1)` throws local non-negative | T8 |
| I-11 | `limitToLast` then `limit` then `stream()` **succeeds** (flag cleared) | T1 |
| I-12 | `orderBy.limitToLast.select.stream` throws (flag copied) | T3 |
| I-13 | Collection-group builder: `orderBy`/`orderByPath` + `startAt` + `limitToLast` works | T7 |
| I-14 | `onSnapshot` after `limitToLast` delivers (optional if harness-heavy; else unit mock) | T4 |

Gate: **`test:coverage:gate:integration`** (`QueryBuilder.ts` / `CollectionGroup.ts` ownership).

### 8.2 Unit — extend `queryBuilderStream.unit.test.ts` (+ small new file if cleaner)

| Id | Asserts | Guards |
| -- | ------- | ------ |
| U-1 | Mock query: after `limitToLast`, `stream()` throws before `query.stream` | T1/D4 |
| U-2 | `limitToLast` then `limit` → `stream` calls through | T1 |
| U-3 | Empty-args `startAt()` throws locally | P25 |
| U-4 | `offset(-1)` / non-integer throws; `offset(0)` calls SDK `offset(0)` | T8 |

Use `createMockFirestoreDb()` / existing query mock patterns — mock at Firestore boundary.

Gate: unit suite runs these; coverage gate for QueryBuilder remains **integration**.

### 8.3 Type — `src/tests/types/query-bounds.type-test.ts` (new)

| Id | Asserts | Guards |
| -- | ------- | ------ |
| T-1 | `startAt` / `startAfter` / `endAt` / `endBefore` / `offset` / `limitToLast` exist on collection builder and return `this`-compatible type | D2 |
| T-2 | Same methods exist on collection-group builder | T7 |
| T-3 | Field-value args accept `unknown`-compatible values; snapshot overload accepts `DocumentSnapshot` | D2 |
| T-4 | `VectorQueryBuilder` still has no `startAt` / `limitToLast` (expect-error if someone adds) | D8 |

Gate: `test:types`.

### 8.4 Coverage gates

| Changed path | Gate |
| ------------ | ---- |
| `src/core/QueryBuilder.ts` | `test:coverage:gate:integration` |
| `src/core/CollectionGroup.ts` | `test:coverage:gate:integration` |
| Type tests only | `test:types` (excluded from coverage) |
| No `src/utils/**` / Validation / ErrorParser / `index.ts` changes | unit gate thresholds unchanged |

---

## §9 Docs and ADR bookkeeping

### 9.1 Bookkeeping — what **does** apply

This is an ADR-0017 deferral ship (`parity` / `v3.x`). All of: new ADR, 0017 amendment, living-index
footers, capability matrix move, Starlight API pages.

### 9.2 New ADR — claim next free number in `docs/adr/` (expect `0030-…`)

From `docs/adr/0000-template.md` via the `adr` skill. Status
`Accepted (v3.x, pending merge/release)`, Date = implement day, Deciders `maintainer`. Must contain:

1. **Context** — #36 acceptance; opaque `paginate` stays; probes P1–P30 / F1–F8 summary; ADR-0024
   foreign-cursor claim staleness.
2. **Decision** — D1–D9 condensed (methods on base; overloads; guards; no token change; no vector;
   no parser).
3. **Consequences** — reverse pagination pattern; forward `paginate` unchanged; `limit`/`limitToLast`
   last-wins; group foreign snapshot empty; DocumentReference footgun.
4. **Alternatives considered** — field-value opaque tokens; orderBy-tracked value generics;
   snapshot membership checks; rejecting onSnapshot.
5. **References** — issue #36, ADR-0017/0001/0024/0027, probe paths (will be deleted with the plan —
   cite issue + this ADR as durable).
6. **Living-index footer** — remaining deferrals `(#37–#41)` + note living-index intent.

Add a row to `docs/adr/README.md` Index table.

### 9.3 ADR bookkeeping edits

| File | Edit |
| ---- | ---- |
| `docs/adr/0017-v3-core-operations-scope.md` | Append `> Amendment (3.0.0, issue #36): …` after the #35 amendment. Remaining deferrals become `#37–#41`. Add References bullet for #36 / new ADR. **Do not rewrite** earlier amendment blockquotes. |
| Every feature ADR whose footer still says `#36–#41` | Grep `remaining deferrals (#36–#41)` / living index — update to `#37–#41` and add “#36 typed bounds / limitToLast have since shipped — see ADR-00NN”. Expected current set includes at least `0023`, `0024`, `0025`, `0026`, `0027`, `0029` — **re-grep at implement time**. |
| `docs/adr/0027-…` | Aggregate claim that limitToLast/cursors/offset apply is now accurate for the ORM surface — no mandatory edit beyond living-index footer. |

### 9.4 Website — pages

| Page | Change |
| ---- | ------ |
| `website/src/content/docs/reference/scope-and-capabilities.md` | Move “Typed lower-level bounds + limitToLast()” from Deferred (~L50) to Supported with notes (inclusive/exclusive bounds, `offset`, `limitToLast` + guards; opaque `paginate` still forward-only). |
| `website/src/content/docs/reference/query-builder.md` | Remove callout at ~L105–106. Document `startAt`/`startAfter`/`endAt`/`endBefore`, `offset`, `limitToLast` near `limit`. Note stream rejection, paginate incompatibility, reverse pattern. |
| `website/src/content/docs/guides/working-with-data/queries.md` | Replace “no public `.startAfter()`” (~L42–43). Add a short “Query bounds & reverse pagination” subsection (or extend Pagination ~L314) with examples for range + `limitToLast`. Keep opaque `paginate` docs. |
| `website/src/content/docs/guides/working-with-data/subcollections.md` | Fix ~L106–107 “no `.startAfter()` chaining”. |

`website/**/*.md` is prettier-exempt — match surrounding style by hand. If you add `:::note` /
`:::caution`, run `npm run docs:build` and grep the built HTML for a leaked literal `:::`.

### 9.5 READMEs

Grepped both: only marketing “pagination” mentions — **neither README requires edits**. Say so in
the PR body. Do not run readme-sync.

### 9.6 Follow-up issues (optional; open only if maintainer wants)

- Reverse opaque pagination helper (`prevCursor`) — if product wants symmetry with `paginate`.
- Revisit opaque token payload to optionally embed orderBy field values — only with a new design
  that preserves projected pagination and binding.

---

## §10 Gate and commit

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
npm run test:types && npm run lint && npm run check:format && npm run test:unit && npm run test:integration:emulator && npm run test:unit:coverage && npm run test:coverage:gate:unit && npm run test:integration:coverage && npm run test:coverage:gate:integration && npm run build && npm run check:package && npm run check:consumer && npm run check:docs && npm run docs:build
```

Fourteen legs. Report failures with output — never claim a leg passed that you did not execute.

Baseline before your change (@ `387db6f`): unit **29 suites / 356 tests**, integration
**29 suites / 429 tests**. Both suite counts and both test counts must **go up**. Watch
**`test:coverage:gate:integration`** — `QueryBuilder.ts` / `CollectionGroup.ts` are integration-owned.

Re-run the probes against the finished code (ORM wrappers, not raw SDK) via the new integration
tests; optionally re-run the raw SDK probes to confirm emulator drift:

```bash
firebase emulators:exec --project demo-firestoreorm-test --only firestore \
  "node docs/plans/issue-36-typed-query-bounds/probes/sdk-cursor-bounds.mjs"
firebase emulators:exec --project demo-firestoreorm-test --only firestore \
  "node docs/plans/issue-36-typed-query-bounds/probes/sdk-foreign-cursor.mjs"
```

**Commit subject** (Conventional Commits; commitlint on `commit-msg`):

```
feat(query): typed cursor bounds, offset, and limitToLast (#36)
```

**Is it breaking?** **No.** Additive methods and new local throws only for illegal combinations that
previously did not exist on the builder. Folds into unreleased `3.0.0` / v3.x per ADR-0017; not a
`feat!`.

---

## §11 Definition of done

| # | Item |
| - | ---- |
| 1 | D1–D9 implemented; opaque cursors unchanged |
| 2 | `startAt`/`startAfter`/`endAt`/`endBefore`/`offset`/`limitToLast` on `FirestoreQueryBuilderBase` with §6 JSDoc |
| 3 | `hasLimitToLast` set/cleared correctly; both `select()` sites copy it |
| 4 | `stream` / `paginate` / `offsetPaginate` local guards; `onSnapshot` not falsely guarded |
| 5 | §8 tests present, fail on unfixed baseline (mutation-checked), pass on fixed tree |
| 6 | ADR-00NN written; `docs/adr/README.md` row added |
| 7 | ADR-0017 #36 amendment appended; living-index footers grepped and updated to `#37–#41` |
| 8 | Starlight pages in §9.4 updated; no leaked `:::` in built HTML |
| 9 | Capability matrix: #36 moved Deferred → Supported |
| 10 | READMEs declared unaffected in PR body |
| 11 | Nothing in the §7 anti-instruction list violated |
| 12 | Full gate green (§10) with real output; suite counts as predicted |
| 13 | `notes.md` committed: deviations, unverified items, adversarial self-review |
| 14 | Assertion coverage lives in committed tests (§8), not only under `probes/` |
| 15 | `git rm -r docs/plans/issue-36-typed-query-bounds/` — plan directory removed in a **final cleanup commit after review**, before merge |

---

## Appendix — probe inventory (`probes/`, beside this file)

| File | What it proves |
| ---- | -------------- |
| `probes/sdk-cursor-bounds.mjs` | P1–P30: inclusive/exclusive bounds, limitToLast, stream rejection, offset 0/−1, aggregate interaction, limit last-wins, select+bounds, empty startAt |
| `probes/sdk-foreign-cursor.mjs` | F1–F8: group vs collection foreign snapshots, DocumentReference footgun, snapshot-without-orderBy ⇒ documentId order |
