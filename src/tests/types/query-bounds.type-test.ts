/**
 * Type-level tests for typed query bounds / offset / limitToLast (issue #36), checked by
 * `npm run test:types` via tsc (NOT jest). This file is never executed.
 *
 * The contract this pins:
 *  - T-1: collection builders expose startAt/startAfter/endAt/endBefore/offset/limitToLast and
 *    each returns a this-compatible builder.
 *  - T-2: collection-group builders expose the same surface (methods live on the base).
 *  - T-3: field-value args accept unknown-compatible values; snapshot overload accepts
 *    DocumentSnapshot.
 *  - T-4: VectorQueryBuilder still has no startAt / limitToLast (expect-error if someone adds).
 *
 * Each `@ts-expect-error` FAILS the type-check if the line below it stops being an error; every
 * un-annotated call must type-check.
 */
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { z } from 'zod';
import { FirestoreRepository } from '../../index.js';
import { withVectorSearch } from '../../vector/index.js';

declare const db: FirebaseFirestore.Firestore;
declare const snap: DocumentSnapshot;

const userSchema = z.object({
  name: z.string(),
  score: z.number(),
  tag: z.string().optional(),
});
const users = FirestoreRepository.withSchema(db, 'users', userSchema);
const userGroup = users.collectionGroup();
const vectorRepo = withVectorSearch(users);

// ---------------------------------------------------------------------------
// T-1 — collection builder surface + this-compatible chaining
// ---------------------------------------------------------------------------

export async function collectionBuilderExposesBoundsAndLimitToLast() {
  const rows = await users
    .query()
    .orderBy('score')
    .startAt(20)
    .startAfter(20)
    .endAt(40)
    .endBefore(40)
    .offset(0)
    .limitToLast(2)
    .get();
  return rows;
}

export async function collectionBoundsReturnThisCompatibleBuilder() {
  // Assigning each clause result back to a builder-typed local proves the return type is chainable
  // as `this` rather than widening to a bare Query or void.
  let q = users.query().orderBy('score');
  q = q.startAt(10);
  q = q.startAfter(10);
  q = q.endAt(50);
  q = q.endBefore(50);
  q = q.offset(0);
  q = q.limitToLast(1);
  return q.get();
}

// ---------------------------------------------------------------------------
// T-2 — collection-group builder inherits the same surface
// ---------------------------------------------------------------------------

export async function collectionGroupBuilderExposesBoundsAndLimitToLast() {
  const rows = await userGroup
    .query()
    .orderBy('score')
    .startAt(20)
    .endAt(40)
    .offset(0)
    .limitToLast(2)
    .get();
  return rows;
}

// ---------------------------------------------------------------------------
// T-3 — overload typing: DocumentSnapshot vs unknown field values
// ---------------------------------------------------------------------------

export async function snapshotAndFieldValueOverloadsTypecheck() {
  await users.query().orderBy('score').startAt(snap).get();
  await users.query().orderBy('score').startAfter(snap).get();
  await users.query().orderBy('score').endAt(snap).get();
  await users.query().orderBy('score').endBefore(snap).get();

  // Field values follow the stored-shape rule (unknown), same as where() — scalars and mixed
  // multi-orderBy prefixes are accepted at the type level.
  await users.query().orderBy('score').orderBy('tag').startAt(30, 'x').get();
  await users.query().orderBy('score').startAt('prefix-ok-as-unknown' as unknown).get();
}

// ---------------------------------------------------------------------------
// T-4 — VectorQueryBuilder deliberately omits bounds / limitToLast
// ---------------------------------------------------------------------------

export function vectorQueryBuilderHasNoBoundsOrLimitToLast() {
  const vq = vectorRepo.vectorQuery();
  // @ts-expect-error VectorQueryBuilder does not expose startAt (no orderBy / cursor surface)
  vq.startAt(0);
  // @ts-expect-error VectorQueryBuilder does not expose limitToLast
  vq.limitToLast(1);
}
