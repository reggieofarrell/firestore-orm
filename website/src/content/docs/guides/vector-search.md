---
title: 'Vector Search Extension'
description: 'Optional ./vector extension and findNearest KNN similarity search.'
---

Opt-in KNN similarity search for Firestore, layered onto the core repository without changing its
API.

Firestore vector search ships as an **opt-in extension** at `@reggieofarrell/firestore-orm/vector`.
The core package API is unchanged — the standard `FirestoreQueryBuilder` behaves exactly as before.
Wrap your repository with `withVectorSearch()` only when you need nearest-neighbor similarity
search.

> **Version 2.0.0** is the first intentional release under `@reggieofarrell/firestore-orm`, bundling
> the maintained fork baseline with this vector extension.

## Requirements

| Capability                                 | Minimum SDK                                                     |
| ------------------------------------------ | --------------------------------------------------------------- |
| Basic `findNearest`                        | `firebase-admin` >= 12                                          |
| `distanceResultField`, `distanceThreshold` | `firebase-admin` >= 13 (or `@google-cloud/firestore` >= 7.10.0) |

Vector search requires a **vector index** on your embedding field. Create indexes via the Firebase
Console, `gcloud`, or `firestore.indexes.json` — the ORM does not provision indexes.

There is **no vector-construction helper** in this library. Build stored and query vectors with the
native `FieldValue.vector(...)` from `firebase-admin/firestore`.

## Quick start

```typescript
import { FirestoreRepository } from '@reggieofarrell/firestore-orm';
import { withVectorSearch, vectorEmbeddingSchema } from '@reggieofarrell/firestore-orm/vector';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';

const articleSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['draft', 'published']),
  embedding: vectorEmbeddingSchema(768).optional(),
});

const articleRepo = FirestoreRepository.withSchema(db, 'articles', articleSchema);
const vectorArticleRepo = withVectorSearch(articleRepo);

await vectorArticleRepo.create({
  title: 'My Article',
  status: 'published',
  embedding: FieldValue.vector(embeddingArray),
});

const neighbors = await vectorArticleRepo
  .query()
  .findNearest({
    vectorField: 'embedding',
    queryVector: queryEmbedding,
    limit: 10,
    distanceMeasure: 'COSINE',
  })
  .get();
```

The wrapped repository proxies every core repository method — `create()`, `getById()`, hooks,
transactions, and so on all work unchanged — and only overrides `query()` to return a
`VectorQueryBuilder`. The schema still requires a top-level `id: z.string()`, exactly like any
`withSchema` repository.

## Top-level embedding fields (recommended)

Store embeddings on a **top-level field** (for example `embedding`), not nested under `metadata`:

```typescript
// RECOMMENDED
{ title: 'Article', embedding: FieldValue.vector([...]) }

// DISCOURAGED — emulator bugs with nested vector paths
{ title: 'Article', metadata: { embedding: FieldValue.vector([...]) } }
```

| Concern             | Top-level                               | Nested (`metadata.embedding`)       |
| ------------------- | --------------------------------------- | ----------------------------------- |
| Emulator testing    | Reliable                                | Known issues — may return 0 results |
| Index configuration | Simple `fieldPath: "embedding"`         | Must match exact nested path        |
| Zod ergonomics      | `embedding: vectorEmbeddingSchema(768)` | Nested sentinel complexity          |

The API accepts any string `vectorField` path, but **docs, examples, and tests use top-level fields
only**.

### Index example

```json
{
  "indexes": [
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "embedding",
          "vectorConfig": { "dimension": 768, "flat": {} }
        }
      ]
    }
  ]
}
```

The index `dimension` must match the length of arrays passed to `FieldValue.vector()`.

## Pre-filtered search

Combine `where()` pre-filters with `findNearest()`. This requires a **composite vector index** that
includes both the filter field(s) and the vector field:

```typescript
const results = await vectorArticleRepo
  .query()
  .where('status', '==', 'published')
  .findNearest({
    vectorField: 'embedding',
    queryVector: queryEmbedding,
    limit: 5,
    distanceMeasure: 'EUCLIDEAN',
    distanceResultField: 'vectorDistance',
    distanceThreshold: 0.5,
  })
  .get();
```

