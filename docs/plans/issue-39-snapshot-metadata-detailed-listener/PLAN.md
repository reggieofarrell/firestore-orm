# Issue #39 — Opt-in snapshot metadata + detailed `docChanges` listeners

**Implementer:** Cursor Cloud Agent (or a later local session) · **Reviewer:** owner ·
**Baseline:** `main` @ `32ce4c1` (`docs(skills): stop a gate-green prototype from becoming a
transcribed plan (#71)`) · **Branch:** `feat/issue-39-snapshot-metadata-detailed-listener` — already
created and pushed with this plan on it; **check it out, do not cut a new one**

**Issue:** [#39](https://github.com/reggieofarrell/firestore-orm/issues/39) — labels `enhancement`,
`parity`, `v3.x`. It **is** in ADR-0017's `#39–#41` deferral set, so the full §9 deferral
bookkeeping applies (new ADR, ADR-0017 amendment, living-index footer decrements, capability
matrix).

> **Acceptance (verbatim from the issue):** "metadata and incremental `docChanges` available opt-in;
> existing return shapes unchanged."

**Scope split (owner-approved, D1):** the issue bundles read metadata, **write** metadata and the
detailed listener. This PR ships read metadata + the detailed listener. Write-time metadata is split
out to **[#72](https://github.com/reggieofarrell/firestore-orm/issues/72)** (already filed), the
same way `explainStream` (#65) was split out of #37.

---

## §0 How to use this plan

1. Read **§1** (settled — do not re-litigate) and **§4** (traps) before writing any code.
2. **§6 blocks are copy-verbatim** and were compile-checked as written against this baseline — see
   §12 for exactly what was run. §7 is the ordered build sequence, §8 the tests, §9 docs/ADR, §10
   the gate, §11 the definition of done.
3. **There is no `prototype.patch`.** No full prototype was built (see §5 for what that leaves
   unverified). Every §6 block was nevertheless pasted into a scratch file under `src/` and put
   through `npm run test:types`; two defects were found and fixed that way before you got this
   (T2 and the `getMany` matrix — §12).
4. Every claim in §3 came from an executed probe on this baseline. Probes live in
   `docs/plans/issue-39-snapshot-metadata-detailed-listener/probes/`. Re-run them if you doubt one:

   ```bash
   firebase emulators:exec --project demo-firestoreorm-test --only firestore "node docs/plans/issue-39-snapshot-metadata-detailed-listener/probes/p1-snapshot-metadata.mjs"
   ```

   ```bash
   firebase emulators:exec --project demo-firestoreorm-test --only firestore "node docs/plans/issue-39-snapshot-metadata-detailed-listener/probes/p2-doc-changes.mjs"
   ```

   **Do not trust the issue body over §3.**
5. `probes/p3-overload-resolution.type-probe.ts` is an **assertion** probe: its `@ts-expect-error`
   blocks are the spec for the type test in §8 (T-1). It lives outside `src/` so `test:types` does
   not see it; §8 tells you where to land it.
6. **Follow the `plan-execution` skill.** Write `notes.md` on this branch as you go, mutation-check
   the load-bearing tests, and pass your own refute-first self-review before declaring ready.
7. Environment: Node 24 (`.nvmrc`; the husky hooks hard-fail otherwise) and a JDK for
   `test:integration:emulator`. On Cursor Cloud, `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"`
   before committing or pushing.

---

## §1 Owner-approved decisions

| Id      | Fork                                                | Decision                                                                                                                                                                           | Rejected alternative and why                                                                                                                                                                                                                                                    |
| ------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1**  | Which of #39's three deliverables ship here          | Read snapshot metadata **+** the detailed `docChanges` listener. Write-time metadata → [#72](https://github.com/reggieofarrell/firestore-orm/issues/72).                            | *All three in one PR* — ~30 methods across four files in one change. *Listener only* — leaves the larger half unaddressed. The split follows #37→#65 and #38→#69.                                                                                                             |
| **D2**  | Opt-in mechanism for read metadata                   | An options-bag flag `{ withMetadata: true }` with paired overloads, mirroring the existing `{ returnDoc: true }` pattern.                                                          | *Named `*WithMetadata` methods* (the `getByIdWithUpdateTime` precedent) — roughly doubles the read-method count. *A `QueryBuilder.withMetadata()` toggle rebinding `R`* — widened-generic change through `FirestoreQueryBuilderBase`, `CollectionGroup` and the vector wrapper. |
| **D3**  | Breadth of the read surface                          | Core repository reads + query terminals (enumerated in §2). **Not** vector terminals, **not** transaction reads, **not** `aggregate`/`count` `readTime`, **not** `explain()`.       | *Everything readable* — the vector wrapper and read-only transaction surface each add their own trap class for a capability nobody asked for yet. *`getById` + `get()` only* — leaves sibling reads visibly inconsistent.                                                       |
| **D4**  | Detailed-listener API form                           | New sibling methods: `FirestoreQueryBuilderBase.onSnapshotDetailed()` and `FirestoreRepository.listenOneDetailed()`. Existing `onSnapshot` / `listenOne` signatures are untouched.  | *An options overload on `onSnapshot`* — a callback-position overload resolves wrong silently when the caller's arrow is untyped. *A second callback argument* — changes the existing callback type, which the acceptance criterion forbids.                                     |
| **D5**  | `listenOneDetailed` on a deleted document            | **Mirror `listenOne`**: route deletion to `onError(new NotFoundError(...))`. The callback parameter stays non-nullable and no extra event type is introduced.                       | *Deliver deletion as a `{ doc: null, exists: false }` event* — needs a `DetailedDocumentEvent` type with nullable `doc`/`metadata`, and diverges from its sibling. Owner chose sibling consistency.                                                                             |
| **D6**  | Home for the shared metadata types + builder         | New **`src/core/SnapshotMetadata.ts`**, deliberately in **neither** coverage gate — the same class as the existing `src/core/DocumentId.ts`. §8 flags this explicitly.               | *Add a gate row to `scripts/check-coverage-gates.mjs`* — pulls the full `testing-docs-sync` bookkeeping in for a ~45-line module. *Fold into `DocumentId.ts`* — mixes document-identity with snapshot-provenance types.                                                        |
| **D7**  | `ref` in the metadata payload *(derived, not asked)* | Include it. The issue names `ref` explicitly.                                                                                                                                      | Omitting it would keep `metadata` JSON-serializable, but the issue asks for it. The `{ doc, metadata }` split is what makes this safe: **`doc` stays fully serializable**; only the sibling `metadata` is not.                                                                   |
| **D8**  | Flat overlay vs. a sibling wrapper *(derived)*       | Sibling wrapper `{ doc, metadata }`. Never overlay `createTime` / `path` / … onto the document.                                                                                    | Overlaying would shadow a stored field of the same name and make it unreachable — exactly the collision ADR-0018 avoids for `id` and ADR-0026 avoids for `updateTime` (`getByIdWithUpdateTime` returns a pair for this reason: `FirestoreRepository.ts:1658-1660`).             |

---

## §2 Scope

### In scope

| Area                                     | Change                                                                                                                                                                        |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/SnapshotMetadata.ts` (**new**)  | `DocumentMetadata`, `WithMetadata<D>`, `DetailedDocumentChange<R>`, `DetailedQuerySnapshot<R>`, and the internal `buildDocumentMetadata(snapshot)`                              |
| `src/core/FirestoreRepository.ts`         | `{ withMetadata }` overloads on `getById`, `getByIdOrThrow`, `getMany`, `getAll`, `findByField`, `getOneByField`, `getOneByFieldOrThrow`; new `listenOneDetailed`               |
| `src/core/QueryBuilder.ts`                | `{ withMetadata }` overloads on `get`, `getOne`, `stream`, `paginate`, `offsetPaginate`, `paginateWithCount`; new `onSnapshotDetailed`; new `protected toResultWithMetadata`    |
| `src/core/CollectionGroup.ts`             | **No source edit.** `FirestoreCollectionGroupQueryBuilder extends FirestoreQueryBuilderBase` (`CollectionGroup.ts:155-159`), so it inherits every new member. Must be **tested** |
| `src/index.ts`                            | `export type` the four new public types                                                                                                                                        |
| `src/vector/index.ts`                     | Re-export the same four types — see R-6 in §3.4; this is **required**, not optional                                                                                            |
| Tests                                     | One new type test, two new integration tests (§8)                                                                                                                              |
| Docs / ADR                                | ADR-0033 + the full deferral bookkeeping; Starlight pages; capability matrix (§9)                                                                                              |

### Explicitly **out** of scope

| Surface                                                                              | Why                                                                                                                                                       |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Write metadata** (`writeTime` on create/update/patch/upsert/delete/bulk\*)         | D1 → [#72](https://github.com/reggieofarrell/firestore-orm/issues/72)                                                                                     |
| `getInTransaction`, `getManyInTransaction`, `ReadOnlyTransactionalRepository`          | D3. Verified untouched: R-7                                                                                                                               |
| `VectorQueryBuilder.get()` / `.getOne()` / `.explain()`                                | D3. Verified structurally impossible to affect by accident: R-5                                                                                           |
| `explain()` on Core and vector builders                                                | D3. Its `QueryExplainResult<R>` already carries `documents: R[] \| null`; a metadata variant would need a fifth overload dimension for a diagnostic surface |
| `count()`, `sum()`, `average()`, `aggregate()`, `distinctValues()`, `exists()`         | Return scalars/aggregates, not documents. `AggregateQuerySnapshot.readTime` is a separate capability — ADR-0027 §115 already parks it on #39; it now parks on #72 |
| `PaginatedResult<T>`                                                                   | R-8: defined and exported but **used in no signature**. Leave it alone                                                                                    |
| `fromSnapshot()`                                                                       | The caller already holds the snapshot and can read its metadata directly                                                                                  |

### Where the issue's own framing is stale or incomplete

- The issue says "a detailed listener API returning mapped documents plus change type / old-new
  indexes / **path** / read time". `path` is delivered inside `metadata` (`metadata.path`), not as a
  sibling of `type`. Keeping it in `metadata` avoids a second spelling of the same value and keeps
  the change payload uniform with the read payload.
- The issue predates `getByIdWithUpdateTime` (ADR-0026) and `getMany` (ADR-0029). Both now exist and
  both interact with this change — `getByIdWithUpdateTime` is a **deliberate non-change** (R-9), and
  `getMany` is the hardest signature in the PR (T3).
- The issue names no files or line numbers, so there is nothing stale to correct there — but §3.4
  is the authoritative enumeration regardless.

---

## §3 Verified facts

All produced on `32ce4c1` with a clean tree.

### §3.1 Probe P1 — snapshot metadata availability per read path

`probes/p1-snapshot-metadata.mjs`, run under `firebase emulators:exec`. Full output in §3.1's table;
`Y` means the property was present and truthy.

| Id      | Read path                             | Runtime class           | `exists` | `createTime` | `updateTime` | `readTime` | `ref` |
| ------- | ------------------------------------- | ----------------------- | -------- | ------------ | ------------ | ---------- | ----- |
| **P1a** | `DocumentReference.get()` — exists    | `QueryDocumentSnapshot` | true     | Y            | Y            | Y          | Y     |
| **P1b** | `DocumentReference.get()` — missing   | `DocumentSnapshot`      | false    | **N**        | **N**        | Y          | Y     |
| **P1c** | `db.getAll()` — exists                | `QueryDocumentSnapshot` | true     | Y            | Y            | Y          | Y     |
| **P1d** | `db.getAll()` — missing               | `DocumentSnapshot`      | false    | **N**        | **N**        | Y          | Y     |
| **P1e** | `Query.get()` docs\[0]                | `QueryDocumentSnapshot` | true     | Y            | Y            | Y          | Y     |
| **P1f** | `Query.stream()` first doc            | `QueryDocumentSnapshot` | true     | Y            | Y            | Y          | Y     |
| **P1g** | `db.getAll(..., { fieldMask })`       | `QueryDocumentSnapshot` | true     | Y            | Y            | Y          | Y     |
| **P1h** | `Query.select().get()` docs\[0]       | `QueryDocumentSnapshot` | true     | Y            | Y            | Y          | Y     |
| **P1i** | `withConverter().get()` docs\[0]      | `QueryDocumentSnapshot` | true     | Y            | Y            | Y          | Y     |
| **P1j** | `tx.get(ref)` / `tx.getAll(ref)`      | `QueryDocumentSnapshot` | true     | Y            | Y            | Y          | Y     |

**P1k** — `createTime` is stable across an `update()`; `updateTime` advances; `readTime` differs
between two reads of the same document. (`true / true / true`.)

**P1l** — every document in one `Query.get()` snapshot reports a `readTime` equal to the
`QuerySnapshot.readTime` (`true`). So a per-document `readTime` is not extra information within one
page — but it *is* the correct source for a single-document read, and reading it per snapshot keeps
one code path.

**What P1 settles:** projections (`fieldMask`, `select`) do **not** strip metadata (P1g, P1h), and a
`readConverter` does not either (P1i). The only case with absent `createTime`/`updateTime` is a
non-existent document (P1b, P1d) — which every ORM read path already excludes before mapping. That
is what makes the non-null assertions in `buildDocumentMetadata` sound rather than optimistic (T1).

### §3.2 Probe P2 — `docChanges()` semantics

`probes/p2-doc-changes.mjs`.

| Id      | Observation                                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P2a** | Initial emission delivers every matching document as `type: 'added'`, `oldIndex: -1`, `newIndex: i`                                                     |
| **P2b** | In-place edit → `modified`, `oldIndex === newIndex`                                                                                                     |
| **P2c** | Edit that reorders → `modified`, `oldIndex: 1`, `newIndex: 2`                                                                                           |
| **P2d** | **Deletion → `removed`, `oldIndex: 1`, `newIndex: -1`, and `change.doc` is a `QueryDocumentSnapshot` with `exists === true`, full last-known data, and `createTime`/`updateTime`/`readTime` all present** |
| **P2e** | `QuerySnapshot.readTime` is present on every emission and strictly increases across emissions                                                           |
| **P2f** | Single-document listener: while the document exists, the snapshot is a `QueryDocumentSnapshot` with all metadata. On deletion it becomes a plain `DocumentSnapshot`, `exists === false`, **no** `createTime`/`updateTime`, `readTime` present |

**P2d is the load-bearing one.** It means `toResult(change.doc)` and `buildDocumentMetadata(change.doc)`
are sound for *all three* change types — a `removed` change still carries mappable data. It also
means `metadata` on a `removed` change describes the document **as it last was**, and `exists` is
`true` on that snapshot: consumers must branch on `change.type`, never on the snapshot. That is T6.

**P2f** is what makes D5 implementable: on deletion there is no `createTime`/`updateTime` to build
metadata from, so routing to `onError` is not merely a style choice — the alternative would have
required a nullable `metadata`.

### §3.3 Probe P3 — overload resolution (type-level, **assertion** probe)

`probes/p3-overload-resolution.type-probe.ts`, compiled with `npm run test:types` while temporarily
located under `src/`. Every `@ts-expect-error` below **held** (an unused one is itself an error).

| Id     | Expression                                                       | Result                                                                      |
| ------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **V1** | `getById('x', { withMetadata: false })`                          | resolves to `FirestoreDocument<User> \| null` ✔                              |
| **V2** | `getById('x', { withMetadata: dynamicBoolean })`                 | **compile error** — a widened `boolean` matches no overload                  |
| **V3** | `const o = { withMetadata: true }; getById('x', o)`              | **compile error** — inference widened the literal to `boolean`               |
| **V4** | `getById('x', { withMetadata: true } as const)`                  | resolves to `WithMetadata<FirestoreDocument<User>> \| null` ✔                |
| **V5** | `getById('x', { withMetaData: true })` (typo)                    | **compile error** — excess-property check                                    |
| **V6** | all four `getMany` cells (`{}`, `{withMetadata}`, `{fieldMask}`, `{fieldMask,withMetadata}`) | each resolves to its distinct expected type ✔        |
| **V7** | `const d: FirestoreDocument<User> \| null = await getById('x', { withMetadata: true })` | **compile error** — the wrapper is not assignable to the bare document ✔ |

**V2/V3 are a real ergonomics consequence, not just a curiosity.** A caller who hoists the options
object gets a compile error rather than a wrong type. Document it (§9) and test it (§8, T-1).

### §3.4 Authoritative site enumeration (`32ce4c1`)

Re-enumerated from the current tree. **Re-verify these line numbers after you rebase** (§7 step 1).

#### `src/core/FirestoreRepository.ts` (3832 lines)

| Id      | Symbol                                  | Line   | Change                                                                                       |
| ------- | --------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| **R1a** | `getById`                               | `1636` | add overload pair + `options` param; body routes through the new `toDocumentResult`            |
| **R1b** | `getByIdOrThrow`                        | `1714` | add overload pair; **must forward `options` to `getById`** (T5)                                |
| **R1c** | `mapManySnapshots` (private)            | `1733` | **do not change** — shared with `getManyInTransaction` at `3529` (T7). Add a sibling instead   |
| **R1d** | `getMany` overloads / impl              | `1787`, `1791`, `1795` | 2 overloads → 4 (T3)                                                            |
| **R1e** | `getMany` impl body — `mapManySnapshots` call | `1813` | branch to the metadata mapper                                                            |
| **R1f** | `findByField`                           | `2957` | add overload pair                                                                             |
| **R1g** | `getOneByField`                         | `2995` | add overload pair                                                                             |
| **R1h** | `getOneByFieldOrThrow`                  | `3029` | add overload pair                                                                             |
| **R1i** | `listenOne`                             | `3067` | **unchanged**; `listenOneDetailed` goes immediately after it                                  |
| **R1j** | `getAll`                                | `3116` | add overload pair                                                                             |
| **R1k** | `getManyInTransaction` impl             | `3505`–`3529` | **unchanged** (out of scope, D3) — but see T7                                          |

#### `src/core/QueryBuilder.ts` (1990 lines)

| Id      | Symbol                                    | Line   | Change                                                                     |
| ------- | ----------------------------------------- | ------ | ---------------------------------------------------------------------------- |
| **R2a** | `PaginatedResult<T>`                      | `52`   | **unchanged** — R-8                                                          |
| **R2b** | `protected hasSelect`                     | `373`  | read by the new `onSnapshotDetailed` guard                                   |
| **R2c** | `protected abstract toResult`             | `387`  | **unchanged**; new concrete `toResultWithMetadata` sits beside it            |
| **R2d** | `paginate`                                | `826`  | add overload pair; map via `mapDocs`                                         |
| **R2e** | `offsetPaginate`                          | `901`  | add overload pair; map via `mapDocs`                                         |
| **R2f** | `getOne`                                  | `973`  | add overload pair                                                            |
| **R2g** | `stream`                                  | `1328` | add overload pair — **signatures without `*`** (T2)                          |
| **R2h** | `onSnapshot`                              | `1376` | **unchanged**; `onSnapshotDetailed` goes immediately after it                |
| **R2i** | `paginateWithCount`                       | `1424` | add overload pair; **must forward the 3rd arg to `paginate`** (T4)           |
| **R2j** | `get`                                     | `1467` | add overload pair                                                            |
| **R2k** | `explain`                                 | `1501` | **unchanged** — out of scope (D3)                                            |
| **R2l** | `FirestoreQueryBuilder.toResult`          | `1567` | **unchanged**                                                                |

#### Everything else

| Id      | File / symbol                                                | Change                                                                                                                              |
| ------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| **R3**  | `src/core/CollectionGroup.ts:155-159`, `toResult` at `182`     | **No source edit.** Extends `FirestoreQueryBuilderBase`, so every new member is inherited. Tests are the deliverable (§8, I-3)          |
| **R4**  | `src/index.ts`                                                 | add one `export type { … } from './core/SnapshotMetadata.js'` block                                                                    |
| **R5**  | `src/vector/index.ts` (24 lines)                               | add the same re-export — see R-6                                                                                                       |
| **R6**  | `src/express/index.ts`                                         | **unchanged.** No new error class ⇒ no status mapping to add. Grepped and confirmed                                                    |

#### Deliberately **NOT** changed — each with the fact that proves it safe

| Id      | Left alone                                                    | Proof                                                                                                                                                                                                                                                                                       |
| ------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R-5** | `src/vector/VectorQueryBuilder.ts`                            | It does **not** extend `FirestoreQueryBuilderBase`. `VectorQueryBuilder.ts:53` declares a standalone class holding `private coreBuilder` (line `64`), and its `get()` (`216`) reads `this.vectorQuery`, never `coreBuilder.get()`. `grep -n "coreBuilder\.\(get\|getOne\|stream\|paginate\)"` returns **no rows**. Adding overloads to the base therefore cannot reach it. |
| **R-6** | …but `src/vector/index.ts` **must still** re-export the types | `withVectorSearch.ts:18` defines `VectorEnabledRepository = FirestoreRepository<…> & { vectorQuery() }`, and its JSDoc (`:25`) states `query()` is proxied unchanged. So a `/vector`-only consumer calling `vectorRepo.getById(id, { withMetadata: true })` gets a `WithMetadata<…>` back and cannot name it — `SnapshotMetadata.ts` has no export-map subpath. Exactly the `VectorValueLike` (`vector/index.ts:20`) and `QueryExplainResult` (`:24`) precedent. |
| **R-7** | `ReadOnlyTransactionalRepository` (`FirestoreRepository.ts:165-215`) | A hand-written interface that **redeclares** its members. Its membership rule (`:148-151`) explicitly excludes `getById` / `getMany` / `getAll` / `query`. None of the methods this PR changes appear in it, so no member drifts out of structural compatibility.                       |
| **R-8** | `PaginatedResult<T>` (`QueryBuilder.ts:52`)                   | `grep -rn "PaginatedResult" src --include="*.ts" \| grep -v src/tests` returns exactly two rows: the definition and the `src/index.ts:20` re-export. **It is used in no signature** — `paginate` declares its return type inline. Adding a metadata variant would create a second unused type. |
| **R-9** | `getByIdWithUpdateTime` (`FirestoreRepository.ts:1682`)       | ADR-0026's dedicated conditional-write read. Its `{ doc, updateTime }` pair is a *different contract* (the CAS token), and its JSDoc at `:1658-1660` is the stated rationale for the pair shape this PR generalizes. Deprecating or rerouting it is out of scope and would be a breaking change to a shipped v3.x API. |
| **R-10**| `src/core/DocumentId.ts`                                       | `FirestoreDocument` / `CollectionGroupDocument` are unchanged: metadata is a **sibling** of the document (D8), never overlaid, so no identity type needs a new key.                                                                                                                        |

### §3.5 Measured gate headroom

Measured on this baseline by running both coverage suites and both gate scripts (§12). Slack is
`actual − threshold`.

| Gate                             | lines            | branches         | functions        |
| -------------------------------- | ---------------- | ---------------- | ---------------- |
| `FirestoreRepository` (integration) | 97.94 / 90 → **+7.94** | 91.45 / 75 → **+16.45** | 92.77 / 85 → **+7.77** |
| `QueryBuilder` (integration)     | 96.73 / 90 → **+6.73** | 87.56 / 75 → **+12.56** | 100.00 / 95 → **+5.00** |
| `CollectionGroup` (integration)  | 99.55 / 90 → **+9.55** | 97.22 / 75 → **+22.22** | 100.00 / 95 → **+5.00** |
| `src/index.ts` (unit)            | 100.00 / 100 → **+0.00** | 100.00 / 100 → **+0.00** | 75.00 / 65 → **+10.00** |

**The `src/index.ts` row has zero slack on lines and branches.** This is safe here only because R4
adds a **type-only** export block, which TypeScript erases — it contributes no executable line. Do
not add a *value* export to `src/index.ts` in this PR. `buildDocumentMetadata` stays internal.

The `QueryBuilder` functions row (+5.00 against a 95% threshold) is the tightest real constraint:
`onSnapshotDetailed`, `toResultWithMetadata` and `mapDocs` are three new functions, and every one
must be executed by an integration test or the percentage falls. §8 covers all three.

### §3.6 Baseline suite counts

| Suite       | Suites | Tests |
| ----------- | ------ | ----- |
| unit        | 31     | 383   |
| integration | 32     | 480   |

---

## §4 Traps

Ordered by how badly a reasonable implementer gets it wrong.

> **T1 — `buildDocumentMetadata` non-null-asserts `createTime` / `updateTime`; that is only sound
> behind an existence guard (P1b, P1d).**
> The Admin SDK types both as optional on `DocumentSnapshot` because they are absent for a
> **non-existent** document — P1b and P1d confirm that is the only case. Every call site must
> therefore sit after an `exists` check. `getById` returns `null` first; `mapManySnapshotsWithMetadata`
> branches on `snapshot.exists`; query terminals only ever see `QueryDocumentSnapshot`, where both
> are non-optional by type. **Silent failure:** call it on a missing snapshot and you get
> `createTime: undefined` typed as `Timestamp` — no compile error, no throw, just a metadata object
> that lies. Guarded by I-1 (missing-id positions in `getMany` are `null`, never a metadata object).
>
> This mirrors the existing precedent verbatim: `FirestoreRepository.ts:1695-1698` already
> non-null-asserts `snapshot.updateTime!` with the same reasoning written out.

> **T2 — an overload signature cannot be declared as a generator (TS1222).**
> Writing `async *stream(options: { withMetadata: true }): AsyncGenerator<…>;` as an overload
> **signature** is a hard compile error. Only the *implementation* carries `async *`; the signatures
> are ordinary methods whose return type is `AsyncGenerator<…>`. This plan's §6 already has it right
> — do not "fix" it back. **Silent failure:** none, it is loud — but it is the kind of thing that
> gets discovered at the end of a 14-leg gate run instead of the start. (Found by the §12 compile.)

> **T3 — `getMany` needs four overloads, not three, and the order matters.**
> `fieldMask` and `withMetadata` are independent, so the matrix is 2×2. Omit the
> `{ fieldMask, withMetadata: true }` cell and that call silently resolves to the *plain* field-mask
> overload: the caller gets `FirestoreDocument<DeepPartial<T>>` typed results while the runtime hands
> back `{ doc, metadata }` objects. **Silent failure:** `rows[0].name` type-checks and is `undefined`
> at runtime, because the real object only has `.doc` and `.metadata`. Guarded by T-1/V6 (all four
> cells asserted) and I-1 (runtime shape of the masked+metadata cell).

> **T4 — `paginateWithCount` must forward its third argument to `paginate`.**
> `QueryBuilder.ts:1429` currently calls `this.paginate(pageSize, cursor)`. Add the overloads but
> leave that call untouched and the *declared* return type says `WithMetadata<R>[]` while `paginate`
> resolves to its no-metadata overload and returns bare `R[]`. **Silent failure:** no compile error
> at either end — the implementation signature's union return absorbs it. Guarded by I-2, which
> asserts `items[0].metadata.readTime` is defined (not merely that the call compiles).

> **T5 — `getByIdOrThrow` must forward `options` to `getById`.**
> Same mechanism as T4 at `FirestoreRepository.ts:1715`. Same silent failure. Guarded by I-1.

> **T6 — a `removed` change carries `exists === true` and full metadata (P2d).**
> `change.doc` for a deletion is a `QueryDocumentSnapshot` describing the document *as it last was*.
> An implementer who "defensively" skips changes where `!change.doc.exists`, or who tries to read
> `exists` to decide whether to map, will produce a listener that never reports deletions — or that
> reports them with `doc: undefined`. The rule is: **branch on `change.type`, never on the
> snapshot.** `metadata.readTime` on a removed change is the *emission's* read time, not a deletion
> time — there is no deletion timestamp available. **Silent failure:** deletions vanish from
> `changes` and only show up as a shrinking `docs` array. Guarded by I-2's removal assertion, which
> checks `changes[0].type === 'removed'` **and** `changes[0].doc.name` is the last-known value.

> **T7 — do not add a `withMetadata` parameter to the shared `mapManySnapshots`.**
> `FirestoreRepository.ts:1733` is called from **two** places: `getMany` (`1813`) and
> `getManyInTransaction` (`3529`). Transaction reads are out of scope (D3). Threading a flag through
> the shared helper puts a metadata code path inside the transaction surface where nothing declares
> it, and a later defaulting mistake changes `getManyInTransaction`'s return shape. Add the separate
> `mapManySnapshotsWithMetadata` in §6 instead. **Silent failure:** `getManyInTransaction`'s
> `ReadOnlyTransactionalRepository` overloads (`:177-186`) still declare the bare document type, so a
> shape change there is invisible to `tsc`. Guarded by I-1's assertion that
> `getManyInTransaction` still returns bare documents.

> **T8 — `onSnapshotDetailed` must reject after `select()`, for the same reason `onSnapshot` does.**
> `QueryBuilder.ts:1382-1388` throws when `this.hasSelect`. Firestore forbids listeners on
> field-masked queries at the *server*; omit the local guard and the failure arrives asynchronously
> through `onError` as an opaque SDK error instead of synchronously with an actionable message.
> **Silent failure:** not silent, but misattributed — it looks like a transport problem. Guarded by
> I-2's rejection assertion.

> **T9 — `metadata.path` on a collection-group row duplicates `row.path`, and they must agree.**
> `CollectionGroup.ts:182-189` already overlays `path` and `parentPath` onto the *result*. With
> metadata on, the same two values also appear under `metadata`. They are read from the same
> `doc.ref`, so they must be identical. **Silent failure:** if a future refactor derives one of them
> differently (e.g. from a cursor or a cached ref), the two silently disagree and a consumer picking
> the "wrong" one gets a stale path. Guarded by I-3, which asserts
> `row.doc.path === row.metadata.path` **and** `row.doc.parentPath === row.metadata.parentPath`.

> **T10 — a hoisted options object does not compile (V2/V3).**
> `const opts = { withMetadata: true }` widens to `{ withMetadata: boolean }`, which matches no
> overload. This is correct behavior — TypeScript cannot pick a return type from a runtime boolean —
> but it will look like a bug to the first consumer who hits it. It must be **documented**, not
> "fixed" by adding a `boolean` overload (which would have to return the union and push the branch
> onto every caller). Guarded by T-1/V2/V3 as `@ts-expect-error` assertions, so a future widening
> of the overloads fails the type test.

---

## §5 Could not verify / bounds

1. **No full prototype was built.** The change is additive-overloads-plus-new-methods, every call
   site is greppable (§3.4), and no generic constraint widens — the skill's prototype table points
   at "skip" on all four rows except "someone else implements it". That last row was answered with
   the §12 compile of every §6 block *including bodies*, not with a gate run. **Consequently
   unverified:** that the full 14-leg gate is green with these edits in place. In particular no
   existing test has been re-run against the modified sources. Expect §10 to be the first real
   signal.
2. **Emulator-only evidence.** P1 and P2 ran against the Firestore emulator, not production
   Firestore. Metadata *presence* is a wire-protocol property and very unlikely to differ, but the
   emulator is known to diverge on at least one adjacent surface (`explain` returns no metrics
   there — `QueryBuilder.ts:1489-1491`). Not blocking; do not upgrade "the emulator does this" into
   "Firestore does this" in JSDoc or docs prose.
3. **`readTime` monotonicity (P2e) was observed over 5 emissions on one listener.** It is not a
   documented SDK guarantee. Do not write a test that asserts strict monotonicity, and do not put
   the claim in user-facing docs.
4. **`check:consumer` covers one peer major locally.** It defaults to the dev `firebase-admin`
   (`14.2.0` in this tree). CI fans out over `^12` / `^13` / `^14` plus a pinned-firestore `^12` leg
   via `FIRESTORE_ORM_ADMIN_VERSION` / `FIRESTORE_ORM_FIRESTORE_VERSION`. **Only the `^14` leg was
   exercised while planning** (and only as a type-check, not a packed-consumer run). `DocumentChange`
   / `DocumentChangeType` are in the `firebase-admin` re-export allowlist on 14.2.0
   (`node_modules/firebase-admin/lib/firestore/index.d.ts:25`) — but this plan uses the
   `FirebaseFirestore.*` **global namespace** form throughout precisely so the allowlist is not load
   bearing. Do not switch to a named import from `firebase-admin/firestore` without re-running
   `check:consumer` on every leg.
5. **Deferred and staying deferred:** write metadata (#72), `explainStream` (#65),
   `AggregateQuerySnapshot.readTime` (ADR-0027 §115 — re-park it on #72, see §9), server-side
   `distinctValues` (#40), Enterprise Pipeline subpath (#41).
6. **Not measured: the runtime cost of `buildDocumentMetadata` per row.** It allocates one object of
   six fields per document when the flag is on, and zero when it is off. No benchmark was run. The
   off-path is unconditionally unchanged, which is the property that matters.

---

## §6 API specification

Copy-verbatim. **Every block below was compiled as written** — see §12.

### §6.1 `src/core/SnapshotMetadata.ts` (new file)

This module has **no imports**. It uses the ambient `FirebaseFirestore` namespace (declared by
`@google-cloud/firestore`), which is what keeps `@google-cloud/firestore` out of the emitted `.d.ts`
— verified in §12. Do not "tidy" these into named imports from `firebase-admin/firestore`.

```ts
/**
 * Snapshot provenance metadata — the Firestore-owned facts about a document that are not part of
 * the document's own data: where it lives, when it was created/updated, and when it was read.
 *
 * Delivered as a **sibling** of the document ({@link WithMetadata}), never overlaid onto it. An
 * overlay would shadow a stored field of the same name and make it unreachable — the same collision
 * ADR-0018 avoids for `id` and ADR-0026 avoids for `updateTime`.
 *
 * `ref` is a live `DocumentReference`, so a `DocumentMetadata` is **not** JSON-serializable. The
 * document it accompanies still is: that is the point of keeping the two apart. Prefer `path` when
 * you only need identity, and rebuild a reference with `db.doc(path)` when you need one.
 */
export type DocumentMetadata = {
  /** Live reference to the document. Not JSON-serializable — prefer {@link DocumentMetadata.path}. */
  readonly ref: FirebaseFirestore.DocumentReference;
  /** Full document path, e.g. `users/u1/posts/p1`. */
  readonly path: string;
  /** Path of the collection containing the document, e.g. `users/u1/posts`. */
  readonly parentPath: string;
  /** Server time the document was created. Stable across later updates. */
  readonly createTime: FirebaseFirestore.Timestamp;
  /** Server time the document was last written, as of this snapshot. */
  readonly updateTime: FirebaseFirestore.Timestamp;
  /** Server time this snapshot was read. Uniform across one query page. */
  readonly readTime: FirebaseFirestore.Timestamp;
};

/**
 * A read result paired with its {@link DocumentMetadata}, returned by any read called with
 * `{ withMetadata: true }`.
 *
 * The document is under `doc`, unchanged from what the same read returns without the flag — so
 * `doc` keeps every property (including the repository-owned `id`) and stays JSON-serializable.
 *
 * @template D - the document shape the underlying read produces
 */
export type WithMetadata<D> = {
  readonly doc: D;
  readonly metadata: DocumentMetadata;
};

/**
 * One entry from a detailed listener's change set — the Admin SDK's `DocumentChange`, mapped
 * through the ORM's result shape.
 *
 * `oldIndex` is `-1` for `'added'`; `newIndex` is `-1` for `'removed'`.
 *
 * ⚠️ For a `'removed'` change, `doc` and `metadata` describe the document **as it last was** — the
 * underlying snapshot still reports `exists: true` and carries its final `createTime`/`updateTime`.
 * Branch on `type`, never on the document. `metadata.readTime` is the emission's read time, not a
 * deletion time; Firestore does not report one.
 *
 * @template R - the builder's result shape
 */
export type DetailedDocumentChange<R> = {
  readonly type: FirebaseFirestore.DocumentChangeType;
  readonly doc: R;
  readonly metadata: DocumentMetadata;
  readonly oldIndex: number;
  readonly newIndex: number;
};

/**
 * The payload delivered to a detailed query listener: the full mapped result set **plus** the
 * incremental change set for this emission.
 *
 * The first emission reports every matching document as an `'added'` change with `oldIndex: -1`.
 *
 * @template R - the builder's result shape
 */
export type DetailedQuerySnapshot<R> = {
  /** Every document currently matching the query, in query order. */
  readonly docs: readonly R[];
  /** What changed since the previous emission. */
  readonly changes: readonly DetailedDocumentChange<R>[];
  readonly size: number;
  readonly empty: boolean;
  /** Server time this emission was read. */
  readonly readTime: FirebaseFirestore.Timestamp;
};

/**
 * Build a {@link DocumentMetadata} from a snapshot.
 *
 * **Only call this for a snapshot that exists.** `createTime` / `updateTime` are optional in the
 * Admin SDK typings solely because they are absent for a NON-EXISTENT document (verified: plan #39
 * probe P1, rows P1b/P1d); every other read path — including field-masked reads, `select()`
 * projections and converter-applied snapshots — populates them. The non-null assertions are
 * therefore sound behind an existence guard, and unsound without one. This mirrors the identical
 * reasoning at `FirestoreRepository.getByIdWithUpdateTime`.
 *
 * Package-internal: not re-exported from the package entry.
 */
export function buildDocumentMetadata(
  snapshot: FirebaseFirestore.DocumentSnapshot,
): DocumentMetadata {
  return {
    ref: snapshot.ref,
    path: snapshot.ref.path,
    parentPath: snapshot.ref.parent.path,
    createTime: snapshot.createTime!,
    updateTime: snapshot.updateTime!,
    readTime: snapshot.readTime,
  };
}
```

### §6.2 `src/core/QueryBuilder.ts`

Add to the import block at the top:

```ts
import {
  buildDocumentMetadata,
  type DetailedQuerySnapshot,
  type WithMetadata,
} from './SnapshotMetadata.js';
```

Add these two members to `FirestoreQueryBuilderBase`, immediately after the abstract `toResult`
declaration (R2c, currently line `387`):

```ts
  /**
   * {@link toResult} paired with the snapshot's provenance metadata — the mapper every
   * `{ withMetadata: true }` terminal uses. Kept beside {@link toResult} so a subclass that
   * overrides the result shape (e.g. the collection-group builder's `path`/`parentPath` overlay)
   * gets the metadata variant for free.
   */
  protected toResultWithMetadata(doc: QueryDocumentSnapshot<any>): WithMetadata<R> {
    return { doc: this.toResult(doc), metadata: buildDocumentMetadata(doc) };
  }

  /**
   * Map a page of snapshots to the shape the caller's `withMetadata` flag selected. One place, so a
   * new terminal cannot forget the branch.
   */
  private mapDocs(
    docs: QueryDocumentSnapshot<any>[],
    withMetadata: boolean | undefined,
  ): R[] | WithMetadata<R>[] {
    return withMetadata
      ? docs.map(doc => this.toResultWithMetadata(doc))
      : docs.map(doc => this.toResult(doc));
  }
```

#### `get` (R2j, currently `1467`)

Keep the existing JSDoc and extend it with the paragraph below; replace the signature and body.

```ts
  /**
   * Execute the query and return all matching documents.
   * This is the main method to retrieve query results.
   *
   * Pass `{ withMetadata: true }` to receive each row as `{ doc, metadata }` instead — the same
   * mapped document under `doc`, plus its Firestore `ref` / `path` / `parentPath` / `createTime` /
   * `updateTime` / `readTime`. The default return shape is unchanged.
   *
   * @param options - Optional `{ withMetadata }` opt-in
   * @returns Array of documents matching the query
   *
   * @example
   * // Simple query
   * const activeUsers = await userRepo.query()
   *   .where('status', '==', 'active')
   *   .get();
   *
   * @example
   * // With snapshot metadata
   * const rows = await userRepo.query().where('status', '==', 'active').get({ withMetadata: true });
   * console.log(rows[0].doc.name, rows[0].metadata.updateTime.toDate());
   */
  async get(options: { withMetadata: true }): Promise<WithMetadata<R>[]>;
  async get(options?: { withMetadata?: false }): Promise<R[]>;
  async get(options?: { withMetadata?: boolean }): Promise<R[] | WithMetadata<R>[]> {
    try {
      const snapshot: QuerySnapshot = await this.query.get();
      return this.mapDocs(snapshot.docs, options?.withMetadata);
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }
```

#### `getOne` (R2f, currently `973`)

Preserve the existing `hasLimitToLast` comment block verbatim — it explains a non-obvious
optimization skip and is not part of this change.

```ts
  async getOne(options: { withMetadata: true }): Promise<WithMetadata<R> | null>;
  async getOne(options?: { withMetadata?: false }): Promise<R | null>;
  async getOne(options?: { withMetadata?: boolean }): Promise<R | WithMetadata<R> | null> {
    try {
      // Build a local limited query instead of calling this.limit(1), which would mutate this.query
      // and permanently limit any later use of the same builder.
      //
      // When limitToLast is active, do NOT apply .limit(1): the Admin SDK treats limit/limitToLast
      // as last-wins, so narrowing would replace limitToLast and return a document from the *front*
      // of the ordered set (outside the intended last-N window). Fetch the limitToLast result and
      // take the first row instead — the optimization is skipped only for that combination.
      const snapshot = this.hasLimitToLast
        ? await this.query.get()
        : await this.query.limit(1).get();
      const doc = snapshot.docs[0];
      if (!doc) return null;
      return options?.withMetadata ? this.toResultWithMetadata(doc) : this.toResult(doc);
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }
```

#### `stream` (R2g, currently `1328`) — **T2 lives here**

⚠️ **`stream()` opens with a `hasLimitToLast` guard (currently lines `1329`–`1336`) that sits inside
the method, before the `try`. It is reproduced below — do not drop it.** (`stream` has no `select()`
guard; that one is on `onSnapshot`.)

```ts
  // The overload SIGNATURES must not carry `*` — TS1222 ("An overload signature cannot be declared
  // as a generator"). Only the implementation is `async *`.
  stream(options: { withMetadata: true }): AsyncGenerator<WithMetadata<R>>;
  stream(options?: { withMetadata?: false }): AsyncGenerator<R>;
  async *stream(options?: { withMetadata?: boolean }): AsyncGenerator<R | WithMetadata<R>> {
    // Firestore cannot stream limitToLast queries (SDK throws). Reject locally with a clear
    // message before opening the native stream. onSnapshot() is intentionally NOT guarded —
    // listeners work with limitToLast.
    if (this.hasLimitToLast) {
      throw new Error(
        'stream() is not supported after limitToLast(): Firestore cannot stream limitToLast queries. ' +
          'Use get() instead.',
      );
    }

    try {
      // Use the Admin SDK's native query stream so documents are yielded incrementally as they
      // arrive, rather than buffering the entire result set via get(). Node readable streams are
      // async-iterable, so `for await` drives them directly; per-document conversion and error
      // semantics are preserved.
      const source = this.query.stream() as AsyncIterable<QueryDocumentSnapshot<any>>;
      for await (const doc of source) {
        yield options?.withMetadata ? this.toResultWithMetadata(doc) : this.toResult(doc);
      }
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }
```

#### `paginate` (R2d, currently `826`)

Signatures only — **the existing body is unchanged except for its final mapping line.** Keep all
four guard blocks (`assertPositiveInt`, the `hasOrderBy` requirement, the `hasLimitToLast` reject,
the `hasOffset` reject) and the cursor/`limit(pageSize + 1)` logic exactly as they are.

```ts
  async paginate(
    pageSize: number,
    cursor: string | null | undefined,
    options: { withMetadata: true },
  ): Promise<{ items: WithMetadata<R>[]; nextCursor: string | null; hasMore: boolean }>;
  async paginate(
    pageSize: number,
    cursor?: string | null,
    options?: { withMetadata?: false },
  ): Promise<{ items: R[]; nextCursor: string | null; hasMore: boolean }>;
  async paginate(
    pageSize: number,
    cursor?: string | null,
    options?: { withMetadata?: boolean },
  ): Promise<{ items: R[] | WithMetadata<R>[]; nextCursor: string | null; hasMore: boolean }> {
```

Then replace only this line:

```ts
      const items = pageDocs.map(doc => this.toResult(doc));
```

with:

```ts
      const items = this.mapDocs(pageDocs, options?.withMetadata);
```

**Note the middle parameter on the metadata overload is `cursor: string | null | undefined`, not
`cursor?:`.** A required-position parameter cannot follow an optional one in the same signature, and
callers must pass `null` explicitly to reach the third argument.

#### `offsetPaginate` (R2e, currently `901`)

Same treatment. Keep both guard blocks and the `count()` / offset math untouched.

```ts
  async offsetPaginate(
    page: number,
    pageSize: number,
    options: { withMetadata: true },
  ): Promise<{
    items: WithMetadata<R>[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  }>;
  async offsetPaginate(
    page: number,
    pageSize: number,
    options?: { withMetadata?: false },
  ): Promise<{ items: R[]; page: number; pageSize: number; total: number; totalPages: number }>;
  async offsetPaginate(
    page: number,
    pageSize: number,
    options?: { withMetadata?: boolean },
  ): Promise<{
    items: R[] | WithMetadata<R>[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  }> {
```

Replace only `const items = snapshot.docs.map(doc => this.toResult(doc));` with
`const items = this.mapDocs(snapshot.docs, options?.withMetadata);`.

#### `paginateWithCount` (R2i, currently `1424`) — **T4 lives here**

```ts
  async paginateWithCount(
    pageSize: number,
    cursor: string | null | undefined,
    options: { withMetadata: true },
  ): Promise<{
    items: WithMetadata<R>[];
    nextCursor: string | null;
    hasMore: boolean;
    total: number;
  }>;
  async paginateWithCount(
    pageSize: number,
    cursor?: string | null,
    options?: { withMetadata?: false },
  ): Promise<{ items: R[]; nextCursor: string | null; hasMore: boolean; total: number }>;
  async paginateWithCount(
    pageSize: number,
    cursor?: string | null,
    options?: { withMetadata?: boolean },
  ): Promise<{
    items: R[] | WithMetadata<R>[];
    nextCursor: string | null;
    hasMore: boolean;
    total: number;
  }> {
    try {
      const total = await this.count();
      // The third argument MUST be forwarded: without it `paginate` resolves to its no-metadata
      // overload and returns bare rows while this method's declared type promises wrappers. The
      // implementation signature's union return absorbs the mismatch, so nothing fails to compile.
      const result = await this.paginate(pageSize, cursor, options as { withMetadata: true });
      return { ...result, total };
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }
```

#### `onSnapshotDetailed` — new, immediately after `onSnapshot` (R2h, after line `1404`)

```ts
  /**
   * Subscribe to real-time updates **with the incremental change set**, rather than only the full
   * result array.
   *
   * Each emission delivers the complete mapped result set (`docs`) *and* what changed since the
   * previous one (`changes`) — the Admin SDK's `docChanges()`, mapped through this builder's result
   * shape and paired with per-document metadata. The first emission reports every matching document
   * as an `'added'` change with `oldIndex: -1`.
   *
   * Use {@link onSnapshot} when you only need the current array; this method exists for consumers
   * that maintain their own list and want to apply deltas.
   *
   * ⚠️ A `'removed'` change carries the document **as it last was** (`doc` and `metadata` are
   * populated, and the underlying snapshot reports `exists: true`). Branch on `change.type`, never
   * on the document. `readTime` is the emission's read time — Firestore reports no deletion time.
   *
   * Like {@link onSnapshot}, this cannot be combined with `select()`: Firestore does not allow a
   * real-time listener on a field-masked query.
   *
   * @param callback - Function called with each detailed emission
   * @param onError - Optional error handler
   * @returns Unsubscribe function to stop listening
   *
   * @example
   * const unsubscribe = await orderRepo.query()
   *   .where('status', '==', 'active')
   *   .onSnapshotDetailed(snapshot => {
   *     for (const change of snapshot.changes) {
   *       if (change.type === 'added') addRow(change.newIndex, change.doc);
   *       else if (change.type === 'removed') removeRow(change.oldIndex);
   *       else moveRow(change.oldIndex, change.newIndex, change.doc);
   *     }
   *   });
   *
   * // Later: stop listening
   * unsubscribe();
   */
  async onSnapshotDetailed(
    callback: (snapshot: DetailedQuerySnapshot<R>) => void,
    onError?: (error: Error) => void,
  ): Promise<() => void> {
    // Same server-side restriction as onSnapshot(): reject locally with an actionable message
    // instead of letting an opaque SDK error arrive asynchronously through onError.
    if (this.hasSelect) {
      throw new Error(
        'onSnapshotDetailed() is not supported after select(): Firestore does not allow real-time ' +
          'listeners on a projected (field-masked) query. Listen without select() and project ' +
          'in your callback, or use get()/stream() for a one-time projected read.',
      );
    }

    try {
      return this.query.onSnapshot(
        snapshot => {
          callback({
            docs: snapshot.docs.map(doc => this.toResult(doc)),
            changes: snapshot.docChanges().map(change => ({
              type: change.type,
              doc: this.toResult(change.doc),
              metadata: buildDocumentMetadata(change.doc),
              oldIndex: change.oldIndex,
              newIndex: change.newIndex,
            })),
            size: snapshot.size,
            empty: snapshot.empty,
            readTime: snapshot.readTime,
          });
        },
        error => {
          // Normalize async stream errors through the same error parser as one-time reads, so the
          // same query surfaces one error type however it is read.
          if (onError) onError(parseFirestoreError(error));
        },
      );
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }
```

### §6.3 `src/core/FirestoreRepository.ts`

Add to the import block:

```ts
import {
  buildDocumentMetadata,
  type WithMetadata,
} from './SnapshotMetadata.js';
```

Two private helpers — put them immediately before `getById` (R1a):

```ts
  /**
   * Materialize one existing snapshot into the shape the caller's `withMetadata` flag selected.
   *
   * **Requires `snapshot.exists`.** Every caller narrows first; see {@link buildDocumentMetadata}
   * for why the metadata builder is unsound on a missing document.
   */
  private toDocumentResult(
    snapshot: FirebaseFirestore.DocumentSnapshot,
    withMetadata: boolean | undefined,
  ): FirestoreDocument<T> | WithMetadata<FirestoreDocument<T>> {
    // Overlay the authoritative document name (snapshot.id), never a caller-supplied argument.
    const doc = asFirestoreDocument<T>({ ...(snapshot.data() as T), id: snapshot.id });
    return withMetadata ? { doc, metadata: buildDocumentMetadata(snapshot) } : doc;
  }

  /**
   * Metadata-carrying counterpart to {@link mapManySnapshots}.
   *
   * Deliberately a SEPARATE method rather than a flag on `mapManySnapshots`: that helper is shared
   * with `getManyInTransaction`, whose result shape is out of scope for issue #39 and whose
   * `ReadOnlyTransactionalRepository` overloads would not catch a shape change.
   */
  private mapManySnapshotsWithMetadata(
    snapshots: FirebaseFirestore.DocumentSnapshot[],
  ): (WithMetadata<FirestoreDocument<T>> | null)[] {
    return snapshots.map(snapshot =>
      snapshot.exists
        ? {
            doc: asFirestoreDocument<T>({ ...(snapshot.data() as T), id: snapshot.id }),
            metadata: buildDocumentMetadata(snapshot),
          }
        : null,
    );
  }
```

#### `getById` (R1a, `1636`)

```ts
  async getById(
    id: ID,
    options: { withMetadata: true },
  ): Promise<WithMetadata<FirestoreDocument<T>> | null>;
  async getById(id: ID, options?: { withMetadata?: false }): Promise<FirestoreDocument<T> | null>;
  async getById(
    id: ID,
    options?: { withMetadata?: boolean },
  ): Promise<FirestoreDocument<T> | WithMetadata<FirestoreDocument<T>> | null> {
    this.validateId(id);
    try {
      const snapshot = await this.readCol().doc(id).get();
      if (!snapshot.exists) return null;
      return this.toDocumentResult(snapshot, options?.withMetadata);
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }
```

#### `getByIdOrThrow` (R1b, `1714`) — **T5 lives here**

```ts
  async getByIdOrThrow(
    id: ID,
    options: { withMetadata: true },
  ): Promise<WithMetadata<FirestoreDocument<T>>>;
  async getByIdOrThrow(id: ID, options?: { withMetadata?: false }): Promise<FirestoreDocument<T>>;
  async getByIdOrThrow(
    id: ID,
    options?: { withMetadata?: boolean },
  ): Promise<FirestoreDocument<T> | WithMetadata<FirestoreDocument<T>>> {
    // Forward `options` — calling the no-argument overload here silently drops the metadata the
    // declared return type promises, with no compile error at either end.
    const doc = await this.getById(id, options as { withMetadata: true });
    if (!doc) {
      throw new NotFoundError(`Document with id ${id} not found`);
    }
    return doc;
  }
```

#### `getMany` (R1d/R1e, `1787`–`1813`) — **T3 lives here**

Four overloads over one implementation. Keep the entire existing JSDoc block and add a
`withMetadata` paragraph to it.

```ts
  async getMany(
    ids: ID[],
    options: { fieldMask: (FieldPaths<OmitId<S>> | FieldPath)[]; withMetadata: true },
  ): Promise<(WithMetadata<FirestoreDocument<DeepPartial<T>>> | null)[]>;
  async getMany(
    ids: ID[],
    options: { fieldMask?: undefined; withMetadata: true },
  ): Promise<(WithMetadata<FirestoreDocument<T>> | null)[]>;
  async getMany(
    ids: ID[],
    options: { fieldMask: (FieldPaths<OmitId<S>> | FieldPath)[]; withMetadata?: false },
  ): Promise<(FirestoreDocument<DeepPartial<T>> | null)[]>;
  async getMany(
    ids: ID[],
    options?: { fieldMask?: undefined; withMetadata?: false },
  ): Promise<(FirestoreDocument<T> | null)[]>;
  async getMany(
    ids: ID[],
    options?: {
      fieldMask?: (FieldPaths<OmitId<S>> | FieldPath)[];
      withMetadata?: boolean;
    },
  ): Promise<
    (
      | FirestoreDocument<T>
      | FirestoreDocument<DeepPartial<T>>
      | WithMetadata<FirestoreDocument<T>>
      | WithMetadata<FirestoreDocument<DeepPartial<T>>>
      | null
    )[]
  > {
```

The body is unchanged except its final mapping line. Replace:

```ts
      return this.mapManySnapshots(snapshots);
```

with:

```ts
      return options?.withMetadata
        ? this.mapManySnapshotsWithMetadata(snapshots)
        : this.mapManySnapshots(snapshots);
```

#### `getAll` (R1j, `3116`), `findByField` (R1f, `2957`), `getOneByField` (R1g, `2995`), `getOneByFieldOrThrow` (R1h, `3029`)

All four follow the same mechanical pattern: add an overload pair whose `true` branch wraps the
existing return type in `WithMetadata<…>`, widen the implementation signature to the union, and
route the existing `asFirestoreDocument({...})` construction through `toDocumentResult`. Signatures:

```ts
  async getAll(options: { withMetadata: true }): Promise<WithMetadata<FirestoreDocument<T>>[]>;
  async getAll(options?: { withMetadata?: false }): Promise<FirestoreDocument<T>[]>;
  async getAll(
    options?: { withMetadata?: boolean },
  ): Promise<FirestoreDocument<T>[] | WithMetadata<FirestoreDocument<T>>[]> {
    try {
      const snapshot = await this.readCol().get();
      return options?.withMetadata
        ? snapshot.docs.map(doc => ({
            doc: asFirestoreDocument<T>({ ...(doc.data() as T), id: doc.id }),
            metadata: buildDocumentMetadata(doc),
          }))
        : snapshot.docs.map(doc => asFirestoreDocument<T>({ ...(doc.data() as T), id: doc.id }));
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  async findByField(
    field: FieldPaths<OmitId<S>> | FieldPath,
    value: unknown,
    options: { withMetadata: true },
  ): Promise<WithMetadata<FirestoreDocument<T>>[]>;
  async findByField(
    field: FieldPaths<OmitId<S>> | FieldPath,
    value: unknown,
    options?: { withMetadata?: false },
  ): Promise<FirestoreDocument<T>[]>;

  async getOneByField(
    field: FieldPaths<OmitId<S>> | FieldPath,
    value: unknown,
    options: { withMetadata: true },
  ): Promise<WithMetadata<FirestoreDocument<T>> | null>;
  async getOneByField(
    field: FieldPaths<OmitId<S>> | FieldPath,
    value: unknown,
    options?: { withMetadata?: false },
  ): Promise<FirestoreDocument<T> | null>;

  async getOneByFieldOrThrow(
    field: FieldPaths<OmitId<S>> | FieldPath,
    value: unknown,
    options: { withMetadata: true },
  ): Promise<WithMetadata<FirestoreDocument<T>>>;
  async getOneByFieldOrThrow(
    field: FieldPaths<OmitId<S>> | FieldPath,
    value: unknown,
    options?: { withMetadata?: false },
  ): Promise<FirestoreDocument<T>>;
```

`getOneByFieldOrThrow`'s existing body does its own `limit(2)` read and duplicate check — it does
**not** delegate to `getOneByField`. Keep the `NotFoundError` / `ConflictError` logic exactly as it
is and only change the final `asFirestoreDocument(...)` line to
`return this.toDocumentResult(doc, options?.withMetadata);`.

#### `listenOneDetailed` — new, immediately after `listenOne` (R1i)

`listenOne`'s closing brace is at line `3102`; `getAll`'s JSDoc opens at `3104`. Insert between them.

```ts
  /**
   * Subscribe to real-time updates for a single document, **with snapshot metadata**.
   *
   * Identical to {@link listenOne} except that the callback receives `{ doc, metadata }` — the same
   * document under `doc`, plus its Firestore `ref` / `path` / `parentPath` / `createTime` /
   * `updateTime` / `readTime`.
   *
   * Deletion is reported the same way {@link listenOne} reports it: through
   * `onError(new NotFoundError(...))`, not as a callback emission. A deleted document's snapshot
   * carries no `createTime` / `updateTime`, so there is no metadata to deliver for it.
   *
   * @param id - Document ID to observe
   * @param callback - Function invoked with the updated document and its metadata
   * @param onError - Optional error handler for not-found and Firestore errors
   * @returns Unsubscribe function to stop listening
   *
   * @example
   * const unsubscribe = userRepo.listenOneDetailed(
   *   'user-123',
   *   ({ doc, metadata }) => {
   *     console.log(`${doc.name} last written ${metadata.updateTime.toDate().toISOString()}`);
   *   },
   *   error => console.error(error),
   * );
   */
  listenOneDetailed(
    id: ID,
    callback: (item: WithMetadata<FirestoreDocument<T>>) => void,
    onError?: (error: Error) => void,
  ): () => void {
    this.validateId(id);
    try {
      return this.readCol()
        .doc(id)
        .onSnapshot(
          snapshot => {
            try {
              if (!snapshot.exists) {
                if (onError) {
                  onError(new NotFoundError(`Document with id ${id} not found`));
                }
                return;
              }

              callback({
                doc: asFirestoreDocument<T>({ ...(snapshot.data() as T), id: snapshot.id }),
                metadata: buildDocumentMetadata(snapshot),
              });
            } catch (error: any) {
              if (onError) {
                onError(parseFirestoreError(error));
              }
            }
          },
          error => {
            if (onError) {
              onError(parseFirestoreError(error));
            }
          },
        );
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }
```

### §6.4 `src/index.ts` (R4)

Append after the `QueryBuilder` type-export blocks:

```ts
export type {
  DocumentMetadata,
  WithMetadata,
  DetailedDocumentChange,
  DetailedQuerySnapshot,
} from './core/SnapshotMetadata.js';
```

**Type-only.** Do not export `buildDocumentMetadata` — §3.5 shows `src/index.ts` has **zero** slack
on the 100% lines and branches gate, and a value export adds an executable line.

### §6.5 `src/vector/index.ts` (R5)

Append, matching the existing comment style at lines `19-24`:

```ts
// Re-exported so /vector consumers can name the opt-in snapshot-metadata shapes returned by the
// proxied core reads on a VectorEnabledRepository, without importing the main entry
// (core/SnapshotMetadata has no export-map subpath) — same rationale as VectorValueLike above.
export type {
  DocumentMetadata,
  WithMetadata,
  DetailedDocumentChange,
  DetailedQuerySnapshot,
} from '../core/SnapshotMetadata.js';
```

### §6.6 Size estimate

| File                                | Change                        |
| ----------------------------------- | ----------------------------- |
| `src/core/SnapshotMetadata.ts`      | new, ~120 lines (mostly JSDoc) |
| `src/core/QueryBuilder.ts`          | ~+190 / −8                    |
| `src/core/FirestoreRepository.ts`   | ~+230 / −12                   |
| `src/index.ts`                      | +6                            |
| `src/vector/index.ts`               | +9                            |
| tests (3 files)                     | ~+420                         |
| docs + ADR                          | ~+230 across 18 files         |

---

## §7 Implementation sequence

1. **Check out the existing branch and rebase — do not cut a new one.**

   ```bash
   git fetch origin && git checkout feat/issue-39-snapshot-metadata-detailed-listener && git rebase origin/main
   ```

   Then **re-run the §3.4 enumeration** and fix any drifted line numbers in your own notes before
   editing. `main` may have moved since `32ce4c1`.

2. **Create `src/core/SnapshotMetadata.ts`** (§6.1) and run `npm run test:types`. It must pass with
   the module unreferenced. *Why first:* every later step imports from it, and a mistake here shows
   up as noise in every other file.

3. **`QueryBuilder.ts`: add `toResultWithMetadata` + `mapDocs`**, then the six terminal overload
   pairs (§6.2), then `onSnapshotDetailed`. Run `npm run test:types` after the terminals and again
   after the listener. *Why before the repository:* `FirestoreRepository.query()` returns this
   builder, so a broken builder signature surfaces as a confusing repository-side error.

4. **`FirestoreRepository.ts`: add the two private helpers**, then `getById` / `getByIdOrThrow` /
   `getMany` (§6.3), then the four remaining reads, then `listenOneDetailed`. **Do `getMany` third,
   while you are still fresh** — it is the four-overload one (T3).

5. **Wire the exports** — `src/index.ts` (§6.4) then `src/vector/index.ts` (§6.5). Run
   `npm run build && npm run check:package`. *Why here:* the export map is what makes the next step's
   type test meaningful.

6. **Write the type test** `src/tests/types/snapshot-metadata.type-test.ts` (§8, T-1), porting
   `probes/p3-overload-resolution.type-probe.ts` onto the **real** classes. Run `npm run test:types`.

7. **Write the integration tests** (§8, I-1 → I-3). Run `npm run test:integration:emulator`.

8. **Mutation-check the load-bearing tests.** For each of I-1, I-2, I-3: `git stash` the source
   change the test guards, confirm the test **fails**, `git stash pop`. Record each result in
   `notes.md`. A test that passes both ways guards nothing.

9. **Docs and ADR** (§9), in the order listed there — the ADR number is claimed first because three
   other edits reference it.

10. **Full gate** (§10). Report failures honestly with output.

### Anti-instructions — do **NOT**

- **Do not commit unless asked.**
- **Do not** add a `withMetadata` parameter to `mapManySnapshots` (T7) or otherwise touch
  `getManyInTransaction` / `getInTransaction` / `ReadOnlyTransactionalRepository`. Out of scope (D3),
  and `tsc` will not catch a shape change there (R-7).
- **Do not** add `withMetadata` to `VectorQueryBuilder.get()` / `.getOne()` / `.explain()`. Out of
  scope (D3). It is a composition wrapper, not a subclass (R-5) — nothing forces this on you, so
  adding it would be scope creep, not consistency.
- **Do not** add `withMetadata` to `explain()`, `count()`, `sum()`, `average()`, `aggregate()`,
  `distinctValues()` or `exists()` (§2).
- **Do not** add a `boolean`-accepting overload to "fix" T10. The compile error on a hoisted options
  object is correct: TypeScript cannot select a return type from a runtime value. Document it
  instead.
- **Do not** overlay metadata keys onto the document (D8). No `doc.createTime`, no `doc.readTime`.
- **Do not** change `getByIdWithUpdateTime` (R-9), `PaginatedResult` (R-8), `listenOne`, or
  `onSnapshot`. The acceptance criterion is "existing return shapes unchanged" and these are the
  ones a tidying instinct reaches for.
- **Do not** export `buildDocumentMetadata` from `src/index.ts` (§3.5 — zero gate slack).
- **Do not** import `DocumentChange` / `DocumentChangeType` by name from `firebase-admin/firestore`.
  Use the ambient `FirebaseFirestore.*` namespace as §6 does, so the re-export allowlist is not load
  bearing across peer majors (§5 item 4).
- **Do not** write an ADR amendment that rewrites an earlier amendment blockquote. They are
  historical snapshots (§9).
- **Do not** assert `readTime` strict monotonicity in a test (§5 item 3).
- **Do not** delete the plan directory until after review (§11).

---

## §8 Test specification

### T-1 — `src/tests/types/snapshot-metadata.type-test.ts` (new) · gate: `test:types`

Port `probes/p3-overload-resolution.type-probe.ts` onto the real `FirestoreRepository` and
`FirestoreQueryBuilder`. Every row below is already proven to behave as stated (§3.3).

| Assert                                                       | Observable when it fails                                             | Guards   |
| ------------------------------------------------------------ | -------------------------------------------------------------------- | -------- |
| `getById(id)` → `FirestoreDocument<T> \| null` (V1)          | return type widened to include the wrapper                            | D2       |
| `getById(id, { withMetadata: true })` → `WithMetadata<…>\|null` (V4) | the flag resolves to the plain overload                       | T5       |
| `@ts-expect-error` on a widened `boolean` flag (V2)          | the expect-error becomes *unused* → `test:types` fails                | T10      |
| `@ts-expect-error` on a hoisted options object (V3)          | same                                                                  | T10      |
| `@ts-expect-error` on `{ withMetaData: true }` (V5)          | same                                                                  | —        |
| `@ts-expect-error` assigning `WithMetadata<D>` to `D` (V7)   | same — a mapper that forgot to wrap would start type-checking         | T3       |
| all four `getMany` cells resolve to distinct types (V6)      | the `{fieldMask, withMetadata}` cell collapses to the plain mask type | **T3**   |
| `stream({ withMetadata: true })` yields `WithMetadata<R>`    | generator overload not selected                                       | T2       |
| `paginateWithCount(n, null, { withMetadata: true }).items[0].metadata` is nameable | third-arg overload missing                      | T4       |
| collection-group builder: `get({ withMetadata: true })[0].doc.path` is `string` | inheritance did not carry the overload             | R3       |
| `DetailedQuerySnapshot<R>['changes'][number]['type']` accepts `'added' \| 'modified' \| 'removed'` | change type widened/narrowed wrongly | D4 |

Use `Expect<A, B>` equality helpers (as the probe does), not bare assignability — assignability
alone passes when the type is wider than intended.

### I-1 — `src/tests/integration/repository-snapshot-metadata.integration.test.ts` (new) · gate: `test:coverage:gate:integration` (`FirestoreRepository`)

Use `createUserRepoHarness()` from `src/tests/integration/helpers/firestoreIntegrationHarness.ts`.

| #   | Assert                                                                                                        | Observable when it fails                                             | Guards   |
| --- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------- |
| 1   | `getById(id, { withMetadata: true })` → `doc` deep-equals the plain `getById(id)` result                       | the wrapper mutated or dropped document fields                        | D8       |
| 2   | …and `metadata.path === \`${collectionPath}/${id}\``, `metadata.parentPath === collectionPath`, `metadata.ref.path === metadata.path` | path built from the wrong ref                    | —        |
| 3   | `metadata.createTime` / `updateTime` / `readTime` are all `Timestamp` instances                                | a non-null assertion produced `undefined`                             | **T1**   |
| 4   | after an `update()`, a re-read's `createTime` is unchanged and `updateTime` has advanced (P1k)                 | createTime/updateTime swapped at the build site                       | —        |
| 5   | `getById('missing', { withMetadata: true })` → `null` (not a metadata object with `undefined` times)           | existence guard bypassed                                              | **T1**   |
| 6   | `getByIdOrThrow(id, { withMetadata: true })` returns a wrapper whose `metadata.updateTime` is defined           | **`options` not forwarded → `.metadata` is `undefined` at runtime**   | **T5**   |
| 7   | `getMany([a, 'ghost', b], { withMetadata: true })` → `[wrapper, null, wrapper]`, positions preserved            | missing position became a metadata object with `undefined` times      | **T1**   |
| 8   | `getMany([a], { fieldMask: ['name'], withMetadata: true })[0].doc` has `name` + `id` only, and `.metadata.createTime` is defined | **the 4th overload cell is missing → runtime shape ≠ declared type** | **T3**   |
| 9   | `getManyInTransaction(tx, [a])` **still** returns a bare document (`rows[0].name` defined, `rows[0].doc` undefined) | the shared mapper was flagged instead of duplicated               | **T7**   |
| 10  | `getAll` / `findByField` / `getOneByField` / `getOneByFieldOrThrow` each return wrappers with populated metadata | one of the four was left unwired                                     | D3       |
| 11  | every default (no-options) call above returns the **unwrapped** legacy shape                                    | an overload defaulted the wrong way                                   | acceptance |
| 12  | with a configured `readConverter`, `{ withMetadata: true }` still applies the converter to `doc` and populates `metadata` (P1i) | metadata built from a pre-converter snapshot          | —        |
| 13  | `query().orderBy('name').paginateWithCount(2, null, { withMetadata: true })` → `items[0].metadata.readTime` is a `Timestamp`, and `total` is the full count | **`options` not forwarded to `paginate` → `items[0].metadata` is `undefined` at runtime while the declared type promises it** | **T4** |

> **#13 is the only test for T4.** It exercises a `QueryBuilder` terminal but lives in this
> repository-backed suite because a seeded collection already exists here. Do not drop it as
> "belongs in the query suite."

### I-2 — `src/tests/integration/repository-detailed-listener.integration.test.ts` (new) · gate: `test:coverage:gate:integration` (`QueryBuilder`, `FirestoreRepository`)

Drive the emulator the way `probes/p2-doc-changes.mjs` does: subscribe, mutate with `await`ed
spacing, collect emissions, unsubscribe, then assert on the collected array. **Always call the
unsubscribe function in a `finally`** — a leaked listener makes later suites flaky.

| #   | Assert                                                                                                     | Observable when it fails                                              | Guards |
| --- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ------ |
| 1   | first emission: every doc is `type: 'added'`, `oldIndex === -1`, `newIndex` ascending from 0 (P2a)            | initial snapshot not mapped through `docChanges()`                     | D4     |
| 2   | `docs` on that emission deep-equals what `get()` returns for the same query                                   | the two mappers diverged                                               | —      |
| 3   | in-place edit → exactly one `modified` change with `oldIndex === newIndex` (P2b)                              | change set not incremental                                             | D4     |
| 4   | reordering edit → one `modified` change with `oldIndex !== newIndex` (P2c)                                    | indexes not forwarded                                                  | D4     |
| 5   | **delete → one change with `type === 'removed'`, `newIndex === -1`, and `change.doc.name` equal to the last-known value** | **deletions silently absent, or `doc` undefined**             | **T6** |
| 6   | that removed change's `metadata.createTime` and `updateTime` are defined (P2d)                                | metadata skipped for removals                                          | **T6** |
| 7   | `snapshot.readTime` is a `Timestamp` on every emission; `size` and `empty` agree with `docs.length` (P2e)     | fields dropped from the payload                                        | —      |
| 8   | `query().select('name').onSnapshotDetailed(...)` **rejects** with the `not supported after select()` message  | **no local guard → an opaque async SDK error instead**                 | **T8** |
| 9   | the existing `onSnapshot` still delivers a bare `R[]` for the same query                                      | the sibling was modified                                               | acceptance |
| 10  | `listenOneDetailed` delivers `{ doc, metadata }` with populated times while the document exists               | wrapper not built                                                      | D4     |
| 11  | `listenOneDetailed` on a **deleted** document calls `onError` with a `NotFoundError` and does **not** invoke the callback | delete leaked into the callback with broken metadata     | **D5** |
| 12  | `listenOneDetailed('missing-id', …)` calls `onError` with `NotFoundError` (parity with `listenOne`)           | divergence from the sibling                                            | D5     |

### I-3 — extend `src/tests/integration/repository-collection-group.integration.test.ts` · gate: `test:coverage:gate:integration` (`CollectionGroup`)

R3 says there is **no source change** in `CollectionGroup.ts`. That makes the tests the only thing
proving inheritance actually works.

| #   | Assert                                                                                                | Observable when it fails                                     | Guards |
| --- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------ |
| 1   | `collectionGroup().query().get({ withMetadata: true })` returns wrappers whose `doc` still carries `id`, `path`, `parentPath` | the CG `toResult` override was bypassed          | R3     |
| 2   | **`row.doc.path === row.metadata.path` and `row.doc.parentPath === row.metadata.parentPath` for every row across ≥2 distinct parents** | the two identity sources disagree            | **T9** |
| 3   | `collectionGroup().query().stream({ withMetadata: true })` yields wrappers                              | generator overload not inherited                                | T2/R3  |
| 4   | `collectionGroup().query().onSnapshotDetailed(...)` delivers changes whose `metadata.parentPath` differs across parents | change mapping lost group identity              | R3/T9  |

### Trap-coverage matrix — every trap, at every site it can occur

| Trap    | Site                                              | Test that fails                     | Observable it names                                                        |
| ------- | ------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------- |
| **T1**  | `getById`                                         | I-1 #3, I-1 #5                      | `metadata.createTime` is not a `Timestamp` / `null` became a metadata object   |
| T1      | `getMany` (missing position)                      | I-1 #7                              | position 1 is an object, not `null`                                            |
| T1      | `getAll` / `findByField` / `getOneByField*`       | I-1 #10                             | one of the four has `undefined` times                                          |
| T1      | `listenOneDetailed`                               | I-2 #10                             | `metadata.updateTime` undefined in the callback                                |
| **T2**  | `QueryBuilder.stream`                             | T-1 (`stream` row) + `test:types`   | TS1222 at build, or the yielded type is bare `R`                               |
| T2      | collection-group `stream`                         | I-3 #3                              | yielded row has no `.metadata`                                                 |
| **T3**  | `getMany` `{fieldMask, withMetadata}` cell        | T-1 (V6 row) **and** I-1 #8         | declared `DeepPartial<T>` vs runtime `{doc, metadata}` — `row.name` undefined  |
| **T4**  | `paginateWithCount`                               | **I-1 #13**                         | `items[0].metadata` is `undefined` at runtime while the type promises a `Timestamp` |
| **T5**  | `getByIdOrThrow`                                  | I-1 #6                              | `.metadata` is `undefined` on the returned object                              |
| **T6**  | `onSnapshotDetailed` removal                      | I-2 #5, I-2 #6                      | no `removed` change present / `change.doc` undefined                           |
| T6      | collection-group `onSnapshotDetailed`             | I-3 #4                              | change set empty on a delete                                                   |
| **T7**  | `mapManySnapshots` shared with transactions       | I-1 #9                              | `rows[0].doc` is defined inside a transaction (shape leaked)                   |
| **T8**  | `onSnapshotDetailed` after `select()`             | I-2 #8                              | promise resolves instead of rejecting; error arrives via `onError` later       |
| **T9**  | collection-group `path` / `parentPath` duplication | I-3 #2                              | `row.doc.path !== row.metadata.path`                                           |
| **T10** | hoisted options object                            | T-1 (V2, V3 rows)                   | the `@ts-expect-error` goes unused → `test:types` fails                        |

### Gate headroom

§3.5 measured the slack. The binding constraint is **`QueryBuilder` functions at +5.00 over a 95%
threshold**: `toResultWithMetadata`, `mapDocs` and `onSnapshotDetailed` are three new functions and
all three must execute in the integration suite. I-2 and I-3 cover `onSnapshotDetailed`; I-1 #13 and
I-3 #1/#3 cover `mapDocs` and `toResultWithMetadata`. Every new branch in `FirestoreRepository`
(+7.94 lines / +16.45 branches of slack) is exercised by I-1.

`src/core/SnapshotMetadata.ts` matches **no gate** (D6) — the same situation as
`src/core/DocumentId.ts`. Its coverage still appears in the integration LCOV; it is simply not
threshold-enforced. Do not add a gate row (D6). Do not treat "ungated" as "untested":
`buildDocumentMetadata` is on every metadata path in I-1/I-2/I-3.

**Every new test must fail on the unfixed baseline** — mutation-check I-1, I-2 and I-3 per §7 step 8
and record the results in `notes.md`.

---

## §9 Docs and ADR bookkeeping

#39 carries `parity` + `v3.x` and is in ADR-0017's deferral set, so the **full** deferral
bookkeeping applies. This is the section where silent omissions happen.

### 9.1 New ADR — `docs/adr/0033-snapshot-metadata-and-detailed-listeners.md`

`0033` is the next free number (`docs/adr/` currently tops out at `0032`; re-check after rebase).
Start from `docs/adr/0000-template.md` via the `/adr` skill. Required content:

1. **Context** — issue #39; the parity gap; what the SDK exposes (`DocumentSnapshot.ref` /
   `createTime` / `updateTime` / `readTime`, `QuerySnapshot.readTime` / `docChanges()`).
2. **Decision** — sourced from §1 D1–D8. In particular: the `{ withMetadata: true }` options-bag
   opt-in (D2), the `{ doc, metadata }` **sibling** shape and why it is not an overlay (D8, citing
   ADR-0018 and ADR-0026), new sibling listener methods rather than changed callbacks (D4), and
   `listenOneDetailed`'s `onError` deletion contract (D5).
3. **The bounded surface (D3)** — name what is in and what is deliberately out, with the reason for
   each: vector terminals (composition wrapper, R-5), transaction reads, `explain()`, aggregates.
4. **The scope split** — write metadata deferred to
   [#72](https://github.com/reggieofarrell/firestore-orm/issues/72), with the two constraints found
   while planning: `CollectionReference.add()` yields no `WriteResult`, and transaction writes
   cannot yield a `writeTime` at all.
5. **Consequences** — including "Capability matrix: #39 moves Deferred → Supported (reads +
   listeners); write metadata tracked as #72", and the hoisted-options-object ergonomics (T10).
6. **Alternatives considered** — the rejected columns of D1–D6, in the ADR's voice.
7. **References** — implementation files, test files, ADR-0017, ADR-0018 (identity collision),
   ADR-0026 (`getByIdWithUpdateTime`, the pair-shape precedent), ADR-0024 (CG identity overlay,
   T9's other half), ADR-0029 (`getMany`), ADR-0031/0032 (the split precedents).
8. **Living-index footer** — the standard blockquote, with the range decremented to `(#40–#41)` and
   `#39` added to "have since shipped". Do **not** link to the mutable Starlight guides.

### 9.2 `docs/adr/README.md`

Append one row after the `0032` row (currently the last line of the table):

```
| [0033](0033-snapshot-metadata-and-detailed-listeners.md)               | Opt-in snapshot metadata (`withMetadata`) + detailed `docChanges` listeners      | Accepted (v3.x, pending merge/release)                        | <YYYY-MM-DD> |
```

Match the existing column padding — that table is prettier-formatted.

### 9.3 ADR-0017 amendment

Insert a new blockquote in `docs/adr/0017-v3-core-operations-scope.md` **after** the `#38` amendment
that currently ends at line `123`, and **before** the `We explicitly do **not** block v3…` line at
`125`. Do not touch any earlier amendment — they are historical snapshots.

Content, following the `#37` "partial" pattern verbatim: snapshot **read** metadata and detailed
listeners are no longer deferred — they ship in 3.0.0 as `{ withMetadata: true }` on the core reads
and query terminals, plus `onSnapshotDetailed()` / `listenOneDetailed()`. **Write** metadata stays
deferred ([#72](https://github.com/reggieofarrell/firestore-orm/issues/72)). So #39 leaves this list
for read metadata and detailed listeners. The remaining deferrals **(#40–#41)** are unchanged, as is
the decision not to pursue full server-side or Enterprise Pipeline parity. Rationale and contract:
ADR-0033.

Also update the **References** bullet at `0017:152-159`: add "and #39 is closed by the 3.0.0
`withMetadata` / `onSnapshotDetailed` API (ADR-0033; write metadata remains tracked as #72)", and
change the opening `GitHub issues #39–#41` to `GitHub issues #40–#41`.

### 9.4 Living-index footers — decrement `(#39–#41)` → `(#40–#41)` everywhere

**Grep, do not trust this list** — the set grows with every shipped issue:

```bash
grep -rn "#39–#41" docs/adr/
```

On this baseline that returns **14 rows across 10 files** (expected result — if it returns zero
after your edits, the sweep is done; if it returns zero *before* you edit, `main` moved and you must
re-derive the current range):

| File                                                        | Lines        |
| ----------------------------------------------------------- | ------------ |
| `docs/adr/0017-v3-core-operations-scope.md`                 | `122`, `152` |
| `docs/adr/0023-composite-filter-factory.md`                 | `200`        |
| `docs/adr/0024-collection-group-queries.md`                 | `149`        |
| `docs/adr/0025-transaction-options-readonly-pitr.md`        | `93`         |
| `docs/adr/0026-conditional-writes-preconditions.md`         | `136`        |
| `docs/adr/0027-generic-multi-aggregation.md`                | `163`        |
| `docs/adr/0029-get-many-multi-document-reads.md`            | `127`        |
| `docs/adr/0030-typed-query-bounds-and-limit-to-last.md`     | `85`, `116`  |
| `docs/adr/0031-query-explain.md`                            | `65`, `102`  |
| `docs/adr/0032-bulkwriter-…-recursive-delete.md`            | `72`, `125`  |

In each footer blockquote, also add `#39` to the "have since shipped" clause. Note that `0017:122`
is **inside the #38 amendment blockquote** — that one is a historical snapshot and its `(#39–#41)`
must be **left alone**. Only the *living-index footers* and the *References* bullet change.

> ⚠️ Read each hit before editing — the 14 rows are three different kinds of text.
> `0017:122` is a **frozen amendment snapshot** (leave it). `0017:152` is a **References bullet**.
> `0030:85`, `0031:65` and `0032:72` are terse **`Consequences` bullets** ("Remaining ADR-0017
> deferrals are `#39–#41`."). The remaining nine are the long **living-index footer blockquote**.
> Match each file's own phrasing rather than pasting one replacement everywhere.

After the sweep:

```bash
grep -rn "#39–#41" docs/adr/
```

**Expected result: exactly one row — `0017:122`, the frozen #38 amendment.** Anything else is a
missed footer. (This check passes by matching *almost* nothing, so "it returned nothing" is a
failure, not a pass — it would mean you edited the frozen snapshot.)

### 9.5 Cross-references in ADRs that named #39 as the owner of this capability

```bash
grep -rn "issues/39\|#39" docs/adr/ | grep -v "#39–#41"
```

| File / line                              | Current text                                                           | Change                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `0026-conditional-writes-preconditions.md:10`  | "issue #39 (still owns general …)"                                | Add an `> Amendment` noting #39's read half shipped as ADR-0033; the general write-metadata half is now #72. **Do not edit the original claim.** |
| `0026:59`                                | "issue #39's general opt-in snapshot-metadata shape"                   | Covered by the same amendment                                              |
| `0027-generic-multi-aggregation.md:11`, `:115` | "issue #39 owns snapshot metadata" / "`AggregateQuerySnapshot.readTime` — issue #39 owns snapshot metadata" | `> Amendment`: aggregate `readTime` is **not** in ADR-0033's surface; it re-parks on #72 |
| `0029-get-many-multi-document-reads.md:10`, `:73`, `:104` | "still owns snapshot /…", "No `getManyWithUpdateTime` (the latter is #39)", "Deferred to #39" | `> Amendment`: `getMany(ids, { withMetadata: true })` now supersedes the `getManyWithUpdateTime` idea (ADR-0033) |

### 9.6 Starlight site (`website/src/content/docs/`)

> **`website/**/*.md` is prettier-exempt** (`.prettierignore`) — match surrounding style by hand.
> A `:::note` / `:::caution` aside whose closing fence lands on a content line renders as a literal
> `:::` on the published page, and **neither `check:docs` nor `docs:build` catches it**. This shipped
> live twice (#33, #34). After `npm run docs:build`, grep the built HTML:
> `grep -rn ':::' website/dist/ | head` — **expected result: no rows.**

| Page                                        | Anchor (baseline lines)                                        | Edit                                                                                                                                            |
| ------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reference/repository.md`                   | `## Reads` block, `82`–`161`                                    | Add the `{ withMetadata: true }` overload beside `getById` (`82`), `getByIdOrThrow` (`86`), `getMany` (`100`–`101`), `getAll` (`141`), `findByField` (`145`), `getOneByField` (`149`), `getOneByFieldOrThrow` (`153`). Add `listenOneDetailed` after `listenOne` (`158`), stating the `onError` deletion contract (D5). |
| `reference/repository.md`                   | `getByIdWithUpdateTime` at `90`                                 | Add one sentence: it remains the CAS-token read; `{ withMetadata: true }` is the general shape (R-9). Do not mark it deprecated                    |
| `reference/query-builder.md`                | `## Terminal reads`, `134`–`232`                                | Add the overload to `get` (`136`), `getOne` (`157`), `paginate` (`210`), `offsetPaginate` (`214`), `paginateWithCount` (`219`), `stream` (`223`). Add `onSnapshotDetailed` after `onSnapshot` (`228`) |
| `reference/query-builder.md`                | `14` ("`R` is the result shape of terminal reads")              | Note that `{ withMetadata: true }` wraps `R` in `WithMetadata<R>` rather than changing `R`                                                        |
| `reference/query-builder.md`                | `## Collection-group query builder`, `246`                      | State that the CG builder inherits every `withMetadata` overload and `onSnapshotDetailed`, and that `metadata.path` equals the row's own `path` (T9) |
| `reference/types.md`                        | after the `CollectionGroupDocument<T>` bullet (`~24`–`32`)      | Four new bullets: `DocumentMetadata`, `WithMetadata<D>`, `DetailedDocumentChange<R>`, `DetailedQuerySnapshot<R>`. Say plainly that `doc` stays JSON-serializable and `metadata.ref` does not (D7) |
| `guides/advanced/real-time.md`              | whole page (70 lines)                                           | New section for `onSnapshotDetailed` with the add/modify/remove worked example, the index semantics (P2a–P2c), and the **removed-change warning** (T6). Extend the `listenOne` section (`14`–`34`) with `listenOneDetailed` |
| `guides/working-with-data/crud-operations.md` | `## Single-document operations` (`10`); the read snippet at `24`–`26`; the read-method table at `70`–`73` | Add a "reading snapshot metadata" subsection with the `getById(id, { withMetadata: true })` example **and the hoisted-options caveat (T10)**. Add a `getById(id, { withMetadata: true })` row to the `70`–`73` table |
| `guides/working-with-data/crud-operations.md` | `getByIdWithUpdateTime` prose at `136`–`162`                   | It already explains the pair shape ("not an overlay"). Add one sentence pointing at `{ withMetadata: true }` as the general form of the same idea (R-9, D8) |
| `reference/scope-and-capabilities.md`        | `41`                                                            | Rewrite the trailing sentence: general snapshot **read** metadata now ships (ADR-0033); **write** metadata is [#72]                               |
| `reference/scope-and-capabilities.md`        | `55` (Deferred table)                                           | **Remove** the "Snapshot/write metadata + detailed listeners → #39" row; **add** a "Write metadata (`writeTime`) → #72" row in its place            |
| `reference/scope-and-capabilities.md`        | Supported table (after the `explain()` row, `~46`)              | **Add** a Supported row: "Snapshot read metadata + detailed listeners (`{ withMetadata: true }`, `onSnapshotDetailed`, `listenOneDetailed`)" with a real Notes cell |

### 9.7 READMEs

Neither `README.md` nor `npm-readme.md` needs changing. Verified — install, peer deps, quick-start,
package pitch, migration notes and docs/support links are all untouched by this change:

```bash
grep -n "onSnapshot\|listenOne\|getById\|withMetadata" README.md npm-readme.md
```

**Expected result: no `withMetadata` rows, and any `getById` / `onSnapshot` rows are in
quick-start snippets whose default (no-options) form is unchanged.** Re-run it and confirm before
declaring the READMEs unaffected — do not leave it implicit.

### 9.8 Not applicable — stated explicitly

- **No new error class** ⇒ no edits to `src/core/Errors.ts`, `src/core/ErrorParser.ts`, or the
  status mapping / JSDoc in `src/express/index.ts`. `listenOneDetailed` reuses the existing
  `NotFoundError`.
- **`CHANGELOG.md` is generated** from Conventional Commits — do not hand-edit it.
- **`docs/2.0/`** is a frozen archive — do not touch it.
- **`src/tests/unit/packageExports.unit.test.ts`** needs no change: it asserts *value* exports with
  `toBeDefined()`, and §6.4 adds only type exports (which are erased at runtime and cannot be
  smoke-tested there). T-1 is the guard for the new exports instead.
- **The `testing-docs-sync` bookkeeping does not fire.** That rule triggers on test *infrastructure*
  — jest configs, `scripts/check-coverage-gates.mjs`, husky hooks, shared mocks/factories,
  integration helpers. This PR adds test **files** that follow the existing naming convention and
  reuses `createUserRepoHarness()` unchanged. Verified: `docs/development/testing.md` documents
  patterns and naming (`{domain}.integration.test.ts`, lines `20`–`63`), not an enumerated file
  list, so nothing there goes stale. Do **not** edit `docs/development/testing.md`,
  `docs/development/test-coverage-followups.md`, `scripts/check-coverage-gates.mjs`, the
  unit/integration skills, or `.github/workflows/tests.yml`.
- **`website/astro.config.mjs`** needs no change: §9.6 adds sections to **existing** pages only. A
  sidebar entry is required only for a new guide page.
- **`src/benchmarks/performance.test.ts`** is unaffected — `grep -n "onSnapshot\|getMany\|paginateWithCount" src/benchmarks/` returns **no rows**.

### 9.9 Link check

```bash
npm run check:docs
```

Expected result: passes. Then `npm run docs:build`, then the `:::` grep in the 9.6 callout.

---

## §10 Gate and commit

Run the full 14-leg gate. Report failures honestly, with output.

```bash
npm run test:types && npm run lint && npm run check:format && npm run test:unit && npm run test:integration:emulator && npm run test:unit:coverage && npm run test:coverage:gate:unit && npm run test:integration:coverage && npm run test:coverage:gate:integration && npm run build && npm run check:package && npm run check:consumer && npm run check:docs && npm run docs:build
```

**Baseline suite counts** (measured on `32ce4c1`, clean tree — §3.6):

| Suite       | Baseline        | After this PR                                                        |
| ----------- | --------------- | ---------------------------------------------------------------------- |
| unit        | 31 suites / 383 | **unchanged** — this PR adds no unit test (no `src/utils/**` or error-layer change) |
| integration | 32 suites / 480 | **must go up**: +2 suites (I-1, I-2) and +N tests, plus I-3's additions to an existing suite |

Type tests are not counted by either runner — T-1 is enforced by `test:types`.

Re-run the plan's own probes if any §3 fact looks wrong (commands in §0.4).

**Commit subject** (commitlint runs on `commit-msg`):

```
feat(repository): add opt-in snapshot metadata and detailed docChanges listeners (#39)
```

**Breaking-or-not ruling: NOT breaking.** Every change is additive — a new optional trailing
parameter on seven repository reads and six query terminals, two new methods, one new module, and
type-only exports. No existing signature's default resolution changes, and every existing return type
is byte-identical when the flag is omitted (asserted by I-1 #11 and I-2 #9). The one theoretical
break is a consumer who *subclasses* `FirestoreQueryBuilder` and overrides `get()` / `stream()` with
a narrower signature; `FirestoreQueryBuilderBase` is not exported from `src/index.ts`, and
subclassing the concrete builder is not a documented pattern. This folds into the unreleased
`3.0.0`, so use `feat:`, not `feat!:`.

---

## §11 Definition of done

- [ ] Branch `feat/issue-39-snapshot-metadata-detailed-listener` checked out and rebased onto current
      `main`; §3.4 line numbers re-verified (§7.1)
- [ ] §1 D1–D8 honored; nothing re-litigated
- [ ] §2 in-scope list complete; nothing from the out-of-scope list touched
- [ ] `src/core/SnapshotMetadata.ts` created exactly as §6.1, with the JSDoc
- [ ] `QueryBuilder.ts`: `toResultWithMetadata`, `mapDocs`, six terminal overload pairs,
      `onSnapshotDetailed` (§6.2)
- [ ] `FirestoreRepository.ts`: two private helpers, seven read overload pairs, `listenOneDetailed`
      (§6.3)
- [ ] `CollectionGroup.ts` **not** modified (R3), and its inheritance proven by I-3
- [ ] `src/index.ts` (§6.4) and `src/vector/index.ts` (§6.5) re-exports added; `buildDocumentMetadata`
      **not** exported
- [ ] T-1 type test written and passing; every `@ts-expect-error` in it is *used*
- [ ] I-1, I-2, I-3 written and passing; **I-1 #13 (T4) present**
- [ ] Every trap T1–T10 has a failing-when-realized test at **every** site in the §8 matrix
- [ ] All three integration tests mutation-checked (§7.8); results recorded in `notes.md`
- [ ] ADR-0033 written with all 8 required content items (§9.1); `docs/adr/README.md` row added (§9.2)
- [ ] ADR-0017 amendment added after line `123` **without** editing earlier amendments; References
      bullet updated (§9.3)
- [ ] Living-index footers swept; `grep -rn "#39–#41" docs/adr/` returns **exactly one** row
      (`0017:122`, the frozen #38 amendment) (§9.4)
- [ ] ADR-0026 / 0027 / 0029 cross-reference amendments added without editing original claims (§9.5)
- [ ] Every Starlight page in §9.6 updated; capability matrix row moved Deferred → Supported and the
      #72 row added
- [ ] `grep -rn ':::' website/dist/` after `docs:build` returns **no rows** (§9.6 callout)
- [ ] READMEs verified unaffected with the §9.7 grep (result recorded, not assumed)
- [ ] Nothing in the §7 anti-instruction list violated
- [ ] Full 14-leg gate green (§10); integration suite count went **up**, unit count unchanged
- [ ] `notes.md` committed on this branch: deviations, anything unverified, and the adversarial
      self-review dispositions
- [ ] **After review, and only after:** `git rm -r docs/plans/issue-39-snapshot-metadata-detailed-listener/`
      in a final cleanup commit — the plan directory is removed in this PR

---

## §12 Pre-handoff verification

What the planner actually ran, on `32ce4c1`.

| Check                                        | Command / method                                                                                                   | Result                                                                                                                                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §6 **signatures** compile as written         | `src/__scratch-39.ts` + `npm run test:types` (file removed after)                                                     | **2 defects found and fixed in §6.** (1) TS1222 — `async *` on the `stream` overload signatures → became T2. (2) a stray `declare` in a function body. Clean after both fixes.               |
| §6 **bodies** compile as written             | `src/__scratch-39c.ts` — `SnapshotMetadata.ts` verbatim, plus `toResultWithMetadata` / `mapDocs` / `get` / `getOne` / `stream` / `paginate` / `paginateWithCount` / `onSnapshotDetailed` / `toDocumentResult` / `mapManySnapshotsWithMetadata` / `getById` / `getByIdOrThrow` / `listenOneDetailed` / the 4-overload `getMany` in real class contexts + `npm run test:types` | clean, exit 0                                                                                          |
| Overload-resolution edge cases               | `src/__scratch-39b.ts` + `npm run test:types` (now `probes/p3-overload-resolution.type-probe.ts`)                     | clean — all seven `@ts-expect-error` / `Expect<>` assertions held (V1–V7, §3.3)                                                                                                             |
| Every `from '…'` specifier §6 uses           | same compiles, importing the exact specifiers                                                                          | `./core/SnapshotMetadata.js`, `./core/DocumentId.js`, `./core/ErrorParser.js`, `./core/Errors.js`, `./utils/pathTypes.js`, `firebase-admin/firestore` — all resolved                          |
| Declaration emit (new public types)          | `npx tsc --declaration --emitDeclarationOnly --outDir <tmp> -p tsconfig.json`, then `grep -rn 'import("' .` and `grep -rn "from '@google-cloud" .` | exit 0; **both greps returned no rows** (expected — the `FirebaseFirestore.*` ambient form emits no module reference). The only `@google-cloud/firestore` strings in the emitted tree are inside JSDoc prose |
| Admin SDK re-export allowlist                | read `node_modules/firebase-admin/lib/firestore/index.d.ts:25`                                                         | `DocumentChange` and `DocumentChangeType` **are** in the allowlist on 14.2.0 — but §6 uses the ambient namespace anyway, so this is a fallback, not a dependency (§5 item 4)                  |
| P1 (metadata per read path)                  | `firebase emulators:exec … node probes/p1-snapshot-metadata.mjs`                                                       | exit 0; results in §3.1                                                                                                                                                                     |
| P2 (`docChanges` semantics)                  | `firebase emulators:exec … node probes/p2-doc-changes.mjs`                                                             | exit 0; results in §3.2                                                                                                                                                                     |
| §9.4 sweep grep                              | `grep -rn "#39–#41" docs/adr/`                                                                                         | **14 rows across 10 files** — enumerated in §9.4. Expected post-sweep result documented as *exactly one* row, not zero                                                                        |
| §9.5 cross-reference grep                    | `grep -rn "issues/39\|#39" docs/adr/ \| grep -v "#39–#41"`                                                             | 4 files (0026, 0027, 0029, 0017) — enumerated in §9.5                                                                                                                                       |
| §3.4 `PaginatedResult` claim                 | `grep -rn "PaginatedResult" src --include="*.ts" \| grep -v src/tests`                                                 | exactly 2 rows (definition + re-export) — **used in no signature** (R-8)                                                                                                                    |
| §3.4 vector-isolation claim                  | `grep -n "coreBuilder\.\(get\|getOne\|stream\|paginate\)" src/vector/VectorQueryBuilder.ts`                            | **no rows** (expected — this is the check that passes by matching nothing; it proves R-5)                                                                                                    |
| Baseline suite counts                        | `npm run test:unit:coverage`, `npm run test:integration:coverage`                                                      | unit **31 suites / 383 tests**; integration **32 suites / 480 tests**                                                                                                                       |
| Gate headroom                                | both coverage runs → `test:coverage:gate:unit` and `test:coverage:gate:integration`                                    | all gates pass; per-gate slack in §3.5. `src/index.ts` has **zero** slack on lines/branches — recorded as a §6.4 constraint                                                                   |
| New-module gate ownership                    | read `scripts/check-coverage-gates.mjs:110-165`                                                                        | `src/core/SnapshotMetadata.ts` matches **no** matcher in either gate list — resolved by D6, flagged in §8                                                                                     |
| Read-only transaction surface                | read `FirestoreRepository.ts:165-215`                                                                                  | hand-written interface; none of the changed methods are members (R-7)                                                                                                                        |
| Every `file:line` in §3.4 / §6 / §9 re-read against the tree | `sed`/`grep` on each cited range                                                                       | **3 corrections made.** (a) §6.2's `stream` block originally omitted the existing `hasLimitToLast` guard at `1329`–`1336` — a copy-verbatim paste would have **deleted** it; the guard is now inside the block. (b) `listenOneDetailed`'s insertion point was stated as "after `3099`"; `listenOne` actually closes at `3102` — corrected. (c) §9.6's `crud-operations.md` anchors were vague ("reads section") — replaced with real line ranges |
| Clean tree after all probes                  | `git status --short` + `npm run test:types`                                                                            | only the untracked plan directory; typecheck exit 0                                                                                                                                          |
| Unresolved conditionals                      | re-read §§2–9                                                                                                          | none. The one lookup-shaped item (the write-metadata follow-up issue number) was resolved by **filing #72** rather than leaving a placeholder                                                |

**Not verified — see §5:** no full prototype, so the 14-leg gate has never been run with these edits
applied; emulator-only behavioral evidence; only the `^14` peer leg was type-checked.

---

## Appendix — probe inventory

| File                                          | What it proves                                                                                              | Kind          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------- |
| `probes/p1-snapshot-metadata.mjs`             | Metadata presence on all 10 read provenances, projection/converter safety, create/update/read time movement    | Investigation |
| `probes/p2-doc-changes.mjs`                   | `docChanges()` type/index semantics; removed-change snapshot provenance; single-doc listener deletion shape    | Investigation |
| `probes/p3-overload-resolution.type-probe.ts` | Overload resolution V1–V7 — **assertion probe**: port it to `src/tests/types/snapshot-metadata.type-test.ts` (§8, T-1) | Assertion     |
