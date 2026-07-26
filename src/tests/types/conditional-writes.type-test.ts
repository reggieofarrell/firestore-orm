/**
 * Type-level tests for conditional writes (issue #33), checked by `npm run test:types` via tsc
 * (NOT jest). This file is never executed.
 *
 * The contract this pins:
 *  - The four new members (`createWithId`, `bulkCreateWithIds`, `createWithIdInTransaction`,
 *    `getByIdWithUpdateTime`) are ABSENT from a `{ readOnly: true }` callback repo. The first three
 *    are writes; the fourth does NON-transactional I/O, which bypasses both the transaction and any
 *    `readTime` — exactly the footgun ADR-0025's membership rule excludes. Adding any of them to
 *    `ReadOnlyTransactionalRepository` breaks these four guards.
 *  - `getByIdWithUpdateTime` returns a nullable PAIR: `.doc` / `.updateTime` are unreachable until
 *    the caller narrows null. The pair shape (not a flat overlay) is deliberate — a flat
 *    `FirestoreDocument<T> & { updateTime }` would shadow a stored field named `updateTime`, the
 *    collision ADR-0018 avoids for `id`.
 *  - `lastUpdateTime` is a `FirebaseFirestore.Timestamp` on every surface that accepts it; a `Date`
 *    or a `number` is rejected at compile time (the Admin SDK rejects them at runtime, so catching
 *    it here is strictly better).
 *  - `bulkDelete` keeps BOTH overloads — the legacy `ID[]` form and the new entry form — while a
 *    mixed `['a', { id: 'b' }]` array matches neither.
 *  - `createWithId` rejects a dotted key at the type level via `CreateInput<W>`.
 *  - The D1 read-modify-write flow type-checks verbatim, exactly as the docs show it.
 *
 * Each `@ts-expect-error` FAILS the type-check if the line below it stops being an error; every
 * un-annotated call must type-check.
 */
import { z } from 'zod';
import { FirestoreRepository, PreconditionFailedError } from '../../index.js';

declare const db: FirebaseFirestore.Firestore;
declare const updateTime: FirebaseFirestore.Timestamp;

const userSchema = z.object({
  name: z.string(),
  status: z.string(),
  balance: z.number(),
});
const users = FirestoreRepository.withSchema(db, 'users', userSchema);

const profileSchema = z.object({
  name: z.string(),
  address: z.object({ city: z.string() }),
});
const profiles = FirestoreRepository.withSchema(db, 'profiles', profileSchema);

// ---------------------------------------------------------------------------
// ReadOnlyTransactionalRepository gained nothing (ADR-0025 D3 membership rule)
// ---------------------------------------------------------------------------

