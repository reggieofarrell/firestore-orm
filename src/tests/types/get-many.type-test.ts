/**
 * Type-level tests for `getMany` / `getManyInTransaction` (issue #35), checked by
 * `npm run test:types` via tsc (NOT jest). This file is never executed.
 *
 * The contract this pins:
 *  - Unmasked calls return `(FirestoreDocument<T> | null)[]`; after a null guard, required fields
 *    stay required and `id` is `string` (T-1).
 *  - Masked calls narrow to `FirestoreDocument<DeepPartial<T>>`; assigning a projected field to a
 *    required `string` is an error until the caller guards optionality; `id` always survives (T-2).
 *  - On an `S !== T` repo, the *same* masked `getManyInTransaction` call compiles through BOTH
 *    `runInTransaction(…, { readOnly: true })` AND `runReadOnlyAt` — the T5 regression that the
 *    prototype hit when only one signature carried `S` (T-3).
 *  - A variable-typed optional-mask options object matches neither overload (T9 / T-4), matching
 *    the established `create(data, options)` wart.
 *  - Mask negatives reject typos and `'id'`; positives accept `[]`, `FieldPath`, and dotted paths
 *    (T-5). `getMany(ids, {})` resolves to the full-model overload (T-6 / T8).
 *  - Non-transactional `getMany` is ABSENT from the read-only callback surface (T-7 / T11).
 *  - ADR-0028 union distribution: variant-only mask paths compile; discriminant narrowing survives
 *    on unmasked results (T-8).
 *  - The vector wrapper proxies `getMany` with identical typing (T-9).
 *  - `ReadOnlyTransactionalRepository<User>` (one type argument) still compiles (T-10).
 *
 * Each `@ts-expect-error` FAILS the type-check if the line below it stops being an error; every
 * un-annotated call must type-check.
 */
import { z } from 'zod';
import { FieldPath } from 'firebase-admin/firestore';
import { FirestoreRepository } from '../../index.js';
import type { FirestoreDocument, ReadOnlyTransactionalRepository } from '../../index.js';
import { withVectorSearch } from '../../vector/index.js';

declare const db: FirebaseFirestore.Firestore;
declare const tx: FirebaseFirestore.Transaction;
declare const readTime: FirebaseFirestore.Timestamp;
declare const ids: string[];

const userSchema = z.object({
  name: z.string(),
  score: z.number(),
  address: z.object({ city: z.string(), zip: z.string() }),
});
type User = z.infer<typeof userSchema>;
const repo = FirestoreRepository.withSchema(db, 'users', userSchema);

// ---------------------------------------------------------------------------
// T-1 — unmasked → full model; null guard unlocks required fields
// ---------------------------------------------------------------------------

export async function t1_unmaskedFullModel() {
  const rows: (FirestoreDocument<User> | null)[] = await repo.getMany(ids);
  const first = rows[0];
  if (!first) throw new Error('missing');
  // After the null guard, required fields are required (not optional).
  const name: string = first.name;
  const city: string = first.address.city;
  const id: string = first.id;
  return [name, city, id] as const;
}

// ---------------------------------------------------------------------------
// T-2 — masked → DeepPartial narrowing; id survives
// ---------------------------------------------------------------------------

export async function t2_maskedDeepPartial() {
  const masked = await repo.getMany(ids, { fieldMask: ['name', 'address.city'] });
  const row = masked[0];
  if (!row) throw new Error('missing');
  // id is intersected outside DeepPartial — always a required string.
  const id: string = row.id;
  // Projected fields are optional under DeepPartial.
  const nameOpt: string | undefined = row.name;
  // @ts-expect-error projected result is DeepPartial — name is not a required string
  const n: string = row.name;
  // @ts-expect-error nested map is optional after projection — city is not a required string
  const city: string = row.address.city;
  // Guarded forms compile.
  const guardedName: string | undefined = row.name;
  const guardedCity: string | undefined = row.address?.city;
  return [id, nameOpt, n, city, guardedName, guardedCity] as const;
}

// ---------------------------------------------------------------------------
// T-3 — T5 regression: BOTH RO entry points type mask paths against S
// ---------------------------------------------------------------------------

const storedSchema = z.object({ name: z.string(), score: z.number(), raw: z.string() });
const divergent = FirestoreRepository.withSchema(db, 'divergent', userSchema, {
  storedSchema,
});

export async function t3_runInTransactionRoUsesStoredModel() {
  return divergent.runInTransaction(
    async (t, r) => r.getManyInTransaction(t, ids, { fieldMask: ['raw'] }),
    { readOnly: true },
  );
}

