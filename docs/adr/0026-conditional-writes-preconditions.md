# ADR-0026: Conditional writes — create-only by explicit id and `lastUpdateTime` preconditions

- **Status:** Accepted (v3.x), pending merge/release
- **Date:** 2026-07-25
- **Deciders:** maintainer
- **Related:** ADR-0017 (amended — #33 leaves the deferred list), ADR-0013 (create return contract),
  ADR-0018 (document identity / overlay collisions), ADR-0019 (operation-aware sentinels), ADR-0025
  (option-forwarding precedent),
  [issue #33](https://github.com/reggieofarrell/firestore-orm/issues/33),
  [issue #39](https://github.com/reggieofarrell/firestore-orm/issues/39) (still owns general
  snapshot/write metadata)

## Context

Issue #33 asked for two related Firestore capabilities the ORM did not expose:

1. an **explicit-id create-only** write (`DocumentReference.create()` semantics — fails if the
   document already exists), and
2. optional **`lastUpdateTime` preconditions** on update and delete across the repository, bulk, and
   transaction surfaces,

with a failed precondition normalized to a distinct ORM error. The issue explicitly said **not** to
redefine `upsert()` as create-only. Acceptance: create-only and precondition-guarded
read-modify-write flows work, with a distinct error type.

Deferred by ADR-0017; the last remaining blocker after #30/#31/#32. Every SDK/backend claim below
was produced by probing the Firestore emulator with `@google-cloud/firestore@8.6.0` and by reading
the installed SDK source — not from memory.

**Backend contract (probed):**

- `docRef.create()` on a fresh document succeeds; on an existing one it throws a plain `Error` with
  **`code === 6`** (`ALREADY_EXISTS`) and leaves the target unchanged. Two concurrent creates on one
  id: exactly one wins.
- `update`/`delete` with a **stale** `lastUpdateTime` throw **`code === 9`** (`FAILED_PRECONDITION`)
  and leave the target unchanged.
- `update` with a `lastUpdateTime` on a **missing** document is also **`code === 9`** (the server
  reports "stored version (0)"), _not_ `5`. A plain `update` on a missing document remains `code 5`.
- `delete()` on a missing document with no precondition still succeeds as a no-op.
- Batches and transactions preserve this: a failed create or precondition inside a `WriteBatch` is
  atomic (no sibling lands), and inside a transaction the callback runs **exactly once** — a
  rejected precondition is not contention, so Firestore does not retry.
- A converter-wrapped (`withConverter`) read still carries `snapshot.updateTime`, and the token it
  yields is accepted on the raw write reference.

**SDK constraint (read from `write-batch.js` `validatePrecondition` and `types/firestore.d.ts`):** a
`Precondition` may carry **at most one** of `exists` / `lastUpdateTime`; `lastUpdateTime` must be a
`Timestamp` **instance**; and on `update` the `exists` condition is restricted to `true`.

**Peer floor:** `@google-cloud/firestore@7.0.0` (reachable from `firebase-admin@^12`) already
declares `Precondition.lastUpdateTime`, all four `create` surfaces, and `precondition?` on every
update/delete overload. **No peer-floor bump is needed.**

## Decision

**D1 — Ship the read half as one purpose-named accessor.** `getByIdWithUpdateTime(id)` returns
`{ doc, updateTime } | null`. A precondition is useless without a supported way to obtain the token,
so shipping the write half alone would leave the acceptance criterion half-wrapped around an escape
hatch. **No existing return type changes**, and issue #39's general opt-in snapshot-metadata shape
stays unclaimed — this is one narrow accessor, not a metadata framework.

The result is a **pair**, not a flat `FirestoreDocument<T> & { updateTime }`. A flat overlay would
shadow a stored field named `updateTime` and make it unreachable on the result — precisely the
collision ADR-0018 avoids by keeping `id` repository-owned and rejecting schemas that declare it. A
pair has no such failure mode.

**D2 — Error taxonomy: reuse `ConflictError` for 6, add `PreconditionFailedError` for 9.**

- gRPC `6 ALREADY_EXISTS` → the **existing** `ConflictError` (already exported, already HTTP 409).
- gRPC `9 FAILED_PRECONDITION`, non-index → a **new** `PreconditionFailedError`, HTTP **412**.

The two are genuinely different conditions with different established HTTP semantics: "the id is
taken" (409) versus "your stated precondition about the current version is false" (412). Collapsing
them into one class would force callers to re-sniff the cause.

`PreconditionFailedError` is message-only, matching `NotFoundError` / `ConflictError`. The server's
version numbers are deliberately **not** attached as structured fields — they are emulator-flavored
and would become an accidental contract.

**D3 — `parseFirestoreError` branch ORDER is a durable invariant.** Firestore overloads
`FAILED_PRECONDITION` for both a missing composite index and a failed write precondition. The
narrower index check (`code 9` **and** `details` containing `requires an index`) must stay strictly
**above** the blanket code-9 branch. Inverting them silently reclassifies every missing-index error
— an actionable `FirestoreIndexError` carrying the console creation URL — as a generic 412. A unit
test pins the ordering and fails if the branches are swapped.

Classification is on the status **code** only, never on message text: emulator messages are
Datastore-flavored and differ from production, so message-sniffing would produce a false green
locally. No test asserts server message text.

**D4 — New members.** `createWithId(id, data, options?)`, `bulkCreateWithIds(entries, options?)`,
`createWithIdInTransaction(tx, id, data)`, and `getByIdWithUpdateTime(id)`. Overloads and the
`{ returnDoc: true }` opt-in mirror `create` / `bulkCreate` / `upsert` exactly (ADR-0013), and the
id-first positional shape matches `upsert(id, data, options?)`. Every caller-supplied id passes
`validateId` **before any hook or I/O** — the same security boundary as every other id-taking
surface, because `CollectionReference.doc()` accepts a slash-separated path.

`bulkCreateWithIds` reproduces `bulkCreate`'s hook-identity invariants verbatim: ids captured before
`beforeBulkCreate`, a stable pre-hook work list the write loop iterates, and a frozen array handed
to the hook — so a hook can mutate documented data fields but cannot repoint, reorder, or splice a
write. It also rejects duplicate ids in its input up front, because the backend's own
insert-then-insert diagnostic is an opaque `INVALID_ARGUMENT`. **No hook event signature changed.**

**D5 — `lastUpdateTime` is threaded through the existing write surfaces**, not bolted on as parallel
methods: `UpdateOptions` gains `lastUpdateTime?`, `patch` / `delete` / `patchInTransaction` /
`deleteInTransaction` gain an options bag, bulk entries gain a per-entry `lastUpdateTime?`, and
`bulkDelete` gains a second overload accepting `{ id, lastUpdateTime? }[]` alongside the legacy
`ID[]`. Option forwarding follows the ADR-0025 precedent: reference the option type as
`FirebaseFirestore.Timestamp` in source and **do not re-export** it, so emitted declarations stay
free of a peer module-resolution edge.

**D6 — Never pass an explicit `undefined` precondition to `update`.** Probed on all three surfaces:
`docRef.update(data, undefined)`, `batch.update(ref, data, undefined)`, and
`tx.update(ref, data, undefined)` all **throw** "Input is not an object", because `update` also has
an alternating field/value overload and parses the extra argument as a _field_. (`delete(undefined)`
happens to be tolerated.) Every call site therefore **branches** and calls the one-argument form
when no token was supplied; an empty `{}` is not used as a substitute either, since it is a valid
no-op precondition that would silently widen the SDK surface every existing write touches. A unit
test asserts that a precondition-free `update` reaches the SDK with **exactly one argument**, so
removing the branch fails the suite instead of breaking every existing caller at runtime.

**D7 — `Precondition.exists` is out of scope.** The SDK permits at most one condition per write and
restricts `exists` to `true` on update (see Context), and the issue asked for `lastUpdateTime` only.
Supporting both would mean designing a mutual-exclusion API for a capability nobody requested; the
`create()`-backed methods already cover the "must not exist" case.

**D8 — `upsert()` is untouched, and `create(data)` keeps `add()` semantics.** The issue says so for
`upsert`. For auto-id `create`, switching to create-only would be invisible except for the error
type in a practically impossible collision.

**D9 — `delete(id)` does not auto-precondition on its own pre-read.** Deriving a precondition from
the existence read the method already performs would turn today's benign races into errors — a
silent behavior change to an existing method.

This record **amends ADR-0017**: conditional writes / preconditions are no longer deferred. The
remaining deferrals (#34–#41) and the decision not to pursue full server-side or Enterprise Pipeline
parity are unchanged. (This footer is a living index of remaining ADR-0017 deferrals — see
[`docs/adr/README.md`](README.md) Conventions.)

## Consequences

- **Public behavior change (breaking).** `parseFirestoreError` is publicly exported, and it now
  reclassifies two codes it previously returned unchanged: gRPC `6` → `ConflictError` and non-index
  gRPC `9` → `PreconditionFailedError`. Code that caught a raw `Error` and inspected `.code` from
  any repository operation — not only the new ones — sees a typed library error instead. Released as
  `feat(repository)!:` with a `BREAKING CHANGE:` footer.
- Optimistic concurrency is now expressible end to end: read a token with `getByIdWithUpdateTime`,
  write with `{ lastUpdateTime }`, catch `PreconditionFailedError`, re-read, retry.
- **The missing-document outcome now depends on whether a precondition was supplied.**
  `update(id, data)` on a deleted document still raises `NotFoundError` (code 5), but
  `update(id, data, { lastUpdateTime })` raises `PreconditionFailedError` — Firestore reports the
  absent document as stored version 0 (code 9). This is the backend's behavior, not a normalization
  choice, and it is documented on every affected surface.
- `delete(id, { lastUpdateTime })` on an already-missing document raises `NotFoundError` instead,
  because `delete`'s own existence pre-read runs first. Likewise `bulkDelete` returns `0` for an
  entry whose document is already gone — the pre-read filter drops it before the batch is built.
  These are consistent with the pre-existing shape of those two methods, not new special cases.
- **The >500-operation caveat extends to preconditions.** A conditional bulk write of ≤ 500
  operations is atomic — one failure lands nothing. Above 500, `commitInChunks` commits each chunk
  independently, so earlier chunks stay committed when a later one fails a precondition. Use a
  transaction when you need all-or-nothing beyond 500 documents.
- **A precondition failure inside a transaction fails immediately with no retry** (probed: exactly
  one callback invocation). Inside a read-write transaction the transaction's own lock is usually
  the better tool; a precondition is for a token read _outside_ the transaction.
- **UNVERIFIED — emulator↔production divergence for a _future_ `lastUpdateTime`.** The emulator
  returns `code 3 INVALID_ARGUMENT` for a token newer than the stored version, not `9`. We
  deliberately do **not** normalize code 3: a future token is a malformed value (clock skew, a
  fabricated timestamp), not a lost race, and telling code-3 variants apart would require the
  message-sniffing D3 forbids. Whether production returns `3` here is **not verified**, and this
  record does not claim it either way. The integration test asserts only that the call rejects and
  the document is unchanged; it deliberately does **not** pin an error class.
- `ReadOnlyTransactionalRepository` gains **nothing**. The three create-only members are writes, and
  `getByIdWithUpdateTime` performs **non-transactional** I/O — exactly the footgun ADR-0025 D3's
  membership rule excludes, since it bypasses both the transaction and any `readTime`. Four
  `@ts-expect-error` type tests pin their absence.
- `bulkDelete`'s two overloads cannot be mixed: `['a', { id: 'b' }]` matches neither. That is
  deliberate and pinned by a type test.

## Alternatives considered

**Escape-hatch-only for the read half** (document `db.collection(...).doc(id).get().updateTime`
instead of shipping `getByIdWithUpdateTime`): rejected — it leaves the issue's acceptance flow
half-wrapped, forcing callers out of the ORM for the one value the feature requires.

**Writes return the post-write `updateTime`**: rejected — it breaks the `{ id }` return contract
ADR-0013 established, for a case a re-read already covers.

**A flat `FirestoreDocument<T> & { updateTime }` read result**: rejected — shadows a stored
`updateTime` field, the exact collision class ADR-0018 exists to prevent.

**A single new error class for both codes 6 and 9**: rejected — collapses HTTP 409 and 412 into one
type and forces callers to re-derive the cause.

**Redefining `upsert()` as create-only**: rejected — the issue forbids it, and it would silently
break every existing idempotent-sync caller.

**Normalizing gRPC code 3 into `PreconditionFailedError`**: rejected — a malformed token is not a
lost race, and distinguishing code-3 variants requires message-sniffing.

**Supporting `Precondition.exists`**: rejected — see D7.

**Adding `upsert`'s standalone dot-notation guard to `createWithId`**: rejected — that guard exists
only because `upsert`'s behavior is existence-dependent. `createWithId` is always a create, so
`validateCreateData`'s own dotted-key rejection is sufficient and correct.

## References

- `src/core/Errors.ts` — `PreconditionFailedError`
- `src/core/ErrorParser.ts` — the code 6 / code 9 branches and the ordering invariant
- `src/core/FirestoreRepository.ts` — `createWithId`, `bulkCreateWithIds`,
  `createWithIdInTransaction`, `getByIdWithUpdateTime`, `toPrecondition`, and the seven branched
  write call sites
- `src/express/index.ts` — the 412 mapping
- `src/tests/types/conditional-writes.type-test.ts`
- `src/tests/unit/repository-conditional-writes.unit.test.ts` (T1 one-argument guard),
  `src/tests/unit/errorParser.unit.test.ts` (branch-ordering guard)
- `src/tests/integration/repository-conditional-writes.integration.test.ts`
- Starlight: CRUD Operations, Transactions, Id Strategies, Repository / Errors reference, Scope &
  Capabilities, migration guide
- `@google-cloud/firestore` `build/src/write-batch.js` (`validatePrecondition`) and
  `types/firestore.d.ts`
