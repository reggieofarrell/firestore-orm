# ADR-0013: Create returns `{ id }` by default with opt-in read-back

- **Status:** Accepted (v3)
- **Date:** 2026-07-19
- **Deciders:** maintainer
- **Related:** ADR-0001 (point 3 — id-returning writes), ADR-0008 (read-only converters)

## Context

`create()`, `bulkCreate()`, and `createInTransaction()` validated the write payload and returned it
cast to the repository's read type `T`, without invoking the `readConverter` or reading the document
back. When the read and write models diverge (a `writeSchema` overlay) or a `readConverter` is
configured, the returned runtime value did not match the promised read type — the exact mismatch the
v3 read/write schema split is meant to make honest. `bulkCreate` additionally reassigned validated
values onto the raw input via `Object.assign`, so Zod-stripped unknown keys leaked into the returned
docs and the `afterBulkCreate` payload despite never being persisted. The write path cannot honestly
return the read model without an extra read.

## Decision

We will return `{ id }` by default from `create()`/`bulkCreate()`/`createInTransaction()`, mirroring
the `update()`/`upsert()` contract (ADR-0001 point 3). `create()`/`bulkCreate()` accept
`{ returnDoc: true }` to read the created document back through the `readConverter` and return the
converted read model. `createInTransaction()` returns `{ id }` only — a transaction cannot read a
document back after writing it. Results and the `afterBulkCreate` payload are built from the
**validated** data, so stripped keys never leak. `before/afterCreate` and `afterBulkCreate` hooks
receive the validated write model plus the id. We also reject read schemas whose `id` is optional,
nullable, or transformed to a non-string, preserving the `T & { id: string }` contract.

## Consequences

The default return no longer promises a read model it cannot produce; consumers who need it opt in
with `returnDoc` (one extra read). Breaking: callers that used the full document from `create` must
pass `{ returnDoc: true }` or read separately. Hook payloads are now consistently the validated
write model.

## Alternatives considered

Always read the document back and apply the converter: rejected as the default because it forces an
implicit read on every create and is impossible inside a transaction. Keeping the cast-through
behavior: rejected — it is the unsound contract this ADR fixes.

## References

- [`src/core/FirestoreRepository.ts`](../../src/core/FirestoreRepository.ts) — `create`,
  `bulkCreate`, `createInTransaction`, `assertSchemaHasRequiredId`.
