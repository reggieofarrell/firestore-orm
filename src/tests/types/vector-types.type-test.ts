/**
 * Type-level tests (checked by `npm run test:types`, never executed) for vector search result
 * typing: a configured `distanceResultField` must appear on the `get()` result type, and must be
 * absent when no distance field is requested.
 */
import { z } from 'zod';
import { FirestoreRepository } from '../../index.js';
import { withVectorSearch } from '../../vector/index.js';
import type { VectorSearchResult } from '../../vector/index.js';

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

  rows[0].name?.toUpperCase(); // selected field present (DeepPartial after projection)
  const distance: number = rows[0].score; // distance field composes onto the projected shape
  // @ts-expect-error `embedding` was projected away by select('name'), so it is not on the result
  rows[0].embedding.length.toFixed();
  return distance;
}

// Regression: vector select() is an immutable transition, so a pre-select alias keeps the full model
// at both type and runtime (they no longer disagree).
export async function vectorSelectIsImmutableForAliases() {
  const q = vectorRepo.query();
  const projected = q.select('name'); // returned narrowed builder

  // The ignored original alias `q` is still the full model — safe to access any field.
  const full = await q
    .findNearest({
      vectorField: 'embedding',
      queryVector: [0.1, 0.2, 0.3],
      limit: 1,
      distanceMeasure: 'COSINE',
    })
    .get();
  full[0].embedding.length.toFixed();

  const rows = await projected
    .findNearest({
      vectorField: 'embedding',
      queryVector: [0.1, 0.2, 0.3],
      limit: 1,
      distanceMeasure: 'COSINE',
    })
    .get();
  // @ts-expect-error projected-away field is not guaranteed present on the narrowed vector builder
  rows[0].embedding.length.toFixed();
}

// Regression: an ID-only projection (select() with no fields) still carries the configured distance
// field in its result type.
export async function emptyVectorProjectionIncludesDistanceField() {
  const rows = await vectorRepo
    .query()
    .select()
    .findNearest({
      vectorField: 'embedding',
      queryVector: [0.1, 0.2, 0.3],
      limit: 1,
      distanceMeasure: 'COSINE',
      distanceResultField: 'score',
    })
    .get();

  const distance: number = rows[0].score; // distance field present despite the empty projection
  // @ts-expect-error `name` was not selected (ID-only projection)
  rows[0].name.toUpperCase();
  return distance;
}

// Regression: a distanceResultField that collides with a model field REPLACES it with the numeric
// distance (Omit<R, DF> & Record<DF, number>), matching Firestore's runtime overwrite — rather than
// intersecting to `never` (which was assignable to both string and number, an unsound gap).
export async function distanceFieldReplacesCollidingModelField() {
  const rows = await vectorRepo
    .query()
    .findNearest({
      vectorField: 'embedding',
      queryVector: [0.1, 0.2, 0.3],
      limit: 1,
      distanceMeasure: 'COSINE',
      distanceResultField: 'name', // collides with the model's `name: string`
    })
    .get();

  const distance: number = rows[0].name; // `name` is now the computed distance (number)
  // @ts-expect-error the colliding field is typed number now, not its original string type
  const original: string = rows[0].name;
  return { distance, original };
}

// A dotted / computed distance-field name is a fresh key (not part of T), added as-is.
export async function distanceFieldDottedName() {
  const rows = await vectorRepo
    .query()
    .findNearest({
      vectorField: 'embedding',
      queryVector: [0.1, 0.2, 0.3],
      limit: 1,
      distanceMeasure: 'COSINE',
      distanceResultField: 'metrics.distance',
    })
    .get();

  const distance: number = rows[0]['metrics.distance'];
  return distance;
}

