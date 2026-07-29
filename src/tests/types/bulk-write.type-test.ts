/**
 * Type-level tests for the BulkWriter-backed write path (issue #38), checked by
 * `npm run test:types` via tsc (NOT jest). This file is never executed.
 *
 * The contract this pins:
 *  - T-1: all four new types are nameable from the package root.
 *  - T-2: `BulkWriteOperation` is discriminated on `op` — only `create` may omit `id`, and only the
 *    update/delete verbs accept `lastUpdateTime`.
 *  - T-3: `data` is typed per verb — create/set take a full create input, update/patch a partial.
 *  - T-4: `BulkWriteResult` narrows on `ok`: `writeTime` only on the success branch, `error` /
 *    `failedAttempts` only on the failure branch.
 *  - T-5: `bulkWrite` returns `Promise<BulkWriteResult[]>` and `recursiveDelete` `Promise<void>`.
 *
 * Each `@ts-expect-error` FAILS the type-check if the line below it stops being an error; every
 * un-annotated call must type-check.
 */
import { z } from 'zod';
import { FirestoreRepository } from '../../index.js';
import type {
  BulkWriteOperation,
  BulkWriteOperationKind,
  BulkWriteOptions,
  BulkWriteResult,
} from '../../index.js';

declare const db: FirebaseFirestore.Firestore;
declare const updateTime: FirebaseFirestore.Timestamp;

const userSchema = z.object({
  name: z.string(),
  score: z.number(),
  email: z.string().optional(),
});
const users = FirestoreRepository.withSchema(db, 'users', userSchema);

type UserWrite = z.input<typeof userSchema>;

// ---------------------------------------------------------------------------
// T-1 — the four new types are nameable from the package root
// ---------------------------------------------------------------------------

const _kind: BulkWriteOperationKind = 'patch';
const _options: BulkWriteOptions = { skipHooks: true, throttling: { maxOpsPerSecond: 100 } };
const _throttlingOff: BulkWriteOptions = { throttling: false };
void _kind;
void _options;
void _throttlingOff;

// ---------------------------------------------------------------------------
// T-2 — discriminated on `op`: id optionality and precondition support per verb
// ---------------------------------------------------------------------------

const _createWithoutId: BulkWriteOperation<UserWrite> = {
  op: 'create',
  data: { name: 'Ada', score: 1 },
};
const _createWithId: BulkWriteOperation<UserWrite> = {
  op: 'create',
  id: 'u1',
  data: { name: 'Ada', score: 1 },
};
const _updateWithPrecondition: BulkWriteOperation<UserWrite> = {
  op: 'update',
  id: 'u1',
  data: { score: 2 },
  lastUpdateTime: updateTime,
};
const _deleteWithPrecondition: BulkWriteOperation<UserWrite> = {
  op: 'delete',
  id: 'u1',
  lastUpdateTime: updateTime,
};
void _createWithoutId;
void _createWithId;
void _updateWithPrecondition;
void _deleteWithPrecondition;

// @ts-expect-error `set` requires an explicit id — there is nothing to generate one for
const _setWithoutId: BulkWriteOperation<UserWrite> = { op: 'set', data: { name: 'Ada', score: 1 } };
void _setWithoutId;

// @ts-expect-error `delete` requires an id
const _deleteWithoutId: BulkWriteOperation<UserWrite> = { op: 'delete' };
void _deleteWithoutId;

const _createWithPrecondition: BulkWriteOperation<UserWrite> = {
  op: 'create',
  id: 'u1',
  data: { name: 'Ada', score: 1 },
  // @ts-expect-error a create-only write has no prior version to precondition on
  lastUpdateTime: updateTime,
};
void _createWithPrecondition;

const _deleteWithData: BulkWriteOperation<UserWrite> = {
  op: 'delete',
  id: 'u1',
  // @ts-expect-error a delete carries no payload
  data: { name: 'Ada', score: 1 },
};
void _deleteWithData;

// @ts-expect-error 'upsert' is not one of the five verbs
const _unknownVerb: BulkWriteOperation<UserWrite> = { op: 'upsert', id: 'u1', data: {} };
void _unknownVerb;

// ---------------------------------------------------------------------------
// T-3 — `data` is typed per verb (full create input vs partial update input)
// ---------------------------------------------------------------------------

const _createMissingRequiredField: BulkWriteOperation<UserWrite> = {
  op: 'create',
  // @ts-expect-error `score` is required by the create input
  data: { name: 'Ada' },
};
void _createMissingRequiredField;

// A partial payload is fine on update — that is the whole point of UpdateInput.
const _partialUpdate: BulkWriteOperation<UserWrite> = {
  op: 'update',
  id: 'u1',
  data: { score: 3 },
};
void _partialUpdate;

const _wrongFieldType: BulkWriteOperation<UserWrite> = {
  op: 'update',
  id: 'u1',
  // @ts-expect-error score is a number
  data: { score: 'high' },
};
void _wrongFieldType;

// ---------------------------------------------------------------------------
// T-4 — `BulkWriteResult` narrows on `ok`
// ---------------------------------------------------------------------------

export function resultNarrowsOnOk(result: BulkWriteResult) {
  // Present on both branches.
  const index: number = result.index;
  const id: string = result.id;
  const op: BulkWriteOperationKind = result.op;
  void index;
  void id;
  void op;

  if (result.ok) {
    const writeTime: FirebaseFirestore.Timestamp = result.writeTime;
    // @ts-expect-error the success branch carries no error
    void result.error;
    return writeTime;
  }

  const error: Error = result.error;
  const failedAttempts: number | undefined = result.failedAttempts;
  // @ts-expect-error the failure branch carries no writeTime
  void result.writeTime;
  void failedAttempts;
  return error;
}

// ---------------------------------------------------------------------------
// T-5 — method return types
// ---------------------------------------------------------------------------

export async function methodReturnTypes() {
  const results: BulkWriteResult[] = await users.bulkWrite([
    { op: 'create', data: { name: 'Ada', score: 1 } },
    { op: 'delete', id: 'u2' },
  ]);

  const removed: void = await users.recursiveDelete('u1');
  void removed;

  // recursiveDelete takes exactly one argument.
  // @ts-expect-error no second parameter exists
  await users.recursiveDelete('u1', { force: true });

  return results;
}
