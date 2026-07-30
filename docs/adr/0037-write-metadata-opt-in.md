# ADR-0037: Write metadata (`writeTime`) opt-in on write results

- **Status:** Accepted (v3.x, pending merge/release)
- **Date:** 2026-07-30
- **Deciders:** maintainer
- **Related:** [Issue #72](https://github.com/reggieofarrell/firestore-orm/issues/72),
  [ADR-0017](0017-v3-core-operations-scope.md) (amended — #39 write-metadata half closes),
  [ADR-0033](0033-snapshot-metadata-and-detailed-listeners.md) (read-metadata precedent; write half
  deferred to #72), [`src/core/FirestoreRepository.ts`](../../src/core/FirestoreRepository.ts)

## Context

Issue #72 is the remaining **write-metadata** half split from #39 / ADR-0033. Acceptance requires
`writeTime` available **opt-in** on the non-transactional write surface, existing return shapes
unchanged, and the transaction carve-out documented.

Verified Admin SDK / repository facts:

- Direct `DocumentReference.set` / `create` / `update` / `delete` resolve to `Promise<WriteResult>`
  with a `Timestamp` `writeTime`.
- `WriteBatch.commit()` resolves to `Promise<WriteResult[]>` (one per enqueued action, order
  preserved) — suitable for pairing fixed-batch ids to chunk results across the 500-op boundary.
- `CollectionReference.add()` returns only a `DocumentReference`, so auto-id `create` must use
  `doc().set(...)` to obtain a receipt.
- Transactional `tx.set` / `update` / `delete` return the `Transaction`, not a `WriteResult` — there
  is no honest per-operation commit timestamp inside a transaction.
- `bulkWrite` already returns `writeTime` on each successful `BulkWriteResult` item.
- Read-side `WithMetadata` / `DocumentMetadata` promise snapshot provenance (`createTime` /
  `updateTime` / `readTime`), not commit receipts — write metadata needs distinct type names.

## Decision

We will ship **opt-in write receipts** on non-transactional repository writes:

1. **Option spelling `withMetadata: true`** — same idiom as #39 read metadata (D1). No second flag
   name.
2. **Enrich the natural result** (D2): `{ id, writeTime }` for id-returning single writes;
   `{ writeTime }` for `delete`; positional `{ id, writeTime }[]` for fixed batches (`bulkCreate` /
   `bulkCreateWithIds` / `bulkUpdate` / `bulkPatch`); bulk delete returns `{ count, writeTimes }`
   aligned to **surviving** documents only. Types:
   `WriteMetadata = { readonly writeTime: Timestamp }` and
   `WriteResultWithMetadata<R> = R & WriteMetadata`.
3. **`returnDoc: true` and `withMetadata: true` are mutually exclusive** in overloads and at runtime
   before any I/O (D3) — a converted read-back document is not a commit receipt.
4. **No `withMetadata` on any `*InTransaction` helper** (D4) — the Admin SDK does not expose per-op
   write results inside a transaction.
5. **`commitInChunks` returns `WriteResult[]`** for successfully committed actions only (enqueue
   order across 500-op chunks). Query-builder write terminals keep returning counts and ignore the
   array; `WriteOutcomeError.committedWrites` accounting is unchanged.
6. **Out of scope:** `bulkWrite` (already has `writeTime`), query `update`/`delete`,
   `recursiveDelete`, read metadata, vector wrappers.

## Consequences

- Default / omitted options retain every existing return type and runtime shape — not a breaking
  change.
- Auto-id `create` always uses client-side `doc().set()` (never `add()`) so a receipt is available
  when requested; id generation remains client-side.
- Consumers that need commit receipts no longer re-read documents solely to approximate write time.
- Transactional callers continue to lack per-op receipts; docs and type tests make that explicit.
- Capability matrix: write metadata moves Deferred → Supported; ADR-0017's #39 write half closes.

## Alternatives considered

**Universal `{ result, metadata }` wrapper.** Rejected — new public abstraction, conflicts with the
`bulkWrite` success precedent, and makes simple `.id` access noisier for the common case.

**Distinct `returnWriteTime` flag.** Rejected — two metadata idioms with no gain over #39's
`withMetadata` spelling.

**Combining `returnDoc` + `withMetadata`.** Rejected — invents an undocumented wrapper that mixes a
later read with a commit receipt.

**Guessing transaction timestamps or returning the transaction object.** Rejected — would falsely
claim per-operation commit metadata the Admin SDK does not expose.

## References

- [Issue #72](https://github.com/reggieofarrell/firestore-orm/issues/72)
- [ADR-0017](0017-v3-core-operations-scope.md),
  [ADR-0033](0033-snapshot-metadata-and-detailed-listeners.md)
- Source: `src/core/FirestoreRepository.ts`, `src/core/QueryBuilder.ts` (private
  `FirestoreWriteBatch` alias), `src/index.ts`
- Tests: `src/tests/types/write-metadata.type-test.ts`,
  `src/tests/integration/repository-write-metadata.integration.test.ts`
- Plan / probes: `docs/plans/issue-72-write-metadata-opt-in/`

This record **amends ADR-0017**: opt-in write metadata (`writeTime`) is no longer deferred. The
remaining deferral (**#41**) and the decision not to pursue full server-side or Enterprise Pipeline
parity are unchanged. (#72 write metadata has since shipped — see this ADR; #39 read metadata /
detailed listeners shipped under ADR-0033; #40 `distinctValues` semantic equality under ADR-0034.
This footer is a living index of remaining ADR-0017 deferrals — see
[`docs/adr/README.md`](README.md) Conventions.)
