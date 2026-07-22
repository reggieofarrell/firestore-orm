/**
 * Type-level tests for the v3 identity / query model (ADR-0018), checked by `npm run test:types`.
 * Each `@ts-expect-error` fails the type-check if the line below it stops being an error.
 *
 * Asserts:
 *  - schemas describe the document's own fields (no top-level `id`); `DataOf` has no `id`;
 *    `DocumentOf` adds a readonly `id`;
 *  - reads return a flat document whose `id` is present and read-only;
 *  - query FIELD PATHS derive from stored data and exclude the synthetic `id` — `where('id')` /
 *    `orderBy('id')` are compile errors; document-name queries use `whereId` / `orderById`.
 */
import { z } from 'zod';
import {
  FirestoreRepository,
  makeValidator,
  type DataOf,
  type DocumentOf,
  type ReadConverter,
  type StoredDataOf,
} from '../../index.js';

declare const db: FirebaseFirestore.Firestore;

const userSchema = z.object({
  name: z.string(),
  age: z.number(),
  tags: z.array(z.string()),
});
const users = FirestoreRepository.withSchema(db, 'users', userSchema);

// DataOf = the read data (no id). StoredDataOf defaults to it.
const _data: DataOf<typeof users> = { name: 'a', age: 1, tags: [] };
const _stored: StoredDataOf<typeof users> = { name: 'a', age: 1, tags: [] };
export const _dataStored = [_data, _stored];

export function dataHasNoId() {
  // @ts-expect-error DataOf is the read data and has no top-level `id`
  const bad: DataOf<typeof users> = { name: 'a', age: 1, tags: [], id: 'x' };
  return bad;
}

// DocumentOf adds the authoritative read-only id.
const _doc: DocumentOf<typeof users> = { id: 'u1', name: 'a', age: 1, tags: [] };
export const _docConst = _doc;

export async function reads() {
  const doc = await users.getById('u1');
  if (doc) {
    const id: string = doc.id;
    const name: string = doc.name;
    // @ts-expect-error the document `id` is read-only (authoritative from snapshot.id)
    doc.id = 'nope';
    return [id, name];
  }
  return null;
}

export async function queryFieldPaths() {
  await users.query().where('name', '==', 'a').get();
  await users.query().orderBy('age').get();
  // @ts-expect-error `id` is repository metadata, not a queryable stored field path (use whereId)
  await users.query().where('id', '==', 'u1');
  // @ts-expect-error `id` is not an orderable stored field path (use orderById)
  await users.query().orderBy('id');
}

export async function documentNameQueries() {
  // The correct way to query by the native document name.
  await users.query().whereId('==', 'u1').getOne();
  await users.query().whereId('in', ['u1', 'u2']).get();
  await users.query().orderById().get();
}

// ── whereId operand typing (A7) ────────────────────────────────────────────────────────────────
// The equality/relational overload takes a single `string`; `in`/`not-in` take a `readonly string[]`.
export async function whereIdOperandTypes() {
  await users.query().whereId('==', 'u1');
  await users.query().whereId('in', ['u1', 'u2']);
  // @ts-expect-error the equality/relational overload requires a string operand, not a number
  await users.query().whereId('==', 123);
  // @ts-expect-error the `in` overload requires a string array, not a single string
  await users.query().whereId('in', 'u1');
  // @ts-expect-error `in` requires string[]; a number[] is rejected
  await users.query().whereId('in', [1, 2]);
}

// ── A2: a raw (schema-less) repository still excludes synthetic `id` from query field paths ──────
// Even when the migrated (v2-style) stored model literally names `id`, it is repository-owned
// identity — never a queryable stored field path. This closes the raw-constructor `where('id')` leak
// across EVERY stored-field surface, not only `where`.
const rawRepo = new FirestoreRepository<{ id: string; name: string; score: number }>(db, 'raw');
export async function rawRepoHasNoIdFieldPath() {
  await rawRepo.query().where('name', '==', 'x').get();
  await rawRepo.query().orderBy('score').get();
  // @ts-expect-error `id` is synthetic identity, excluded from where() field paths even on a raw repo
  await rawRepo.query().where('id', '==', 'x');
  // @ts-expect-error `id` is not an orderable stored field path
  await rawRepo.query().orderBy('id');
  // @ts-expect-error `id` is not a selectable stored field path
  await rawRepo.query().select('id');
  // @ts-expect-error `id` is not a distinct-able stored field path
  await rawRepo.query().distinctValues('id');
  // @ts-expect-error `id` is not a numeric aggregation field path
  await rawRepo.query().sum('id');
  // @ts-expect-error `id` is not a numeric aggregation field path
  await rawRepo.query().average('id');
  // @ts-expect-error findByField cannot target the synthetic `id` (use whereId / getById)
  await rawRepo.findByField('id', 'x');
  // @ts-expect-error getOneByFieldOrThrow cannot target the synthetic `id` (the old B4 footgun)
  await rawRepo.getOneByFieldOrThrow('id', 'x');
  // The native document-name query and a real numeric aggregation still work.
  await rawRepo.query().whereId('==', 'x').get();
  await rawRepo.query().sum('score');
}

