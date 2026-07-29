/**
 * Probe 3 — the remaining design questions for the ORM wrapper.
 *
 *  - Can a caller COUNT recursive deletes by supplying a BulkWriter with `onWriteResult`?
 *    (`Firestore.recursiveDelete()` itself resolves to `undefined`.)
 *  - Does `recursiveDelete` work on a SUBCOLLECTION document (`users/u1/posts/p1`)?
 *  - Does an unclosed BulkWriter block `db.terminate()`? (index.js increments `bulkWritersCount`
 *    on `bulkWriter()` and decrements on close, and terminate() rejects while it is > 0.)
 *  - Scale: do 600 mixed ops all settle through one writer + `close()`?
 *  - Duplicate writes to the SAME document in one writer — allowed, and in enqueue order?
 *  - Does `set(ref, data, { merge: true })` behave like `patch` (leave siblings alone)?
 *  - Do dot-notation field paths work through `writer.update()`?
 *  - Does `writer.create(col.doc(), …)` (auto-id) work?
 *
 * Run:  firebase emulators:exec --project demo-firestoreorm-test --only firestore \
 *         "node docs/plans/issue-38-bulkwriter-recursive-delete/probes/03-design-questions.mjs"
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';

const app = initializeApp({ projectId: 'demo-firestoreorm-test' });
const db = getFirestore(app);
const out = obj => console.log(JSON.stringify(obj, null, 2));
const root = `probe_dq_${Date.now()}`;
const describeError = e => ({ ctorName: e?.constructor?.name, code: e?.code, message: String(e?.message).slice(0, 200) });

// ------------------------------- count recursive deletes via onWriteResult
{
  const target = db.collection(root).doc('countMe');
  await target.set({ n: 0 });
  for (let i = 0; i < 3; i++) await target.collection('kids').doc(`k${i}`).set({ n: i });
  await target.collection('kids').doc('k0').collection('grandkids').doc('g0').set({ n: 9 });

  const writer = db.bulkWriter();
  let ok = 0;
  const errors = [];
  writer.onWriteResult(() => ok++);
  writer.onWriteError(err => {
    errors.push({ code: err.code, path: err.documentRef.path });
    return false;
  });
  await db.recursiveDelete(target, writer);
  await writer.close();
  out({ probe: 'P-rd-count-via-onWriteResult', deleted: ok, errors, expected: 5 });
}

// ------------------------------- subcollection document
{
  const parent = db.collection(root).doc('u1');
  await parent.set({ n: 1 });
  const subDoc = parent.collection('posts').doc('p1');
  await subDoc.set({ t: 'a' });
  await subDoc.collection('comments').doc('c1').set({ t: 'x' });
  const siblingSub = parent.collection('posts').doc('p2');
  await siblingSub.set({ t: 'keep' });

  const result = await db.recursiveDelete(subDoc).then(() => 'resolved', e => describeError(e));
  out({
    probe: 'P-rd-subcollection-document',
    result,
    subDocGone: !(await subDoc.get()).exists,
    commentsGone: (await subDoc.collection('comments').get()).size === 0,
    parentSurvived: (await parent.get()).exists,
    siblingSubSurvived: (await siblingSub.get()).exists,
  });
}

// ------------------------------- unclosed writer blocks terminate()?
{
  const leaked = db.bulkWriter();
  const terminateResult = await db.terminate().then(() => 'resolved', e => ({ rejected: String(e).slice(0, 200) }));
  out({ probe: 'P-unclosed-writer-blocks-terminate', terminateResult });
  await leaked.close();
}

// The db above may now be in a terminated/odd state — use a second app for the rest.
const app2 = initializeApp({ projectId: 'demo-firestoreorm-test' }, 'probe-app-2');
const db2 = getFirestore(app2);

// ------------------------------- scale: 600 mixed ops
{
  const col = db2.collection(`${root}_scale`);
  const writer = db2.bulkWriter();
  const promises = [];
  for (let i = 0; i < 600; i++) promises.push(writer.set(col.doc(`s${i}`), { n: i }));
  const t0 = process.hrtime.bigint();
  await writer.close();
  const settled = await Promise.allSettled(promises);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  out({
    probe: 'P-scale-600',
    fulfilled: settled.filter(s => s.status === 'fulfilled').length,
    rejected: settled.filter(s => s.status === 'rejected').length,
    approxMs: Math.round(ms),
    committed: (await col.get()).size,
  });
}

// ------------------------------- duplicate writes to the same document
{
  const ref = db2.collection(`${root}_dup`).doc('same');
  const writer = db2.bulkWriter();
  const p1 = writer.set(ref, { v: 'first' });
  const p2 = writer.set(ref, { v: 'second' });
  await writer.close();
  const results = await Promise.allSettled([p1, p2]);
  out({
    probe: 'P-duplicate-same-doc',
    statuses: results.map(r => r.status),
    finalValue: (await ref.get()).data(),
  });
}

// ------------------------------- set merge + dot-notation update + auto-id create
{
  const col = db2.collection(`${root}_misc`);
  await col.doc('m1').set({ a: 1, nested: { x: 1, y: 2 } });
  const writer = db2.bulkWriter();
  const pMerge = writer.set(col.doc('m1'), { nested: { x: 99 } }, { merge: true });
  const pDot = writer.update(col.doc('m1'), { 'nested.y': 42 });
  const autoRef = col.doc();
  const pAuto = writer.create(autoRef, { a: 'auto' });
  await writer.close();
  const settled = await Promise.allSettled([pMerge, pDot, pAuto]);
  out({
    probe: 'P-misc-write-shapes',
    statuses: settled.map(s => s.status),
    rejections: settled.filter(s => s.status === 'rejected').map(s => describeError(s.reason)),
    m1: (await col.doc('m1').get()).data(),
    autoIdLen: autoRef.id.length,
    autoDoc: (await autoRef.get()).data(),
  });
}

// ------------------------------- cleanup
await db2.recursiveDelete(db2.collection(root));
await db2.recursiveDelete(db2.collection(`${root}_scale`));
await db2.recursiveDelete(db2.collection(`${root}_dup`));
await db2.recursiveDelete(db2.collection(`${root}_misc`));
out({ probe: 'P-dq-cleanup', done: true });
await app2.delete();
await app.delete().catch(() => {});
