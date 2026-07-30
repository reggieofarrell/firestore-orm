/**
 * Type-level tests for opt-in write metadata (`{ withMetadata: true }`) on non-transactional
 * repository writes (issue #72), checked by `npm run test:types` via tsc (NOT jest). This file is
 * never executed.
 *
 * Each `@ts-expect-error` FAILS the type-check if the line below it stops being an error; every
 * un-annotated call must type-check. Prefer `ExpectEqual` over bare assignability so a widened
 * return type does not silently pass.
 *
 * Coverage map (plan §8.1):
 *  - T-1: direct + fixed-batch `{ withMetadata: true }` enrichments; `writeTime` is Timestamp
 *  - T-2: default/false keep legacy shapes; `{ returnDoc: true, withMetadata: true }` is an error
 *  - T-3: every transaction helper rejects `withMetadata`
 *  - T-4: root import of `WriteMetadata` / `WriteResultWithMetadata` compiles
 */
import { z } from 'zod';
import { FirestoreRepository } from '../../index.js';
import type { FirestoreDocument, WriteMetadata, WriteResultWithMetadata } from '../../index.js';

/** Structural equality: fails when A is wider or narrower than B. */
type ExpectEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertTrue<T extends true> = T;

declare const db: FirebaseFirestore.Firestore;
declare const tx: FirebaseFirestore.Transaction;

const userSchema = z.object({
  name: z.string(),
  age: z.number(),
});
type User = z.infer<typeof userSchema>;
const repo = FirestoreRepository.withSchema(db, 'users', userSchema);

// ---------------------------------------------------------------------------
// T-4 — root type exports are nameable from the package entry
// ---------------------------------------------------------------------------

export type _RootWriteMetadata = WriteMetadata;
export type _RootWriteResultWithMetadata = WriteResultWithMetadata<{ id: string }>;

// ---------------------------------------------------------------------------
// T-1 — withMetadata: true resolves to enriched receipts
// ---------------------------------------------------------------------------

export async function createWithMetadataIsIdAndWriteTime() {
  const row = await repo.create({ name: 'a', age: 1 }, { withMetadata: true });
  type _ = AssertTrue<ExpectEqual<typeof row, WriteResultWithMetadata<{ id: string }>>>;
  const writeTime: FirebaseFirestore.Timestamp = row.writeTime;
  void writeTime;
  return row;
}

export async function createWithIdWithMetadataIsIdAndWriteTime() {
  const row = await repo.createWithId('u1', { name: 'a', age: 1 }, { withMetadata: true });
  type _ = AssertTrue<ExpectEqual<typeof row, WriteResultWithMetadata<{ id: string }>>>;
  return row;
}

export async function updatePatchUpsertWithMetadata() {
  const u = await repo.update('u1', { name: 'b' }, { withMetadata: true });
  type _u = AssertTrue<ExpectEqual<typeof u, WriteResultWithMetadata<{ id: string }>>>;
  const p = await repo.patch('u1', { name: 'c' }, { withMetadata: true });
  type _p = AssertTrue<ExpectEqual<typeof p, WriteResultWithMetadata<{ id: string }>>>;
  const s = await repo.upsert('u1', { name: 'd', age: 2 }, { withMetadata: true });
  type _s = AssertTrue<ExpectEqual<typeof s, WriteResultWithMetadata<{ id: string }>>>;
  return [u, p, s] as const;
}

export async function deleteWithMetadataIsWriteMetadata() {
  const meta = await repo.delete('u1', { withMetadata: true });
  type _ = AssertTrue<ExpectEqual<typeof meta, WriteMetadata>>;
  return meta;
}

