/**
 * Type-level tests for distributive `OmitId` over union stored/read models (issue #54, ADR-0028)
 * and for literal keys beside index signatures (issue #58), checked by `npm run test:types` via
 * tsc (NOT jest). Uses the directly-typed constructor because `withSchema` cannot express a union
 * stored model (`ZodObject` only) and because intersection fixtures likewise need an explicit `S`.
 *
 * Each `@ts-expect-error` FAILS the type-check if the line below it stops being an error; every
 * un-annotated call must type-check. Union fixtures use branch-specific **top-level** keys so the
 * collapse defect is observable — unions whose branches share all top-level key names do not
 * reproduce the bug. Intersection fixtures route through `OmitId` and real builders so a root-only
 * `FieldPaths<IndexIntersect>` assertion cannot falsely pass while `FieldPaths<OmitId<…>>` remains
 * `never` (T1).
 */
import { FieldPath, Filter } from 'firebase-admin/firestore';
import { FirestoreRepository } from '../../index.js';
import { withVectorSearch } from '../../vector/index.js';
import type {
  FieldPaths,
  OmitId,
  PathValue,
  QueryFilterFactory,
  StoredDataOf,
} from '../../index.js';
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

// ── U58 / U-6: literal key + index signature retains typed paths (issue #58) ───────────────────
// Nested intersection is load-bearing (T3): a root-only fix would admit `nested` while dropping
// `nested.label` / `nested.count`. Score is the explicit numeric path for NumericFieldPaths.
type IndexIntersect = {
  name: string;
  score: number;
  nested: { label: string; count: number } & Record<string, unknown>;
} & Record<string, unknown>;

const indexRepo = new FirestoreRepository<
  IndexIntersect,
  IndexIntersect,
  IndexIntersect,
  IndexIntersect
>(db, 'index-intersect');

// U58-1 — direct aliases through OmitId recover top-level and nested declared paths (T1, T3)
type IndexPaths = FieldPaths<OmitId<IndexIntersect>>;
type IndexNumeric = NumericFieldPaths<OmitId<IndexIntersect>>;
const _indexName: IndexPaths = 'name';
const _indexScore: IndexPaths = 'score';
const _indexNested: IndexPaths = 'nested';
const _indexNestedLabel: IndexPaths = 'nested.label';
const _indexNestedCount: IndexPaths = 'nested.count';
const _indexNumericScore: IndexNumeric = 'score';
export const _u58_1 = [
  _indexName,
  _indexScore,
  _indexNested,
  _indexNestedLabel,
  _indexNestedCount,
  _indexNumericScore,
];

// U58-2 — StoredDataOf keeps declared precision AND the string index (T2, T7)
// Observation direction is unknown→string: assigning a string INTO PathValue/`name` would pass
// when the alias is still `unknown` and would guard nothing.
type IndexStored = StoredDataOf<typeof indexRepo>;
declare const _stored: IndexStored;
// Assign declared property / PathValue INTO `string` — the reverse (string INTO unknown) would
// pass on the unfixed baseline and guard nothing (T7).
const _storedName: string = _stored.name;
// Positive: dynamic index access compiles (index signature retained — T2 path-only leak rejects this).
const _storedDynamic: unknown = _stored['arbitrary'];
// Precision pin: dynamic access must remain `unknown`, not a widened declared type (F1).
// Assigning into `unknown` alone would also succeed for `string`/`any` and would not catch a widen.
export function u58_2_dynamicIndexIsUnknown() {
  // @ts-expect-error dynamic index access is `unknown`, not `string`
  const _asString: string = _stored['arbitrary'];
  void _asString;
}
declare const _pathValueName: PathValue<OmitId<IndexIntersect>, 'name'>;
const _pathName: string = _pathValueName;
export const _u58_2 = [_storedName, _storedDynamic, _pathName];

// U58-3 — every public path-consumer family accepts declared paths (T1, T6)
declare const tx: FirebaseFirestore.Transaction;

export async function u58_3_coreAndRepositorySurfaces() {
  // Core query clauses / factories / aggregations
  indexRepo.query().where('name', '==', 'x');
  indexRepo.query().where('nested.label', '==', 'x');
  indexRepo.query().orderBy('score');
  indexRepo.query().orderBy('nested.count', 'desc');
  indexRepo.query().select('name', 'nested.label');
  indexRepo.query().whereFilter(f => f.where('name', '==', 'x'));
  indexRepo
    .query()
    .whereFilter(f => Filter.or(f.where('name', '==', 'x'), f.where('score', '==', 1)));
  await indexRepo.query().sum('score');
  await indexRepo.query().average('score');
  await indexRepo.query().aggregate({
    total: { kind: 'sum', field: 'score' },
    n: { kind: 'count' },
  });

  // Repository field helpers + field-mask overloads
  await indexRepo.findByField('name', 'x');
  await indexRepo.getOneByField('nested.label', 'x');
  await indexRepo.getOneByFieldOrThrow('name', 'x');
  await indexRepo.getMany(['doc-1'], { fieldMask: ['name', 'nested.label'] });
  await indexRepo.getManyInTransaction(tx, ['doc-1'], {
    fieldMask: ['name', 'score'],
  });

  // Reusable invariant filter factory over StoredDataOf (preserves intersection)
  const mine = (f: QueryFilterFactory<StoredDataOf<typeof indexRepo>>) =>
    f.where('name', '==', 'x');
  indexRepo.query().whereFilter(mine);
}

