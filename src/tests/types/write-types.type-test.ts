/**
 * Type-level tests, checked by `tsc` via `npm run test:types` (NOT jest — the jest suites run
 * ts-jest with `isolatedModules`, which transpiles without type-checking, so `@ts-expect-error`
 * is not enforced there). Here each `@ts-expect-error` FAILS the type-check if the line below it
 * stops being a type error, and every un-annotated call must type-check. This file is never run;
 * it exists purely so the compiler validates the repository's write-input types.
 *
 * Scope note: these assert only what the type system reliably enforces. Firestore's
 * `WithFieldValue`/`PartialWithFieldValue` accept any `FieldValue` on any field, so the *kind* of
 * sentinel is never compile-checked (only runtime `'strict'` enforces it); and `update`
 * (`PartialWithFieldValue`) is looser than `create` (`WithFieldValue`) for object-typed fields.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import {
  FirestoreRepository,
  zDateWrite,
  zNumberWrite,
  createMillisTimestampConverter,
} from '../../index.js';

declare const db: FirebaseFirestore.Firestore;

type Event = { id: string; name: string; loginCount: number; happenedAt: number };

const writeSchema = z.object({
  id: z.string(),
  name: z.string(),
  loginCount: zNumberWrite(), // number | increment
  happenedAt: zDateWrite(), // Date | serverTimestamp()
});

// ── Curried form: write inputs are inferred from the schema ──────────────────────────────────
const repo = FirestoreRepository.withSchema<Event>()(db, 'events', writeSchema);

// The primary deliverable: combinator native values / sentinels are writable with NO cast, and
// `create` does not require `id`.
export async function curriedPositives() {
  await repo.create({ name: 'a', loginCount: 0, happenedAt: new Date() });
  await repo.update('x', { happenedAt: new Date() });
  await repo.update('x', { happenedAt: FieldValue.serverTimestamp() });
  await repo.update('x', { loginCount: FieldValue.increment(1) });
  await repo
    .query()
    .where('name', '==', 'a')
    .update({ loginCount: FieldValue.increment(1) });
}

export async function curriedNegatives() {
  // @ts-expect-error string is not a valid write for a number field (update)
  await repo.update('x', { loginCount: 'nope' });
  // @ts-expect-error number is not a valid write for a string field (update)
  await repo.update('x', { name: 999 });
  // @ts-expect-error create validates scalar types tightly: a raw number is not a zDateWrite() value
  await repo.create({ name: 'a', loginCount: 0, happenedAt: 123 });
  // @ts-expect-error create validates scalar types tightly: a string is not a number field
  await repo.create({ name: 'a', loginCount: 'nope', happenedAt: new Date() });
}

// ── Direct form: backwards compatible; write inputs are typed by the read type ────────────────
const legacy = FirestoreRepository.withSchema<Event>(db, 'events', writeSchema);

export async function directForm() {
  // `create` still does not require `id` (the CreateInput change), typed by the read type.
  await legacy.create({ name: 'a', loginCount: 0, happenedAt: 123 });
}

// ── Curried subcollection: same inference as the curried withSchema ───────────────────────────
type Order = { id: string; total: number };
const orderWrite = z.object({ id: z.string(), total: zNumberWrite() });
const orders = legacy.subcollection<Order>()('u1', 'orders', orderWrite);

export async function curriedSubcollection() {
  await orders.create({ total: 0 }); // no id, no cast
  await orders.update('o1', { total: FieldValue.increment(5) }); // no cast
  // @ts-expect-error create validates scalar types: a string is not a number field
  await orders.create({ total: 'nope' });
}

// ── README "Storing a Timestamp" example: curried withSchema + createMillisTimestampConverter ──
type EventDoc = { id: string; name: string; happenedAt: number };
const eventWrite = z.object({ id: z.string(), name: z.string(), happenedAt: zDateWrite() });
const events = FirestoreRepository.withSchema<EventDoc>()(
  db,
  'events',
  eventWrite,
  createMillisTimestampConverter<EventDoc>(),
);

export async function timestampReadmeExample() {
  // Cast-free on the curried form, exactly as the README shows.
  await events.create({ name: 'launch', happenedAt: FieldValue.serverTimestamp() });
  await events.update('id', { happenedAt: new Date() });
}
