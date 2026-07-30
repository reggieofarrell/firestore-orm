# Transactional outbox design

Status: **Draft for future implementation**  
Tracking issue: [#80](https://github.com/reggieofarrell/firestore-orm/issues/80)  
Related issue: [#46](https://github.com/reggieofarrell/firestore-orm/issues/46)

## Summary

A transactional outbox provides durable, retryable delivery of effects caused by Firestore writes.
Instead of calling an external system directly from an `after*` hook, an application atomically
stores a serializable event alongside its domain write. A separate worker later delivers that event
and records the result.

The proposed feature is an opt-in `@reggieofarrell/firestore-orm/outbox` module. Its first version
should expose an explicit transaction enqueue primitive and a lease-based worker. It should not
automatically replace lifecycle hooks or claim exactly-once delivery.

The central invariant is:

> An outbox event is durable only when its document and the domain write are committed by the same
> Firestore transaction or write batch.

Calling `repo.create()` and then `outbox.enqueue()` as two independent writes is not a transactional
outbox and must not be presented as one.

## Problem

An ordinary `after*` hook runs in the application process after Firestore has committed:

1. The domain write commits.
2. The hook performs an effect.
3. The repository method resolves.

There is an unavoidable failure window after step 1. The process can terminate before the hook runs,
leaving committed state without its corresponding effect. It can also terminate after the external
effect succeeds but before the hook returns, leaving the caller unable to determine whether retrying
the effect is safe.

Examples include:

- charging a payment after creating an order;
- sending a required email;
- publishing a domain event;
- invoking a partner webhook;
- synchronizing another datastore;
- starting a workflow that must eventually run.

Issue #46 makes committed-write and hook failures observable. It does not make `after*` hooks
durable. The outbox is the optional reliability layer for applications that need eventual delivery
after process failure.

## Goals

1. Atomically persist domain state and the intent to perform an external effect.
2. Retain pending work across application crashes, deployments, and restarts.
3. Support concurrent workers without normally delivering the same event concurrently.
4. Retry transient failures with bounded exponential backoff.
5. Move repeatedly failing events to a visible dead-letter state.
6. Provide strongly typed and runtime-validated event payloads.
7. Give every event a stable delivery idempotency key.
8. Support an optional producer deduplication key for repeated logical requests.
9. Keep deployment ownership with the application.
10. Remain explicit about at-least-once delivery, ordering, and transaction boundaries.

## Non-goals

The first version will not:

- guarantee exactly-once external effects;
- guarantee global or per-entity event ordering;
- execute arbitrary hook functions outside the originating process;
- automatically convert existing `after*` hooks into outbox events;
- make two independent Firestore writes atomic;
- coordinate one atomic commit across Firestore and an external service;
- provide a hosted worker or managed queue;
- automatically support fixed bulk operations spanning multiple Firestore commits;
- enqueue from `bulkWrite`, whose per-item non-atomic contract is intentionally different;
- expose the Firestore transaction retry count as an idempotency key;
- replace Pub/Sub, Cloud Tasks, Kafka, or another destination-specific delivery service.

## Delivery semantics

### Atomic intent, eventual effect

The domain write and outbox document commit together. After that commit, a worker eventually
attempts the effect.

This provides **atomic intent**, not an atomic external effect:

- if the Firestore commit fails, neither the domain state nor event exists;
- if the Firestore commit succeeds, the event remains available until delivered or dead-lettered;
- if delivery succeeds but acknowledgement fails, the worker may deliver the event again.

### At-least-once

Delivery is at least once. A worker can:

1. claim an event;
2. successfully call the destination;
3. terminate before marking the event delivered;
4. retry after its lease expires.

Every handler must therefore be idempotent. The stable outbox document ID is the default delivery
idempotency key and should be forwarded to destinations that support idempotency keys.

### Transaction retries

Firestore may invoke a transaction callback multiple times when a document read by the transaction
changes concurrently. Writes from failed attempts do not commit. An event enqueued within the
callback is therefore persisted only by the successful transaction attempt.

The ORM-observed hook attempt count from issue #46 is diagnostic only. It must not participate in an
outbox document ID or deduplication key.

### Ordering

No ordering guarantee is proposed initially. Events may be delivered concurrently, retried after
newer events, or recovered from an expired lease.

If ordering is added later, it should be an explicit opt-in contract based on a `partitionKey` and
sequence/checkpoint design. It must not be inferred from timestamps or document IDs.

## Relationship to lifecycle hooks

The three mechanisms have different responsibilities:

| Mechanism      | Responsibility                                             | Durability                                                 |
| -------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| `before*` hook | Synchronous normalization and invariants before a write    | Re-executed with the process; transaction hooks may repeat |
| `after*` hook  | Immediate, in-process, best-effort reaction after commit   | Not durable                                                |
| Outbox event   | Serializable intent for an effect that must eventually run | Durable after its atomic commit                            |

An outbox event contains data, not executable code. Hook closures cannot be serialized, versioned,
validated after deployment, or reconstructed by another worker process. Consequently, existing hooks
should retain their current semantics.

A later feature may add declarative event projectors, but those projectors must produce serializable
outbox records before commit; they are not delayed execution of `after*` hook functions.

## Proposed package surface

Publish the feature from an optional subpath:

```ts
import { createFirestoreOutbox, defineOutboxEvents } from '@reggieofarrell/firestore-orm/outbox';
```

Keeping it outside the root entry point makes the additional operational concepts opt-in and allows
future delivery adapters to evolve separately from the core repository API.

### Event registry

Use a Zod-backed event registry to provide compile-time payload inference and runtime validation:

```ts
import { z } from 'zod';

const events = defineOutboxEvents({
  'user.email-changed': z.object({
    userId: z.string(),
    previousEmail: z.string().email(),
    newEmail: z.string().email(),
  }),

  'order.created': z.object({
    orderId: z.string(),
    customerId: z.string(),
  }),
});

const outbox = createFirestoreOutbox(db, {
  collectionPath: '__firestoreOrmOutbox',
  events,
});
```

The registry is required by both producers and workers. Workers must validate stored payloads before
invoking application handlers. Invalid or unknown event types should be dead-lettered with a safe
diagnostic rather than retried indefinitely.

### Explicit transactional enqueue

The first implementation primitive should be:

```ts
await userRepo.runInTransaction(async (tx, repo) => {
  await repo.updateInTransaction(tx, userId, {
    email: newEmail,
  });

  outbox.enqueue(tx, 'user.email-changed', {
    userId,
    previousEmail,
    newEmail,
  });
});
```

Proposed signature:

```ts
enqueue<K extends keyof Events & string>(
  transaction: Transaction,
  type: K,
  payload: z.input<Events[K]>,
  options?: EnqueueOptions,
): OutboxEventReference<K>;
```

`enqueue` should:

- parse the payload synchronously before registering the transaction write;
- allocate a scattered Firestore document ID;
- register the event creation through the supplied transaction;
- return its stable ID/reference without performing additional I/O;
- use a create-only transaction operation so an ID collision cannot overwrite an event.

The function need not return a promise if validation and transaction mutation are synchronous.

### Producer deduplication

Provide a separate method for an application-defined logical request key:

```ts
outbox.enqueueOnce(tx, `change-email:${requestId}`, 'user.email-changed', payload);
```

Proposed signature:

```ts
enqueueOnce<K extends keyof Events & string>(
  transaction: Transaction,
  deduplicationKey: string,
  type: K,
  payload: z.input<Events[K]>,
  options?: EnqueueOptions,
): Promise<OutboxEventReference<K>>;
```

The implementation should hash a namespace plus the key into a scattered, fixed-length document ID.
The raw key should not appear in the path because it may contain sensitive data, invalid path
characters, or sequential values.

`enqueueOnce` must read the deterministic event document before transaction writes begin:

- if absent, create it;
- if present with the same type and canonical payload identity, return the existing reference;
- if present with conflicting content, throw a typed deduplication conflict.

This feature protects against an entire logical application request being submitted more than once.
It is not needed merely because Firestore retried one transaction callback.

### Convenience methods for ordinary writes

Ordinary repository calls cannot atomically enqueue an event afterward:

```ts
// Unsafe: a crash can occur between these writes.
await orderRepo.create(order);
outbox.enqueue(/* no shared atomic boundary */);
```

A future convenience layer may expose APIs such as:

```ts
await outbox.runInTransaction(orderRepo, async ({ tx, repo, enqueue }) => {
  const { id } = await repo.createInTransaction(tx, order);
  enqueue('order.created', { orderId: id, customerId: order.customerId });
});
```

or a specialized single-write wrapper:

```ts
await orderRepo.createWithOutbox(order, ({ id, enqueue }) => {
  enqueue('order.created', { orderId: id, customerId: order.customerId });
});
```

The latter must internally use one Firestore transaction or write batch. It must not be syntactic
sugar for two sequential writes.

These convenience methods are intentionally deferred until the explicit transaction primitive and
worker semantics are proven.

## Persisted event schema

The initial schema should be versioned and destination-neutral:

```ts
type StoredOutboxEvent = {
  schemaVersion: 1;

  type: string;
  payload: unknown;

  state: 'pending' | 'processing' | 'delivered' | 'dead';
  attempts: number;

  createdAt: Timestamp;
  nextAttemptAt: Timestamp;

  leaseOwner?: string;
  leaseToken?: string;
  leaseExpiresAt?: Timestamp;

  deliveredAt?: Timestamp;
  deadAt?: Timestamp;

  lastError?: {
    name?: string;
    code?: string;
    message: string;
    occurredAt: Timestamp;
  };

  expireAt?: Timestamp;
};
```

### Field rules

- `schemaVersion` versions the envelope independently of individual event payload schemas.
- `type` selects the registered payload schema and handler.
- `payload` is parsed at enqueue and revalidated at delivery.
- `state` is operational state, not a delivery guarantee.
- `attempts` increments when a worker successfully claims the event.
- `nextAttemptAt` is the primary due-work field for initial delivery, retry, and expired-lease
  recovery.
- `leaseOwner` identifies a worker instance for diagnostics.
- `leaseToken` is a fresh random token for each claim and prevents stale workers from acknowledging
  a later claim.
- `leaseExpiresAt` makes abandoned processing recoverable.
- `lastError` is sanitized and size-bounded; never persist arbitrary thrown objects or stacks by
  default.
- `expireAt` supports optional TTL cleanup after delivery or dead-letter retention.

The event ID is intentionally stored in the Firestore document name rather than duplicated as a
field.

## Worker API

The library should provide processing machinery without owning its deployment:

```ts
const worker = outbox.createWorker({
  handlers: {
    'user.email-changed': async (event, context) => {
      await emailService.sendEmailChangedNotice(event, {
        idempotencyKey: context.eventId,
      });
    },

    'order.created': async (event, context) => {
      await publisher.publish(event, {
        idempotencyKey: context.eventId,
      });
    },
  },

  concurrency: 10,
  leaseDurationMs: 60_000,
  maxAttempts: 12,
  backoff: {
    kind: 'exponential',
    initialDelayMs: 1_000,
    maximumDelayMs: 15 * 60_000,
    jitter: true,
  },
});

await worker.runOnce();
```

Potential future long-running form:

```ts
const stop = worker.start({
  pollIntervalMs: 1_000,
  signal: abortController.signal,
});
```

The initial release should prioritize `runOnce()`. It composes with Cloud Run jobs, scheduled
functions, application cron systems, tests, and user-controlled loops without requiring the ORM to
own process lifecycle or signal handling.

### Handler context

```ts
type OutboxHandlerContext = {
  readonly eventId: string;
  readonly attempt: number;
  readonly leaseToken: string;
  readonly createdAt: Timestamp;
  readonly signal: AbortSignal;
};
```

`eventId` is the delivery idempotency key. `attempt` is worker-delivery attempt count, distinct from
the transaction callback attempt introduced by issue #46.

## Claim and lease protocol

Workers should use short Firestore transactions to claim events:

1. Query a bounded page of events whose `nextAttemptAt <= now`.
2. For each candidate, start a claim transaction.
3. Re-read the candidate inside the transaction.
4. Accept it only when:
   - it is `pending`; or
   - it is `processing` and its lease has expired.
5. Update it to:
   - `state: 'processing'`;
   - `attempts: previous + 1`;
   - a new random `leaseToken`;
   - this worker's `leaseOwner`;
   - `leaseExpiresAt` and `nextAttemptAt` equal to the lease deadline.
6. Commit the claim.
7. Run the handler outside the transaction.

Competing workers can query the same document. Only one claim transaction should successfully
establish the current lease. Others re-read the changed state and skip it.

### Successful delivery

After the handler resolves, update the event only when its stored `leaseToken` still matches:

```text
state = delivered
deliveredAt = server time
lease fields = removed
nextAttemptAt = removed or set outside the active query range
expireAt = deliveredAt + configured retention
```

A stale worker whose lease expired must not acknowledge a newer worker's delivery attempt.

### Failed delivery

After a retryable handler failure:

```text
state = pending
nextAttemptAt = now + exponential backoff with jitter
lastError = sanitized diagnostic
lease fields = removed
```

When `attempts >= maxAttempts`, transition to `dead` instead:

```text
state = dead
deadAt = server time
lastError = sanitized diagnostic
lease fields = removed
expireAt = optional dead-letter retention deadline
```

The handler API may later support an explicit non-retryable error marker, but the first version can
dead-letter only after `maxAttempts` unless a validated/unknown event cannot be handled safely.

### Lease expiration during a running handler

The initial version should require users to configure a lease longer than the expected handler
timeout and should abort the handler when its local deadline expires. Automatic lease heartbeats add
state and failure modes and may be deferred.

If heartbeats are later added, every renewal must compare the current `leaseToken`.

## Query and index design

The worker needs a bounded due-event query ordered by `nextAttemptAt`. The implementation must
document the required Firestore indexes and provide actionable missing-index errors.

Avoid sequential document IDs. Firestore auto-IDs distribute writes across the keyspace. The
timestamp fields are necessarily sequential; applications with high event rates may need single
field index exemptions or a sharded due-work strategy.

The first implementation should benchmark and probe:

- the exact due-event query and required composite indexes;
- mixed `pending` and expired `processing` recovery;
- missing or deleted candidate documents;
- simultaneous claims from multiple workers;
- pagination without repeatedly scanning delivered/dead documents;
- behavior at sustained event rates.

Do not make the worker depend on TTL deletion order. Firestore TTL deletion is asynchronous and not
transactional.

## Fixed batches and bulk operations

An outbox event consumes a Firestore write within the same atomic batch or transaction.

Consequences:

- a fixed batch that currently holds 500 domain writes cannot add an event as write 501;
- one event per chunk reduces domain capacity by at least one;
- one event per domain document may reduce capacity substantially;
- a logical bulk operation spanning multiple commits cannot have one event atomically represent all
  commits;
- a later chunk can fail after earlier chunks and their events committed.

The first version should exclude automatic bulk integration. Applications may explicitly use smaller
transaction/batch chunks and enqueue events whose semantics are clearly per document or per
committed chunk.

A future bulk design must choose and document one of:

1. one event per domain document;
2. one aggregate event per atomic chunk;
3. no automatic events, requiring explicit application orchestration.

It must not emit one “whole bulk completed” event unless completion is itself represented by a
separate durable coordinator after all chunks succeed.

`bulkWrite` remains out of scope because it intentionally exposes independent per-item outcomes and
does not provide one shared atomic boundary.

## Error model

Producer errors happen before or during the shared Firestore commit:

- payload validation failure: ordinary validation error; no event registered;
- deduplication conflict: typed outbox conflict; transaction does not commit;
- Firestore transaction failure: existing normalized repository/SDK error;
- committed transaction: both domain write and event exist.

Worker errors do not change the result of the original domain write. They are recorded on the event
and surfaced through worker results, metrics, logs, and dead-letter inspection.

Proposed `runOnce()` result:

```ts
type OutboxRunResult = {
  scanned: number;
  claimed: number;
  delivered: number;
  retried: number;
  deadLettered: number;
  skipped: number;
};
```

One malformed or failed event should not reject the entire worker page after its state has been
recorded. Infrastructure failures that prevent safe claim/acknowledgement may reject `runOnce()`.

## Security and data handling

- Treat event payloads as durable application data.
- Do not store secrets, access tokens, raw request objects, or unrestricted thrown values.
- Allow applications to configure payload size limits below Firestore's document limit.
- Sanitize and truncate persisted error names, codes, and messages.
- Do not persist stack traces by default.
- Hash producer deduplication keys before using them as document IDs.
- Document IAM requirements for workers.
- Keep the outbox collection server-only; Firebase Admin access is governed by IAM rather than
  client Security Rules.
- Support configurable retention for delivered and dead events.

## Observability and operations

Expose structured hooks or callbacks for worker telemetry, separate from repository lifecycle hooks:

- claim succeeded or lost;
- handler started and completed;
- retry scheduled;
- event dead-lettered;
- lease expired and recovered;
- acknowledgement lost;
- validation or unknown-type failure.

Recommended metrics:

- pending event count and oldest pending age;
- processing count and expired lease count;
- delivery success/failure rate;
- delivery latency from `createdAt`;
- attempts per delivered event;
- dead-letter count;
- handler duration by event type.

Provide inspection methods rather than requiring applications to know the raw schema:

```ts
outbox.listPending(options);
outbox.listDead(options);
outbox.retryDead(eventId);
outbox.get(eventId);
```

Administrative retry must retain the same event ID so downstream idempotency remains stable.

## Deployment models

The storage and claim protocol should work with several application-owned deployment models:

### Scheduled `runOnce`

Simplest operational model. A scheduler invokes a Cloud Run job, function, or application endpoint.
Latency depends on the schedule.

### Long-running poller

Lowest routine latency and independent of Firestore trigger delivery. Requires lifecycle,
concurrency, and shutdown management in the hosting application.

### Firestore create trigger

An `onDocumentCreated` trigger can invoke processing quickly. The handler must still claim the event
and remain idempotent because Firestore triggers are at-least-once and unordered. A scheduled sweep
is still recommended to recover events missed because of deployment or configuration problems.

### Publisher adapter

A worker handler may publish the stored event to Pub/Sub, Cloud Tasks, Kafka, or another broker. The
outbox protects the Firestore-to-publisher boundary; the destination retains its own delivery
contract.

The ORM should not select one deployment model as universally correct.

## Testing strategy

Integration tests against the Firestore emulator are the primary confidence layer.

### Producer tests

- domain write and event commit together;
- hook/validation/transaction failure commits neither;
- Firestore transaction contention may rerun enqueue code but commits one event;
- `enqueueOnce` returns one logical event across repeated requests;
- conflicting `enqueueOnce` content fails without domain changes;
- invalid payload fails before transaction commit;
- ordinary direct write followed by an independent enqueue is not exposed as a safe API.

### Worker concurrency tests

- two workers racing for one event establish one current lease;
- stale lease token cannot acknowledge a newer claim;
- expired lease becomes claimable;
- active lease remains unclaimable;
- successful handler marks delivered;
- retryable failure schedules increasing backoff;
- maximum attempts dead-letters;
- malformed and unknown events dead-letter safely;
- one failed event does not stop independent siblings;
- bounded concurrency is respected.

### Crash-window tests

Use deterministic seams around delivery and acknowledgement:

- crash before handler call: lease expires and event is retried;
- crash after external success but before acknowledgement: same event ID is delivered again;
- downstream idempotency example prevents duplicate business effect;
- crash during acknowledgement: state remains recoverable.

### Type and unit tests

- event registry infers exact handler/enqueue payloads;
- unknown event names fail to compile;
- invalid payload shapes fail to compile where statically knowable;
- stored payload is revalidated at runtime;
- document ID hashing is deterministic and scattered;
- backoff and jitter remain within configured bounds;
- error sanitization and truncation never leak stacks or arbitrary fields.

### Consumer/package tests

- root package remains importable without outbox-specific optional dependencies;
- ESM and CJS `./outbox` imports work;
- supported firebase-admin peer majors compile and load;
- generated declarations expose no private/unimportable SDK types.

## Implementation phases

### Phase 1 — Durable primitive

- event registry;
- stored schema and envelope version;
- explicit transaction `enqueue`;
- optional `enqueueOnce`;
- root-independent `./outbox` export;
- emulator atomicity/contention tests;
- ADR and public reliability documentation.

### Phase 2 — Worker

- due query;
- transactional claim and lease token;
- `runOnce`;
- handler registry;
- retry/backoff/dead-letter behavior;
- worker results and telemetry;
- concurrency and crash-window tests.

Phase 1 and Phase 2 should ship together if the public feature is advertised as usable. An enqueue
API without a supported processing path is an incomplete reliability feature. They may be developed
as separate internal milestones.

### Phase 3 — Operational convenience

- inspection and dead-letter retry APIs;
- optional TTL retention helpers/documentation;
- long-running polling helper;
- Firestore trigger integration example;
- publisher adapters.

### Phase 4 — Repository convenience

- single-write transaction/batch wrappers;
- declarative outbox event projectors, if still justified;
- explicit bulk semantics and chunk accounting;
- optional ordering partitions.

## Open design questions

These must be settled with evidence before implementation:

1. Should `enqueueOnce` compare canonical payload identity, accept an existing key unconditionally,
   or expose separate strict/lenient modes?
2. Should delivery handlers receive parsed Zod output while enqueue accepts Zod input?
3. What is the exact due-event query and minimal supported index configuration?
4. Should expired processing records share `nextAttemptAt` with pending retries or use a separate
   recovery query?
5. Should the initial worker support an explicit non-retryable/dead-letter error type?
6. What default lease, timeout, retry, jitter, and retention values are safe without implying a
   service-level guarantee?
7. Should events remain as delivered records or move to a separate archive/dead collection?
8. Should schema migration be handler-owned by versioned event names or supported by an outbox
   payload migration facility?
9. Is a Firestore trigger example sufficient, or should the first release include a scheduled sweep
   example as the recommended recovery path?
10. Should Phase 1 and Phase 2 live in one issue/ADR or separate implementation issues beneath #80?

## Recommended initial decision

Implement the smallest complete and honest system:

1. a typed, validated event registry;
2. explicit enqueue through an application-owned Firestore transaction;
3. stable event IDs and optional hashed producer deduplication keys;
4. a lease-based `runOnce` worker;
5. bounded retry with jitter and a dead-letter state;
6. at-least-once delivery with mandatory handler idempotency;
7. no ordering, automatic hooks, direct-write sugar, or bulk integration in v1.

This preserves a narrow trust boundary: the ORM guarantees that committed event intent is durable
and recoverable. It does not claim that an external effect happened exactly once.

## References

- [Firestore transactions and batched writes](https://firebase.google.com/docs/firestore/manage-data/transactions)
- [Cloud Firestore trigger delivery behavior](https://firebase.google.com/docs/functions/firestore-events)
- [Firestore scaling best practices](https://firebase.google.com/docs/firestore/best-practices)
- [Firestore TTL policies](https://firebase.google.com/docs/firestore/ttl)