// Regression: a NON-literal (broad `string`) distanceResultField must NOT type every field as number.
// The conservative shape keeps `id` as its string type, types other known fields as `T | number`, and
// exposes arbitrary keys as `unknown` — so unsound numeric assumptions are compile errors.
export async function dynamicDistanceFieldIsConservative(distanceField: string) {
  const rows = await vectorRepo
    .query()
    .findNearest({
      vectorField: 'embedding',
      queryVector: [0.1, 0.2, 0.3],
      limit: 1,
      distanceMeasure: 'COSINE',
      distanceResultField: distanceField,
    })
    .get();

  rows[0].id.toUpperCase(); // id stays a string
  // @ts-expect-error id is not a number under a broad distance-field name
  rows[0].id.toFixed();
  // @ts-expect-error a known field may still be its original type (string) — not unconditionally number
  const n: number = rows[0].name;
  const either: string | number = rows[0].name; // it is string | number
  const dynamic: unknown = rows[0][distanceField]; // arbitrary key is unknown, not number
  return { n, either, dynamic };
}

// A `string | undefined` field name behaves like the broad case (conservative), not the empty case.
export async function optionalStringDistanceField(distanceField: string | undefined) {
  const rows = await vectorRepo
    .query()
    .findNearest({
      vectorField: 'embedding',
      queryVector: [0.1, 0.2, 0.3],
      limit: 1,
      distanceMeasure: 'COSINE',
      distanceResultField: distanceField,
    })
    .get();
  rows[0].id.toUpperCase();
  return rows;
}

// A union of literal names uses the precise (replacement) branch, distributed per member — NOT the
// broad conservative shape. So the untouched model field keeps its exact type (string), proving we
// did not fall into the `string`-widened branch (where it would be `string | number`).
export async function unionLiteralDistanceField(useScore: boolean) {
  const rows = await vectorRepo
    .query()
    .findNearest({
      vectorField: 'embedding',
      queryVector: [0.1, 0.2, 0.3],
      limit: 1,
      distanceMeasure: 'COSINE',
      distanceResultField: useScore ? ('score' as const) : ('dist' as const),
    })
    .get();
  const name: string = rows[0].name; // exact string (literal branch), not string | number
  // @ts-expect-error the field name is one of the union members; `score` is not guaranteed present
  const maybeScore: number = rows[0].score;
  return { name, maybeScore };
}

// The exported VectorSearchResult type follows the same rules for a broad string vs a literal.
type Model = { id: string; name: string; embedding: number[] };
export function vectorSearchResultTyping(
  broad: VectorSearchResult<Model, string>,
  literal: VectorSearchResult<Model, 'score'>,
) {
  broad.id.toUpperCase(); // id preserved
  // @ts-expect-error broad result never promises a known field is numeric
  const bn: number = broad.name;
  const score: number = literal.score; // literal adds a numeric distance field
  literal.name.toUpperCase(); // untouched model field
  return { bn, score };
}

// The exported type resolves a reserved literal `id` distance field to `never` (rejected at runtime).
export function vectorSearchResultReservedId(): never {
  return undefined as unknown as VectorSearchResult<Model, 'id'>;
}

// ── R1: withVectorSearch threads the 4th generic (WO), so a transformed-write repository (W ≠ WO)
// can be wrapped and the wrapper preserves the exact after-create OUTPUT typing. Before the fix the
// wrap call was a hard TS2345 (WO collapsed to W) and afterCreate exposed the write INPUT. ──────────
const tRead = z.object({ title: z.string(), score: z.number() });
const tWrite = z.object({ title: z.string(), score: z.string().transform(s => Number(s)) });
const tRepo = FirestoreRepository.withSchema(db, 'tdocs', tRead, { writeSchema: tWrite });
// Regression guard: this must COMPILE (W = { score: string }, WO = { score: number }).
const tVector = withVectorSearch(tRepo);

export async function transformedRepoWrapsAndPreservesOutputTyping() {
  // create() still accepts the pre-transform write INPUT (string).
  await tVector.create({ title: 't', score: '5' });
  // @ts-expect-error create input is the pre-transform string, not the number output
  await tVector.create({ title: 't', score: 5 });

  tVector.on('afterCreate', v => {
    // afterCreate observes the EXACT parsed output (number) — WO threaded through the wrapper (R1) and
    // exact via CreateOutput (R4).
    const exact: number = v.score;
    void exact;
    // @ts-expect-error the wrapped afterCreate is WO-derived (number), not the string write input
    const bad: string = v.score;
    void bad;
  });
}
