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

| Capability                                      | Notes                                                                   |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| Document create / read / update / delete        | Typed read/write models; `{ id }`-by-default create returns             |
| Auto-generated and explicit IDs (`upsert`)      | `upsert(id, …)` reads-then-writes (not create-only)                     |
| Validated ID boundary (`repo.id()` / `newId()`) | Rejects malformed IDs; `allowLegacyDatastoreIds` opt-in for numeric IDs |
| Subcollections                                  | Concrete parent path                                                    |
| Field filters + chained AND (`where`)           | Values typed `unknown` (read-converter divergence)                      |
| Document-name queries (`whereId` / `orderById`) | Native doc-name filter/order; `where('id', …)` is a compile error       |
| Ordering, forward `limit`                       |                                                                         |
| Cursor + offset pagination                      | Opaque, forward-only cursor bound to the collection                     |
| Field projections (`select`)                    | Result type narrows to `FirestoreDocument<DeepPartial<T>>`              |
| Real-time listeners (`onSnapshot`)              | Full-model arrays; not combinable with `select()`                       |
| Count / sum / average aggregates                | Numeric field-path typing for sum/average                               |
| Native query streaming (`stream`)               | Backed by the SDK's `Query.stream()`                                    |
| Transactions (read-write)                       | Options/PITR deferred — see below                                       |
| Fixed batch writes (`bulkCreate/Update/Delete`) | 500-op chunks, non-atomic above 500 (documented)                        |
| Field transforms / sentinels                    | Strict per-field approval by default                                    |
| Vector search (`vectorQuery().findNearest()`)   | Distance measures, result field, threshold, prefilters                  |

## Deferred to v3.x (tracked)

These are real server-side Firestore capabilities the ORM does not yet wrap. Each has a tracking
issue labeled `parity` / `v3.x`. Until then, use the [raw-SDK escape hatch](#raw-sdk-escape-hatch).

| Capability                                                 | Issue                                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------------- |
| Composite `where(Filter)` AND/OR (Core + vector prefilter) | [#30](https://github.com/reggieofarrell/firestore-orm/issues/30) |
| Collection-group queries (full-path identity)              | [#31](https://github.com/reggieofarrell/firestore-orm/issues/31) |
| Transaction options (read-only / PITR / `maxAttempts`)     | [#32](https://github.com/reggieofarrell/firestore-orm/issues/32) |
| Conditional writes (create-only + preconditions)           | [#33](https://github.com/reggieofarrell/firestore-orm/issues/33) |
| Generic multi-aggregation `aggregate(spec)`                | [#34](https://github.com/reggieofarrell/firestore-orm/issues/34) |
| `getMany(ids)` multi-document reads                        | [#35](https://github.com/reggieofarrell/firestore-orm/issues/35) |
| Typed lower-level bounds + `limitToLast()`                 | [#36](https://github.com/reggieofarrell/firestore-orm/issues/36) |
| Query Explain / `explainStream`                            | [#37](https://github.com/reggieofarrell/firestore-orm/issues/37) |
| BulkWriter high-throughput API + recursive delete          | [#38](https://github.com/reggieofarrell/firestore-orm/issues/38) |
| Snapshot/write metadata + detailed listeners               | [#39](https://github.com/reggieofarrell/firestore-orm/issues/39) |
| Server-side / structured-equality `distinctValues`         | [#40](https://github.com/reggieofarrell/firestore-orm/issues/40) |
| Experimental Enterprise Pipeline subpath                   | [#41](https://github.com/reggieofarrell/firestore-orm/issues/41) |

## Raw-SDK escape hatch

You always own the `Firestore` instance you pass into a repository, so you can drop down to the
Admin SDK for anything the ORM does not wrap — you lose the ORM's
validation/conversion/result-shaping for that operation, but nothing is blocked. For example, a
composite `OR` filter (until #30 lands):

```typescript
import { Filter } from 'firebase-admin/firestore';

// `db` is the same Firestore instance you passed to your repositories.
const snap = await db
  .collection('posts')
  .where(
    Filter.or(
      Filter.where('status', '==', 'published'),
      Filter.where('authorId', '==', currentUserId),
    ),
  )
  .get();

const posts = snap.docs.map(doc => postRepo.fromSnapshot(doc)); // re-enter the read model
```

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
