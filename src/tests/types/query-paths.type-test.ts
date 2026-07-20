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

  // Projected read: result narrows to Partial<Doc> & { id }.
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

// `DeepPartial` only recurses into plain (map) objects. Every leaf value — scalars, `Date`,
// Firestore value classes, byte values, functions, and arrays — is preserved WHOLE, so a selected
// value keeps its real API after the parent is guarded (it does not become a partialized object).
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
