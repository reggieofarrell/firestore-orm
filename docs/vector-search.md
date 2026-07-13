# Vector Search Extension

Firestore vector search is available as an **opt-in extension** at
`@reggieofarrell/firestore-orm/vector`. The core package API is unchanged — wrap your repository
with `withVectorSearch()` when you need KNN similarity search.

> **Version 2.0.0** is the first intentional release under `@reggieofarrell/firestore-orm`, bundling
> the maintained fork baseline with this vector extension.

## Requirements

| Capability                                 | Minimum SDK                                                     |
| ------------------------------------------ | --------------------------------------------------------------- |
| Basic `findNearest`                        | `firebase-admin` >= 12                                          |
| `distanceResultField`, `distanceThreshold` | `firebase-admin` >= 13 (or `@google-cloud/firestore` >= 7.10.0) |

Vector search requires a **vector index** on your embedding field. Create indexes via the Firebase
Console, `gcloud`, or `firestore.indexes.json` — the ORM does not provision indexes.

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

## Distance measures

| Measure       | When to use                                                           |
| ------------- | --------------------------------------------------------------------- |
| `DOT_PRODUCT` | Normalized embeddings — fastest, best performance                     |
| `COSINE`      | Unsure if normalized — safe default (range 0–2, lower = more similar) |
| `EUCLIDEAN`   | When magnitude matters or model was trained with L2 distance          |

## API reference

### `withVectorSearch(repo)`

Returns a `VectorEnabledRepository` that proxies all repository methods and overrides `query()` to
return a `VectorQueryBuilder`.

### `VectorQueryBuilder`

| Method                    | Description                                          |
| ------------------------- | ---------------------------------------------------- |
| `where(field, op, value)` | Pre-filter before vector search                      |
| `select(...fields)`       | Field mask (include `distanceResultField` when used) |
| `findNearest(options)`    | Configure KNN search (required before `get()`)       |
| `get()`                   | Execute search and return documents                  |
| `getOne()`                | Return the nearest single document or `null`         |

### `vectorEmbeddingSchema(dimensions?)`

Zod helper accepting `number[]` or `FieldValue.vector()` write values.

### Constants

- `VECTOR_MAX_DIMENSIONS` — 2048
- `VECTOR_MAX_LIMIT` — 1000
- `VectorDistanceMeasure` — `EUCLIDEAN`, `COSINE`, `DOT_PRODUCT`

## Limitations

- No real-time listeners (`onSnapshot`) on vector queries
- Maximum 2048 embedding dimensions
- Maximum 1000 results per query
- Index management is external to the ORM
- Embedding generation is not included — use Vertex AI, OpenAI, or your preferred model

## Out of scope

- Programmatic index creation
- Embedding model integration
- Emulator workarounds for nested vector field paths
