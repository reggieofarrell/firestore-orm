/**
 * Type-level tests (checked by `npm run test:types`, never executed) for vector search result
 * typing: a configured `distanceResultField` must appear on the `get()` result type, and must be
 * absent when no distance field is requested.
 */
import { z } from 'zod';
import { FirestoreRepository } from '../../index.js';
import { withVectorSearch } from '../../vector/index.js';

declare const db: FirebaseFirestore.Firestore;

const schema = z.object({
  id: z.string(),
  name: z.string(),
  embedding: z.array(z.number()),
});
const repo = FirestoreRepository.withSchema(db, 'docs', schema);
const vectorRepo = withVectorSearch(repo);

export async function distanceFieldAppearsInResult() {
  const withDistance = await vectorRepo
    .query()
    .findNearest({
      vectorField: 'embedding',
      queryVector: [0.1, 0.2, 0.3],
      limit: 5,
      distanceMeasure: 'COSINE',
      distanceResultField: 'score',
    })
    .get();

  // The configured distance field is present and typed as number.
  const distance: number = withDistance[0].score;
  withDistance[0].name.toUpperCase(); // base fields remain present
  return distance;
}

export async function noDistanceFieldWhenNotRequested() {
  const plain = await vectorRepo
    .query()
    .findNearest({
      vectorField: 'embedding',
      queryVector: [0.1, 0.2, 0.3],
      limit: 5,
      distanceMeasure: 'COSINE',
    })
    .get();

  plain[0].name.toUpperCase();
  // @ts-expect-error no distanceResultField was configured, so `score` is not on the result type
  plain[0].score.toFixed();
}

// Regression: a select() projection must COMPOSE through findNearest() rather than be reset to the
// full model. `embedding` was projected away, so accessing it must be a compile error, while the
// selected field and the configured distance field remain present.
export async function selectComposesThroughFindNearest() {
  const rows = await vectorRepo
    .query()
    .select('name')
    .findNearest({
      vectorField: 'embedding',
      queryVector: [0.1, 0.2, 0.3],
      limit: 5,
      distanceMeasure: 'COSINE',
      distanceResultField: 'score',
    })
    .get();

  rows[0].name?.toUpperCase(); // selected field present (Partial after projection)
  const distance: number = rows[0].score; // distance field composes onto the projected shape
  // @ts-expect-error `embedding` was projected away by select('name'), so it is not on the result
  rows[0].embedding.length.toFixed();
  return distance;
}
