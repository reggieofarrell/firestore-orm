# ADR-0025: Transaction options (read-only, PITR, maxAttempts) and `getInTransaction` rename

- **Status:** Accepted (v3.x), pending merge/release
- **Date:** 2026-07-25
- **Deciders:** maintainer
- **Related:** ADR-0017 (amended — #32 leaves the deferred list), ADR-0024 (read-only-by-type
  precedent), ADR-0021 D11 (`totalCount` → `collectionCount` rename precedent),
  [issue #32](https://github.com/reggieofarrell/firestore-orm/issues/32)

## Context

Issue #32 asked to:

1. Extend `runInTransaction()` to accept Admin SDK transaction options (`maxAttempts`, read-only /
   PITR `readTime`).
2. Consider a `runReadOnlyAt(readTime, fn)` convenience.
3. Expose **only read helpers** on the callback repo when the transaction is read-only (type-level).
4. Acceptance: read-only/PITR transactions and a retry ceiling are settable; ORM mapping helpers
   work for PITR reads.

Deferred by ADR-0017; remaining after #30/#31. The Admin SDK contract (verified against installed
typings and the Firestore emulator):

- `db.runTransaction(fn, options?)` accepts `ReadWriteTransactionOptions` (`maxAttempts?`,
  `readOnly?: false`) or `ReadOnlyTransactionOptions` (`readOnly: true`, `readTime?`).
- Read-only transactions take **no document locks**, are **not retried**, and are the only place
  `readTime` appears as an **input** on the public typing surface.
- PITR reads **must** go through a read-only transaction with `readTime` — you cannot put `readTime`
  on a lone `get`.
- Emulator probes confirmed: `{ readOnly: true }` works; writes inside a read-only tx are rejected
  **client-side** as a plain `Error` with message
  `Firestore read-only transactions cannot execute writes.` (no `code` — `parseFirestoreError`
  returns it unchanged); `readTime` **time-travel works**, including through `tx.get(query)`;
  `maxAttempts` of `0` / `-1` / `1.5` are rejected by the SDK client-side. The only
  emulator↔production divergence is the 60s `readTime` window (emulator accepts older times;
  production rejects them absent PITR retention).

A second force: the existing helper was named `getForUpdateInTransaction`. Its body is mode-agnostic
(`tx.get(docRef)` + id overlay); locking comes from the _transaction mode_, never the method. Under
`readOnly` the name is false in both halves — nothing is locked and no update can follow — and it is
the sole **transaction-scoped document read** on the read-only interface (`fromSnapshot` remains for
query-shaped PITR mapping), so it fronts every PITR example.

## Decision

1. **Options as a second argument** on `runInTransaction(fn, options?)`, matching
   `db.runTransaction(fn, options)`. Additive for the one-arg call shape. Options pass through
   unchanged — no parallel ORM options bag, no ORM-side `maxAttempts` validation (SDK already
   enforces integer ∈ `[1, Infinity]`).

2. **Discriminated overloads** for the callback `repo` type:
   - `{ readOnly: true }` → `ReadOnlyTransactionalRepository<T>`
   - omitted / read-write options → full `FirestoreRepository<T, W, S, WO>`

   Same “absent from the type” pattern as ADR-0024 (no throw stubs). Runtime still clones a full
   repository; the SDK rejects read-only writes client-side.

