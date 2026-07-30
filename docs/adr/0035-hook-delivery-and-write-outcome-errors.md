# ADR-0035: Hook delivery and write-outcome error model

- **Status:** Accepted (v3.x, pending merge/release)
- **Date:** 2026-07-29
- **Deciders:** maintainer
- **Related:** [Issue #46](https://github.com/reggieofarrell/firestore-orm/issues/46),
  [Follow-up #80](https://github.com/reggieofarrell/firestore-orm/issues/80) (transactional outbox /
  durable after-hook delivery),
  [Issue #79](https://github.com/reggieofarrell/firestore-orm/issues/79) (lifecycle-hooks prose
  contradiction for `query().delete()` — docs-only, out of scope here),
  [ADR-0013](0013-create-return-contract.md) (`returnDoc` read-back),
  [ADR-0015](0015-express-adapter-subpath.md) (Express mapping),
  [`src/core/Hooks.ts`](../../src/core/Hooks.ts), [`src/core/Errors.ts`](../../src/core/Errors.ts),
  [`src/core/FirestoreRepository.ts`](../../src/core/FirestoreRepository.ts)

## Context

Lifecycle hooks and fixed-batch writes already have observable, non-obvious failure modes:

- Transaction callbacks (and their `before*` hooks) may run more than once under contention.
- An `after*` hook failure rejects the public call even though the write already committed.
- Fixed batches larger than 500 commit as independent 500-op chunks; a later failure leaves earlier
  chunks committed and skips the `after*` hook.
- `{ returnDoc: true }` can fail in the postcommit converter/read path after a successful write.

Issue #46 asked to document and then model these semantics. Consumers previously received the raw
hook/SDK error with no typed signal of whether data persisted. A durable outbox for after-hook side
effects is a separate, larger feature (#80).

## Decision

We will ship a typed hook context and a single discriminated write-outcome error, and document
idempotency guidance — without durable delivery.

1. **Defer the outbox (D1).** Issue #46 covers the observable outcome model and docs. Durable
   delivery stays [#80](https://github.com/reggieofarrell/firestore-orm/issues/80).
2. **Wrap only outcome-sensitive failures (D2).** Public `WriteOutcomeError` wraps before-hook
   failures, after-hook failures, partial fixed-batch commits, and postcommit read-back failures.
   Ordinary top-level `ValidationError`, `InvalidDocumentIdError`, `NotFoundError`, `ConflictError`,
   `PreconditionFailedError`, and raw/normalized SDK failures remain when no write committed and no
   hook is the failed phase (`committedWrites === 0`).
3. **Keep transaction `before*` hooks (D3).** They preserve the same normalization/validation/
   invariant boundary as direct writes. Hooks receive a typed second `HookContext` argument so they
   can distinguish direct vs retryable transaction execution.
4. **ORM-observed attempt, honest null (D4).** For `runInTransaction()`, context carries a 1-based
   count of callback invocations. For a public `*InTransaction` helper used with a caller-managed
   raw Admin SDK transaction, `attempt` is `null`. The field is diagnostic only and MUST NOT be used
   as an idempotency key.
5. **One discriminated outcome type (D5).** `WriteOutcomeError.outcome` distinguishes:
   - `state: 'not-committed', phase: 'before-hook'`;
   - `state: 'partially-committed', phase: 'commit'` (+ `committedWrites` / `totalWrites`);
   - `state: 'committed', phase: 'after-hook'`;
   - `state: 'committed', phase: 'read-back'`. Cause stays on the Error (`cause`), not inside
     `outcome`, so HTTP serialization stays safe.
6. **Preserve sequential fail-fast delivery (D6).** Hooks continue in registration order; the first
   thrown/rejected hook stops later hooks. No best-effort or aggregate delivery.

`HookEvent` and `HookContext` live in `src/core/Hooks.ts` to avoid a type cycle with `Errors.ts`.
`parseFirestoreError` preserves an existing `WriteOutcomeError` before SDK normalization. The
Express adapter maps the class to HTTP 500 with `{ error, outcome }` only.

## Consequences

- Callers can exhaustively branch on persistence outcome without parsing messages.
- One-argument hooks remain source-compatible (TypeScript allows fewer parameters).
- After hooks remain in-process, postcommit, at-most-once per successful ORM method invocation, and
  may never finish on process crash — docs recommend idempotent side effects keyed by a business /
  write identity, not by `attempt`.
- Fixed-batch partiality becomes typed (`committedWrites` / `totalWrites`) without changing the
  500-op chunking semantics.
- Breaking for callers that assumed hook/read-back/partial failures keep the raw thrown identity as
  the top-level rejection (they become `WriteOutcomeError` with the original as `cause`).

## Alternatives considered

**Bundle a transactional outbox into #46.** Rejected: persistence schema, leasing, and operational
ownership are independent of accurately reporting today's write outcomes (#80).

**Wrap every write rejection.** Rejected: destroys established `instanceof` control flow for
precommit validation and first-commit failures whose outcome is already unambiguous.

**Remove transaction hooks as a v3 cleanup.** Rejected: `*InTransaction` helpers would silently
bypass hooks that may enforce invariants.

**Four unrelated error subclasses.** Rejected: callers primarily need an exhaustive state/phase
branch; a correlated discriminated union keeps phase-specific fields type-safe.

**Aggregate / parallel / continue-after-failure hooks.** Rejected: changes delivery semantics beyond
documenting and typing today's sequential fail-fast contract.

## References

- [Issue #46](https://github.com/reggieofarrell/firestore-orm/issues/46)
- [Issue #80](https://github.com/reggieofarrell/firestore-orm/issues/80) (outbox follow-up)
- [Issue #79](https://github.com/reggieofarrell/firestore-orm/issues/79) (docs contradiction,
  deferred)
- Plan: `docs/plans/issue-46-hook-delivery-error-model/PLAN.md`
