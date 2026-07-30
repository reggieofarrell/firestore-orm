# Issue #46 — Hook delivery and write-outcome error model

Status: implementation handoff

Issue: [#46](https://github.com/reggieofarrell/firestore-orm/issues/46)

Baseline: `main` at `284ef98 feat(query): dedupe distinctValues() by Firestore-aware semantic equality (#40) (#78)`

Feature branch: `feat/issue-46-hook-delivery-error-model`

## §0. Handoff contract

Implement this plan on the existing feature branch. The implementer is expected to have only a
fresh clone, this directory, and the repository instructions.

1. Check out `feat/issue-46-hook-delivery-error-model`; do not create another branch.
2. Rebase onto current `main` before editing. If the baseline moved, rerun the enumerations and
   probes in §3, then update any drifted line references in `notes.md`.
3. Use Node 24 (`.nvmrc`) and a JDK capable of running the Firestore emulator.
4. Follow §7 in order. Do not combine the deferred outbox or documentation defect into this change.
5. Write implementation decisions, deviations, command results, and refute-first self-review
   dispositions to `notes.md`; commit it with the implementation.
6. Every new test specified by §8 must be demonstrated to fail on the unfixed baseline before it is
   accepted as a regression test.
7. Run the full §10 gate. Do not describe an unexecuted leg as passing.
8. Hand the implementation to an independent reviewer while this plan directory is still present.
   Remove the directory only after review, as specified by §11.

The planning probes are deliberately retained under `probes/`. They investigate the baseline; they
are not substitutes for the permanent tests in §8.

## §1. Decisions and acceptance criteria

### §1.1 Owner decisions

**D1 — Deliver the error model and documentation; defer durable delivery.** Issue #46 covers the
observable hook/write outcome model and idempotency guidance. A transactional outbox is a separate,
larger feature tracked by [#80](https://github.com/reggieofarrell/firestore-orm/issues/80).

Rejected: bundling an outbox into this issue. It adds persistence schema, polling/lease semantics,
delivery guarantees, and operational ownership that are independent of accurately reporting the
outcome of existing writes.

**D2 — Wrap only outcome-sensitive failures.** Add one public `WriteOutcomeError`; preserve ordinary
top-level `ValidationError`, `InvalidDocumentIdError`, `NotFoundError`, `ConflictError`,
`PreconditionFailedError`, and raw/normalized SDK failures when no write committed and no hook is
the failed phase.

Rejected: wrap every write rejection. That would needlessly destroy established `instanceof`
control flow for precommit validation and first-commit failures whose outcome is already
unambiguous.

**D3 — Keep transaction `before*` hooks.** They preserve the same normalization, validation, and
invariant boundary as direct repository writes. Add a typed second `HookContext` callback argument
so a hook can distinguish direct execution from retryable transaction execution.

Rejected: remove transaction hooks as a v3 breaking cleanup. That would make
`updateInTransaction`, `createInTransaction`, `createWithIdInTransaction`, and
`deleteInTransaction` silently bypass hooks that may enforce invariants.

**D4 — Expose an ORM-observed transaction attempt, with an honest unknown state.** For
`repo.runInTransaction()`, the context carries a 1-based count of callback invocations. For a public
`*InTransaction` helper used with a caller-managed raw Admin SDK transaction, use `attempt: null`;
the ORM cannot observe the outer callback. The field is diagnostic only and MUST NOT be documented
or used as an idempotency/deduplication key.

The Admin SDK does not provide a documented stable attempt identifier or callback-attempt argument.
The ORM count is therefore “how many times this wrapper has entered the callback,” not a backend
retry token.

**D5 — Use one discriminated outcome type.** `WriteOutcomeError.outcome` distinguishes:

- `state: 'not-committed', phase: 'before-hook'`;
- `state: 'partially-committed', phase: 'commit'`;
- `state: 'committed', phase: 'after-hook'`;
- `state: 'committed', phase: 'read-back'`.

Rejected: four unrelated error subclasses. Callers primarily need an exhaustive state/phase branch,
and a correlated discriminated union keeps phase-specific fields type-safe.

**D6 — Preserve sequential, fail-fast hook delivery.** Hooks continue in registration order and the
first thrown/rejected hook stops later hooks. This issue documents that behavior; it does not invent
best-effort or aggregate delivery.

### §1.2 Issue acceptance criteria

The issue asks to “Document — and then model — hook retry / delivery / idempotency semantics” and
calls out these current cases:

- transaction `before*` hooks may run more than once;
- an `after*` hook failure rejects even though the write committed;
- fixed batches larger than 500 commit as independent chunks, so a later failure can leave earlier
  chunks committed and skip the `after*` hook;
- errors should distinguish precommit failure, partial commit, committed write plus after-hook
  failure, and hook failure.

This plan makes those statements executable as follows:

1. Consumers can distinguish all outcome-sensitive failures via `WriteOutcomeError.outcome`.
2. Existing ordinary precommit error classes remain top-level.
3. Every hook receives a typed context; only `before*` hook contexts admit transaction execution.
4. ORM-owned transaction callbacks report a 1-based observed attempt; externally owned transaction
   callbacks report `null`.
5. Partial fixed-batch errors report exact successfully committed write count and requested total.
6. Postcommit read-converter/read-back failures are explicitly classified as committed.
7. The Express adapter returns safe outcome metadata without serializing the original `cause`.
8. Public docs state ordering, fail-fast behavior, transaction retry behavior, attempt limitations,
   write outcomes, partial batches, read-back failures, and idempotency guidance.
9. Emulator-backed tests make each persistence claim, not mocks.

## §2. Scope and complete affected-surface map

### §2.1 Production source in scope

| File | Required change | Why |
| --- | --- | --- |
| `src/core/Hooks.ts` (new) | Own and export `HookEvent`, `HookContext`, and their internal event subsets | Avoid a type cycle between repository hook signatures and the new error outcome |
| `src/core/Errors.ts` | Add `WriteOutcome`, `WriteOutcomeError`, JSDoc, stable `name`, and explicit `cause` | Public outcome contract |
| `src/core/ErrorParser.ts` | Preserve a `WriteOutcomeError` unchanged before SDK normalization | Nested repository catches must not erase the outcome |
| `src/core/FirestoreRepository.ts` | Import hook types; add context to every hook callback; split combined delete aliases; build contexts; track transaction callback invocation; wrap hook/read-back/partial-commit failures | Primary write implementation |
| `src/core/QueryBuilder.ts` | Consume the widened bound hook dispatcher contract and preserve query update/delete outcome behavior | Query writes run bulk hooks through the repository dispatcher |
| `src/index.ts` | Export `HookContext`, `HookEvent`, `WriteOutcome`, and `WriteOutcomeError` | Root public API |
| `src/express/index.ts` | Map `WriteOutcomeError` to HTTP 500 with non-sensitive outcome metadata | Optional public adapter |

### §2.2 Exact baseline call-site enumeration

`FirestoreRepository.ts`:

- Hook type surface: `253`, callback aliases `261–286`, registry `362`, overloads immediately before
  dispatcher `998–1008`, dispatcher `1013–1016`.
- Central after-create emitters: `1025`, `1031`.
- Before hooks: `1304`, `1394`, `1482`, `1587`, `2177`, `2346`, `2487`, `2560`, `2669`,
  transaction helpers `3785`, `3868`, `3924`, `3977`.
- Other after hooks: `2202`, `2372`, `2569`, `2687`.
- Fixed-batch commit callers: `1501`, `1608`, `2369`, `2686`; helper `3448–3466`.
- Postcommit read-backs: `1315`, `1410`, `1506`, `1613`, `2207`, `2496`.
- Transaction callback and hook-cloning boundary: `3529–3580`, especially the clone at
  `3569–3573`.

`QueryBuilder.ts`:

- Bound dispatcher member/constructor propagation: `1757`, `1926`.
- Query update hooks and commit: `2084`, `2098`, `2101`.
- Query delete hooks and commit: `2161`, `2170`, `2171`.

The executable enumeration is
`node docs/plans/issue-46-hook-delivery-error-model/probes/N-write-outcome-sites.mjs`.

### §2.3 Tests in scope

- A dedicated emulator suite for hook context and outcome/persistence behavior.
- Existing hook/transaction/query integration suites where their public callback typing or
  assertions become stale.
- Unit tests for the new error class, parser preservation, package exports, and Express response.
- A compile-only/type test for event-correlated `HookContext` narrowing and root exports.
- Existing package consumer fixtures only if the new root exports require an explicit assertion.

### §2.4 Documentation and architecture in scope

- New ADR (claim the next free number at implementation time) and `docs/adr/README.md`.
- `website/src/content/docs/guides/concepts/lifecycle-hooks.md`.
- `website/src/content/docs/guides/working-with-data/transactions.md`.
- `website/src/content/docs/guides/working-with-data/crud-operations.md`.
- `website/src/content/docs/reference/repository.md`.
- `website/src/content/docs/reference/errors.md`.
- `website/src/content/docs/reference/types.md`.
- `website/src/content/docs/reference/scope-and-capabilities.md`.
- `website/src/content/docs/guides/integrations/express.md`.
- `website/src/content/docs/guides/migration-v2-to-v3.md`.

### §2.5 Explicitly out of scope

- Transactional outbox/durable effects: #80.
- The contradictory lifecycle-hooks sentence about `query().delete()`: bug
  [#79](https://github.com/reggieofarrell/firestore-orm/issues/79). Preserve the runtime contract
  that query delete runs bulk hooks; do not broaden this PR into unrelated copy repair.
- `bulkWrite` and `recursiveDelete`: their separate, documented no-hook/per-item contracts remain.
- Collection-group and vector APIs: read-only with respect to this change.
- Raw `tx.*` calls: they continue to bypass repository validation and hooks.
- Changing hook registration/removal, parallelizing hooks, aggregating failures, continuing after a
  hook failure, or adding automatic hook retries.
- Historical frozen `website/src/content/docs/2.0/**`.
- README/npm README: neither currently documents hook callback signatures or the outcome model.
  Re-run the grep in §10; use `readme-sync` only if implementation expands their consumer content.
- `CHANGELOG.md`, which is generated from Conventional Commits.

### §2.6 Where the issue is stale or incomplete

- “v3 docs-only guidance” is superseded by the owner’s decision to use the unreleased v3 break
  window for the API model.
- It does not enumerate query-builder bulk hook write sites.
- It omits the six postcommit `{ returnDoc: true }` read-back/converter failure sites.
- It does not distinguish ORM-owned transaction callback attempts from caller-owned raw SDK
  transactions.
- Its “precommit failure” category is too broad to imply wrapping: ordinary validation/conflict/SDK
  failures remain their existing errors under D2.

## §3. Verified baseline facts

### §3.1 Runtime facts

**N1 — Before-hook failure means no write at the probed direct create boundary.** The probe throws a
sentinel error from `beforeCreate`, observes the same error identity, and reads zero documents.

**N2 — After-hook failure happens after commit.** A thrown `afterCreate` sentinel is currently
returned with the same identity, the document exists, and a later registered hook was not called.
This establishes commit ordering and fail-fast behavior.

**N3 — Read-back failure can follow a successful commit.** With `{ returnDoc: true }`, a throwing
read converter currently rejects with the same sentinel while the created document exists.

**N4 — A fixed batch can partially commit.** `bulkCreateWithIds` with 501 writes and a pre-existing
last ID commits the first 500, rejects the last chunk with `ConflictError`, and does not run
`afterBulkCreate`.

N1–N4 are produced by:

```sh
node docs/plans/issue-46-hook-delivery-error-model/probes/N-hook-write-outcomes.mjs
```

Observed baseline:

```text
before_hook: same error identity; 0 stored
after_hook: same error identity; 1 stored; later hook calls 0
readback_after_commit: same error identity; 1 stored
later_chunk_failure: ConflictError; 500 newly committed; after hook calls 0
```

**N5 — Transaction callbacks and before hooks are retried together.** Two contending logical
transactions each entered their callback twice. The probe observed four total callback entries,
four `beforeUpdate` calls, and a final counter value of two.

```sh
node docs/plans/issue-46-hook-delivery-error-model/probes/N-transaction-retry-hooks.mjs
```

Observed baseline:

```text
logical transactions: 2
callback attempts: [2, 2]
total callback attempts: 4
before_update hook calls: 4
final value: 2
```

This proves at-least-once callback/hook execution under contention. It does not prove that every
future SDK retry schedule will be identical.

### §3.2 Source facts

**P1 — Hooks are sequential and fail-fast.** The dispatcher at
`src/core/FirestoreRepository.ts:1013` awaits each callback without an aggregate catch.

**P2 — After hooks are postcommit.** Fixed batch methods commit at
`src/core/FirestoreRepository.ts:1501`, `1608`, `2369`, and `2686`; their after emitters follow.
Single writes follow the same ordering around `2202`, `2569`, and the central create emitters.

**P3 — Fixed batches are sequential 500-operation commits.**
`src/core/FirestoreRepository.ts:3448–3466` commits when the counter reaches 500 and commits the
remainder afterward. It currently returns no committed count.

**P4 — Transaction hooks are cloned, not globally shared by reference.**
`src/core/FirestoreRepository.ts:3569–3573` copies hook arrays to the transaction-scoped repository.
Only the four `*InTransaction` write helpers call before hooks (`3785`, `3868`, `3924`, `3977`);
there are no transaction after-hook calls.

**P5 — A transaction-scoped repository still exposes normal methods in a read-write callback.**
Documentation at `website/src/content/docs/guides/working-with-data/transactions.md:21` warns that
calling them performs nontransactional I/O. Therefore transaction context cannot be a blanket
property that makes every hook on the cloned repository report transaction execution.

**P6 — Query writes use the bound repository dispatcher.** Constructor state at
`src/core/QueryBuilder.ts:1757`/`1926` and write sites `2084–2101`, `2161–2172` show query update and
delete use bulk hooks.

**P7 — Unknown Error instances are preserved today.**
`src/core/ErrorParser.ts:73` returns an existing `Error`. The new class still requires an explicit
early preservation branch so future parser mappings cannot accidentally unwrap/reclassify it.

**P8 — The Express fallback hides details but erases outcome.**
`src/express/index.ts:130` returns generic HTTP 500. The new branch belongs before it and must expose
only the safe `outcome` fields.

### §3.3 Public-doc facts

**R1 — Transaction hooks are already public behavior.**
`website/src/content/docs/reference/repository.md:344–345` says only before hooks run inside
transactions; `website/src/content/docs/guides/working-with-data/transactions.md:16–19` directs
users to transaction helpers so hooks and validation run.

**R2 — Bulk partiality is incompletely described.**
`website/src/content/docs/reference/scope-and-capabilities.md:39` says fixed batches use 500-op
chunks and the first failure throws, but does not give a typed committed count/outcome.

**R3 — Existing error docs promise a small typed set.**
`website/src/content/docs/reference/errors.md:13–14` and the normalization table at `173–177` need
the new error without weakening existing classes.

**R4 — Express has an exhaustive table.**
`website/src/content/docs/guides/integrations/express.md:178–188` needs an explicit 500 row.

**R5 — Hook callback exports currently list only `HookEvent`.**
`website/src/content/docs/reference/types.md:45` must add `HookContext`, `WriteOutcome`, and the new
class cross-reference.

### §3.4 Baseline gates

Under Node `v24.18.0`, all 14 §10 legs passed at `284ef98`:

- unit: 32 suites / 407 tests;
- integration: 34 suites / 504 tests;
- unit coverage groups: utils 98.93% lines / 94.47% branches / 100% functions;
  error-validation 98.24 / 92.58 / 100; index 100 / 100 / 75;
- integration coverage: repository 97.81 / 91.59 / 93.18; query builder 96.80 / 87.72 / 100;
  collection group 99.55 / 97.22 / 100; validation 95.97 / 90.51 / 100; vector
  93.26 / 88.03 / 96.55.

`check:package`, `check:consumer`, and the full gate used a temporary npm cache because the local
default cache contains root-owned entries. The local consumer run exercised firebase-admin 14;
the 12/13/14 peer-major matrix remains CI-owned and is not claimed here.

## §4. Implementation traps

1. **T1 — Do not wrap all errors.** Use N1/D2: before-hook errors are wrapped because the failed
   phase matters, but validation, malformed ID, precondition, conflict, and first commit failures
   keep their existing top-level types when `committedWrites === 0`.
2. **T2 — Do not infer outcome from the caught error.** Outcome comes from control-flow position:
   before hook, successful commit count, after hook, or postcommit read-back.
3. **T3 — Increment only after `await batch.commit()` resolves.** Incrementing before await would
   falsely report a failed chunk as committed.
4. **T4 — Preserve partiality for synchronous action-building failures.** If an error occurs while
   building a later chunk after earlier commits, return the already committed count through the same
   partial outcome.
5. **T5 — Preserve exact totals.** A bulk call’s `totalWrites` is its input/action count, not number
   of chunks; `committedWrites` counts successful document write actions.
6. **T6 — Do not let `parseFirestoreError` erase the wrapper.** Check
   `instanceof WriteOutcomeError` before SDK code parsing.
7. **T7 — Cover all six postcommit read-backs.** Create, create-with-ID, both bulk create variants,
   update (including patch delegation), and upsert-create must use one helper.
8. **T8 — Do not mark the entire cloned transaction repository as transactional.** P5 means normal
   `create()` called on that object is still a direct write. Pass execution explicitly only from
   `*InTransaction` helpers.
9. **T9 — Attempt means wrapper invocation.** Start at one, increment immediately before each Admin
   SDK callback invocation, and set that value on the per-invocation transaction repo. Use `null`
   when no wrapper-owned value exists. Never expose an alleged SDK retry ID.
10. **T10 — Type after hooks as direct-only.** `HookContext<'afterCreate'>` must not admit the
    transaction branch. A broad uncorrelated context loses this guarantee.
11. **T11 — Split delete aliases.** The current combined `DeleteHookFn` and `BulkDeleteHookFn`
    service before and after events. Split them so event-specific contexts remain correlated.
12. **T12 — Existing one-argument hooks must compile.** TypeScript permits a function with fewer
    parameters as a callback; do not make context opt-in via a second overload or force consumers to
    add an unused parameter.
13. **T13 — QueryBuilder is bound to repository helpers.** Update the private `RunHook` signature
    and constructor propagation; do not duplicate error wrapping in query methods if centralized
    dispatcher/commit helpers provide it.
14. **T14 — Do not leak causes over HTTP.** The original hook/converter/SDK error can contain
    sensitive data. Serialize only the discriminated outcome after removing `cause`.
15. **T15 — Keep fail-fast ordering.** Do not use `Promise.all`, collect errors, or run later hooks
    after a failure.
16. **T16 — Do not promise durable delivery.** After hooks remain in-process, postcommit,
    at-most-once per successful ORM method invocation, and may never finish on process crash.
17. **T17 — Do not touch no-hook paths.** `bulkWrite` and `recursiveDelete` retain their own
    contracts and errors.
18. **T18 — Do not “fix” #79 here.** Runtime query delete bulk hooks are part of this issue’s test
    surface, but the unrelated contradictory prose stays assigned to #79.

## §5. Verification bounds and unresolved external behavior

- No full production prototype was built. The sites are finite and greppable, while the behavioral
  unknowns were answered by emulator probes. This avoids implementing the feature twice.
- The exact §6 type/class/dispatcher/helper fragments were placed in temporary files under `src/`,
  passed `npm run test:types`, and emitted declarations successfully. The scratch files were then
  deleted.
- The contention probe demonstrates retries on the current emulator/SDK, not a guaranteed retry
  count for every contention schedule.
- The ORM cannot know an outer callback attempt for raw caller-managed transactions; `null` is the
  intentional public representation.
- The error model reports observed commit state; it does not create atomicity across 500-operation
  chunks and does not guarantee delivery of side effects.
- Only firebase-admin 14 was exercised by the local consumer check. CI owns the full supported peer
  matrix.
- No unresolved design conditional remains. ADR numbering is intentionally resolved at
  implementation time because a rebase can consume `0035`; the current next free number is `0035`.

## §6. Public API and core implementation prescription

These signatures were compiled together and declaration-emitted during planning.

### §6.1 `src/core/Hooks.ts`

```ts
export type HookEvent =
  | 'beforeCreate'
  | 'afterCreate'
  | 'beforeUpdate'
  | 'afterUpdate'
  | 'beforeDelete'
  | 'afterDelete'
  | 'beforeBulkCreate'
  | 'afterBulkCreate'
  | 'beforeBulkUpdate'
  | 'afterBulkUpdate'
  | 'beforeBulkDelete'
  | 'afterBulkDelete';

type BeforeHookEvent = Extract<HookEvent, `before${string}`>;

export type HookContext<E extends HookEvent = HookEvent> =
  | {
      readonly event: E;
      readonly execution: 'direct';
      readonly retryable: false;
    }
  | (E extends BeforeHookEvent
      ? {
          readonly event: E;
          readonly execution: 'transaction';
          readonly retryable: true;
          readonly attempt: number | null;
        }
      : never);
```

Keep the event on the context even though it duplicates the registration key: it enables logging,
portable shared hook functions, and correlated narrowing. Add complete JSDoc, including that
`attempt` is diagnostic and not an idempotency key.

### §6.2 `src/core/Errors.ts`

```ts
import type { HookContext, HookEvent } from './Hooks.js';

export type WriteOutcome =
  | {
      readonly state: 'not-committed';
      readonly phase: 'before-hook';
      readonly hook: HookContext<HookEvent>;
    }
  | {
      readonly state: 'partially-committed';
      readonly phase: 'commit';
      readonly committedWrites: number;
      readonly totalWrites: number;
    }
  | {
      readonly state: 'committed';
      readonly phase: 'after-hook';
      readonly hook: HookContext<HookEvent>;
    }
  | {
      readonly state: 'committed';
      readonly phase: 'read-back';
    };

export class WriteOutcomeError extends Error {
  readonly outcome: WriteOutcome;
  override readonly cause: Error;

  constructor(outcome: WriteOutcome, cause: Error) {
    super(messageForWriteOutcome(outcome), { cause });
    this.name = 'WriteOutcomeError';
    this.outcome = outcome;
    this.cause = cause;
  }
}
```

Implement a private `messageForWriteOutcome` with stable, non-cause-derived messages. Freeze neither
the error nor the outcome unless the project’s existing errors establish that convention. Normalize
unknown caught values through `parseFirestoreError` before assigning `cause`, but preserve an
existing `WriteOutcomeError`.

Use event-specific `HookContext<E>` at construction sites even though the public outcome union uses
the complete event union. Do not add the cause inside `outcome`; this keeps HTTP serialization safe.

### §6.3 Hook dispatcher

```ts
private async runHooks<E extends HookEvent>(
  event: E,
  data: HookDataFor<E, T, W, WO>,
  execution:
    | { readonly kind: 'direct' }
    | { readonly kind: 'transaction'; readonly attempt: number | null } = { kind: 'direct' },
): Promise<void> {
  const context = hookContext(event, execution);

  try {
    for (const hook of this.hooks[event] ?? []) {
      await hook(data, context);
    }
  } catch (error) {
    throw new WriteOutcomeError(
      {
        state: event.startsWith('before') ? 'not-committed' : 'committed',
        phase: event.startsWith('before') ? 'before-hook' : 'after-hook',
        hook: context,
      } as WriteOutcome,
      parseFirestoreError(error),
    );
  }
}
```

The final code should avoid the illustrative `as WriteOutcome`: implement overloads or small typed
before/after helpers so the compiler verifies the phase/context correlation. Define a
`HookDataFor<E,...>` mapping (or equivalently event-specific callback map) and replace current `any`.
Every callback alias takes `(data, context)` with the exact event context.

The dispatcher’s default is direct. Only transaction helper calls pass
`{ kind: 'transaction', attempt: this.transactionAttempt ?? null }`.

### §6.4 Transaction attempt tracking

Inside `runInTransaction`, initialize a closure-local counter to zero. On every SDK callback entry:

1. increment the counter;
2. construct the per-invocation transaction repository;
3. clone hooks as today;
4. assign the current observed attempt to a private optional field on that per-invocation repo;
5. invoke the user callback.

Do not reuse one transaction repo across retries. Do not change `maxAttempts` forwarding. Public
`*InTransaction` calls made on a repository without the private value report `attempt: null`.
Normal repository methods always use the dispatcher default and therefore remain `direct`, even on
the cloned object.

### §6.5 Commit and read-back helpers

Change the fixed-batch helper to return a successful count and wrap only after prior success:

```ts
private async commitInChunks(
  actions: readonly ((batch: WriteBatch) => void)[],
): Promise<number> {
  let committedWrites = 0;

  try {
    // Preserve current 500-operation chunking and action order.
    // After each successful batch.commit():
    committedWrites += writesInThatBatch;
    return committedWrites;
  } catch (error) {
    const cause = parseFirestoreError(error);
    if (committedWrites === 0) throw cause;
    throw new WriteOutcomeError(
      {
        state: 'partially-committed',
        phase: 'commit',
        committedWrites,
        totalWrites: actions.length,
      },
      cause,
    );
  }
}
```

Keep the real loop structurally close to the existing implementation; the omitted pseudocode is not
permission to change batching semantics.

Centralize all six return-document conversions:

```ts
private async readAfterCommit<R>(read: () => Promise<R>): Promise<R> {
  try {
    return await read();
  } catch (error) {
    throw new WriteOutcomeError(
      { state: 'committed', phase: 'read-back' },
      parseFirestoreError(error),
    );
  }
}
```

Call it only after a successful write. Do not use it on ordinary reads.

### §6.6 Parser, exports, and Express

- `parseFirestoreError`: first return an existing `WriteOutcomeError`.
- Root `src/index.ts`:

```ts
export { WriteOutcomeError } from './core/Errors.js';
export type { WriteOutcome } from './core/Errors.js';
export type { HookContext, HookEvent } from './core/Hooks.js';
```

- Remove/repoint the old `HookEvent` declaration/export in `FirestoreRepository.ts`.
- Do not export these from the `./vector` subpath.
- Express maps the class to status 500:

```ts
{
  error: 'WriteOutcomeError',
  outcome: err.outcome
}
```

Because `cause` is outside `outcome`, ordinary JSON serialization cannot expose it. Add defensive
response assertions in §8.

## §7. Ordered implementation procedure

1. Rebase the existing branch and rerun the three probes plus site enumeration. Record drift in
   `notes.md`; never blindly apply baseline line numbers.
2. Use the `adr` skill to claim the next free ADR and record D1–D6 before source changes. Add its
   index row.
3. Add `src/core/Hooks.ts`, move `HookEvent`, add complete JSDoc, and update root type exports.
4. Add `WriteOutcome`, `WriteOutcomeError`, and message helper to `Errors.ts`; update root exports.
5. Add parser preservation and unit tests before touching repository control flow.
6. Replace the repository hook callback aliases with an event-to-callback map. Split before/after
   delete aliases. Add the context builder and typed dispatcher while preserving sequential
   fail-fast execution.
7. Update every direct and query-builder hook call. Direct calls should normally need no third
   argument; query builder continues through the bound dispatcher.
8. Add closure-local transaction attempt counting and pass explicit transaction execution from all
   four transaction write helpers. Test that ordinary methods on the cloned repo remain direct.
9. Refactor `commitInChunks` to count successful writes and wrap only nonzero partial outcomes.
   Revisit all four callers.
10. Add `readAfterCommit` and replace all six enumerated read-back sites.
11. Add the explicit Express mapping.
12. Implement the full §8 permanent test matrix using the `unit-testing` and `integration-testing`
    skill guardrails. Demonstrate each new test’s baseline failure.
13. Complete the §9 docs sweep. Do not edit frozen 2.0 docs, READMEs, #79 copy, or changelog.
14. Run targeted tests, coverage gates, then all 14 §10 legs.
15. Perform a refute-first self-review: re-enumerate hook calls, commit calls, read-backs, exports,
    docs, and error catches; record every challenge and disposition in `notes.md`.
16. Commit with a breaking Conventional Commit, for example:
    `feat(repository)!: model hook and partial-write outcomes (#46)`.
17. Request independent implementation review before §11 cleanup.

## §8. Permanent regression-test plan

### §8.1 Integration tests (primary confidence layer)

Create `src/tests/integration/repository-write-outcomes.integration.test.ts` with the required JSDoc
strategy header and `createUserRepoHarness()`/shared factories. Keep persistence assertions against
the emulator.

**I1 — Before-hook classification, all event families.** Table-test direct single create/update/
delete and bulk create/update/delete (query variants separately where useful):

- rejects with `WriteOutcomeError`;
- `outcome.state === 'not-committed'`;
- `phase === 'before-hook'`;
- exact `hook.event`, `execution: 'direct'`, `retryable: false`;
- `cause` is the thrown hook error;
- Firestore state is unchanged.

**I2 — After-hook classification and fail-fast delivery.** For each after event family:

- committed data/count is observable after rejection;
- state/phase are `committed`/`after-hook`;
- context is direct;
- original error is `cause`;
- a later registered hook was not invoked.

Include `query().update()` and `query().delete()` to pin P6 without changing #79’s prose.

**I3 — Transaction hook context.**

- A transaction before-hook sees `execution: 'transaction'`, `retryable: true`, attempt `1` without
  contention.
- A thrown transaction before-hook yields not-committed/before-hook and no write.
- Calling a normal `create()` on the transaction-scoped repo reports direct context, proving T8.
- Calling a public `*InTransaction` helper with a caller-managed raw transaction reports
  `attempt: null`.

**I4 — Retried transaction attempt.** Adapt the contention barrier from
`N-transaction-retry-hooks.mjs`; assert at least one logical callback observes monotonically
increasing attempts beginning at one and that hook observations match callback invocation count.
Do not assert the exact `[2,2]` schedule. Assert final data once per logical transaction, and state in
the test name that attempts are diagnostic.

**I5 — Partial fixed batches.** For 501-entry create-with-ID with the final ID pre-existing:

- `WriteOutcomeError`;
- state/phase `partially-committed`/`commit`;
- `committedWrites === 500`, `totalWrites === 501`;
- cause is `ConflictError`;
- first 500 new documents exist, seeded document is unchanged;
- after-bulk hook did not run.

Repeat the count contract for a later-chunk update/delete refusal if the emulator can produce one
deterministically without test-only production seams; otherwise I5 plus unit loop-boundary tests is
the required minimum.

**I6 — First-chunk errors preserve ordinary classes.** A create-only collision within the first
chunk remains top-level `ConflictError`, not `WriteOutcomeError`, with no successful writes.

**I7 — All six read-back sites.** Use a read converter that throws a unique sentinel and table-test
create, createWithId, bulkCreate, bulkCreateWithIds, update (patch delegates), and upsert-create with
`returnDoc: true`. Each rejects committed/read-back with the sentinel as cause and persisted data
visible. Add an upsert-update case if it shares a distinct read path after refactoring.

Every I-test fails on the baseline because the class/context does not exist or because the baseline
returns the original error without outcome metadata.

### §8.2 Unit and type tests

Follow `unit-testing`: mock at the Firestore boundary, import factories from specific modules, and
do not reimplement repository behavior inside mock factories.

**U1 — `Errors` contract.** Assert all four outcome variants, stable name/message, `instanceof
Error`, explicit cause identity, and discriminated fields.

**U2 — Parser preservation.** `parseFirestoreError(new WriteOutcomeError(...))` returns the same
instance; existing gRPC mappings stay green.

**U3 — Express safety.** Each outcome maps to HTTP 500 with `{ error, outcome }`; response contains
no `cause`, stack, or cause message. Existing generic 500 and typed status mappings stay unchanged.

**U4 — Package exports.** Root import of class and types compiles; runtime export is the same
constructor as the core class. Vector subpath remains unchanged.

**U5 — Type contract.** Add/update a file under `src/tests/types/` proving:

- `HookContext<'afterCreate'>['execution']` is only `'direct'`;
- transaction narrowing exposes `attempt` and direct narrowing does not;
- a one-argument hook still registers;
- shared two-argument hooks can narrow by event/execution;
- `WriteOutcome` exhaustive switching correlates count/hook fields;
- invalid after-hook transaction contexts are `@ts-expect-error`;
- root public module specifier exports all four symbols.

### §8.3 Coverage ownership and baseline-failure audit

- Unit gate owns `Errors.ts`, `ErrorParser.ts`, `src/express/index.ts`, and `src/index.ts`.
- Integration gate owns `FirestoreRepository.ts` and `QueryBuilder.ts`.
- `Hooks.ts` is type-only; the compile/type tests own its contract even if runtime coverage excludes
  it.
- Baseline counts are 32/407 unit and 34/504 integration. Both test counts and at least the
  integration suite count must increase; record rebased values rather than copying stale counts.
- Before implementation, run each new test against baseline or temporarily stash the source change.
  Record the failing assertion/diagnostic in `notes.md`. “Could not import the new symbol” is a valid
  baseline failure for the contract tests; an unrelated setup failure is not.

## §9. ADR and documentation map

### §9.1 ADR

Use the `adr` skill and the next free number. At this baseline it is
`0035-hook-delivery-and-write-outcome-errors.md`; resolve again after rebase.

Record:

- context: retryable transaction callbacks, postcommit hooks/read-back, sequential 500 chunks;
- D1–D6;
- exact `HookContext` and `WriteOutcome` contracts;
- why attempt is observed/nullable and unsuitable for deduplication;
- why ordinary precommit errors remain top-level;
- fail-fast and non-durable after-hook consequences;
- alternatives: remove transaction hooks, wrap all errors, multiple subclasses, aggregate hooks,
  outbox now;
- follow-up #80 and issue #46.

Add one row to `docs/adr/README.md`. Do not link the ADR to mutable usage docs.

### §9.2 Lifecycle hooks

Update `website/src/content/docs/guides/concepts/lifecycle-hooks.md` to:

- show the second callback argument;
- define direct vs transaction context and nullable 1-based attempt;
- state that before transaction hooks may run once per callback attempt;
- warn that attempt is not an idempotency key;
- document sequential registration order and fail-fast stopping;
- document postcommit after hooks, committed failures, lack of crash durability, and outbox
  deferral;
- recommend idempotent side effects keyed by a business/write identity stored atomically with data,
  not by attempt number;
- preserve the runtime query bulk-hook contract without taking #79’s copy scope.

### §9.3 Transactions

Update `website/src/content/docs/guides/working-with-data/transactions.md` around its hook guidance
(`16–22`) and post-transaction effects section (`47+`):

- show retry context/attempt logging;
- distinguish raw `tx.*`, direct methods on the callback repo, and `*InTransaction`;
- explain repeated before-hook delivery;
- state that after hooks do not run in the transaction;
- recommend returning data from the callback and performing non-durable effects after success, or a
  durable outbox when #80 exists.

### §9.4 Repository, CRUD, types, scope

- `reference/repository.md:193–265`: add failure/outcome notes to returnDoc and fixed-batch methods.
- `reference/repository.md:327–348`: update `on` signature with event-correlated context and
  ordering/retry rules.
- `reference/repository.md:375–439`: document observed attempt/null and transaction hook failure.
- `working-with-data/crud-operations.md:156`, `200–227`: explain >500 partial counts and show an
  exhaustive `WriteOutcomeError` branch.
- `reference/types.md:45`: add `HookContext` and `WriteOutcome`.
- `reference/scope-and-capabilities.md:39`: replace vague “first failure throws” with exact
  `WriteOutcomeError` partial contract; leave no-hook rows unchanged.

### §9.5 Errors and Express

- `reference/errors.md`: add a primary section before raw SDK normalization with all four variants,
  narrowing example, cause contract, ordinary-error preservation, and retry/idempotency guidance.
- Keep existing mappings at `173–177` unchanged and state that `parseFirestoreError` preserves the
  new class.
- `guides/integrations/express.md:178–188`: add HTTP 500 outcome row and safe body example; explain
  that cause is server-side only.

### §9.6 v2-to-v3 migration

Add a breaking-change section to `guides/migration-v2-to-v3.md` near the hook changes and checklist:

- callbacks may accept a second context argument (one-argument callbacks remain source-compatible);
- outcome-sensitive hook/read-back/partial errors now surface as `WriteOutcomeError` with cause;
- ordinary validation/conflict/etc. remain top-level;
- transaction before hooks were already supported; v3 makes retry execution observable.

Update the checklist to audit side-effect idempotency and error branching.

## §10. Verification commands and definition of done

Use Node 24. Run targeted tests first, then this exact gate from repository root:

```sh
npm run test:types
npm run lint
npm run check:format
npm run test:unit
npm run test:integration:emulator
npm run test:unit:coverage
npm run test:coverage:gate:unit
npm run test:integration:coverage
npm run test:coverage:gate:integration
npm run build
npm run check:package
npm run check:consumer
npm run check:docs
npm run docs:build
```

If the local npm cache has ownership problems, create a temporary directory and prefix only the
affected npm command with `npm_config_cache=<absolute-temp-path>`; record that deviation.

Re-run the evidence probes:

```sh
node docs/plans/issue-46-hook-delivery-error-model/probes/N-write-outcome-sites.mjs
node docs/plans/issue-46-hook-delivery-error-model/probes/N-hook-write-outcomes.mjs
node docs/plans/issue-46-hook-delivery-error-model/probes/N-transaction-retry-hooks.mjs
```

The behavioral probes describe the old surface, so after implementation their error-identity output
is expected to change to `WriteOutcomeError`; convert their assertions into §8 tests rather than
editing probes to become a second test suite.

Run these completed-sweep checks and inspect every row:

```sh
rg -n "runHooks\\(|emitAfterHook\\(|commitInChunks\\(|getByIdOrThrow\\(" src/core/FirestoreRepository.ts src/core/QueryBuilder.ts
rg -n "HookEvent|HookContext|WriteOutcome" src/index.ts src/core website/src/content/docs --glob '!2.0/**'
rg -n "hook|HookContext|WriteOutcome" README.md npm-readme.md
```

The last grep is expected to show no newly stale callback/error contract. If implementation adds
shared README content, stop and use `readme-sync`.

Definition of done:

- D1–D6 are implemented and recorded in the ADR.
- Every §2 source and call site was inspected; every §4 trap has a test or recorded disposition.
- I1–I7 and U1–U5 pass and each was shown to fail on baseline.
- Exact persistence state backs every outcome assertion.
- Ordinary first-commit/precommit errors retain their existing class.
- `attempt` is correct for owned callbacks, null for external callbacks, and never presented as a
  dedupe key.
- Both coverage gates pass without threshold reduction.
- All 14 legs pass.
- Docs build and link check pass.
- `notes.md` contains rebase drift, test mutation evidence, command outputs, and adversarial review.
- Commit is a breaking Conventional Commit referencing #46.

## §11. Review and plan-directory cleanup

1. Push the implementation while this directory and completed `notes.md` are present.
2. Run an independent review using `implementation-review`; the reviewer writes findings to
   `review.md`.
3. Address findings, rerun affected tests and the complete gate, and record dispositions.
4. Only after approval, remove
   `docs/plans/issue-46-hook-delivery-error-model/` in a final cleanup commit.
5. Request final review/merge. The durable record is the ADR, tests, public docs, and source JSDoc.

## §12. Planning evidence ledger

| ID | Prescription or fact | Verification | Result |
| --- | --- | --- | --- |
| E1 | Baseline identity | `git log -1 --oneline` | `284ef98` |
| E2 | All current hook/write sites | `N-write-outcome-sites.mjs` + `rg` | Enumerated in §2.2 |
| E3 | Direct before/after/read-back/partial state | emulator `N-hook-write-outcomes.mjs` | N1–N4 observed |
| E4 | Transaction retries repeat hooks | emulator `N-transaction-retry-hooks.mjs` | N5 observed |
| E5 | Proposed types compile | temporary `src/issue46-plan-scratch`, `npm run test:types` | Passed |
| E6 | Proposed module exports emit | declaration-only NodeNext emit to temporary directory | `Hooks.d.ts`, `Errors.d.ts`, root `index.d.ts` emitted |
| E7 | No scratch production files remain | `git status --short` | Only this plan directory remains untracked before commit |
| E8 | Full baseline gate | all 14 commands in §10 | Passed |
| E9 | Baseline tests | Jest reports | unit 32/407; integration 34/504 |
| E10 | Coverage headroom | both coverage commands/gates | Percentages recorded in §3.4; both gates passed |
| E11 | Package/consumer bounds | local pack + consumer | Pack passed; admin 14 local consumer passed; peer matrix not claimed |
| E12 | Docs map | `rg` over current Starlight sources | Nine mutable pages enumerated; frozen 2.0 excluded |
| E13 | Deferred discoveries | GitHub issues | #79 docs contradiction; #80 outbox |
| E14 | Commands in plan | every §3/§10 command executed during planning | All returned expected baseline results |

There are no unresolved implementation choices. The only intentionally variable values are the ADR
number, rebased line numbers, and rebased test counts, each of which §7 requires the implementer to
measure before editing.