3. **`ReadOnlyTransactionalRepository` membership rule:** a member belongs iff it is **pure** or
   **transaction-scoped**. Anything that performs I/O outside the transaction is excluded —
   `getById` / `getAll` / `query` / every write — because on a full repo those silently bypass both
   the transaction and `readTime`. The member set is:

   - `getInTransaction` (transaction-scoped read)
   - `fromSnapshot` (mapping helper — **required**: the only route from a `tx.get(query)` snapshot
     back into the read model, and the issue's acceptance criterion is "ORM mapping helpers work for
     PITR reads")
   - `validate` (both overloads — pure)
   - `id` / `newId` (pure id boundary)
   - `getCollectionPath` (pure — needed so `tx.get(query)` can be built from the callback repo
     without hardcoding a path or reaching for an outer repository)
   - `readSchema` / `schemas` (pure getters)

4. **`runReadOnlyAt(readTime, fn)`** ships as a thin wrapper:
   `runInTransaction(fn, { readOnly: true, readTime })`.

5. **No query-in-transaction ORM API.** `QueryBuilder` has no `Transaction` support today. Document
   the `tx.get(query)` + `repo.fromSnapshot` escape hatch (which requires `fromSnapshot` on the
   read-only type).

6. **Do not re-export** `ReadOnlyTransactionOptions` / `ReadWriteTransactionOptions`. Reference them
   as `FirebaseFirestore.*` in library source so emitted `.d.ts` stays free of a module-resolution
   dependency on a peer for these option types.

7. **Rename `getForUpdateInTransaction` → `getInTransaction`** on the repository (both modes), as
   part of this change. No deprecated alias: at runtime the two names would be byte-identical, so
   shipping both means two names for one behavior forever. Direct precedent: **ADR-0021 D11**
   renamed `totalCount()` → `collectionCount()` in the same unreleased-3.0.0 window, on the same
   "the name should signal what it does" rationale. 3.0.0 is unreleased (npm `latest` is 2.2.1), so
   this is the last free window. The rename is a **breaking change for 2.x callers**, folded into an
   already-breaking major as `feat(repository)!:`.

This record **amends ADR-0017**: transaction options / PITR are no longer deferred. The remaining
deferrals (#38–#41) and the decision not to pursue full server-side or Enterprise Pipeline parity
are unchanged. (#33 conditional writes, #34 generic multi-aggregation, #35 `getMany`, #36 typed
bounds / `limitToLast`, and #37 `explain()` have since shipped — see ADR-0026 / ADR-0027 / ADR-0029
/ ADR-0030 / ADR-0031; this footer is a living index of remaining ADR-0017 deferrals — see
[`docs/adr/README.md`](README.md) Conventions.)

The read-only surface gained `getManyInTransaction` and an optional second type parameter `S`
(defaults to `T`) so field-mask paths are typed against the stored model — see ADR-0029.

## Consequences

- Callers can set `maxAttempts`, run read-only transactions, and perform PITR / time-travel reads
  through the ORM, with `runReadOnlyAt` for the common PITR call site.
- The narrowed type closes a pre-existing footgun: non-transactional repo reads inside a callback
  bypass the transaction _and_ `readTime`. Read-write callbacks still carry that hazard (full repo).
- **Options-object typing is an accepted cost.** Two ordinary call shapes need care:
  - `const opts = { readOnly: true }` — `readOnly` widens to `boolean` and matches **neither**
    overload (`TS2769`). Fix: `as const`, or
    `satisfies FirebaseFirestore.ReadOnlyTransactionOptions`, or inline the literal.
  - a variable typed `ReadOnlyTransactionOptions | ReadWriteTransactionOptions` — TypeScript rejects
    the call with `TS2769: No overload matches this call` (both overload branches listed). This
    includes `declare`d parameters, values returned from helpers, and ternary-built options
    (`readOnly ? ({ readOnly: true } as RO) : ({ maxAttempts: 3 } as RW)`). Fix: narrow before the
    call, use `as const` / `satisfies` on a single constituent, or pass an inline literal.

  **CFA caveat:** a `const` with an explicit `RO | RW` annotation **and an initializer** is narrowed
  by control-flow analysis to the initializer's constituent, so
  `const opts: RO | RW = { readOnly: true }` can look like it "accepts" the union at the call site
  when it is really plain `ReadOnlyTransactionOptions`. Do not treat that pattern as evidence that
  true unions are accepted.

  Do **not** paper over the widened-boolean or true-union cases with a third union overload that
  unsoundly hands the read-only repo to read-write callers.

- The rename is unrelated to transaction options as a feature; it is folded in because #32 is what
  makes the old name wrong. Migration guide documents it alongside the ADR-0021 D11 rename.
- Emulator↔production divergence is **narrower than expected**: the emulator does honor `readTime`
  time-travel, including through `tx.get(query)`. The only divergence is the 60s window. Integration
  tests assert real time-travel; the window itself is a docs note, not an assertion.
- Write rejection surfaces as a **plain `Error` with no `code`** — docs and tests assert the
  message, not a typed library error.

## Alternatives considered

**Keep `getForUpdateInTransaction` and only add options:** rejected — the name is false under
read-only, it is the sole transaction-scoped document read on the RO interface (alongside
`fromSnapshot` for query mapping), and 3.0.0 is the last cheap rename window. Shipping a deprecated
alias forever is worse than one honest name.

**Runtime mode flag that strips write methods from the cloned instance:** rejected — matches neither
the collection-group pattern nor the verified SDK client-side rejection; type-level absence is
enough.

**Third overload accepting the SDK option union:** rejected — unsoundly hands the read-only repo to
read-write callers (or widens to a union that reintroduces writes).

**Re-export SDK option types:** rejected — `src/` references `FirebaseFirestore.*` for these;
keeping emitted declarations free of a peer module-resolution edge for options is intentional.

**ORM-side `maxAttempts` validation / 60s `readTime` guard:** rejected — SDK already validates
`maxAttempts`; the 60s window is not enforced by the emulator and is a production control-plane
concern, not an ORM guard.

**Query-in-transaction ORM API in this change:** rejected — out of scope for #32 acceptance; genuine
gap deferred with a documented escape hatch.

## References

- `src/core/FirestoreRepository.ts` — `ReadOnlyTransactionalRepository`, `runInTransaction`
  overloads, `runReadOnlyAt`, `getInTransaction`
- `src/tests/types/transaction-options.type-test.ts`
- `src/tests/unit/repository-transaction-options.unit.test.ts`
- `src/tests/integration/repository-transaction-options.integration.test.ts`
- Starlight: Transactions guide, Scope & Capabilities, Repository / Types reference, migration guide
- Firebase PITR docs (control-plane enablement stays out of ORM scope)