export function u58_3_collectionGroupSurfaces() {
  const group = indexRepo.collectionGroup();
  // Inherited Core paths
  group.query().where('name', '==', 'x');
  group.query().orderBy('score');
  // Subclass-specific overrides
  group.query().select('name', 'nested.label');
  group.query().whereFilter(f => f.where('nested.count', '==', 1));
}

const indexVecRepo = withVectorSearch(indexRepo);
export function u58_3_vectorSurfaces() {
  indexVecRepo.vectorQuery().where('name', '==', 'x');
  indexVecRepo.vectorQuery().select('score', 'nested.label');
  indexVecRepo.vectorQuery().whereFilter(f => f.where('name', '==', 'x'));
}

// U58-4 — typos, dynamic strings, pure records, and non-numeric paths stay rejected (T5, T10)
type PureRecord = Record<string, unknown>;
type PureRecordPaths = FieldPaths<OmitId<PureRecord>>;
// Assigning any string into `never` must remain an error — proves no accidental widening to `string`.
export function u58_4_negativesRemainRejected() {
  // @ts-expect-error typo — not a declared literal beside the index
  indexRepo.query().where('nombre', '==', 'x');
  // @ts-expect-error undeclared nested key under the nested intersection
  indexRepo.query().where('nested.missing', '==', 'x');
  // @ts-expect-error arbitrary dynamic strings still rejected
  indexRepo.query().where('some' + 'field', '==', 1);
  // @ts-expect-error non-numeric field rejected by sum
  indexRepo.query().sum('name');
  // @ts-expect-error pure Record yields no typed string paths
  const _purePath: PureRecordPaths = 'anything';
  void _purePath;
  // SDK FieldPath escape hatch for arbitrary map keys still compiles
  indexRepo.query().where(new FieldPath('metadata', 'plan'), '==', 'pro');
}

// ── U58-5 / U-7: `id` is still stripped after distributing (T4) ────────────────────────────────
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

// Direct ordinary / optional / readonly explicit-id controls — `Omit` branch must still fire
type ExplicitId = { id: string; name: string };
type OptionalId = { id?: string; name: string };
type ReadonlyId = { readonly id: string; name: string };
type ExplicitIdPaths = FieldPaths<OmitId<ExplicitId>>;
type OptionalIdPaths = FieldPaths<OmitId<OptionalId>>;
type ReadonlyIdPaths = FieldPaths<OmitId<ReadonlyId>>;
const _explicitName: ExplicitIdPaths = 'name';
const _optionalName: OptionalIdPaths = 'name';
const _readonlyName: ReadonlyIdPaths = 'name';
export const _u58_5 = [_explicitName, _optionalName, _readonlyName];
export function u58_5_explicitIdStillStripped() {
  // @ts-expect-error explicit `id` remains non-queryable after OmitId
  const _idPath: ExplicitIdPaths = 'id';
  void _idPath;
  // @ts-expect-error optional explicit `id` is still stripped (T4 / P24)
  const _optionalIdPath: OptionalIdPaths = 'id';
  void _optionalIdPath;
  // @ts-expect-error readonly explicit `id` is still stripped (T4 / P25)
  const _readonlyIdPath: ReadonlyIdPaths = 'id';
  void _readonlyIdPath;
  const explicitRepo = new FirestoreRepository<ExplicitId, ExplicitId, ExplicitId, ExplicitId>(
    db,
    'explicit-id',
  );
  // @ts-expect-error explicit `id` is not a stored field path on the builder either
  explicitRepo.query().where('id', '==', 'x');
  explicitRepo.query().where('name', '==', 'x');
}

// U58 — union member that is itself a declared-plus-index intersection (probe P17)
type UnionWithIntersect =
  | ({ kind: 'indexed'; indexedName: string } & Record<string, unknown>)
  | { kind: 'plain'; plainName: string };
type UnionIntersectPaths = FieldPaths<OmitId<UnionWithIntersect>>;
const _unionKind: UnionIntersectPaths = 'kind';
const _unionIndexedName: UnionIntersectPaths = 'indexedName';
const _unionPlainName: UnionIntersectPaths = 'plainName';
export const _u58_unionIntersect = [_unionKind, _unionIndexedName, _unionPlainName];

// U58-6 — explicit `id` + string index remains unsupported (D4 / T9 / #82)
// Do not remove this pin without an owner decision; expanding #58 to cover it requires the
// D1-rejected path-only helper across value and path surfaces.
type ExplicitIdIndex = { id: string; name: string } & Record<string, unknown>;
type ExplicitIdIndexPaths = FieldPaths<OmitId<ExplicitIdIndex>>;
export function u58_6_explicitIdIndexStillUnsupported() {
  // @ts-expect-error D4 (#82): explicit id + string index still collapses typed paths
  const _name: ExplicitIdIndexPaths = 'name';
  void _name;
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