// ── A6: after-create hooks are typed by the parsed write OUTPUT, create input by the write INPUT ──
// A write overlay whose input differs from its output (a transform) makes the distinction observable:
// `create()` accepts the pre-transform INPUT, while `afterCreate` sees the parsed OUTPUT.
const orderRead = z.object({ total: z.number() });
const orderWrite = z.object({ total: z.string().transform(s => Number(s)) });
const orders = FirestoreRepository.withSchema(db, 'orders', orderRead, { writeSchema: orderWrite });
export async function writeInputVsParsedOutput() {
  // create() input is `z.input<orderWrite>`: `total` is the pre-transform string.
  await orders.create({ total: '42' });
  // @ts-expect-error create input uses z.input (pre-transform string), not the number output
  await orders.create({ total: 42 });

  orders.on('afterCreate', data => {
    const id: string = data.id;
    void id;
    // The after-create payload is the EXACT parsed output (review R4): `total` is assignable to the
    // precise `number`, not the widened `number | FieldValue` the old CreateInput helper produced.
    const asOutput: number = data.total;
    void asOutput;
    // @ts-expect-error …and it is NOT the string write input
    const asInput: string = data.total;
    void asInput;
  });

  // The bulk after-create twin carries the same exact output element type (review R4).
  orders.on('afterBulkCreate', rows => {
    const first: number = rows[0].total;
    void first;
    // @ts-expect-error bulk after-create rows are the parsed number output, not the string input
    const bad: string = rows[0].total;
    void bad;
  });
}

// ── A6 (low-level): a direct constructor + makeValidator expresses WriteInput ≠ ParsedWriteData ──
// makeValidator returns Validator<z.input<S>, z.output<S>>; the repository's 4th generic (WO) carries
// the parsed write OUTPUT. Because WO diverges from W here, the constructor REQUIRES the validator
// (review S1) — a validator is the only thing that can produce a parsed output distinct from input.
const countValidator = makeValidator(z.object({ count: z.string().transform(s => Number(s)) }));
const countRepo = new FirestoreRepository<
  { count: number }, // read model
  { count: string }, // write input (z.input)
  { count: number }, // stored model
  { count: number } // parsed write output (z.output)
>(db, 'counts', countValidator);
export async function directConstructorInputOutput() {
  // create() input is the pre-transform string.
  await countRepo.create({ count: '5' });
  // @ts-expect-error create input is the pre-transform string, not the number output
  await countRepo.create({ count: 5 });

  countRepo.on('afterCreate', data => {
    // Exact parsed output on the low-level path too (review R4).
    const asOutput: number = data.count;
    void asOutput;
    // @ts-expect-error after-create observes the parsed number output, not the string write input
    const asInput: string = data.count;
    void asInput;
  });
}

// ── S2/T1: makeValidator's custom update schema must be input/output-compatible with the create schema ──
// The repository has a single write shape, so an update schema whose INPUT or OUTPUT diverges from the
// create schema (and which no repository could honestly attach) is rejected at makeValidator; a
// field-restricting (`.pick`) or coercion-compatible one is accepted.
const compatCreate = z.object({ name: z.string(), score: z.number() });
export function makeValidatorUpdateSchema() {
  // Compatible: a field-restricting update schema (narrows WHICH fields, not their types) is allowed.
  const okPick = makeValidator(compatCreate, compatCreate.pick({ name: true }));
  void okPick;

  // Compatible: a coercion whose input accepts the shared numeric input and whose output is `number`.
  const okCoerce = makeValidator(
    z.object({ score: z.number() }),
    z.object({ score: z.coerce.number() }),
  );
  void okCoerce;

  // @ts-expect-error INPUT-divergent: update input `string` cannot accept the shared `number` input (T1)
  makeValidator(z.object({ score: z.number() }), z.object({ score: z.string().transform(Number) }));

  // @ts-expect-error OUTPUT-divergent: update output `string` is not assignable to the create output
  makeValidator(z.object({ score: z.number() }), z.object({ score: z.string() }));
}

