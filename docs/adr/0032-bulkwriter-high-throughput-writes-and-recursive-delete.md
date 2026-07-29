# ADR-0032: BulkWriter high-throughput writes and recursive delete

- **Status:** Accepted (v3.x, pending merge/release)
- **Date:** 2026-07-28
- **Deciders:** maintainer
- **Related:** [Issue #38](https://github.com/reggieofarrell/firestore-orm/issues/38),
  [ADR-0017](0017-v3-core-operations-scope.md),
  [ADR-0019](0019-operation-aware-sentinel-validation.md),
  [ADR-0029](0029-get-many-multi-document-reads.md),
  [`src/core/FirestoreRepository.ts`](../../src/core/FirestoreRepository.ts)

## Context

ADR-0017 deferred Admin SDK `BulkWriter` high-throughput writes and recursive delete as issue #38.
The fixed-batch helpers (`bulkCreate` / `bulkCreateWithIds` / `bulkUpdate` / `bulkPatch` /
`bulkDelete`) are atomic at or below 500 ops, throw on the first failure, and run lifecycle hooks —
the right contract for transactional-feeling small batches. A 10k-row import needs the opposite on
every axis: parallel rate-limited writes, per-item success/failure, and no all-or-nothing pre-read.

SDK facts that shape the contract (measured against the Firestore emulator and
`firebase-admin@14.2.0`):

- A `BulkWriter` batch is **not** atomic — a colliding `create` leaves siblings applied.
- `close()` never rejects; success is only observable per operation.
- Per-op promises stay pending until `flush`/`close` when fewer than 20 ops are enqueued
  (`MAX_BATCH_SIZE`); awaiting them earlier hangs forever with no error.
- An unobserved per-op rejection is fatal under Node's default `--unhandled-rejections=throw`.
- An unclosed writer makes `db.terminate()` reject forever.
- Two writes to the same document in one writer go into separate batches whose commits **race** —
  measured 36 % first-enqueued wins — so "last write wins" is false.
- `BulkWriterError` is not importable from `firebase-admin/firestore`; use `FirebaseFirestore.*`.
- `recursiveDelete` returns `void` (no count); a delete of an already-absent document succeeds; a
  supplied writer is only `flush()`ed, never closed.

## Decision

We will ship two additive repository methods and four exported types:

1. **`bulkWrite(operations[], options?)` → `Promise<BulkWriteResult[]>`** — one method, mixed verbs
   (`create` / `set` / `update` / `patch` / `delete`) in one call, positional per-item results. The
   ORM owns the whole writer lifecycle (create → enqueue → close → collect). No streaming
   `repo.bulkWriter()` handle.
2. **No lifecycle hooks on this path.** `bulkWrite` throws when any of the six bulk hook events is
   registered, unless the caller passes `{ skipHooks: true }`. A silent bypass would drop audit /
   cache invalidation with no error.
3. **Per-item validation and backend failures** land as `{ ok: false, error }` — one bad row of 10
   000 does not cost the import. Whole-call throws are reserved for registered hooks without
   `skipHooks` and for duplicate explicit ids.
4. **Duplicate explicit ids are rejected** (whole-call throw via `assertNoDuplicateIds`). Same-
   document commit order is undefined; allowing duplicates would ship a coin flip.
5. **`recursiveDelete(id): Promise<void>`** — document-scoped (the document plus every descendant),
   no hooks, no count. "Opt-in" is the distinct, loudly documented method name. Collection-wide
   recursive delete stays deferred
   ([#69](https://github.com/reggieofarrell/firestore-orm/issues/69)).

Types and options use `FirebaseFirestore.*` so emitted `.d.ts` does not pull in undeclared
`@google-cloud/firestore`. The existing private batch helper is renamed `runBulkBatchWrite` so the
public name can be `bulkWrite`. Fixed-batch helpers are otherwise unchanged.

## Consequences

- Two write contracts now coexist; callers must choose deliberately (atomic+hooks vs
  high-throughput+per-item).
- Capability matrix: #38 moves Deferred → Supported.
- The raw-SDK `BulkWriter` escape-hatch example is no longer the only route; it remains for
  streaming input larger than memory and other unwrapped cases.
- `recursiveDelete` returns no count; partial subtree failure is a whole-call error; re-running is
  safe.
- Collection-wide recursive delete remains deferred
  ([#69](https://github.com/reggieofarrell/firestore-orm/issues/69)).
- `bulkWrite` is the first ORM write path that runs **no** hooks by design (with a loud guard).
- Remaining ADR-0017 deferrals are `#40–#41` (#39 snapshot read metadata / detailed listeners have
  since shipped — see ADR-0033).

## Alternatives considered

**A `repo.bulkWriter()` streaming handle.** Rejected — larger surface (stateful close/flush /
use-after-close) whose only real advantage is input that does not fit in memory; the raw-SDK escape
hatch already covers that.

**Per-verb methods (`bulkWriteCreate` / …).** Rejected — three surfaces and no mixed-op batches,
which is what BulkWriter is uniquely good at.

**No hooks, documented only.** Rejected — a repository whose `afterBulkDelete` drives an audit trail
would silently stop firing when someone swaps `bulkDelete` for `bulkWrite`.

**Before-hooks + after-hooks with succeeded ids.** Rejected — gives the same event names a weaker
meaning and forces a `db.getAll` pre-read back onto the delete path.

**Throw before any write on validation failure.** Rejected — defeats the per-item contract for the
import case this path exists for.

**Allow duplicate ids, last-enqueued wins.** Rejected because it is **false**: same-document commits
race (36 % inversions measured). The SDK's "executed sequentially" claim refers to batch separation,
not commit order.

**`recursiveDelete` returns `Promise<number>`.** Rejected — a delete of an absent document succeeds,
so any tally would count operations, not documents that existed.

**A magic confirmation flag on recursive delete.** Rejected as ceremony; the distinct method name is
the opt-in.

**Exposing `onWriteError` / a retry-policy knob.** Rejected — the SDK default already retries
transient statuses up to 10 attempts; wrapping it would require exposing `BulkWriterError`, which is
not importable from `firebase-admin/firestore`.

**Collection-wide `recursiveDelete`.** Deferred to
[#69](https://github.com/reggieofarrell/firestore-orm/issues/69) — verified working on the SDK, but
the most destructive call in the library and not in #38's acceptance.

## References

- [Issue #38](https://github.com/reggieofarrell/firestore-orm/issues/38)
- [Follow-up #69](https://github.com/reggieofarrell/firestore-orm/issues/69) (collection-wide
  recursive delete)
- Implementation: `src/core/FirestoreRepository.ts` (`bulkWrite`, `recursiveDelete`)
- Tests: `src/tests/integration/repository-bulk-writer.integration.test.ts`,
  `src/tests/types/bulk-write.type-test.ts`
- [ADR-0017](0017-v3-core-operations-scope.md),
  [ADR-0019](0019-operation-aware-sentinel-validation.md) (delete-sentinel rejection on create
  verbs), [ADR-0029](0029-get-many-multi-document-reads.md) (`bulkDelete`'s consistent pre-read —
  the contrast case)

This record **amends ADR-0017**: BulkWriter high-throughput writes (`bulkWrite`) and explicit
document-scoped recursive delete (`recursiveDelete`) are no longer deferred. The remaining deferrals
(#40–#41) and the decision not to pursue full server-side or Enterprise Pipeline parity are
unchanged. (#38 has since shipped — see this ADR; #39 snapshot read metadata / detailed listeners
have since shipped — see ADR-0033; collection-wide recursive delete is tracked separately as
[#69](https://github.com/reggieofarrell/firestore-orm/issues/69). This footer is a living index of
remaining ADR-0017 deferrals — see [`docs/adr/README.md`](README.md) Conventions.)
