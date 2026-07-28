/**
 * Type-level tests for Query Explain return shapes (issue #37), checked by `npm run test:types`
 * via tsc (NOT jest). This file is never executed.
 *
 * The contract this pins:
 *  - T-1: explain() return type is QueryExplainResult<FirestoreDocument<…>>.
 *  - T-2: after select('name'), documents elements are projected (@ts-expect-error on removed field).
 *  - T-3: vector after findNearest + distanceResultField: documents carry distance typing when
 *    narrowed from null.
 *  - T-4: QueryExplainResult is importable from the package root and from /vector.
 *
 * Each `@ts-expect-error` FAILS the type-check if the line below it stops being an error; every
 * un-annotated call must type-check.
 */
import { z } from 'zod';
import { FirestoreRepository } from '../../index.js';
import type { QueryExplainResult } from '../../index.js';
import { withVectorSearch } from '../../vector/index.js';
import type { QueryExplainResult as VectorQueryExplainResult } from '../../vector/index.js';

declare const db: FirebaseFirestore.Firestore;

const userSchema = z.object({
  name: z.string(),
  score: z.number(),
  email: z.string().optional(),
});
const users = FirestoreRepository.withSchema(db, 'users', userSchema);

const vectorSchema = z.object({
  name: z.string(),
  embedding: z.array(z.number()),
});
const vectorRepo = withVectorSearch(FirestoreRepository.withSchema(db, 'docs', vectorSchema));

// ---------------------------------------------------------------------------
// T-4 — QueryExplainResult importable from root and /vector (type identity)
// ---------------------------------------------------------------------------

type _RootExport = QueryExplainResult<{ id: string; name: string }>;
type _VectorExport = VectorQueryExplainResult<{ id: string; name: string }>;
type _SameExport = _RootExport extends _VectorExport
  ? _VectorExport extends _RootExport
    ? true
    : never
  : never;
const _exportCheck: _SameExport = true;
void _exportCheck;

// ---------------------------------------------------------------------------
// T-1 — explain() return type is QueryExplainResult<FirestoreDocument<…>>
// ---------------------------------------------------------------------------

export async function explainReturnIsQueryExplainResult() {
  const plan: QueryExplainResult<{ id: string; name: string; score: number; email?: string }> =
    await users.query().explain();
  // Plan-only documents may be null.
  if (plan.documents === null) {
    return plan.metrics;
  }
  const first = plan.documents[0];
  return first?.name;
}

// ---------------------------------------------------------------------------
// T-2 — after select('name'), documents elements are projected
// ---------------------------------------------------------------------------

export async function explainAfterSelectProjectsDocuments() {
  const analyzed = await users.query().select('name').explain({ analyze: true });
  if (analyzed.documents === null) {
    return;
  }
  const row = analyzed.documents[0];
  if (!row) {
    return;
  }
  // name survives the projection (DeepPartial — optional).
  const _name: string | undefined = row.name;
  void _name;
  // score was projected away: DeepPartial makes it optional, so calling a number method is an error.
  // @ts-expect-error score was projected away by select('name')
  row.score.toFixed();
}

// ---------------------------------------------------------------------------
// T-3 — vector distanceResultField typing on explain documents when non-null
// ---------------------------------------------------------------------------

export async function vectorExplainCarriesDistanceField() {
  const analyzed = await vectorRepo
    .vectorQuery()
    .findNearest({
      vectorField: 'embedding',
      queryVector: [1, 0, 0],
      limit: 5,
      distanceMeasure: 'EUCLIDEAN',
      distanceResultField: 'vectorDistance',
    })
    .explain({ analyze: true });

  if (analyzed.documents === null) {
    return;
  }
  const row = analyzed.documents[0];
  if (!row) {
    return;
  }
  // distanceResultField is part of the result shape after findNearest.
  const distance: number = row.vectorDistance;
  return distance;
}
