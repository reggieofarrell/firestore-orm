---
title: 'Scope & Capabilities'
description:
  'What firestore-orm v3 wraps (Firestore Core operations), what it defers, and the raw-SDK escape
  hatch.'
---

firestore-orm v3 is a **type-safe ORM for Firestore _Core operations_** — the everyday
collection/document/query surface of the Firebase Admin SDK — with validation, lifecycle hooks, a
query builder, transactions, and a vector-search extension. It intentionally does **not** attempt to
mirror the entire server-side Firestore feature set, and it does not wrap the Firestore Enterprise
Pipeline query model or the database control/administration plane.

This page states what is first-class today, what is deferred (with tracking issues), and how to
reach the raw Admin SDK for anything not yet wrapped.

## Supported (first-class)

| Capability                                       | Notes                                                                                                                                                                                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document create / read / update / delete         | Typed read/write models; `{ id }`-by-default create returns                                                                                                                                                                               |
| Auto-generated and explicit IDs (`upsert`)       | `upsert(id, …)` reads-then-writes (not create-only)                                                                                                                                                                                       |
| Validated ID boundary (`repo.id()` / `newId()`)  | Rejects malformed IDs; `allowLegacyDatastoreIds` opt-in for numeric IDs                                                                                                                                                                   |
| Subcollections                                   | Concrete parent path                                                                                                                                                                                                                      |
| Field filters + chained AND (`where`)            | Values typed `unknown` (read-converter divergence)                                                                                                                                                                                        |
| Composite AND/OR filters (`whereFilter`)         | Schema-aware filter factory; also a vector prefilter                                                                                                                                                                                      |
| Collection-group queries (`collectionGroup`)     | Read-only; results carry full-path identity; needs group-scoped indexes                                                                                                                                                                   |
| Document-name queries (`whereId` / `orderById`)  | Native doc-name filter/order; `where('id', …)` is a compile error                                                                                                                                                                         |
| Ordering, forward `limit`, `limitToLast`         | `limitToLast` requires `orderBy`; rejected by `stream` / opaque `paginate` (use `get()` for reverse pages)                                                                                                                                |
| Typed cursor bounds (`startAt` / `endAt` / …)    | Inclusive/exclusive snapshot or field-value bounds; public `offset(n)` (`0` allowed). Opaque `paginate` stays path-only and forward-only.                                                                                                 |
| Cursor + offset pagination                       | Opaque, forward-only cursor bound to the collection                                                                                                                                                                                       |
| Field projections (`select`)                     | Result type narrows to `FirestoreDocument<DeepPartial<T>>`                                                                                                                                                                                |
| Real-time listeners (`onSnapshot`)               | Full-model arrays; not combinable with `select()`                                                                                                                                                                                         |
| Count / sum / average aggregates                 | Numeric field-path typing for sum/average                                                                                                                                                                                                 |
| Multi-aggregation `aggregate(spec)`              | Aliased count/sum/average in one request; max 5; sparse-field caveat (see queries guide)                                                                                                                                                  |
| Native query streaming (`stream`)                | Backed by the SDK's `Query.stream()`                                                                                                                                                                                                      |
| Transactions (read-write + read-only / PITR)     | `runInTransaction(fn, options?)`, `runReadOnlyAt(readTime, fn)`; `maxAttempts` on RW; RO callback is `ReadOnlyTransactionalRepository`                                                                                                    |
| Fixed batch writes (`bulkCreate/Update/Delete`)  | 500-op chunks, atomic at or below 500; hooks run; first failure throws                                                                                                                                                                    |
| High-throughput writes (`bulkWrite`)             | Non-atomic BulkWriter path; positional per-item results; **no hooks** (throws if any bulk hook is registered unless `{ skipHooks: true }`); duplicate ids rejected                                                                       |
| Recursive delete (`recursiveDelete`)             | Document + all descendants; **no hooks**, no count; missing target resolves. Collection-wide variant deferred ([#69](https://github.com/reggieofarrell/firestore-orm/issues/69)).                                                         |
| Conditional writes (create-only + preconditions) | `createWithId` / `bulkCreateWithIds` / `createWithIdInTransaction`; `lastUpdateTime` on update/delete; `getByIdWithUpdateTime`. General snapshot/write metadata remains [#39](https://github.com/reggieofarrell/firestore-orm/issues/39). |
| `getMany(ids)` multi-document reads              | One batched `BatchGetDocuments` read; results in **input order**; `null` marks missing ids in position; optional `fieldMask`; transaction variant `getManyInTransaction`. Prefer over `whereId('in', …)` for id lookups.                    |
| Field transforms / sentinels                     | Strict per-field approval by default                                                                                                                                                                                                      |
| Vector search (`vectorQuery().findNearest()`)    | Distance measures, result field, threshold, prefilters (incl. AND/OR)                                                                                                                                                                     |
| Query Explain (`explain()`)                      | Core + vector (after `findNearest`); returns `{ metrics, documents }` (`documents` is `null` plan-only, `[]` when analyzed empty). **Emulator throws `No explain results`** — real metrics need production Firestore. `explainStream` deferred ([#65](https://github.com/reggieofarrell/firestore-orm/issues/65)). |

## Deferred to v3.x (tracked)

These are real server-side Firestore capabilities the ORM does not yet wrap. Each has a tracking
issue labeled `parity` / `v3.x`. Until then, use the [raw-SDK escape hatch](#raw-sdk-escape-hatch).

| Capability                                         | Issue                                                            |
| -------------------------------------------------- | ---------------------------------------------------------------- |
| Query `explainStream` (Core only)                  | [#65](https://github.com/reggieofarrell/firestore-orm/issues/65) |
| Snapshot/write metadata + detailed listeners       | [#39](https://github.com/reggieofarrell/firestore-orm/issues/39) |
| Server-side / structured-equality `distinctValues` | [#40](https://github.com/reggieofarrell/firestore-orm/issues/40) |
| Experimental Enterprise Pipeline subpath           | [#41](https://github.com/reggieofarrell/firestore-orm/issues/41) |

## Collection groups are read-only

`repo.collectionGroup()` wraps the read surface of a Firestore collection group — every collection
with the same id, at any depth. Results carry the full `path` and `parentPath` because document IDs
are **not** unique across a group. See
[collection-group queries](/firestore-orm/guides/working-with-data/queries/#collection-group-queries).

There is deliberately no group-wide `update()` / `delete()`: the ORM's bulk hooks carry `{ ids }`
payloads, and an `id` is ambiguous across a group, so a hook could not tell which document it was
observing. For a group-wide write, use the escape hatch below — the group query gives you each
document's `path`, so you can batch against `db.doc(row.path)`.

```typescript
const spam = await postGroup.query().where('status', '==', 'spam').get();

const batch = db.batch();
spam.forEach(row => batch.delete(db.doc(row.path)));
await batch.commit();
```

⚠️ **A raw batch runs no lifecycle hooks.** That is the whole reason there is no first-class group
write: `beforeBulkDelete` / `afterBulkDelete` (and the update pair) would receive `{ ids }` they
cannot resolve. Writing through the SDK does not make the hooks fire with better data — it makes
them not fire at all, silently. If your hooks are load-bearing (audit trails, cache invalidation,
downstream fan-out), group the results by `parentPath`, build a concrete repository per parent, and
write through that instead:

```typescript
const byParent = new Map<string, typeof spam>();
for (const row of spam)
  byParent.set(row.parentPath, [...(byParent.get(row.parentPath) ?? []), row]);

for (const [parentPath, rows] of byParent) {
  const [, parentId] = parentPath.split('/'); // 'users/u1/posts' → 'u1'
  const repo = userRepo.subcollection(parentId, 'posts', postSchema);
  await repo.bulkDelete(rows.map(row => row.id)); // hooks run, ids are unambiguous here
}
```

## Raw-SDK escape hatch

You always own the `Firestore` instance you pass into a repository, so you can drop down to the
Admin SDK for anything the ORM does not wrap — you lose the ORM's
validation/conversion/result-shaping for that operation, but nothing is blocked. For cases
`bulkWrite` does not cover — for example streaming input larger than memory — use a raw
`BulkWriter`:

```typescript
// `db` is the same Firestore instance you passed to your repositories.
const writer = db.bulkWriter();
const snap = await db.collection('posts').where('status', '==', 'stale').get();
snap.docs.forEach(doc => writer.delete(doc.ref));
await writer.close();
```

To re-enter the read model from a raw snapshot, use `repo.fromSnapshot(doc)` — or, for a snapshot
that could come from any depth of a collection group, `repo.collectionGroup().fromSnapshot(doc)`,
which overlays full-path identity instead of just the leaf `id` and **throws** if the snapshot is
not in that group.

`fromSnapshot()` maps a raw snapshot back into the repository's read model + `id`. (There is no
supported getter for a repository's internal `Firestore` instance — keep your own reference to the
`db` you injected. `FirestoreQueryBuilder.getUnderlyingQuery()` is `@internal` and returns
`Query<any>`; it is used by the vector extension and is not a re-entry point into the builder.)

## Out of scope

- **Firestore Enterprise Pipeline operations** (expression-based queries, joins, DML, full-text /
  geo search) — a pre-GA, edition-gated query model incompatible with a builder that always returns
  `FirestoreDocument<T>`. A separate experimental subpath is tracked in
  [#41](https://github.com/reggieofarrell/firestore-orm/issues/41).
- **Firestore with MongoDB compatibility** — a different product mode (MongoDB drivers / BSON /
  MQL); use the MongoDB driver or Mongoose instead.
- **The database control/administration plane** — database/backup/PITR/index/IAM administration is a
  deployment concern; use Terraform, the Firebase CLI, the Google Cloud CLI, or the Firestore Admin
  API.
