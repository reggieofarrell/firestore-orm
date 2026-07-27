/**
 * Type-level tests for distributive `Omit<_, 'id'>` over union stored/read models (issue #54,
 * ADR-0028), checked by `npm run test:types` via tsc (NOT jest). Uses the directly-typed
 * constructor because `withSchema` cannot express a union stored model (`ZodObject` only).
 *
 * Each `@ts-expect-error` FAILS the type-check if the line below it stops being an error; every
 * un-annotated call must type-check. Union fixtures use branch-specific **top-level** keys so the
 * collapse defect is observable — unions whose branches share all top-level key names do not
 * reproduce the bug.
 */
import { FieldPath, Filter } from 'firebase-admin/firestore';
import { FirestoreRepository } from '../../index.js';
import { withVectorSearch } from '../../vector/index.js';
import type { FieldPaths, OmitId, PathValue } from '../../index.js';
import type { NumericFieldPaths } from '../../utils/pathTypes.js';
import type { FindNearestOptions } from '../../vector/index.js';

declare const db: FirebaseFirestore.Firestore;

/** Branch-specific top-level keys — the shape that triggers union collapse when `Omit` is non-distributive. */
type UnionModel =
  | { kind: 'a'; onlyOnA: string; nA: number; meta: { x: string } }
  | { kind: 'b'; onlyOnB: number; nB: number };

const repo = new FirestoreRepository<UnionModel, UnionModel, UnionModel, UnionModel>(db, 'unions');

// ── U-1: query surfaces accept branch-specific and nested branch-specific paths ─────────────────
export function whereAcceptsBranchSpecificPaths() {
  repo.query().where('kind', '==', 'a');
  repo.query().where('onlyOnA', '==', 'x');
  repo.query().where('onlyOnB', '==', 1);
  repo.query().where('meta.x', '==', 'x');
  repo.query().where(new FieldPath('onlyOnA'), '==', 'x');
}

export function orderByAcceptsBranchSpecificPaths() {
  repo.query().orderBy('onlyOnA');
  repo.query().orderBy('meta.x', 'desc');
}

export function selectAcceptsBranchSpecificPaths() {
  repo.query().select('onlyOnA', 'meta.x');
  repo.query().select('onlyOnB');
}

export function whereFilterAcceptsBranchSpecificPaths() {
  repo.query().whereFilter(f => f.where('onlyOnA', '==', 'x'));
  repo
    .query()
    .whereFilter(f => Filter.or(f.where('onlyOnA', '==', 'x'), f.where('onlyOnB', '==', 1)));
}

// ── U-2: numeric aggregations reach branch-only numeric fields ────────────────────────────────
export async function numericAggregationsReachBranchFields() {
  await repo.query().sum('nA');
  await repo.query().average('nB');
  await repo.query().aggregate({ total: { kind: 'sum', field: 'nA' }, n: { kind: 'count' } });
}

// ── U-3: distinctValues preserves element types, not just compile acceptance (T2 / N1) ──────────
export async function distinctValuesReachesBranchFields() {
  const a: string[] = await repo.query().distinctValues('onlyOnA');
  const b: number[] = await repo.query().distinctValues('onlyOnB');
  return [a, b];
}

// ── U-4: repository find-by-field helpers accept branch-specific paths ────────────────────────
export async function findByFieldReachesBranchFields() {
  await repo.findByField('onlyOnA', 'x');
  await repo.getOneByField('onlyOnB', 1);
  await repo.getOneByFieldOrThrow('onlyOnA', 'x');
}

// ── U-5: same-key-different-type unions stay conservative (T8) ────────────────────────────────
type SameKeyUnion = { kind: 'a'; v: number } | { kind: 'b'; v: string };
const sameKeyRepo = new FirestoreRepository<SameKeyUnion, SameKeyUnion, SameKeyUnion, SameKeyUnion>(
  db,
  'same-key',
);
export async function sameKeyUnionNumericExcluded() {
  // @ts-expect-error `v` is `number | string` across branches — not a pure numeric path (T8)
  await sameKeyRepo.query().sum('v');
}
const _pathValueOnV: PathValue<SameKeyUnion, 'v'> = 1 as number | string;
export const _u5 = [_pathValueOnV];

// ── U-6: D2 limitation — literal key + index signature still yields no typed paths ────────────
type IndexIntersect = { name: string } & Record<string, unknown>;
const indexRepo = new FirestoreRepository<
  IndexIntersect,
  IndexIntersect,
  IndexIntersect,
  IndexIntersect
