/**
 * Type-level tests for schema-aware query field paths, checked by `npm run test:types` via tsc (NOT
 * jest). This file is never executed; it exists so the compiler validates that `where`/`orderBy`/
 * `select` accept typed nested dot-notation paths (and a `FieldPath` escape hatch) while rejecting
 * typos, arbitrary dynamic strings, array-index paths, and invalid operators.
 *
 * Each `@ts-expect-error` FAILS the type-check if the line below it stops being an error; every
 * un-annotated call must type-check.
 */
import { FieldPath } from 'firebase-admin/firestore';
import type { Timestamp, GeoPoint, DocumentReference } from 'firebase-admin/firestore';
import { z } from 'zod';
import { FirestoreRepository } from '../../index.js';
import type { DeepPartial, FieldPaths, PathValue } from '../../index.js';
// `NumericFieldPaths` is internal (it constrains `sum`/`average`); import it directly to assert the
// derived numeric-path set, in addition to exercising it through the public builder below.
import type { NumericFieldPaths } from '../../utils/pathTypes.js';

declare const db: FirebaseFirestore.Firestore;

const schema = z.object({
  id: z.string(),
  name: z.string(),
  tags: z.array(z.string()),
  createdAt: z.date(),
  address: z.object({ city: z.string(), zip: z.string().optional() }),
  settings: z.object({ notifications: z.object({ email: z.boolean() }) }),
});
type Doc = z.infer<typeof schema>;
const repo = FirestoreRepository.withSchema(db, 'docs', schema);

export function queryFieldPathPositives() {
  repo.query().where('name', '==', 'a');
  repo.query().where('address.city', '==', 'LA'); // nested path
  repo.query().where('settings.notifications.email', '==', true); // deep path
  repo.query().where(new FieldPath('address', 'city'), '==', 'LA'); // FieldPath escape hatch
  repo.query().orderBy('address.city', 'asc'); // nested orderBy (was blocked pre-v3)
  repo.query().orderBy('createdAt');
  repo.query().select('name', 'address.city', 'settings.notifications.email');
  repo.query().select(new FieldPath('address', 'city'));
}

export function queryFieldPathNegatives() {
  // @ts-expect-error typo in a nested path
  repo.query().where('address.citee', '==', 'LA');
  // @ts-expect-error not a field of the schema
  repo.query().where('nope', '==', 1);
  // @ts-expect-error arbitrary dynamic strings are no longer accepted — use a FieldPath
  repo.query().where('some' + 'field', '==', 1);
  // @ts-expect-error array-element paths are not valid field paths
  repo.query().orderBy('tags.0');
  // @ts-expect-error invalid Firestore operator
  repo.query().where('name', '===', 'a');
  // @ts-expect-error unknown field in select
  repo.query().select('nope');
}

// `select(...)` narrows the terminal-read result shape to `DeepPartial<T> & { id }`, so a field that
// was projected away becomes possibly-undefined and unsafe to access without a guard.
export async function projectionNarrowsResultType() {
  // Full read: every field is present with its exact type.
  const full = await repo.query().get();
  full[0].createdAt.getTime();
  full[0].name.toUpperCase();

  // Projected read: result narrows to DeepPartial<Doc> & { id }.
  const projected = await repo.query().select('name').get();
  projected[0].id.toUpperCase(); // id is always present
  // @ts-expect-error a projected-away field is not guaranteed present after select()
  projected[0].createdAt.getTime();

  // getOne on a projection returns the narrowed shape (or null).
  const one = await repo.query().select('name').getOne();
  if (one) {
    one.id.toUpperCase();
    // @ts-expect-error projected result: this field may be absent
    one.createdAt.getTime();
  }

  // stream / paginate / offsetPaginate carry the projection too.
  for await (const doc of repo.query().select('name').stream()) {
    // @ts-expect-error streamed projected doc: field may be absent
    doc.createdAt.getTime();
  }
  const page = await repo.query().select('name').orderBy('name').paginate(10);
  // @ts-expect-error paginated projected item: field may be absent
  page.items[0].createdAt.getTime();
}

