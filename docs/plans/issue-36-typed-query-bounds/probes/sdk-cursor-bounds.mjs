/**
 * Investigation probe for issue #36 — Admin SDK cursor bounds, offset, and
 * limitToLast semantics against the Firestore emulator.
 *
 * Asks (not asserts): what does the SDK actually do? Output is evidence for
 * PLAN.md §3. Run via:
 *
 *   firebase emulators:exec --project demo-firestoreorm-test --only firestore \
 *     "node docs/plans/issue-36-typed-query-bounds/probes/sdk-cursor-bounds.mjs"
 *
 * Does not touch src/. Safe to delete with the plan directory.
 */

import { initializeApp, getApps, deleteApp } from 'firebase-admin/app';
import {
  getFirestore,
  FieldPath,
  Filter,
} from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ??= 'demo-firestoreorm-test';

const app =
  getApps()[0] ??
  initializeApp({ projectId: 'demo-firestoreorm-test' });
const db = getFirestore(app);

/** Collect async iterable / readable stream into an array (or capture error). */
async function collectStream(query) {
  const docs = [];
  try {
    for await (const snap of query.stream()) {
      docs.push(snap.id);
    }
    return { ok: true, ids: docs };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/** Run one named case and print a structured row. */
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

const col = db.collection(`probe36_${Date.now()}`);

// Seed ordered docs: score asc → a(10), b(20), c(30), d(40), e(50)
const seed = [
  { id: 'a', score: 10, tag: 'x' },
  { id: 'b', score: 20, tag: 'y' },
  { id: 'c', score: 30, tag: 'x' },
  { id: 'd', score: 40, tag: 'y' },
  { id: 'e', score: 50, tag: 'x' },
];
for (const row of seed) {
  await col.doc(row.id).set({ score: row.score, tag: row.tag });
}

const ordered = () => col.orderBy('score', 'asc');

console.log('=== ISSUE #36 SDK CURSOR / BOUNDS PROBE ===');
console.log(
  JSON.stringify({
    firestoreEmulator: process.env.FIRESTORE_EMULATOR_HOST,
    collection: col.path,
  }),
);

// P1 — field-value startAt inclusive
await case_('P1', 'startAt(fieldValues) inclusive', async () => {
  const snap = await ordered().startAt(30).get();
  return snap.docs.map(d => d.id);
});

// P2 — field-value startAfter exclusive
await case_('P2', 'startAfter(fieldValues) exclusive', async () => {
  const snap = await ordered().startAfter(30).get();
  return snap.docs.map(d => d.id);
});

// P3 — field-value endAt inclusive
await case_('P3', 'endAt(fieldValues) inclusive', async () => {
  const snap = await ordered().endAt(30).get();
  return snap.docs.map(d => d.id);
});

// P4 — field-value endBefore exclusive
await case_('P4', 'endBefore(fieldValues) exclusive', async () => {
  const snap = await ordered().endBefore(30).get();
  return snap.docs.map(d => d.id);
});

// P5 — snapshot overloads for startAt / startAfter
await case_('P5', 'startAt/startAfter(DocumentSnapshot)', async () => {
  const c = await col.doc('c').get();
  const at = await ordered().startAt(c).get();
  const after = await ordered().startAfter(c).get();
  return { startAt: at.docs.map(d => d.id), startAfter: after.docs.map(d => d.id) };
});

// P6 — snapshot overloads for endAt / endBefore
await case_('P6', 'endAt/endBefore(DocumentSnapshot)', async () => {
  const c = await col.doc('c').get();
  const at = await ordered().endAt(c).get();
  const before = await ordered().endBefore(c).get();
  return { endAt: at.docs.map(d => d.id), endBefore: before.docs.map(d => d.id) };
});

// P7 — bounded range startAt + endAt
await case_('P7', 'startAt+endAt bounded inclusive range', async () => {
  const snap = await ordered().startAt(20).endAt(40).get();
  return snap.docs.map(d => d.id);
});

// P8 — limitToLast returns last N in ascending orderBy (ascending result order)
await case_('P8', 'limitToLast(2) with orderBy asc — last 2, ascending order', async () => {
  const snap = await ordered().limitToLast(2).get();
  return snap.docs.map(d => ({ id: d.id, score: d.get('score') }));
});

// P9 — limitToLast without orderBy
await case_('P9', 'limitToLast(2) WITHOUT orderBy', async () => {
  const snap = await col.limitToLast(2).get();
  return snap.docs.map(d => d.id);
});

// P10 — stream() with limitToLast
await case_('P10', 'stream() after limitToLast', async () => {
  return collectStream(ordered().limitToLast(2));
});

// P11 — stream() with startAfter (control: streaming with forward cursor works)
await case_('P11', 'stream() after startAfter (control)', async () => {
  return collectStream(ordered().startAfter(20));
});

// P12 — offset skips N documents
await case_('P12', 'offset(2) + limit(2)', async () => {
  const snap = await ordered().offset(2).limit(2).get();
  return snap.docs.map(d => d.id);
});

// P13 — offset(0) and negative offset
await case_('P13a', 'offset(0)', async () => {
  const snap = await ordered().offset(0).limit(2).get();
  return snap.docs.map(d => d.id);
});
await case_('P13b', 'offset(-1)', async () => {
  const snap = await ordered().offset(-1).limit(2).get();
  return snap.docs.map(d => d.id);
});

// P14 — field-value arity mismatch vs orderBy count
await case_('P14', 'startAt with too few field values for multi-orderBy', async () => {
  const snap = await col.orderBy('score').orderBy('tag').startAt(30).get();
  return snap.docs.map(d => d.id);
});

// P15 — startAt without any orderBy (field values)
await case_('P15', 'startAt(30) WITHOUT orderBy', async () => {
  const snap = await col.startAt(30).get();
  return snap.docs.map(d => d.id);
});

// P16 — startAt(snapshot) without orderBy
await case_('P16', 'startAt(snapshot) WITHOUT orderBy', async () => {
  const c = await col.doc('c').get();
  const snap = await col.startAt(c).get();
  return snap.docs.map(d => d.id);
});

// P17 — foreign-collection snapshot as startAfter (ADR-0024 claim)
await case_('P17', 'startAfter(foreignSnapshot) — silent whole set?', async () => {
  const other = db.collection(`probe36_other_${Date.now()}`);
  await other.doc('z').set({ score: 99 });
  const foreign = await other.doc('z').get();
  const snap = await ordered().startAfter(foreign).get();
  return { ids: snap.docs.map(d => d.id), count: snap.size };
});

// P18 — projected select omitting orderBy field + startAt field values
await case_('P18', 'select(tag) + orderBy(score) + startAt(30)', async () => {
  const snap = await ordered().select('tag').startAt(30).get();
  return snap.docs.map(d => ({ id: d.id, data: d.data() }));
});

// P19 — projected select + startAt(snapshot) where snapshot was full read
await case_('P19', 'select(tag) + startAt(fullSnapshot of c)', async () => {
  const c = await col.doc('c').get();
  const snap = await ordered().select('tag').startAt(c).get();
  return snap.docs.map(d => ({ id: d.id, data: d.data() }));
});

// P20 — onSnapshot with limitToLast
await case_('P20', 'onSnapshot after limitToLast', async () => {
  return await new Promise((resolve, reject) => {
    const unsub = ordered()
      .limitToLast(2)
      .onSnapshot(
        snap => {
          unsub();
          resolve(snap.docs.map(d => d.id));
        },
        err => {
          unsub();
          reject(err);
        },
      );
  });
});

// P21 — aggregate + limitToLast (ADR-0027 claim)
await case_('P21', 'count aggregate after limitToLast(2)', async () => {
  const snap = await ordered().limitToLast(2).count().get();
  return snap.data();
});

// P22 — aggregate + startAt/endAt bounds
await case_('P22', 'count aggregate after startAt(20).endAt(40)', async () => {
  const snap = await ordered().startAt(20).endAt(40).count().get();
  return snap.data();
});

// P23 — limitToLast + startAt together (reverse page from a cursor)
await case_('P23', 'limitToLast(2) + endAt(40) — reverse page ending at d', async () => {
  const snap = await ordered().endAt(40).limitToLast(2).get();
  return snap.docs.map(d => d.id);
});

// P24 — DocumentReference is NOT accepted (only snapshot / field values)
await case_('P24', 'startAfter(DocumentReference) rejected?', async () => {
  const snap = await ordered().startAfter(col.doc('c')).get();
  return snap.docs.map(d => d.id);
});

// P25 — empty startAt() / zero field values
await case_('P25', 'startAt() with zero args', async () => {
  const snap = await ordered().startAt().get();
  return snap.docs.map(d => d.id);
});

// P26 — multi-field orderBy + matching field values
await case_('P26', 'orderBy score+tag startAt(30,"x")', async () => {
  const snap = await col.orderBy('score').orderBy('tag').startAt(30, 'x').get();
  return snap.docs.map(d => ({ id: d.id, score: d.get('score'), tag: d.get('tag') }));
});

// P27 — FieldPath.documentId() as orderBy + startAt with id string
await case_('P27', 'orderBy(documentId) + startAt("c")', async () => {
  const snap = await col.orderBy(FieldPath.documentId()).startAt('c').get();
  return snap.docs.map(d => d.id);
});

// P28 — limitToLast(0) / negative
await case_('P28a', 'limitToLast(0)', async () => {
  const snap = await ordered().limitToLast(0).get();
  return snap.docs.map(d => d.id);
});
await case_('P28b', 'limitToLast(-1)', async () => {
  const snap = await ordered().limitToLast(-1).get();
  return snap.docs.map(d => d.id);
});

// P29 — combining limit() and limitToLast()
await case_('P29', 'limit(3).limitToLast(2) — which wins?', async () => {
  const snap = await ordered().limit(3).limitToLast(2).get();
  return snap.docs.map(d => d.id);
});

// P30 — limitToLast then limit
await case_('P30', 'limitToLast(2).limit(3) — which wins?', async () => {
  const snap = await ordered().limitToLast(2).limit(3).get();
  return snap.docs.map(d => d.id);
});

console.log('=== END PROBE ===');

try {
  await deleteApp(app);
} catch {
  /* ignore */
}
