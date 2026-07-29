/* eslint-disable */
// SCRATCH — §4 trap verification for issue #39 (overload-resolution edge cases). Deleted after.
import type { FirestoreDocument } from './core/DocumentId.js';
import type { ID } from './core/FirestoreRepository.js';
import type { FieldPaths, OmitId, DeepPartial } from './utils/pathTypes.js';
import type { FieldPath } from 'firebase-admin/firestore';

type DocumentMetadata = {
  readonly ref: FirebaseFirestore.DocumentReference;
  readonly path: string;
  readonly parentPath: string;
  readonly createTime: FirebaseFirestore.Timestamp;
  readonly updateTime: FirebaseFirestore.Timestamp;
  readonly readTime: FirebaseFirestore.Timestamp;
};
type WithMetadata<D> = { readonly doc: D; readonly metadata: DocumentMetadata };

interface User {
  name: string;
  age: number;
}

declare class R2<T extends object, S extends object> {
  getById(id: ID, options: { withMetadata: true }): Promise<WithMetadata<FirestoreDocument<T>> | null>;
  getById(id: ID, options?: { withMetadata?: false }): Promise<FirestoreDocument<T> | null>;

  getMany(
    ids: ID[],
    options: { fieldMask: (FieldPaths<OmitId<S>> | FieldPath)[]; withMetadata: true },
  ): Promise<(WithMetadata<FirestoreDocument<DeepPartial<T>>> | null)[]>;
  getMany(
    ids: ID[],
    options: { fieldMask?: undefined; withMetadata: true },
  ): Promise<(WithMetadata<FirestoreDocument<T>> | null)[]>;
  getMany(
    ids: ID[],
    options: { fieldMask: (FieldPaths<OmitId<S>> | FieldPath)[]; withMetadata?: false },
  ): Promise<(FirestoreDocument<DeepPartial<T>> | null)[]>;
  getMany(
    ids: ID[],
    options?: { fieldMask?: undefined; withMetadata?: false },
  ): Promise<(FirestoreDocument<T> | null)[]>;
}

declare const repo: R2<User, User>;
declare const dynamicFlag: boolean;

async function edges() {
  // E1 — explicit `false` literal resolves to the plain overload.
  const a = await repo.getById('x', { withMetadata: false });
  const _a: FirestoreDocument<User> | null = a;

  // E2 — a widened `boolean` matches NO overload (deliberate: it cannot pick a return type).
  // @ts-expect-error withMetadata: boolean is not assignable to `true` or `false | undefined`
  await repo.getById('x', { withMetadata: dynamicFlag });

  // E3 — a variable holding an inferred-widened object also fails (same reason as E2).
  const opts = { withMetadata: true };
  // @ts-expect-error `{ withMetadata: boolean }` — inference widened the literal
  await repo.getById('x', opts);

  // E4 — `as const` fixes E3.
  const optsConst = { withMetadata: true } as const;
  const d = await repo.getById('x', optsConst);
  const _d: WithMetadata<FirestoreDocument<User>> | null = d;

  // E5 — excess-property checking still rejects a typo'd flag.
  // @ts-expect-error 'withMetaData' is not a known property
  await repo.getById('x', { withMetaData: true });

  // E6 — getMany 2x2 matrix, all four cells.
  const m1 = await repo.getMany(['a']);
  const _m1: (FirestoreDocument<User> | null)[] = m1;
  const m2 = await repo.getMany(['a'], { withMetadata: true });
  const _m2: (WithMetadata<FirestoreDocument<User>> | null)[] = m2;
  const m3 = await repo.getMany(['a'], { fieldMask: ['name'] });
  const _m3: (FirestoreDocument<DeepPartial<User>> | null)[] = m3;
  const m4 = await repo.getMany(['a'], { fieldMask: ['name'], withMetadata: true });
  const _m4: (WithMetadata<FirestoreDocument<DeepPartial<User>>> | null)[] = m4;

  // E7 — the metadata wrapper must NOT be assignable to the bare document (catches a mapper that
  // forgot to wrap, or a caller that forgot to reach through `.doc`).
  // @ts-expect-error WithMetadata<FirestoreDocument<User>> is not a FirestoreDocument<User>
  const _e7: FirestoreDocument<User> | null = await repo.getById('x', { withMetadata: true });

  void [_a, _d, _m1, _m2, _m3, _m4, _e7];
}
void edges;