>(db, 'index-intersect');
export function indexSignatureCollapseStillUnfixed() {
  // @ts-expect-error D2 (#58): intersection flattening in `Omit` — `OmitId` does not recover paths
  indexRepo.query().where('name', '==', 'x');
}

// ── U-7: `id` is still stripped after distributing ────────────────────────────────────────────
type PartialIdUnion = { kind: 'a'; onlyOnA: string; id?: string } | { kind: 'b'; onlyOnB: number };
const partialIdRepo = new FirestoreRepository<
  PartialIdUnion,
  PartialIdUnion,
  PartialIdUnion,
  PartialIdUnion
>(db, 'partial-id');
export function idStillStrippedOnUnion() {
  // @ts-expect-error synthetic `id` is repository metadata, not a queryable stored field path
  partialIdRepo.query().where('id', '==', 'x');
}

// ── U-8: non-union model unchanged (P14) ────────────────────────────────────────────────────────
// Routed through `OmitId` and through the real builder — asserting `FieldPaths<PlainModel>`
// directly would pass no matter what `OmitId` does, and so would guard nothing.
type PlainModel = { name: string; score: number; stats: { count: number } };
type PlainPaths = FieldPaths<OmitId<PlainModel>>;
type PlainNumeric = NumericFieldPaths<OmitId<PlainModel>>;
const _plainPath: PlainPaths = 'stats.count';
const _plainNumeric: PlainNumeric = 'score';
export const _u8 = [_plainPath, _plainNumeric];

const plainRepo = new FirestoreRepository<PlainModel, PlainModel, PlainModel, PlainModel>(
  db,
  'plain',
);
export async function plainModelSurfaceUnchanged() {
  plainRepo.query().where('name', '==', 'x');
  plainRepo.query().orderBy('stats.count');
  await plainRepo.query().sum('stats.count');
  const names: string[] = await plainRepo.query().distinctValues('name');
  // @ts-expect-error typo rejection is unchanged for non-union models
  plainRepo.query().where('nombre', '==', 'x');
  return names;
}

// ── collection group inherits the fix ─────────────────────────────────────────────────────────
export function collectionGroupReachesBranchFields() {
  const group = repo.collectionGroup();
  group.query().where('onlyOnA', '==', 'x');
  group.query().orderBy('onlyOnB');
  group.query().select('onlyOnA');
  group.query().whereFilter(f => f.where('onlyOnB', '==', 1));
}

// ── vector surface ────────────────────────────────────────────────────────────────────────────
type VecUnion =
  { kind: 'a'; onlyOnA: string; embA: number[] } | { kind: 'b'; onlyOnB: number; embB: number[] };
const vecRepo = withVectorSearch(
  new FirestoreRepository<VecUnion, VecUnion, VecUnion, VecUnion>(db, 'vecs'),
);

export function vectorSurfaceReachesBranchFields() {
  vecRepo.vectorQuery().where('onlyOnA', '==', 'x');
  vecRepo.vectorQuery().select('onlyOnB');
  vecRepo.vectorQuery().whereFilter(f => f.where('onlyOnA', '==', 'x'));
  vecRepo.vectorQuery().findNearest({
    vectorField: 'embA',
    queryVector: [1, 2, 3],
    limit: 5,
    distanceMeasure: 'COSINE',
  });
}

// `FindNearestOptions` carries its OWN `keyof` constraint (`VectorSearch.ts`), and the builder call
// above does not exercise it — `VectorQueryBuilder.findNearest` supplies an already-widened `K`, so
// reverting that constraint to a non-distributive `keyof T` breaks no builder test. The type is
// publicly exported from the `/vector` subpath, so assert it directly.
type VecField = FindNearestOptions<VecUnion>['vectorField'];
const _embA: VecField = 'embA';
const _embB: VecField = 'embB';
export const _findNearestOptionsDistributes = [_embA, _embB];

// ── U-9: negatives — typos must still be rejected after widening ──────────────────────────────
export function typosStillRejected() {
  // @ts-expect-error typo — not a field on any branch
  repo.query().where('onlyOnC', '==', 1);
  // @ts-expect-error typo in a nested path
  repo.query().orderBy('meta.z');
  // @ts-expect-error typo in select
  repo.query().select('nope');
  // @ts-expect-error non-numeric field rejected by sum
  repo.query().sum('onlyOnA');
  // @ts-expect-error typo in distinctValues
  repo.query().distinctValues('nope');
  // @ts-expect-error typo in findByField
  repo.findByField('nope', 1);
  // @ts-expect-error typo in whereFilter
  repo.query().whereFilter(f => f.where('nope', '==', 1));
  // @ts-expect-error arbitrary dynamic strings still rejected
  repo.query().where('some' + 'field', '==', 1);
}
