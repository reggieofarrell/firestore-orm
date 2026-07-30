/**
 * Type-level tests for Query Explain return shapes (issue #37 / #65), checked by `npm run test:types`
 * via tsc (NOT jest). This file is never executed.
 *
 * The contract this pins:
 *  - T-1: explain() return type is QueryExplainResult<FirestoreDocument<…>>.
 *  - T-2: after select('name'), documents elements are projected (@ts-expect-error on removed field).
 *  - T-3: vector after findNearest + distanceResultField: documents carry distance typing when
 *    narrowed from null.
 *  - T-4: QueryExplainResult is importable from the package root and from /vector.
 *  - Stream T-1: root import/inference equals AsyncGenerator<QueryExplainStreamResult<FirestoreDocument<User>>>
 *  - Stream T-2/T-3: select projection preserved; group names path/parentPath.
 *
 * Each `@ts-expect-error` FAILS the type-check if the line below it stops being an error; every
 * un-annotated call must type-check.
 */
import { z } from 'zod';
import { FirestoreRepository } from '../../index.js';
import type {
  FirestoreDocument,
  QueryExplainResult,
  QueryExplainStreamResult,
} from '../../index.js';
import { withVectorSearch } from '../../vector/index.js';
import type { QueryExplainResult as VectorQueryExplainResult } from '../../vector/index.js';
// T6 — must stay a compile error: QueryExplainStreamResult is Core-only (not re-exported from /vector).
// @ts-expect-error QueryExplainStreamResult must not be exported from the /vector entry
import type { QueryExplainStreamResult as _ForbiddenVectorStreamResult } from '../../vector/index.js';
void 0 as unknown as _ForbiddenVectorStreamResult;

declare const db: FirebaseFirestore.Firestore;

const userSchema = z.object({
  name: z.string(),
  score: z.number(),
  email: z.string().optional(),
});
const users = FirestoreRepository.withSchema(db, 'users', userSchema);

const postSchema = z.object({
  title: z.string(),
  views: z.number(),
});
const posts = FirestoreRepository.withSchema(db, 'users/u1/posts', postSchema);
const postGroup = posts.collectionGroup();

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

type _StreamExport = QueryExplainStreamResult<{ id: string; name: string }>;
const _streamExportProbe: _StreamExport = {};
void _streamExportProbe;

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
// Stream T-1 — explainStream() is AsyncGenerator<QueryExplainStreamResult<FirestoreDocument<User>>>
// ---------------------------------------------------------------------------

type UserDoc = FirestoreDocument<{ name: string; score: number; email?: string }>;

export async function explainStreamReturnIsQueryExplainStreamResult() {
  const gen: AsyncGenerator<QueryExplainStreamResult<UserDoc>> = users
    .query()
    .explainStream({ analyze: true });

  for await (const chunk of gen) {
    if (chunk.document) {
      const id: string = chunk.document.id;
      const name: string = chunk.document.name;
      void [id, name];
    }
    if (chunk.metrics) {
      return chunk.metrics;
    }
  }
}

// ---------------------------------------------------------------------------
// Stream T-6 — VectorQueryBuilder has no explainStream (runtime absent; type must stay absent)
// ---------------------------------------------------------------------------

export async function vectorExplainStreamAbsent() {
  const vq = vectorRepo.vectorQuery().findNearest({
    vectorField: 'embedding',
    queryVector: [1, 0, 0],
    limit: 1,
    distanceMeasure: 'EUCLIDEAN',
  });
  // @ts-expect-error VectorQueryBuilder deliberately has no explainStream (P1b / T6)
  vq.explainStream();
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
// Stream T-2 — after select('name'), explainStream document chunks stay projected
// ---------------------------------------------------------------------------

export async function explainStreamAfterSelectProjectsDocuments() {
  for await (const chunk of users.query().select('name').explainStream({ analyze: true })) {
    if (!chunk.document) {
      continue;
    }
    const _name: string | undefined = chunk.document.name;
    void _name;
    // @ts-expect-error score was projected away by select('name')
    chunk.document.score.toFixed();
  }
}

// ---------------------------------------------------------------------------
// Stream T-3 — collection-group explainStream document carries path/parentPath
// ---------------------------------------------------------------------------

export async function explainStreamGroupCarriesPathIdentity() {
  for await (const chunk of postGroup.query().explainStream({ analyze: true })) {
    if (!chunk.document) {
      continue;
    }
    const path: string = chunk.document.path;
    const parentPath: string = chunk.document.parentPath;
    const id: string = chunk.document.id;
    const title: string = chunk.document.title;
    return [path, parentPath, id, title];
  }
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