export async function fixedBatchWithMetadataIsPositional() {
  const created = await repo.bulkCreate([{ name: 'a', age: 1 }], { withMetadata: true });
  type _c = AssertTrue<ExpectEqual<typeof created, WriteResultWithMetadata<{ id: string }>[]>>;
  const createdIds = await repo.bulkCreateWithIds([{ id: 'u1', data: { name: 'a', age: 1 } }], {
    withMetadata: true,
  });
  type _i = AssertTrue<ExpectEqual<typeof createdIds, WriteResultWithMetadata<{ id: string }>[]>>;
  const updated = await repo.bulkUpdate([{ id: 'u1', data: { name: 'b' } }], {
    withMetadata: true,
  });
  type _u = AssertTrue<ExpectEqual<typeof updated, WriteResultWithMetadata<{ id: string }>[]>>;
  const patched = await repo.bulkPatch([{ id: 'u1', data: { name: 'c' } }], {
    withMetadata: true,
  });
  type _p = AssertTrue<ExpectEqual<typeof patched, WriteResultWithMetadata<{ id: string }>[]>>;
  const deleted = await repo.bulkDelete(['u1'], { withMetadata: true });
  type _d = AssertTrue<
    ExpectEqual<typeof deleted, { count: number; writeTimes: FirebaseFirestore.Timestamp[] }>
  >;
  return [created, createdIds, updated, patched, deleted] as const;
}

// ---------------------------------------------------------------------------
// T-2 — defaults unchanged; returnDoc + withMetadata rejected
// ---------------------------------------------------------------------------

export async function defaultsRetainLegacyShapes() {
  const c = await repo.create({ name: 'a', age: 1 });
  type _c = AssertTrue<ExpectEqual<typeof c, { id: string }>>;
  const cf = await repo.create({ name: 'a', age: 1 }, { withMetadata: false });
  type _cf = AssertTrue<ExpectEqual<typeof cf, { id: string }>>;
  const doc = await repo.create({ name: 'a', age: 1 }, { returnDoc: true });
  type _doc = AssertTrue<ExpectEqual<typeof doc, FirestoreDocument<User>>>;
  const d = await repo.delete('u1');
  type _d = AssertTrue<ExpectEqual<typeof d, void>>;
  const bd = await repo.bulkDelete(['u1']);
  type _bd = AssertTrue<ExpectEqual<typeof bd, number>>;
  return [c, cf, doc, d, bd] as const;
}

export async function returnDocPlusWithMetadataIsError() {
  // @ts-expect-error returnDoc and withMetadata are mutually exclusive
  await repo.create({ name: 'a', age: 1 }, { returnDoc: true, withMetadata: true });
  // @ts-expect-error returnDoc and withMetadata are mutually exclusive
  await repo.createWithId('u1', { name: 'a', age: 1 }, { returnDoc: true, withMetadata: true });
  // @ts-expect-error returnDoc and withMetadata are mutually exclusive
  await repo.update('u1', { name: 'b' }, { returnDoc: true, withMetadata: true });
  // @ts-expect-error returnDoc and withMetadata are mutually exclusive
  await repo.patch('u1', { name: 'b' }, { returnDoc: true, withMetadata: true });
  // @ts-expect-error returnDoc and withMetadata are mutually exclusive
  await repo.upsert('u1', { name: 'b', age: 2 }, { returnDoc: true, withMetadata: true });
  // @ts-expect-error returnDoc and withMetadata are mutually exclusive
  await repo.bulkCreate([{ name: 'a', age: 1 }], { returnDoc: true, withMetadata: true });
}

// ---------------------------------------------------------------------------
// T-3 — transaction helpers reject withMetadata
// ---------------------------------------------------------------------------

export async function transactionHelpersRejectWithMetadata() {
  // @ts-expect-error withMetadata is not a createInTransaction option
  await repo.createInTransaction(tx, { name: 'a', age: 1 }, { withMetadata: true });
  // @ts-expect-error withMetadata is not a createWithIdInTransaction option
  await repo.createWithIdInTransaction(tx, 'u1', { name: 'a', age: 1 }, { withMetadata: true });
  // @ts-expect-error withMetadata is not an updateInTransaction option
  await repo.updateInTransaction(tx, 'u1', { name: 'b' }, { withMetadata: true });
  // @ts-expect-error withMetadata is not a patchInTransaction option
  await repo.patchInTransaction(tx, 'u1', { name: 'b' }, { withMetadata: true });
  // @ts-expect-error withMetadata is not a deleteInTransaction option
  await repo.deleteInTransaction(tx, 'u1', { withMetadata: true });
}
