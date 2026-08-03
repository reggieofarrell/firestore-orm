/**
 * Type-level tests for distributive `OmitId` over union stored/read models (issue #54, ADR-0028),
 * literal keys beside index signatures (issue #58), and explicit-`id` + index preservation
 * (issue #82), checked by `npm run test:types` via tsc (NOT jest). Uses the directly-typed
 * constructor because `withSchema` cannot express a union stored model (`ZodObject` only) and
 * because intersection fixtures likewise need an explicit `S`.
 *
 * Each `@ts-expect-error` FAILS the type-check if the line below it stops being an error; every
 * un-annotated call must type-check. Union fixtures use branch-specific **top-level** keys so the
 * collapse defect is observable — unions whose branches share all top-level key names do not
 * reproduce the bug. Intersection fixtures route through `OmitId` and real builders so a root-only
 * `FieldPaths<IndexIntersect>` assertion cannot falsely pass while `FieldPaths<OmitId<…>>` remains
 * `never` (T1). Explicit-`id` indexed fixtures additionally prove that declared siblings survive
 * the `Omit` branch when index signatures are reconstructed (issue #82 / T1–T10).
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

// ── TY / U82: explicit `id` + index signature recovers declared paths (issue #82) ───────────────
// Built-in `Omit` flattens `{ id; name } & Record<string, unknown>` to the index alone. The
// refined `OmitId` omits declared `id` from `LiteralOnly` and reattaches index signatures, so
// every public path-consumer family inherits the fix without signature edits (D1 / T5).
type ExplicitIdIndex = {
  id: string;
  name: string;
  score: number;
  nested: { label: string; count: number } & Record<string, unknown>;
  embedding: number[];
} & Record<string, unknown>;

const explicitIdIndexRepo = new FirestoreRepository<
  ExplicitIdIndex,
  ExplicitIdIndex,
  ExplicitIdIndex,
  ExplicitIdIndex
>(db, 'explicit-id-index');

// TY-1 — direct aliases recover top-level and nested declared paths; numerics reach score/count
type ExplicitIdIndexPaths = FieldPaths<OmitId<ExplicitIdIndex>>;
type ExplicitIdIndexNumeric = NumericFieldPaths<OmitId<ExplicitIdIndex>>;
const _eiiName: ExplicitIdIndexPaths = 'name';
const _eiiScore: ExplicitIdIndexPaths = 'score';
const _eiiNested: ExplicitIdIndexPaths = 'nested';
const _eiiNestedLabel: ExplicitIdIndexPaths = 'nested.label';
const _eiiNestedCount: ExplicitIdIndexPaths = 'nested.count';
const _eiiNumericScore: ExplicitIdIndexNumeric = 'score';
const _eiiNumericNestedCount: ExplicitIdIndexNumeric = 'nested.count';
export const _ty1 = [
  _eiiName,
  _eiiScore,
  _eiiNested,
  _eiiNestedLabel,
  _eiiNestedCount,
  _eiiNumericScore,
  _eiiNumericNestedCount,
];

// TY-2 — StoredDataOf / PathValue keep declared precision AND the string index (T2, T4, T8)
// Observation direction is unknown→string: assigning a string INTO PathValue/`name` would pass
// when the alias is still `unknown` and would guard nothing.
type ExplicitIdIndexStored = StoredDataOf<typeof explicitIdIndexRepo>;
declare const _eiiStored: ExplicitIdIndexStored;
const _eiiStoredName: string = _eiiStored.name;
// Positive: dynamic index access compiles (index signature retained — path-only leak rejects this).
const _eiiStoredDynamic: unknown = _eiiStored['arbitrary'];
// D3 / T4: value-position `id` remains the index value (`unknown`), not absent / never.
const _eiiStoredIdValue: unknown = _eiiStored['id'];
export function ty2_dynamicIndexIsUnknown() {
  // @ts-expect-error dynamic index access is `unknown`, not `string`
  const _asString: string = _eiiStored['arbitrary'];
  void _asString;
  // @ts-expect-error value-position `id` is the index value (`unknown`), not `string`
  const _idAsString: string = _eiiStored['id'];
  void _idAsString;
}
declare const _eiiPathValueName: PathValue<OmitId<ExplicitIdIndex>, 'name'>;
const _eiiPathName: string = _eiiPathValueName;
export const _ty2 = [_eiiStoredName, _eiiStoredDynamic, _eiiStoredIdValue, _eiiPathName];

// TY-3 — Core clauses / factories / aggregations / reusable predicate accept declared paths
export async function ty3_coreSurfaces() {
  explicitIdIndexRepo.query().where('name', '==', 'x');
  explicitIdIndexRepo.query().where('nested.label', '==', 'x');
  explicitIdIndexRepo.query().orderBy('score');
  explicitIdIndexRepo.query().orderBy('nested.count', 'desc');
  explicitIdIndexRepo.query().select('name', 'nested.label');
  explicitIdIndexRepo.query().whereFilter(f => f.where('name', '==', 'x'));
  explicitIdIndexRepo
    .query()
    .whereFilter(f => Filter.or(f.where('name', '==', 'x'), f.where('score', '==', 1)));
  // Exact public reusable-predicate spelling (D2 / T9) — not merely an inferred inline factory.
  const mine = (f: QueryFilterFactory<StoredDataOf<typeof explicitIdIndexRepo>>) =>
    f.where('name', '==', 'x');
  explicitIdIndexRepo.query().whereFilter(mine);
  await explicitIdIndexRepo.query().sum('score');
  await explicitIdIndexRepo.query().average('nested.count');
  await explicitIdIndexRepo.query().aggregate({
    total: { kind: 'sum', field: 'score' },
    n: { kind: 'count' },
  });
}

// TY-4 — repository helpers and both field-mask routes accept declared/nested paths
export async function ty4_repositorySurfaces() {
  await explicitIdIndexRepo.findByField('name', 'x');
  await explicitIdIndexRepo.getOneByField('nested.label', 'x');
  await explicitIdIndexRepo.getOneByFieldOrThrow('name', 'x');
  await explicitIdIndexRepo.getMany(['doc-1'], { fieldMask: ['name', 'nested.label'] });
  await explicitIdIndexRepo.getManyInTransaction(tx, ['doc-1'], {
    fieldMask: ['name', 'score'],
  });
}

// TY-5 — collection-group inherited clauses, override select, and group factory
export function ty5_collectionGroupSurfaces() {
  const group = explicitIdIndexRepo.collectionGroup();
  group.query().where('name', '==', 'x');
  group.query().orderBy('score');
  group.query().select('name', 'nested.label');
  group.query().whereFilter(f => f.where('nested.count', '==', 1));
}

// TY-6 — vector prefilter / projection / factory; findNearest KeysOf control remains wide (T10)
const explicitIdIndexVecRepo = withVectorSearch(explicitIdIndexRepo);
export function ty6_vectorSurfaces() {
  explicitIdIndexVecRepo.vectorQuery().where('name', '==', 'x');
  explicitIdIndexVecRepo.vectorQuery().select('score', 'nested.label');
  explicitIdIndexVecRepo.vectorQuery().whereFilter(f => f.where('name', '==', 'x'));
  // KeysOf consumer: declared embedding AND an arbitrary index key remain accepted (N5 / T10).
  explicitIdIndexVecRepo.vectorQuery().findNearest({
    vectorField: 'embedding',
    queryVector: [1, 2, 3],
    limit: 5,
    distanceMeasure: 'COSINE',
  });
  explicitIdIndexVecRepo.vectorQuery().findNearest({
    vectorField: 'arbitraryVectorKey',
    queryVector: [1, 2, 3],
    limit: 5,
    distanceMeasure: 'COSINE',
  });
}

// TY-7 — `id`, arbitrary/dynamic keys, typos, undeclared nested, nonnumeric sum stay rejected
export function ty7_negativesRemainRejected() {
  // @ts-expect-error synthetic / declared `id` is not a typed stored field path (T4)
  const _idPath: ExplicitIdIndexPaths = 'id';
  void _idPath;
  // @ts-expect-error `id` is not a typed path on the builder either
  explicitIdIndexRepo.query().where('id', '==', 'x');
  // @ts-expect-error typo — not a declared literal beside the index
  explicitIdIndexRepo.query().where('nombre', '==', 'x');
  // @ts-expect-error undeclared nested key under the nested intersection
  explicitIdIndexRepo.query().where('nested.missing', '==', 'x');
  // @ts-expect-error arbitrary dynamic strings still rejected (T7)
  explicitIdIndexRepo.query().where('some' + 'field', '==', 1);
  // @ts-expect-error non-numeric field rejected by sum
  explicitIdIndexRepo.query().sum('name');
  // SDK FieldPath escape hatch for arbitrary map keys still compiles
  explicitIdIndexRepo.query().where(new FieldPath('metadata', 'plan'), '==', 'pro');
}

// TY-8 — number-only and readonly string indexes preserve domain / modifiers (T3)
type NumberOnlyIndexed = { id: string; name: string } & Record<number, unknown>;
type NumberOnlyPaths = FieldPaths<OmitId<NumberOnlyIndexed>>;
type NumberOnlyStored = OmitId<NumberOnlyIndexed>;
const _numberOnlyName: NumberOnlyPaths = 'name';
declare const _numberOnlyStored: NumberOnlyStored;
const _numberOnlyDynamic: unknown = _numberOnlyStored[123];
export function ty8_numberOnlyRejectsArbitraryStrings() {
  // @ts-expect-error number-only index does not invent arbitrary string paths
  const _arbitrary: NumberOnlyPaths = 'arbitrary';
  void _arbitrary;
  // Domain preservation (T3): string key value-access must stay illegal — widening the number
  // index to a string index would make this compile and would leave the matrix cell unguarded.
  // @ts-expect-error number-only stored shape rejects string-key indexing
  const _stringKeyAccess = _numberOnlyStored['arbitrary'];
  void _stringKeyAccess;
}
export const _ty8_number = [_numberOnlyName, _numberOnlyDynamic];

type ReadonlyStringIndexed = {
  id: string;
  name: string;
  readonly [key: string]: unknown;
};
type ReadonlyStringStored = OmitId<ReadonlyStringIndexed>;
declare const _readonlyStringStored: ReadonlyStringStored;
const _readonlyStringName: string = _readonlyStringStored.name;
export function ty8_readonlyIndexRemainsReadonly() {
  // @ts-expect-error reconstructed string index preserves its readonly modifier (T3 / P23)
  _readonlyStringStored['dynamic'] = 1;
}
export const _ty8_readonly = [_readonlyStringName];

// TY-9 — union distribution, symbol index, special types, and #58/#54 controls retained
type UnionWithExplicitIdIndex =
  | ({ id: string; kind: 'indexed'; indexedName: string } & Record<string, unknown>)
  | { id: string; kind: 'plain'; plainName: string };
type UnionExplicitIdIndexPaths = FieldPaths<OmitId<UnionWithExplicitIdIndex>>;
const _ueiKind: UnionExplicitIdIndexPaths = 'kind';
const _ueiIndexedName: UnionExplicitIdIndexPaths = 'indexedName';
const _ueiPlainName: UnionExplicitIdIndexPaths = 'plainName';
export const _ty9_union = [_ueiKind, _ueiIndexedName, _ueiPlainName];

type SymbolIndexed = {
  id: string;
  name: string;
  [key: symbol]: unknown;
};
type SymbolIndexedPaths = FieldPaths<OmitId<SymbolIndexed>>;
type SymbolIndexedStored = OmitId<SymbolIndexed>;
const _symbolName: SymbolIndexedPaths = 'name';
declare const _symbolStored: SymbolIndexedStored;
const _symbolValue: unknown = _symbolStored[Symbol.for('x')];
export const _ty9_symbol = [_symbolName, _symbolValue];

// Special-type identity: never / unknown / any must not be rewritten into an empty object.
// Bare `declare const` + array placement is vacuous (assignable from `{}`); use bidirectional
// equality so a regression that maps these to `{}` fails `test:types`.
type AssertTrue<T extends true> = T;
type ExpectEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type NeverOmit = OmitId<never>;
type UnknownOmit = OmitId<unknown>;
type AnyOmit = OmitId<any>;
type _ty9_neverIsNever = AssertTrue<ExpectEqual<NeverOmit, never>>;
type _ty9_unknownIsUnknown = AssertTrue<ExpectEqual<UnknownOmit, unknown>>;
type _ty9_anyIsAny = AssertTrue<ExpectEqual<AnyOmit, any>>;
export type _ty9_special = [_ty9_neverIsNever, _ty9_unknownIsUnknown, _ty9_anyIsAny];

// No-id indexed, pure-record, and ordinary explicit-id controls remain (cross-checked above too)
type NoIdIndexControl = { name: string } & Record<string, unknown>;
type NoIdIndexPaths = FieldPaths<OmitId<NoIdIndexControl>>;
const _noIdIndexName: NoIdIndexPaths = 'name';
export const _ty9_noIdIndex = [_noIdIndexName];

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