// Alias soundness: select() returns a NEW builder rather than mutating and re-casting `this`, so a
// pre-select alias keeps the full model at BOTH the type level and runtime (they no longer disagree).
export async function selectIsImmutableForAliases() {
  const q = repo.query();
  const projected = q.select('name'); // narrowed builder

  // The original alias `q` is untouched: still the full model, so accessing any field is safe.
  const full = await q.get();
  full[0].createdAt.getTime();

  // The returned builder carries the projection.
  const rows = await projected.get();
  // @ts-expect-error projected-away field is not guaranteed present on the narrowed builder
  rows[0].createdAt.getTime();
}

// Dotted/deep projections must be sound too: DeepPartial makes NESTED map properties optional, so an
// unselected sibling of a selected nested field is a compile error (a shallow Partial<T> left it
// statically required — "typed present, runtime absent").
export async function dottedProjectionIsSound() {
  // Select a nested field; the parent map is present with only that field at runtime.
  const rows = await repo.query().select('address.zip').get();
  if (rows[0].address) {
    rows[0].address.zip?.toUpperCase(); // selected nested field (optional under DeepPartial)
    // @ts-expect-error unselected sibling `city` is not guaranteed present (DeepPartial), even though
    // it is required in the full model
    rows[0].address.city.toUpperCase();
  }

  // Deep path guard chain compiles (each level is optional under DeepPartial).
  const deep = await repo.query().select('settings.notifications.email').get();
  deep[0].settings?.notifications?.email?.valueOf();

  // Multiple paths and parent+child combinations narrow to the same DeepPartial shape.
  await repo.query().select('name', 'address.city').get();
  await repo.query().select('address', 'address.city').get();

  // A dynamic FieldPath projection also yields the conservative DeepPartial shape.
  const dyn = await repo.query().select(new FieldPath('address', 'city')).get();
  if (dyn[0].address) {
    // @ts-expect-error a dynamic FieldPath projection cannot prove any field is present
    dyn[0].address.city.toUpperCase();
  }
}

// sum()/average() accept only numeric field paths (including nested/dotted), not any keyof T;
// findByField accepts typed dotted paths.
const numSchema = z.object({
  id: z.string(),
  name: z.string(),
  score: z.number(),
  rating: z.number().optional(),
  stats: z.object({ count: z.number(), label: z.string() }),
});
const numRepo = FirestoreRepository.withSchema(db, 'nums', numSchema);

export function numericAggregationPaths() {
  numRepo.query().sum('score');
  numRepo.query().average('score');
  numRepo.query().sum('rating'); // optional numeric field
  numRepo.query().sum('stats.count'); // nested numeric path
  // @ts-expect-error 'name' is a string, not a numeric field
  numRepo.query().sum('name');
  // @ts-expect-error 'stats.label' is a string, not numeric
  numRepo.query().average('stats.label');
  // @ts-expect-error 'stats' is an object, not a numeric field
  numRepo.query().sum('stats');

  // findByField accepts typed dotted paths (was limited to top-level keys).
  numRepo.findByField('stats.count', 5);
  numRepo.findByField('name', 'x');
  // @ts-expect-error unknown field path
  numRepo.findByField('nope', 1);
}

// `PathValue` resolves the read-model type at a (possibly dotted) path.
const city: PathValue<Doc, 'address.city'> = 'x'; // string
const email: PathValue<Doc, 'settings.notifications.email'> = true; // boolean
export const _pathValues = { city, email };

// `FieldPaths` includes top-level keys and nested paths, but not array-index paths.
const validPaths: FieldPaths<Doc>[] = [
  'name',
  'address',
  'address.city',
  'address.zip',
  'settings.notifications.email',
  'tags',
  'createdAt',
];
export const _fieldPaths = validPaths;

// `DeepPartial` recurses into every object NOT assignable to the leaf set (there is no plain-map
// predicate). Every leaf value — scalars, `Date`, Firestore value classes, byte values, functions,
// and arrays — is preserved WHOLE, so a selected value keeps its real API after the parent is
// guarded (it does not become a partialized object).
type LeafyDoc = {
  id: string;
  meta: { note: string }; // plain map — recurses
  at: Timestamp;
  loc: GeoPoint;
  ref: DocumentReference;
  bytes: Uint8Array;
  tags: string[];
  when: Date;
};

