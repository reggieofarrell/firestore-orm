/**
 * Follow-up probe for issue #36 — collection-group foreign cursors (ADR-0024 claim)
 * and DocumentReference-as-field-value silent empty results.
 *
 * Run:
 *   firebase emulators:exec --project demo-firestoreorm-test --only firestore \
 *     "node docs/plans/issue-36-typed-query-bounds/probes/sdk-foreign-cursor.mjs"
 */

import { initializeApp, getApps, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldPath } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ??= 'demo-firestoreorm-test';

const app =
  getApps()[0] ??
  initializeApp({ projectId: 'demo-firestoreorm-test' });
const db = getFirestore(app);

async function case_(id, label, fn) {
  try {
    const result = await fn();
    console.log(JSON.stringify({ id, label, ok: true, result }));
  } catch (err) {
    console.log(
      JSON.stringify({
        id,
        label,
        ok: false,
        error: String(err?.message ?? err),
        code: err?.code,
      }),
    );
  }
}

const stamp = Date.now();
const parentA = db.collection(`probe36fg_a_${stamp}`).doc('p1');
const parentB = db.collection(`probe36fg_b_${stamp}`).doc('p2');
const itemsA = parentA.collection('items');
const itemsB = parentB.collection('items');

await itemsA.doc('a1').set({ score: 10 });
await itemsA.doc('a2').set({ score: 20 });
await itemsB.doc('b1').set({ score: 15 });
await itemsB.doc('b2').set({ score: 25 });

const group = db.collectionGroup('items');

console.log('=== FOREIGN CURSOR / DOCREF PROBE ===');

// F1 — collection-group startAfter with same-group different-parent snapshot
await case_('F1', 'group startAfter(same-group other parent)', async () => {
  const cursor = await itemsB.doc('b1').get();
  const snap = await group.orderBy('score').startAfter(cursor).get();
  return snap.docs.map(d => d.ref.path);
});

// F2 — collection-group startAfter with completely foreign collection snapshot
await case_('F2', 'group startAfter(foreign collection snapshot)', async () => {
  const foreign = db.collection(`probe36fg_foreign_${stamp}`);
  await foreign.doc('z').set({ score: 99 });
  const cursor = await foreign.doc('z').get();
  const snap = await group.orderBy('score').startAfter(cursor).get();
  return { paths: snap.docs.map(d => d.ref.path), count: snap.size };
});

// F3 — single-collection startAfter with sibling-collection snapshot (same parent id? no)
await case_('F3', 'collection startAfter(sibling collection snapshot)', async () => {
  const snap = await itemsA.orderBy('score').startAfter(await itemsB.doc('b1').get()).get();
  return { ids: snap.docs.map(d => d.id), count: snap.size };
});

// F4 — DocumentReference passed as sole field value: what comparison happens?
await case_('F4', 'startAfter(DocumentReference) with orderBy(score)', async () => {
  const snap = await itemsA.orderBy('score').startAfter(itemsA.doc('a1')).get();
  return { ids: snap.docs.map(d => d.id), count: snap.size };
});

// F5 — DocumentReference with orderBy(documentId) — does path/id compare?
await case_('F5', 'startAfter(DocumentReference) with orderBy(documentId)', async () => {
  const snap = await itemsA
    .orderBy(FieldPath.documentId())
    .startAfter(itemsA.doc('a1'))
    .get();
  return { ids: snap.docs.map(d => d.id), count: snap.size };
});

// F6 — DocumentSnapshot.exists === false as cursor
await case_('F6', 'startAfter(missing snapshot)', async () => {
  const missing = await itemsA.doc('missing').get();
  const snap = await itemsA.orderBy('score').startAfter(missing).get();
  return { exists: missing.exists, ids: snap.docs.map(d => d.id) };
});

// F7 — re-check collection foreign: same as P17 but print error class
await case_('F7', 'collection startAfter(totally foreign) error shape', async () => {
  const foreign = db.collection(`probe36fg_x_${stamp}`);
  await foreign.doc('z').set({ score: 1 });
  try {
    await itemsA.orderBy('score').startAfter(await foreign.doc('z').get()).get();
    return { threw: false };
  } catch (err) {
    return {
      threw: true,
      name: err?.name,
      code: err?.code,
      message: String(err?.message ?? err),
      constructor: err?.constructor?.name,
    };
  }
});

// F8 — startAt(snapshot) without orderBy: does it imply documentId order?
await case_('F8', 'startAt(snapshot) no orderBy — result order vs documentId', async () => {
  // Seed non-lexicographic scores so we can tell if score or id order is used.
  const col = db.collection(`probe36fg_noorder_${stamp}`);
  await col.doc('m').set({ score: 1 });
  await col.doc('a').set({ score: 99 });
  await col.doc('z').set({ score: 50 });
  const mid = await col.doc('m').get();
  const snap = await col.startAt(mid).get();
  return snap.docs.map(d => ({ id: d.id, score: d.get('score') }));
});

console.log('=== END ===');
try {
  await deleteApp(app);
} catch {
  /* ignore */
}
