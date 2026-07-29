/**
 * Type-level tests for opt-in snapshot metadata + detailed listeners (issue #39), checked by
 * `npm run test:types` via tsc (NOT jest). This file is never executed.
 *
 * Ports the assertion probe at
 * `docs/plans/issue-39-snapshot-metadata-detailed-listener/probes/p3-overload-resolution.type-probe.ts`
 * onto the real `FirestoreRepository` / `FirestoreQueryBuilder` / collection-group builder, and adds
 * the §8 rows for `stream`, `paginateWithCount`, collection-group inheritance, and
 * `DetailedQuerySnapshot` change types.
 *
 * Each `@ts-expect-error` FAILS the type-check if the line below it stops being an error; every
 * un-annotated call must type-check. Prefer `ExpectEqual` over bare assignability so a widened
 * return type (wrapper | bare) does not silently pass.
 */
import { z } from 'zod';
import { FirestoreRepository } from '../../index.js';
import type {
  CollectionGroupDocument,
  DetailedQuerySnapshot,
  FirestoreDocument,
  WithMetadata,
} from '../../index.js';

/** Structural equality: fails when A is wider or narrower than B. */
type ExpectEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertTrue<T extends true> = T;

declare const db: FirebaseFirestore.Firestore;
declare const dynamicFlag: boolean;

const userSchema = z.object({
  name: z.string(),
  age: z.number(),
});
type User = z.infer<typeof userSchema>;
const repo = FirestoreRepository.withSchema(db, 'users', userSchema);
const group = repo.collectionGroup();

// ---------------------------------------------------------------------------
// V1 / V4 / V2 / V3 / V5 / V7 — getById overload resolution
// ---------------------------------------------------------------------------

export async function getByIdDefaultIsBareDocument() {
  const a = await repo.getById('x');
  type _ = AssertTrue<ExpectEqual<typeof a, FirestoreDocument<User> | null>>;
  const b = await repo.getById('x', { withMetadata: false });
  type __ = AssertTrue<ExpectEqual<typeof b, FirestoreDocument<User> | null>>;
  return [a, b] as const;
}

export async function getByIdWithMetadataTrueIsWrapper() {
  const row = await repo.getById('x', { withMetadata: true });
  type _ = AssertTrue<ExpectEqual<typeof row, WithMetadata<FirestoreDocument<User>> | null>>;
  return row;
}

export async function getByIdWidenedBooleanIsError() {
  // @ts-expect-error withMetadata: boolean is not assignable to `true` or `false | undefined`
  await repo.getById('x', { withMetadata: dynamicFlag });
}

export async function getByIdHoistedOptionsObjectIsError() {
  const opts = { withMetadata: true };
  // @ts-expect-error `{ withMetadata: boolean }` — inference widened the literal
  await repo.getById('x', opts);
}

export async function getByIdTypoFlagIsError() {
  // @ts-expect-error 'withMetaData' is not a known property
  await repo.getById('x', { withMetaData: true });
}

export async function getByIdWrapperNotAssignableToBareDocument() {
  // @ts-expect-error WithMetadata<FirestoreDocument<User>> is not a FirestoreDocument<User>
  const _e7: FirestoreDocument<User> | null = await repo.getById('x', { withMetadata: true });
  return _e7;
}

export async function getByIdAsConstHoistedOptionsCompiles() {
  const optsConst = { withMetadata: true } as const;
  const d = await repo.getById('x', optsConst);
  type _ = AssertTrue<ExpectEqual<typeof d, WithMetadata<FirestoreDocument<User>> | null>>;
  return d;
}

// ---------------------------------------------------------------------------
// V6 — getMany 2×2 matrix (T3)
// ---------------------------------------------------------------------------

export async function getManyFourCellsResolveDistinctly() {
  const m1 = await repo.getMany(['a']);
  type _1 = AssertTrue<ExpectEqual<typeof m1, (FirestoreDocument<User> | null)[]>>;

  const m2 = await repo.getMany(['a'], { withMetadata: true });
  type _2 = AssertTrue<ExpectEqual<typeof m2, (WithMetadata<FirestoreDocument<User>> | null)[]>>;

  const m3 = await repo.getMany(['a'], { fieldMask: ['name'] });
  type _3 = AssertTrue<
    ExpectEqual<typeof m3, (FirestoreDocument<Partial<User> & { id: string }> | null)[]>
  >;
  // DeepPartial may be wider than Partial — pin that name is optional after mask:
  const row3 = m3[0];
  if (row3) {
    const nameOpt: string | undefined = row3.name;
    void nameOpt;
  }

  const m4 = await repo.getMany(['a'], { fieldMask: ['name'], withMetadata: true });
  type _4 = AssertTrue<
    ExpectEqual<
      typeof m4,
      (WithMetadata<FirestoreDocument<Partial<User> & { id: string }>> | null)[]
    >
  >;
  // The load-bearing cell: metadata is nameable on the masked+metadata result.
  const row4 = m4[0];
  if (row4) {
    const createTime: FirebaseFirestore.Timestamp = row4.metadata.createTime;
    const nameOpt: string | undefined = row4.doc.name;
    void [createTime, nameOpt];
  }

  return [m1, m2, m3, m4] as const;
}

// ---------------------------------------------------------------------------
// stream / paginateWithCount / collection-group / DetailedQuerySnapshot
// ---------------------------------------------------------------------------

export async function getByIdOrThrowWithMetadataIsWrapper() {
  const row = await repo.getByIdOrThrow('x', { withMetadata: true });
  type _ = AssertTrue<ExpectEqual<typeof row, WithMetadata<FirestoreDocument<User>>>>;
  return row;
}

export async function getOneWithMetadataIsWrapper() {
  const row = await repo.query().where('name', '==', 'x').getOne({ withMetadata: true });
  type _ = AssertTrue<ExpectEqual<typeof row, WithMetadata<FirestoreDocument<User>> | null>>;
  if (row) {
    const readTime: FirebaseFirestore.Timestamp = row.metadata.readTime;
    void readTime;
  }
  return row;
}

export async function streamWithMetadataYieldsWrapper() {
  const gen = repo.query().stream({ withMetadata: true });
  type _ = AssertTrue<
    ExpectEqual<typeof gen, AsyncGenerator<WithMetadata<FirestoreDocument<User>>>>
  >;
  return gen;
}

export async function paginateWithCountMetadataItemsNameable() {
  const page = await repo
    .query()
    .orderBy('name')
    .paginateWithCount(2, null, { withMetadata: true });
  const first = page.items[0];
  if (first) {
    const readTime: FirebaseFirestore.Timestamp = first.metadata.readTime;
    const name: string = first.doc.name;
    void [readTime, name];
  }
  return page;
}

export async function collectionGroupGetWithMetadataCarriesPath() {
  const rows = await group.query().get({ withMetadata: true });
  type _ = AssertTrue<ExpectEqual<typeof rows, WithMetadata<CollectionGroupDocument<User>>[]>>;
  const row = rows[0];
  if (row) {
    const path: string = row.doc.path;
    const metaPath: string = row.metadata.path;
    void [path, metaPath];
  }
  return rows;
}

export function detailedQuerySnapshotChangeTypes() {
  type ChangeType = DetailedQuerySnapshot<FirestoreDocument<User>>['changes'][number]['type'];
  const added: ChangeType = 'added';
  const modified: ChangeType = 'modified';
  const removed: ChangeType = 'removed';
  // @ts-expect-error 'upserted' is not a DocumentChangeType
  const bad: ChangeType = 'upserted';
  void [added, modified, removed, bad];
}