export function deepPartialPreservesLeafApis(row: DeepPartial<LeafyDoc>) {
  if (row.meta) {
    // Nested map property is optional (the whole point of DeepPartial).
    row.meta.note?.toUpperCase();
  }
  // Leaf values keep their real, callable APIs after guarding.
  if (row.at) row.at.toMillis().toFixed();
  if (row.loc) row.loc.latitude.toFixed();
  if (row.ref) row.ref.id.toUpperCase();
  if (row.bytes) row.bytes.byteLength.toFixed();
  if (row.when) row.when.getTime().toFixed();
  // Arrays are preserved whole (not element-partialized), so element access is fully typed.
  if (row.tags) row.tags[0]?.toUpperCase();
}

// The leaf test is distributive per union member: a field typed `<leaf> | <map>` preserves the leaf
// member whole and makes the map member's properties optional (rather than partializing the leaf).
type MixedDoc = {
  id: string;
  ts: Timestamp | { legacy: string };
  when: Date | { iso: string };
  bytes: Uint8Array | { raw: string };
};

export function deepPartialDistributesOverUnions(row: DeepPartial<MixedDoc>) {
  if (row.ts && 'toMillis' in row.ts) {
    row.ts.toMillis().toFixed(); // Timestamp member preserved whole (callable)
  }
  if (row.ts && 'legacy' in row.ts) {
    row.ts.legacy?.toUpperCase(); // map member's property is optional
  }
  if (row.when && 'getTime' in row.when) row.when.getTime().toFixed();
  if (row.bytes && 'byteLength' in row.bytes) row.bytes.byteLength.toFixed();
}

// `FieldPaths` recurses only into the MAP members of a mixed union — it must expose the map's nested
// field but never a leaf member's class method.
const mixedPaths: FieldPaths<MixedDoc>[] = ['id', 'ts', 'ts.legacy', 'when', 'when.iso', 'bytes'];
export const _mixedPaths = mixedPaths;

export function fieldPathsExcludesClassMethods() {
  // @ts-expect-error `toMillis` is a Timestamp method, not a queryable nested Firestore field path
  const bad: FieldPaths<MixedDoc> = 'ts.toMillis';
  return bad;
}

// `PathValue` must distribute over unions so it AGREES with `FieldPaths` (which already distributes).
// A branch-specific key resolves against the member that has it, rather than collapsing to `never`
// because `keyof` of the whole union only exposes keys common to every member. Regressions cover a
// top-level union, a leaf-or-map union, branch-specific numeric/string keys, a same-key mixed-value
// path, and optional/null members.
type UnionDoc = {
  id: string;
  ts: Timestamp | { legacy: string }; // leaf-or-map union: only the map member has `legacy`
  metric: { count: number } | { label: string }; // branch-specific numeric vs string keys
  mixed: { v: number } | { v: string }; // same key, different value type per branch
  maybe?: { n: number } | null; // optional/null members
};

// Leaf-or-map branch key resolves to the map member's value (was `never` before the fix); the
// Timestamp branch contributes nothing rather than poisoning the result.
const legacyVal: PathValue<UnionDoc, 'ts.legacy'> = 'x'; // string
// @ts-expect-error resolves to `string`, not a number (proves it is NOT `never`/`any`)
const legacyBad: PathValue<UnionDoc, 'ts.legacy'> = 123;
// Branch-specific keys each resolve to their own branch's value.
const countVal: PathValue<UnionDoc, 'metric.count'> = 1; // number
const labelVal: PathValue<UnionDoc, 'metric.label'> = 'x'; // string
// A key present in both branches with different value types resolves to the union of both.
const mixedVal: PathValue<UnionDoc, 'mixed.v'> = 1 as number | string; // number | string
// Optional/null members: `NonNullable` strips null/undefined before recursing.
const maybeVal: PathValue<UnionDoc, 'maybe.n'> = 1; // number
export const _unionPathValues = { legacyVal, legacyBad, countVal, labelVal, mixedVal, maybeVal };

// Top-level union document: a key present in only one member still resolves to that member's value.
type TopUnion = { a: number } | { b: string };
const topA: PathValue<TopUnion, 'a'> = 1; // number
const topB: PathValue<TopUnion, 'b'> = 'x'; // string
export const _topUnion = { topA, topB };

// `NumericFieldPaths` must agree with the fixed `PathValue`: only genuinely-numeric branch paths
// qualify. A branch-string path and a mixed `number | string` path must NOT (previously they leaked
// in because an unresolved `PathValue` was `never`, and `never extends number` is vacuously true).
const numericUnionPaths: NumericFieldPaths<UnionDoc>[] = ['metric.count', 'maybe.n'];
export const _numericUnionPaths = numericUnionPaths;