export async function readOnlyCallbackExcludesConditionalWriteMembers() {
  await users.runInTransaction(
    async (tx, repo) => {
      // @ts-expect-error createWithId is a write — absent from the read-only type
      await repo.createWithId('u1', { name: 'x', status: 'a', balance: 0 });
      // @ts-expect-error bulkCreateWithIds is a write — absent from the read-only type
      await repo.bulkCreateWithIds([{ id: 'u1', data: { name: 'x', status: 'a', balance: 0 } }]);
      // @ts-expect-error createWithIdInTransaction is a write — absent from the read-only type
      await repo.createWithIdInTransaction(tx, 'u1', { name: 'x', status: 'a', balance: 0 });
      // @ts-expect-error getByIdWithUpdateTime does non-transactional I/O — bypasses tx and readTime
      await repo.getByIdWithUpdateTime('u1');
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// getByIdWithUpdateTime — nullable pair, narrowed before use
// ---------------------------------------------------------------------------

export async function getByIdWithUpdateTimeRequiresNullCheck() {
  const current = await users.getByIdWithUpdateTime('u1');
  // @ts-expect-error result may be null — narrow before reading `doc`
  const _doc = current.doc;
  // @ts-expect-error result may be null — narrow before reading `updateTime`
  const _token = current.updateTime;
  return [_doc, _token] as const;
}

export async function getByIdWithUpdateTimeNarrowsToThePair() {
  const current = await users.getByIdWithUpdateTime('u1');
  if (!current) return null;

  // `doc` is the ordinary read model with the id overlay; `updateTime` is a Timestamp.
  const name: string = current.doc.name;
  const id: string = current.doc.id;
  const token: FirebaseFirestore.Timestamp = current.updateTime;

  // @ts-expect-error `updateTime` lives on the pair, not on the document — the shapes stay separate
  const _shadowed = current.doc.updateTime;

  return [name, id, token, _shadowed] as const;
}

// ---------------------------------------------------------------------------
// lastUpdateTime must be a Timestamp, on every surface
// ---------------------------------------------------------------------------

export async function lastUpdateTimeAcceptsATimestamp() {
  await users.update('u1', { balance: 1 }, { lastUpdateTime: updateTime });
  await users.patch('u1', { balance: 1 }, { lastUpdateTime: updateTime });
  await users.delete('u1', { lastUpdateTime: updateTime });
  await users.bulkUpdate([{ id: 'u1', data: { balance: 1 }, lastUpdateTime: updateTime }]);
  await users.bulkPatch([{ id: 'u1', data: { balance: 1 }, lastUpdateTime: updateTime }]);
  await users.bulkDelete([{ id: 'u1', lastUpdateTime: updateTime }]);
  await users.runInTransaction(async (tx, repo) => {
    await repo.updateInTransaction(tx, 'u1', { balance: 1 }, { lastUpdateTime: updateTime });
    await repo.patchInTransaction(tx, 'u1', { balance: 1 }, { lastUpdateTime: updateTime });
    await repo.deleteInTransaction(tx, 'u1', { lastUpdateTime: updateTime });
  });
}

export async function lastUpdateTimeRejectsADate() {
  // @ts-expect-error a Date is not a FirebaseFirestore.Timestamp (the SDK rejects it at runtime)
  await users.update('u1', { balance: 1 }, { lastUpdateTime: new Date() });
  // @ts-expect-error a Date is not a FirebaseFirestore.Timestamp
  await users.delete('u1', { lastUpdateTime: new Date() });
  // @ts-expect-error a Date is not a FirebaseFirestore.Timestamp
  await users.bulkDelete([{ id: 'u1', lastUpdateTime: new Date() }]);
}

export async function lastUpdateTimeRejectsANumber() {
  // @ts-expect-error epoch millis are not a FirebaseFirestore.Timestamp
  await users.update('u1', { balance: 1 }, { lastUpdateTime: 1700000000000 });
  // @ts-expect-error epoch millis are not a FirebaseFirestore.Timestamp
  await users.patch('u1', { balance: 1 }, { lastUpdateTime: 1700000000000 });
  // @ts-expect-error epoch millis are not a FirebaseFirestore.Timestamp
  await users.bulkUpdate([{ id: 'u1', data: { balance: 1 }, lastUpdateTime: 1700000000000 }]);
}

// ---------------------------------------------------------------------------
// bulkDelete — both overloads, no mixing
// ---------------------------------------------------------------------------

export async function bulkDeleteAcceptsBothOverloads() {
  const fromIds: number = await users.bulkDelete(['a', 'b']);
  const fromEntries: number = await users.bulkDelete([{ id: 'a', lastUpdateTime: updateTime }]);
  // An entry array with no preconditions at all is still the entry overload.
  const fromBareEntries: number = await users.bulkDelete([{ id: 'a' }, { id: 'b' }]);
  return [fromIds, fromEntries, fromBareEntries] as const;
}

export async function bulkDeleteRejectsAMixedArray() {
  // @ts-expect-error a mixed (ID | entry)[] array matches neither overload — pick one form
  await users.bulkDelete(['a', { id: 'b' }]);
}

// ---------------------------------------------------------------------------
// createWithId / bulkCreateWithIds input typing
// ---------------------------------------------------------------------------

export async function createWithIdAcceptsTheWriteModel() {
  const created: { id: string } = await users.createWithId('u1', {
    name: 'Ada',
    status: 'active',
    balance: 0,
  });
  // `{ returnDoc: true }` selects the read-model overload, exactly as on create()/upsert().
  const doc = await users.createWithId(
    'u2',
    { name: 'Grace', status: 'active', balance: 0 },
    { returnDoc: true },
  );
  const name: string = doc.name;
  const id: string = doc.id;
  return [created, name, id] as const;
}

export async function createWithIdRejectsADottedKey() {
  // @ts-expect-error dotted keys are not part of CreateInput — Firestore would write a literal
  // dot-in-name field on a create. Use a nested object, or update() for field-path merges.
  await profiles.createWithId('p1', { name: 'Ada', 'address.city': 'LA' });
}

export async function bulkCreateWithIdsTyping() {
  const ids: { id: string }[] = await users.bulkCreateWithIds([
    { id: 'u1', data: { name: 'Ada', status: 'active', balance: 0 } },
  ]);
  const docs = await users.bulkCreateWithIds(
    [{ id: 'u2', data: { name: 'Grace', status: 'active', balance: 0 } }],
    { returnDoc: true },
  );
  const firstName: string = docs[0].name;

  // @ts-expect-error entries are { id, data } pairs — a bare data array is not accepted
  await users.bulkCreateWithIds([{ name: 'Ada', status: 'active', balance: 0 }]);

  return [ids, firstName] as const;
}

// ---------------------------------------------------------------------------
// The D1 acceptance flow, verbatim as the docs present it
// ---------------------------------------------------------------------------

/**
 * The read-modify-write loop from ADR-0026 / the CRUD guide. If this stops compiling, the published
 * example is wrong — that is the whole point of pinning it here.
 */
export async function documentedRetryOnConflictFlow() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await users.getByIdWithUpdateTime('user-123');
    if (!current) break;

    try {
      await users.update(
        current.doc.id,
        { balance: current.doc.balance + 100 },
        { lastUpdateTime: current.updateTime },
      );
      break;
    } catch (error) {
      if (!(error instanceof PreconditionFailedError)) throw error;
    }
  }
}
