# ADR-0019: Operation-aware sentinel validation (reject delete sentinels on create)

- **Status:** Accepted (v3) — implementing on branch `v3-release-hardening-part-2`
- **Date:** 2026-07-21
- **Deciders:** Reggie O'Farrell
- **Related:** Refines [ADR-0002](0002-per-field-sentinel-write-validation.md) (per-field sentinel
  validation);
  [`reviews/v3-pre-release-codebase-review.md`](../../reviews/v3-pre-release-codebase-review.md)
  (finding B8); [`src/core/Validation.ts`](../../src/core/Validation.ts),
  [`src/core/FirestoreRepository.ts`](../../src/core/FirestoreRepository.ts).

## Context

The per-field write combinators from ADR-0002 (`withDelete`, the `allowDelete` option, `zSentinel`)
and the update schema derivation share one field-level schema across **both** create and update
validation: the create schema is `omitTopLevelId(writeSchema)` and the update schema is
`createWriteSchema.partial()`. A field declared `withDelete(z.string())` therefore accepts
`FieldValue.delete()` on `parseCreate` as readily as on `parseUpdate`.

But the Firestore backend permits a delete sentinel only in update-like writes (`update()`, or
`set(..., { merge: true })`) — **not** a plain `create`/`set`. So an input can pass the ORM's
runtime validation and then fail only at commit, on `create`, `bulkCreate`, `createInTransaction`,
and the create branch of `upsert`. `upsert` is worse: the same type-valid input succeeds or fails
depending on whether the document already exists (update branch vs create branch). The other
sentinel kinds (`increment`, `arrayUnion`, `arrayRemove`, `serverTimestamp`) _are_ accepted by the
backend on `set`/`create`, so they must keep working.

## Decision

We will make sentinel validation **operation-aware** for the one kind Firestore treats differently.

- In the shared create chokepoint `validateCreateData`
  ([`FirestoreRepository.ts`](../../src/core/FirestoreRepository.ts)) — through which `create`,
  `bulkCreate`, `createInTransaction`, and the `upsert` create branch all pass — scan the payload
  with `collectSentinelPaths` and, if any path classifies (`whichFieldValue`) as `'delete'`, throw a
  clear `ValidationError` **before I/O**: delete sentinels are not valid on create/set; use
  `update()`/`patch()` to clear a field.
- Keep `increment`/`arrayUnion`/`arrayRemove`/`serverTimestamp` permitted on create (the backend
  accepts them). Leave update/patch/merge paths unchanged.
- Add a matching up-front guard in `upsert` so the input contract is deterministic regardless of
  current document existence.

## Consequences

- An input that would fail only at commit now fails fast, consistently, and with a specific message
  — and `upsert` validity no longer depends on document existence.
- **Non-breaking:** the guard only rejects writes Firestore itself would reject; no previously
  successful write changes behavior.
- Builds on existing exports (`collectSentinelPaths`, `whichFieldValue`) — a small addition, not a
  new subsystem. Reinforced by integration tests exercising each sentinel kind across
  create/set/merge/ update/patch/transaction/bulk/upsert.

## Alternatives considered

- **A create-specific schema variant** that strips delete unions. Rejected: heavier and duplicative;
  a targeted pre-I/O scan reuses machinery already present.
- **Leave it to the Firestore backend.** Rejected: it surfaces a confusing commit-time error and
  leaves `upsert` non-deterministic — exactly the ergonomics this library exists to smooth.

## References

- [ADR-0002](0002-per-field-sentinel-write-validation.md) — combinators, `whichFieldValue`,
  `collectSentinelPaths`, `sentinelPolicy`.
- [`src/core/Validation.ts`](../../src/core/Validation.ts),
  [`src/core/FirestoreRepository.ts`](../../src/core/FirestoreRepository.ts).
- [Delete data from Cloud Firestore](https://firebase.google.com/docs/firestore/manage-data/delete-data).