export function numericFieldPathsExcludesUnionStringPaths() {
  // @ts-expect-error 'metric.label' resolves to string in its branch — not numeric
  const a: NumericFieldPaths<UnionDoc> = 'metric.label';
  // @ts-expect-error 'mixed.v' resolves to number | string (mixed) — not numeric
  const b: NumericFieldPaths<UnionDoc> = 'mixed.v';
  // @ts-expect-error 'ts.legacy' resolves to string — not numeric
  const c: NumericFieldPaths<UnionDoc> = 'ts.legacy';
  return [a, b, c];
}

// Exercise the public builder (not just the helper aliases): sum()/average() must reject a
// string-valued union-branch path. This is the exact probe that failed before the fix — a branch key
// resolved to `never`, which `never extends number` wrongly classified as numeric.
const unionSchema = z.object({
  id: z.string(),
  metric: z.union([z.object({ count: z.number() }), z.object({ label: z.string() })]),
  mixed: z.union([z.object({ v: z.number() }), z.object({ v: z.string() })]),
});
const unionRepo = FirestoreRepository.withSchema(db, 'union', unionSchema);

export function numericAggregationUnionPaths() {
  unionRepo.query().sum('metric.count'); // numeric branch path
  unionRepo.query().average('metric.count');
  // @ts-expect-error 'metric.label' is a string in its branch, not numeric
  unionRepo.query().sum('metric.label');
  // @ts-expect-error 'metric.label' is a string in its branch, not numeric
  unionRepo.query().average('metric.label');
  // @ts-expect-error 'mixed.v' is number | string (mixed), not numeric
  unionRepo.query().sum('mixed.v');
}

// `NumericFieldPaths` must run its empty-value guard on the NORMALIZED (`NonNullable`) value: a field
// typed exactly `null` / `undefined` / `null | undefined` resolves to a nullish `PathValue` that only
// becomes `never` after `NonNullable`. Guarding the raw `PathValue` (round-6) let such a field slip
// past `[raw] extends [never]` and then get admitted by the vacuous `never extends number`. A
// nullable/optional NUMBER is still numeric (its non-null part is `number`); a nullable string is not.
type NullishDoc = {
  id: string;
  nil: null; // resolves to null — never numeric
  missing?: undefined; // resolves to undefined — never numeric
  both: null | undefined; // never numeric
  maybeNumber: number | null; // NonNullable => number — numeric
  optNumber?: number; // NonNullable => number — numeric
  maybeString: string | null; // NonNullable => string — not numeric
};

const numericNullishPaths: NumericFieldPaths<NullishDoc>[] = ['maybeNumber', 'optNumber'];
export const _numericNullishPaths = numericNullishPaths;

export function numericFieldPathsExcludesNullishFields() {
  // @ts-expect-error a `null` field can never hold a number
  const a: NumericFieldPaths<NullishDoc> = 'nil';
  // @ts-expect-error an `undefined` field can never hold a number
  const b: NumericFieldPaths<NullishDoc> = 'missing';
  // @ts-expect-error a `null | undefined` field can never hold a number
  const c: NumericFieldPaths<NullishDoc> = 'both';
  // @ts-expect-error a nullable string is not numeric
  const d: NumericFieldPaths<NullishDoc> = 'maybeString';
  return [a, b, c, d];
}

// Public builder: the same leak reached sum()/average() with a Firestore-valid null field.
const nullishSchema = z.object({
  id: z.string(),
  nil: z.null(),
  maybeNumber: z.number().nullable(),
  optNumber: z.number().optional(),
  maybeString: z.string().nullable(),
});
const nullishRepo = FirestoreRepository.withSchema(db, 'nullish', nullishSchema);

export function numericAggregationNullishPaths() {
  nullishRepo.query().sum('maybeNumber'); // number | null -> numeric
  nullishRepo.query().average('optNumber'); // number | undefined -> numeric
  // @ts-expect-error a `z.null()` field can never contain a number
  nullishRepo.query().sum('nil');
  // @ts-expect-error a nullable string is not numeric
  nullishRepo.query().average('maybeString');
}
