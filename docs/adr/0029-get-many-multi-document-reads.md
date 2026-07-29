# ADR-0029: `getMany(ids)` multi-document reads

- **Status:** Accepted (v3.x, pending merge/release)
- **Date:** 2026-07-27
- **Deciders:** maintainer
- **Related:** ADR-0017 (amended — #35 leaves the deferred list), ADR-0018 (document identity — `id`
  overlay), ADR-0024 (why no collection-group variant), ADR-0025 (read-only transaction surface),
  ADR-0028 (`OmitId` / distributive path typing),
  [issue #35](https://github.com/reggieofarrell/firestore-orm/issues/35),
  [issue #39](https://github.com/reggieofarrell/firestore-orm/issues/39) (still owns snapshot /
  write metadata including a future `getManyWithUpdateTime`)

> Amendment (3.0.0, issue #39): `getMany(ids, { withMetadata: true })` now supersedes the deferred
> `getManyWithUpdateTime` idea (ADR-0033). Pair-shaped `{ doc, metadata }` is the general opt-in
> read-metadata shape.

## Context

Issue #35 asked for a multi-ID read that **preserves order**, **marks missing docs**, and **supports
a field mask** — and that would also let `bulkDelete` skip its per-id existence pre-reads.

The existing multi-id path is `query().whereId('in', ids)`. Measured against the Admin SDK
(`@google-cloud/firestore@8.6.0` / emulator):

| Behavior     | `whereId('in', ids)`                                      | Needed for #35              |
| ------------ | --------------------------------------------------------- | --------------------------- |
| Max ids      | **30** — 31 throws `INVALID_ARGUMENT`                     | No operator cap             |
| Result order | **Document-name order**, not input order                  | Input order                 |
| Missing ids  | **Silently dropped**                                      | Marked in position          |
| Empty input  | Throws ("A non-empty array is required for 'in' filters") | Empty → `[]`                |
| Projection   | `select(...)`                                             | Field mask on the batch-get |

`Firestore.getAll` / `Transaction.getAll` (`BatchGetDocuments`) already provide the right
primitives: client-side re-sort against the request array (order is an SDK guarantee, not a backend
one), snapshots with `exists === false` in position for misses, optional `fieldMask`, and a single
uniform `readTime` across the batch.

Separately, `bulkDelete`'s existence pre-read used `Promise.all(ids.map(id => doc(id).get()))`. For
300 ids that produced **14 distinct `readTime`s** — an inconsistent snapshot the delete hooks
observe. One `db.getAll` produced **1** `readTime` and ran ~9× faster on the emulator. That is a
correctness fix, not just a perf win.

## Decision

We will ship batched multi-document reads on `FirestoreRepository` as follows.

1. **`getMany(ids, options?)` returns `(FirestoreDocument<T> | null)[]`** — positional, with `null`
   per missing id (`ids[i]` is the missing id). Matches `getById`'s null convention and composes as
   a drop-in DataLoader batch function (DataLoader's contract is positional alignment with the key
   array).
2. **Include `getManyInTransaction(tx, ids, options?)`.** `tx.getAll` works in read-write,
   read-only, and PITR transactions (including with field masks). Transactions are where batched
   reads matter most: one locked round trip instead of N. The method is added to
   `ReadOnlyTransactionalRepository`; non-transactional `getMany` is deliberately **absent** (same
   membership rule as `getById` / `getAll` / `query` — ADR-0025).
3. **Rewire `bulkDelete`'s pre-read to `db.getAll`.** One `BatchGetDocuments` so the pre-read the
   delete hooks observe is a single consistent snapshot. Empty input short-circuits to `0` before
   `getAll` (the SDK rejects a zero-ref call).
4. **Allow duplicate ids.** Reads are idempotent; `assertNoDuplicateIds`' write-side rationale does
   not apply. The SDK dedupes the RPC but returns one entry per requested position.
5. **No internal chunking / no `maxBatchSize`.** Chunking would break the single-`readTime`
   consistency guarantee that justifies the `bulkDelete` rewire. Callers reading many thousands
   should chunk themselves and accept the consistency trade-off. Docs must not claim a hard
   production batch ceiling (emulator accepted 10 000; production is unverified).

**`ReadOnlyTransactionalRepository<T, S extends object = T>`:** the interface gains a second type
parameter so `fieldMask` paths are typed against the **stored** model `S` (mirroring `select()` /
`where()`). The default `S = T` keeps existing single-argument uses compiling. **Both** RO entry
points — `runInTransaction(fn, { readOnly: true })` **and** `runReadOnlyAt` — pass `<T, S>`.
Patching only one leaves an `S !== T` repo compiling through one path and failing with `TS2769` on
the other.

Overload order: masked overload first, unmasked second, implementation third — so a masked call
narrows to `FirestoreDocument<DeepPartial<T>>` rather than silently staying on the full model.

No new public export. `src/index.ts` is unchanged. No `CollectionGroup.getMany` (ids are not unique
across a group — ADR-0024). No `getManyOrThrow` / `getManyWithUpdateTime` (the latter is #39).

## Consequences

- One `BatchGetDocuments` RPC instead of N reads for id lookups; billed per **unique** document read
  — the SDK dedupes duplicate refs in the outbound request — while the result still carries one
  entry per requested position.
- Results are point-in-time consistent within a single call (documented `BatchGetDocuments`
  behavior; emulator-measured for the `bulkDelete` rewire).
- `bulkDelete`'s hook payload (`{ ids, documents }`) is now drawn from one snapshot.
- **Accepted limitation (documented, not fixed):** with a `readConverter`, `fromFirestore` receives
  the **masked** document under `getMany(ids, { fieldMask })` and will throw a raw `TypeError` if it
  dereferences a field the mask omitted. The library cannot know which fields a user converter
  touches; suppressing the error would be worse than surfacing it.
- Empty `getMany([])` / `getManyInTransaction(tx, [])` / `bulkDelete([])` short-circuit without an
  SDK call — mandatory because `getAll()` with zero refs throws a plain `Error`.
- Production batch ceiling remains **unverified**; docs advise chunking large batches without
  stating a hard limit number.

## Alternatives considered

**`{ id, doc }[]` or `{ found, missing }` result shapes.** Rejected: positional `(T | null)[]`
aligns with DataLoader and with `getById`'s null convention; the missing id is simply `ids[i]`.

**Reject duplicate ids (reuse `assertNoDuplicateIds`).** Rejected: write-side rationale (which
payload wins? inflated counts) does not apply to idempotent reads; the SDK already preserves
positional duplicates.

**Internal chunking / `maxBatchSize`.** Rejected: destroys the single-snapshot guarantee that is the
`bulkDelete` rewire's whole justification (D5).

**`getManyWithUpdateTime`.** Deferred to #39 — `updateTime` _is_ available on `getAll` snapshots,
but snapshot/write metadata is that issue's territory.

**Add `getMany` to `ReadOnlyTransactionalRepository`.** Rejected: non-transactional I/O bypasses the
transaction and any `readTime` (ADR-0025 membership rule). Only `getManyInTransaction` belongs.

**A third, permissive overload for variable-typed optional masks.** Rejected: it would silently pick
the wrong return type. The established `create(data, options)` pair has the identical safe wart.

## References

- [Issue #35](https://github.com/reggieofarrell/firestore-orm/issues/35)
- [`src/core/FirestoreRepository.ts`](../../src/core/FirestoreRepository.ts) — `getMany`,
  `getManyInTransaction`, `mapManySnapshots`, `bulkDelete` pre-read, RO surface
- Tests: `src/tests/types/get-many.type-test.ts`,
  `src/tests/integration/repository-get-many.integration.test.ts`,
  `src/tests/unit/repository-get-many.unit.test.ts`,
  `src/tests/unit/repository-conditional-writes.unit.test.ts` (`db.getAll` mock)
- Starlight: repository reference, types, scope & capabilities, troubleshooting, CRUD, transactions,
  performance, read converters
- Plan / probes (maintainer-local): `tmp/plans/issue-35-get-many.md`, `tmp/probes/issue-35/`

This record **amends ADR-0017**: multi-document `getMany` reads are no longer deferred. The
remaining deferrals (#41) and the decision not to pursue full server-side or Enterprise Pipeline
parity are unchanged. (#36 typed bounds / `limitToLast`, #37 `explain()`, #38 `bulkWrite` /
`recursiveDelete`, and #39 snapshot read metadata / detailed listeners have since shipped — see
ADR-0030 / ADR-0031 / ADR-0032 / ADR-0033; #40 `distinctValues` semantic equality has since shipped
— see ADR-0034; this footer is a living index of remaining ADR-0017 deferrals — see
[`docs/adr/README.md`](README.md) Conventions.)