Call `where()` and `select()` **before** `findNearest()`; both throw if invoked after the query has
entered vector mode.

## Distance measures

The `distanceMeasure` option accepts the string values below (or the corresponding
`VectorDistanceMeasure` constant, e.g. `VectorDistanceMeasure.COSINE`):

| Measure       | When to use                                                           |
| ------------- | --------------------------------------------------------------------- |
| `DOT_PRODUCT` | Normalized embeddings — fastest, best performance                     |
| `COSINE`      | Unsure if normalized — safe default (range 0–2, lower = more similar) |
| `EUCLIDEAN`   | When magnitude matters or model was trained with L2 distance          |

## API reference

All vector exports come from `@reggieofarrell/firestore-orm/vector`.

### `withVectorSearch(repo)`

Returns a `VectorEnabledRepository` that proxies all repository methods and overrides `query()` to
return a `VectorQueryBuilder`.

### `VectorQueryBuilder`

| Method                    | Description                                    |
| ------------------------- | ---------------------------------------------- |
| `where(field, op, value)` | Pre-filter before vector search                |
| `select(...fields)`       | Field mask (stored fields only — see note)     |
| `findNearest(options)`    | Configure KNN search (required before `get()`) |
| `get()`                   | Execute search and return documents            |
| `getOne()`                | Return the nearest single document or `null`   |

`select(...)` narrows the result type and that projection **composes through** `findNearest()`. Pass
only stored document fields to `select()` — do **not** list `distanceResultField`. It is a computed
output field, not a stored one; `findNearest()` appends it to the result and, when you also use
`select()`, automatically widens the field mask so the distance survives.

The computed distance field is added to the result type as a `number`. Prefer a **string literal**
for `distanceResultField` (e.g. `'score'`) for precise typing:

- A literal name is added as a numeric property; if it collides with a model field, it **replaces**
  that field's type with `number` (matching Firestore, which overwrites the stored field with the
  computed distance).
- `'id'` is **rejected** at runtime — the repository overlays the document id on every result, which
  would overwrite the distance.
- A non-literal `string` (a value from a variable) yields a **conservative** result type: `id` stays
  a string, every other known field becomes `T[field] | number` (the runtime name may collide with
  any one), and arbitrary keys are `unknown`. It never claims every field is numeric.

`findNearest(options)` takes
`{ vectorField, queryVector, limit, distanceMeasure, distanceResultField?, distanceThreshold? }`. It
can be called only once per query, `limit` must be a positive integer no greater than
`VECTOR_MAX_LIMIT`, and `queryVector` must be a non-empty array of finite numbers within
`VECTOR_MAX_DIMENSIONS`.

`orderBy()`, `onSnapshot()`, and `stream()` are **not supported** on a vector query builder — each
throws. Apply ordering implicitly through `findNearest()` and pre-filter with `where()` instead.

### `vectorEmbeddingSchema(dimensions?)`

Zod helper accepting `number[]` or `FieldValue.vector()` write values. Pass `dimensions` to
constrain the embedding length.

### `isVectorFieldValue(value)`

Type guard that returns `true` when a value is a Firestore vector `FieldValue` (the result of
`FieldValue.vector(...)`).

### Constants

- `VECTOR_MAX_DIMENSIONS` — 2048
- `VECTOR_MAX_LIMIT` — 1000
- `VectorDistanceMeasure` — `{ EUCLIDEAN, COSINE, DOT_PRODUCT }`

## Limitations

- No real-time listeners: `onSnapshot()`, `stream()`, and `orderBy()` throw on vector queries
- Maximum 2048 embedding dimensions
- Maximum 1000 results per query
- Index management is external to the ORM
- Embedding generation is not included — use Vertex AI, OpenAI, or your preferred model

## Out of scope

- Programmatic index creation
- Embedding model integration
- Emulator workarounds for nested vector field paths
