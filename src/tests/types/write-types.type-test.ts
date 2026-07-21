/**
 * Type-level tests, checked by `tsc` via `npm run test:types` (NOT jest — the jest suites run
 * ts-jest with `isolatedModules`, which transpiles without type-checking, so `@ts-expect-error`
 * is not enforced there). Here each `@ts-expect-error` FAILS the type-check if the line below it
 * stops being a type error, and every un-annotated call must type-check. This file is never run;
 * it exists purely so the compiler validates the repository's write-input types.
 *
 * V3 model: read type = `z.infer<readSchema>`; write type = `z.infer<writeSchema ?? readSchema>`.
 * Types are inferred from schema values in a single (non-curried) call.
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

const eventRead = z.object({
  id: z.string(),
  name: z.string(),
  loginCount: z.number(), // plain number (read)
  happenedAt: z.date(), // plain Date (read)
});
const eventWrite = z.object({
  id: z.string(),
  name: z.string(),
  loginCount: zNumberWrite(), // number | increment
  happenedAt: zDateWrite(), // Date | serverTimestamp()
});

// ── A) writeSchema overlay: write type = z.infer<writeSchema>, combinator writes are cast-free ──
const repo = FirestoreRepository.withSchema(db, 'events', eventRead, { writeSchema: eventWrite });

// The primary deliverable: combinator native values / sentinels are writable with NO cast, and
// `create` does not require `id`.
export async function overlayPositives() {
  await repo.create({ name: 'a', loginCount: 0, happenedAt: new Date() });
  await repo.update('x', { happenedAt: new Date() });
  await repo.update('x', { happenedAt: FieldValue.serverTimestamp() });
  await repo.update('x', { loginCount: FieldValue.increment(1) });
  await repo
    .query()
    .where('name', '==', 'a')
    .update({ loginCount: FieldValue.increment(1) });
}

export async function overlayNegatives() {
  // @ts-expect-error string is not a valid write for a number field (update)
  await repo.update('x', { loginCount: 'nope' });
  // @ts-expect-error number is not a valid write for a string field (update)
  await repo.update('x', { name: 999 });
  // @ts-expect-error create validates scalar types tightly: a raw number is not a zDateWrite() value
  await repo.create({ name: 'a', loginCount: 0, happenedAt: 123 });
  // @ts-expect-error create validates scalar types tightly: a string is not a number field
  await repo.create({ name: 'a', loginCount: 'nope', happenedAt: new Date() });
}

// ── B) No writeSchema: write type == read type (writes typed by the read scalars) ──────────────
const plain = FirestoreRepository.withSchema(db, 'events', eventRead);

export async function noWriteSchema() {
  // `create` still does not require `id`; write type == read type, so a raw Date is valid.
  await plain.create({ name: 'a', loginCount: 0, happenedAt: new Date() });
  await plain.update('x', { name: 'b' });
}

// ── C) CRITICAL: options present but NO writeSchema → write type must FALL BACK to the read type.
// If `WS` degraded to a permissive object instead of defaulting to `RS`, the negatives below would
// stop being errors and `test:types` would fail — exactly the regression this section guards.
const strict = FirestoreRepository.withSchema(db, 'events', eventRead, {
  sentinelPolicy: 'strict',
});

export async function fallbackPositives() {
  await strict.create({ name: 'a', loginCount: 0, happenedAt: new Date() });
}

export async function fallbackNegatives() {
  // @ts-expect-error write type fell back to the READ type: a number field rejects a string
  await strict.update('x', { loginCount: 'nope' });
  // @ts-expect-error read-type Date field rejects a raw number on create
  await strict.create({ name: 'a', loginCount: 0, happenedAt: 123 });
}

// ── D) All options together: readConverter contextual typing must not break WS inference ──────
type EventDoc = { id: string; name: string; happenedAt: number };
const eventDocRead = z.object({ id: z.string(), name: z.string(), happenedAt: z.number() });
const eventDocWrite = z.object({ id: z.string(), name: z.string(), happenedAt: zDateWrite() });
const events = FirestoreRepository.withSchema(db, 'events', eventDocRead, {
  writeSchema: eventDocWrite,
  sentinelPolicy: 'strict',
  readConverter: createMillisTimestampConverter<EventDoc>(),
});

export async function allOptions() {
  // Cast-free on the write overlay, exactly as the timestamps docs show.
  await events.create({ name: 'launch', happenedAt: FieldValue.serverTimestamp() });
  await events.update('id', { happenedAt: new Date() });
  // @ts-expect-error write overlay applied: a number field rejects a string
  await events.update('id', { name: 999 });
}

// ── E) subcollection schema-inferred overlay: same inference as withSchema ─────────────────────
const orderRead = z.object({ id: z.string(), total: z.number() });
const orderWrite = z.object({ id: z.string(), total: zNumberWrite() });
const orders = repo.subcollection('u1', 'orders', orderRead, { writeSchema: orderWrite });

export async function subcollectionOverlay() {
  await orders.create({ total: 0 }); // no id, no cast
  await orders.update('o1', { total: FieldValue.increment(5) }); // no cast
  // @ts-expect-error create validates scalar types: a string is not a number field
  await orders.create({ total: 'nope' });
}

// ── F) Dot-notation update keys are first-class and type-checked (no `as any`) ──────────────────
// `UpdateInput<W>` now reuses the SDK's `UpdateData<Omit<W,'id'>>`, so nested field paths are typed.
const profileRead = z.object({
  id: z.string(),
  name: z.string(),
  address: z.object({ city: z.string(), zip: z.string().optional() }),
  profile: z.object({ settings: z.object({ theme: z.string() }) }),
});
const profiles = FirestoreRepository.withSchema(db, 'profiles', profileRead);

export async function dotNotationPositives() {
  await profiles.update('x', { 'address.city': 'LA' }); // no cast
  await profiles.update('x', { 'address.zip': '90001' });
  await profiles.update('x', { 'profile.settings.theme': 'dark' }); // deep path
  await profiles.update('x', { name: 'n', 'address.city': 'SF' }); // mixed regular + dotted
  await profiles.update('x', { address: { city: 'NYC' } }); // whole-object form still valid
  await profiles.query().where('name', '==', 'a').update({ 'address.city': 'LA' });
}

export async function dotNotationNegatives() {
  // @ts-expect-error wrong leaf type: address.city is a string field
  await profiles.update('x', { 'address.city': 999 });
  // @ts-expect-error typo in a dotted path is not a known key
  await profiles.update('x', { 'addres.city': 'LA' });
  // @ts-expect-error `id` is not a writable update key
  await profiles.update('x', { id: 'nope' });
}

// ── G) Transaction update options exclude `returnDoc` (ADR-0021 / D7) ──────────────────────────
// A transaction cannot read a document back after writing it, so updateInTransaction takes only
// `{ merge?: boolean }`. Guards against a future regression back to the broad `UpdateOptions` alias.
declare const tx: FirebaseFirestore.Transaction;

export async function transactionUpdateOptions() {
  await repo.updateInTransaction(tx, 'e1', { name: 'x' }); // no options — ok
  await repo.updateInTransaction(tx, 'e1', { name: 'x' }, { merge: true }); // merge is honored
  // @ts-expect-error updateInTransaction options do not include returnDoc (a tx cannot read back)
  await repo.updateInTransaction(tx, 'e1', { name: 'x' }, { returnDoc: true });
}