export async function t3_runReadOnlyAtUsesStoredModel() {
  // Identical call, same repo — must agree with the runInTransaction RO overload above.
  // Reverting runReadOnlyAt's callback type to <T> (without S) fails this with TS2769.
  return divergent.runReadOnlyAt(readTime, async (t, r) =>
    r.getManyInTransaction(t, ids, { fieldMask: ['raw'] }),
  );
}

export async function t3_readModelOnlyPathRejectedOnDivergent() {
  // @ts-expect-error address.city is on the read model, not the stored model
  await divergent.getMany(ids, { fieldMask: ['address.city'] });
}

// ---------------------------------------------------------------------------
// T-4 — T9 precedent: variable-typed optional mask matches neither overload
// ---------------------------------------------------------------------------

export async function t4_dynamicOptionalMaskRejected() {
  const dynamicOpts: { fieldMask?: string[] } = { fieldMask: ['name'] };
  // @ts-expect-error optional-mask variable matches neither getMany overload (safe wart)
  await repo.getMany(ids, dynamicOpts);

  // Matching precedent on create(data, options) — prove the wart is pre-existing, not unique to getMany.
  const createOpts: { returnDoc?: boolean } = { returnDoc: true };
  // @ts-expect-error optional-options variable matches neither create overload (same safe wart)
  await repo.create({ name: 'x', score: 1, address: { city: 'a', zip: '1' } }, createOpts);
}

// ---------------------------------------------------------------------------
// T-5 — mask negatives / positives
// ---------------------------------------------------------------------------

export async function t5_maskNegativesAndPositives() {
  // @ts-expect-error typo path is not a FieldPaths member
  await repo.getMany(ids, { fieldMask: ['nombre'] });
  // @ts-expect-error `id` is repository metadata, not a stored path
  await repo.getMany(ids, { fieldMask: ['id'] });

  // Positives: empty mask (ID-only), FieldPath instance, dotted path.
  await repo.getMany(ids, { fieldMask: [] });
  await repo.getMany(ids, { fieldMask: [new FieldPath('address', 'city')] });
  await repo.getMany(ids, { fieldMask: ['address.city'] });
}

// ---------------------------------------------------------------------------
// T-6 — empty options object resolves to the FULL-model overload (T8)
// ---------------------------------------------------------------------------

export async function t6_emptyOptionsIsFullModel() {
  const rows = await repo.getMany(ids, {});
  const first = rows[0];
  if (!first) throw new Error('missing');
  // If the masked overload had been selected, `name` would be `string | undefined`.
  const name: string = first.name;
  return name;
}

// ---------------------------------------------------------------------------
// T-7 — getMany absent from the read-only callback surface (T11)
// ---------------------------------------------------------------------------

export async function t7_getManyAbsentFromReadOnlySurface() {
  await repo.runInTransaction(
    async (t, r) => {
      // Allowed: transaction-scoped batch read.
      await r.getManyInTransaction(t, ids);
      // @ts-expect-error non-transactional getMany is absent from the read-only surface
      await r.getMany(ids);
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// T-8 — ADR-0028 union distribution
// ---------------------------------------------------------------------------

type UnionModel = { kind: 'a'; onlyOnA: string } | { kind: 'b'; onlyOnB: number };
const unionRepo = new FirestoreRepository<UnionModel, UnionModel, UnionModel, UnionModel>(
  db,
  'unions',
);

export async function t8_unionMaskPathsDistribute() {
  await unionRepo.getMany(ids, { fieldMask: ['onlyOnA'] });
  await unionRepo.getMany(ids, { fieldMask: ['onlyOnB'] });
  const rows = await unionRepo.getMany(ids);
  const first = rows[0];
  if (first && first.kind === 'a') {
    const s: string = first.onlyOnA;
    return s;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// T-9 — vector wrapper proxies getMany with identical typing
// ---------------------------------------------------------------------------

export async function t9_vectorWrapperProxiesGetMany() {
  const wrapped = withVectorSearch(repo);
  const rows: (FirestoreDocument<User> | null)[] = await wrapped.getMany(ids);
  const masked = await wrapped.getMany(ids, { fieldMask: ['name'] });
  const m = masked[0];
  if (!m) throw new Error('missing');
  const id: string = m.id;
  const nameOpt: string | undefined = m.name;
  // @ts-expect-error projected result through the vector wrapper is still DeepPartial
  const n: string = m.name;
  return [rows, id, nameOpt, n] as const;
}

// ---------------------------------------------------------------------------
// T-10 — back-compat: one-argument ReadOnlyTransactionalRepository still compiles
// ---------------------------------------------------------------------------

export type LegacyRo = ReadOnlyTransactionalRepository<User>;
export declare const legacy: LegacyRo;

export async function t10_legacyOneArgRoStillUsable() {
  return legacy.getManyInTransaction(tx, ids);
}