// ── R5: DataOf / StoredDataOf strip the synthetic `id`, even for a legacy raw repository ──────────
export function extractionHelpersOmitId() {
  const data: DataOf<typeof rawRepo> = { name: 'a', score: 1 };
  const stored: StoredDataOf<typeof rawRepo> = { name: 'a', score: 1 };
  void data;
  void stored;
  // @ts-expect-error DataOf drops the synthetic `id` even when the raw generic still declares it
  const badData: DataOf<typeof rawRepo> = { id: 'x', name: 'a', score: 1 };
  void badData;
  // @ts-expect-error StoredDataOf drops the synthetic `id` even when the raw generic declares it
  const badStored: StoredDataOf<typeof rawRepo> = { id: 'x', name: 'a', score: 1 };
  void badStored;
}

// ── A3: a readConverter REQUIRES a storedSchema (overload 2); omitting it is a compile error ──────
const convertedRead = z.object({ at: z.number() });
const convertedStored = z.object({ at: z.number() });
const readAt: ReadConverter<z.output<typeof convertedRead>> = snapshot =>
  snapshot.data() as { at: number };
export function converterRequiresStoredSchema() {
  // With a storedSchema present, the converter overload resolves.
  FirestoreRepository.withSchema(db, 'converted', convertedRead, {
    readConverter: readAt,
    storedSchema: convertedStored,
  });
  // @ts-expect-error a readConverter requires a storedSchema (overload 2) — omitting it is an error
  FirestoreRepository.withSchema(db, 'converted', convertedRead, { readConverter: readAt });
}

// ── A9: distinctValues keys derive from the READ model and exclude the synthetic `id` ────────────
export async function distinctValuesKeys() {
  // A real stored field resolves to its value type.
  const names: string[] = await users.query().distinctValues('name');
  const tags: string[][] = await users.query().distinctValues('tags');
  // @ts-expect-error `id` is repository metadata, not a distinct-able stored field
  await users.query().distinctValues('id');
  return [names, tags];
}

// ── R9: subcollection mirrors withSchema — a readConverter requires a storedSchema there too ─────
const subRead = z.object({ total: z.number() });
const subStored = z.object({ total: z.number() });
const subConv: ReadConverter<z.output<typeof subRead>> = snapshot =>
  snapshot.data() as { total: number };
export function subcollectionConverterRequiresStoredSchema() {
  // With a storedSchema present, the subcollection converter overload resolves.
  users.subcollection('u1', 'orders', subRead, { readConverter: subConv, storedSchema: subStored });
  // @ts-expect-error a readConverter on a subcollection requires a storedSchema too
  users.subcollection('u1', 'orders', subRead, { readConverter: subConv });
}

// ── S1: a schema-less repository cannot promise a parsed output (WO) no parser produces ──────────
export function schemaLessCannotDivergeParsedOutput() {
  // raw() no longer exposes an independent parsed-output generic (only T, W, S) — a 4th type arg is
  // an error, so the parsed output is pinned to W (short literal types keep the error on this line).
  // @ts-expect-error raw() takes at most 3 type arguments; the parsed output is pinned to W
  FirestoreRepository.raw<{ a: 1 }, { a: 1 }, { a: 1 }, { a: 2 }>(db, 'raw-probe');

  // The positional constructor REQUIRES a validator when WO diverges from W (only a parser can
  // produce a distinct parsed output). No validator + divergent WO is a compile error.
  // @ts-expect-error WO ({a:2}) diverges from W ({a:1}) with no validator supplied
  new FirestoreRepository<{ a: 1 }, { a: 1 }, { a: 1 }, { a: 2 }>(db, 'ctor-probe');

  // WO === W needs no validator — the common schema-less construction still works with 2 args.
  const ok = new FirestoreRepository<{ score: string }>(db, 'ok-probe');
  const okRaw = FirestoreRepository.raw<{ score: string }>(db, 'ok-raw');
  return [ok, okRaw];
}

// ── S3: beforeBulkUpdate `data` is readonly — in-place field mutation OK, replacement rejected ───
export function bulkUpdateDataReplacementRejected() {
  users.on('beforeBulkUpdate', entries => {
    // In-place field mutation is the supported contract.
    entries[0].data.name = 'renamed';
    // @ts-expect-error the whole `data` object cannot be REPLACED (readonly — review S3)
    entries[0].data = { name: 'y' };
    // @ts-expect-error the entry `id` cannot be reassigned
    entries[0].id = 'z';
    // @ts-expect-error the entries array is readonly (no reorder/splice/replace)
    entries[0] = { id: 'z', data: {} };
  });
}
