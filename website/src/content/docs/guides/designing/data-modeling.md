---
title: 'Data Modeling'
description:
  'Design Firestore documents for the queries you need — maps vs subcollections, arrays, and
  denormalized query flags.'
---

Firestore rewards data models designed around the reads you'll perform, not around a normalized
relational schema. This page collects modeling advice that applies to Firestore generally; the ORM
just makes whichever shape you choose type-safe.

## Model for your queries

Firestore has no server-side joins, and a query reads from a single collection. So the shape that
matters is the one your reads need: denormalize the fields you filter, sort, or display together
into the document you query, rather than stitching data across collections at read time. A field you
never query on can stay nested; a field you filter or sort on should be a top-level (or shallow)
stored field so it's a clean [query path](/firestore-orm/guides/working-with-data/queries/).

## Maps vs subcollections

Prefer a **nested map** when the related data is bounded and always loaded with its parent (an
address, a settings object, a small set of counters). It rides along in the same document read and
updates cleanly with [dot notation](/firestore-orm/guides/working-with-data/dot-notation/).

Prefer a **[subcollection](/firestore-orm/guides/working-with-data/subcollections/)** when the
related data is unbounded or independently queried (a user's orders, a post's comments). A single
document is capped at ~1 MiB, so an ever-growing array or map inside one document eventually fails —
a subcollection scales and can be paginated and queried on its own.

## Arrays

Arrays are queryable with `array-contains` / `array-contains-any` and mutated atomically with the
`zArrayWrite()` combinator (`arrayUnion` / `arrayRemove`). They suit **bounded** membership sets
(tags, role labels). For large or high-churn collections of records, reach for a subcollection
instead — you can't paginate or range-query within an array, and rewriting a large array on every
change is costly. Firestore also does not support nested arrays (an array directly inside an array).

## Denormalized query flags

Because a query reads one collection, precompute the fields you need to filter or sort on. A boolean
`isPublished`, a denormalized `authorName`, or a `statusUpdatedAt` timestamp stored on the document
lets you serve a query with a single index instead of post-filtering in application code. Keep these
flags in sync from a `before*` [hook](/firestore-orm/guides/concepts/lifecycle-hooks/) so they can't
drift from the source fields.

## Design with security and identity in mind

Even though the Admin SDK bypasses security rules (see
[Trust Boundary & Security](/firestore-orm/guides/designing/security-boundary/)), model as if client
rules must enforce access — it keeps documents self-describing and access checks expressible. And
let the document name carry identity rather than storing a redundant `id` field (see
[Document Identity](/firestore-orm/guides/concepts/document-identity/) and
[ID Strategies](/firestore-orm/guides/designing/id-strategies/)).
