/**
 * Probe 1 — What does the Admin SDK `BulkWriter` actually do against the Firestore emulator?
 *
 * Questions (all "asks", no assertions to promote):
 *  - Does `db.bulkWriter()` work at all on the emulator?
 *  - Do per-operation promises resolve with a `WriteResult` (and does it carry `writeTime`)?
 *  - What is thrown for a `create()` collision / an `update()` on a missing doc / a stale
 *    `lastUpdateTime` precondition, and is it a `BulkWriterError` (code / operationType /
 *    documentRef.path / failedAttempts)?
 *  - Does `close()` reject when individual writes failed, or resolve?
 *  - Does the default error handler retry ALREADY_EXISTS / NOT_FOUND (failedAttempts > 1)?
 *  - Does an un-awaited failing per-op promise produce an unhandled rejection?
 *  - Does a write after `close()` throw, and what type? Does a second `close()` throw?
 *  - Is a BulkWriter "batch" atomic (does a sibling land when one op fails)?
 *
 * IMPORTANT (found the hard way): `await writer.create(...)` BEFORE `flush()`/`close()` with fewer
 * than 20 enqueued ops DEADLOCKS — the SDK only schedules a batch at `_opCount === MAX_BATCH_SIZE`
 * (20) or on flush/close. Every await below therefore happens AFTER close/flush.
 *
 * Run:  firebase emulators:exec --project demo-firestoreorm-test --only firestore \
 *         "node docs/plans/issue-38-bulkwriter-recursive-delete/probes/01-bulkwriter-emulator.mjs"
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';

const unhandled = [];
process.on('unhandledRejection', reason => {
  unhandled.push(String(reason && reason.message ? reason.message : reason));
});

const app = initializeApp({ projectId: 'demo-firestoreorm-test' });
const db = getFirestore(app);
const col = db.collection(`probe_bulkwriter_${Date.now()}`);

const out = obj => console.log(JSON.stringify(obj, null, 2));

function describeError(e) {
  return {
    ctorName: e?.constructor?.name,
    name: e?.name,
    isError: e instanceof Error,
    code: e?.code,
    codeType: typeof e?.code,
    operationType: e?.operationType,
    failedAttempts: e?.failedAttempts,
    documentRefPath: e?.documentRef?.path,
    message: String(e?.message).slice(0, 200),
    ownEnumerableKeys: Object.keys(e ?? {}),
  };
}

const settle = p => p.then(r => ({ ok: true, writeTime: !!r?.writeTime }), e => ({ ok: false, e: describeError(e) }));

// ------------------------------------------------------------------ deadlock demo
{
  const writer = db.bulkWriter();
  const p = writer.set(col.doc('deadlock'), { n: 1 });
  const raced = await Promise.race([
    p.then(() => 'settled-without-flush'),
    new Promise(r => setTimeout(() => r('STILL-PENDING-after-1500ms'), 1500)),
  ]);
  out({ probe: 'P-deadlock-without-flush', raced });
  await writer.close();
  out({ probe: 'P-deadlock-after-close', settled: await settle(p) });
}

// ---------------------------------------------------------------------- happy path
{
  const writer = db.bulkWriter();
  const p1 = writer.create(col.doc('a'), { n: 1 });
  const p2 = writer.set(col.doc('b'), { n: 2 });
  const closeResult = await writer.close().then(() => 'resolved', e => ({ rejected: describeError(e) }));
  out({ probe: 'P-happy', closeResult, settled: [await settle(p1), await settle(p2)] });
}

// ------------------------------------------------- create collision (ALREADY_EXISTS)
{
  const writer = db.bulkWriter();
  const good = writer.create(col.doc('c'), { n: 3 });
  const collide = writer.create(col.doc('a'), { n: 99 }); // 'a' already written above
  const closeResult = await writer.close().then(() => 'resolved', e => ({ rejected: describeError(e) }));
  out({
    probe: 'P-create-collision',
    good: await settle(good),
    collide: await settle(collide),
    closeResult,
  });
  const cSnap = await col.doc('c').get();
  const aSnap = await col.doc('a').get();
  out({
    probe: 'P-create-collision-atomicity',
    siblingLanded: cSnap.exists,
    collidedDocValue: aSnap.data(),
  });
}

// ------------------------------------------------- update on a missing doc (NOT_FOUND)
{
  const writer = db.bulkWriter();
  const missing = writer.update(col.doc('does-not-exist'), { n: 1 });
  const closeResult = await writer.close().then(() => 'resolved', e => ({ rejected: describeError(e) }));
  out({ probe: 'P-update-missing', missing: await settle(missing), closeResult });
}

// ------------------------------------------------- delete on a missing doc
{
  const writer = db.bulkWriter();
  const del = writer.delete(col.doc('also-missing'));
  await writer.close();
  out({ probe: 'P-delete-missing', del: await settle(del) });
}

// ------------------------------------------------- stale precondition on delete()
{
  await col.doc('pre').set({ n: 1 });
  const stale = (await col.doc('pre').get()).updateTime;
  await col.doc('pre').set({ n: 2 }); // bump updateTime so `stale` no longer matches
  const writer = db.bulkWriter();
  const failed = writer.delete(col.doc('pre'), { lastUpdateTime: stale });
  await writer.close();
  out({ probe: 'P-precondition-failed', failed: await settle(failed) });
}

// ------------------------------------------------- stale precondition on update()
{
  await col.doc('pre2').set({ n: 1 });
  const stale = (await col.doc('pre2').get()).updateTime;
  await col.doc('pre2').set({ n: 2 });
  const writer = db.bulkWriter();
  const failed = writer.update(col.doc('pre2'), { n: 3 }, { lastUpdateTime: stale });
  await writer.close();
  out({ probe: 'P-precondition-failed-update', failed: await settle(failed) });
}

// ------------------------------------------------- un-awaited failing promise
{
  const before = unhandled.length;
  const writer = db.bulkWriter();
  writer.create(col.doc('a'), { n: 1 }); // deliberately NOT awaited, will reject
  await writer.close();
  await new Promise(r => setTimeout(r, 400)); // let the rejection tracker fire
  out({
    probe: 'P-unawaited-rejection',
    newUnhandled: unhandled.length - before,
    unhandled: unhandled.slice(before),
  });
}

// ------------------------------------------------- after close()
{
  const writer = db.bulkWriter();
  await writer.close();
  let afterCloseWrite;
  try {
    const p = writer.set(col.doc('z'), { n: 1 });
    afterCloseWrite = { threwSynchronously: false, promise: !!p };
    p.catch(() => {});
  } catch (e) {
    afterCloseWrite = { threwSynchronously: true, ...describeError(e) };
  }
  let secondClose;
  try {
    secondClose = await writer.close().then(() => 'resolved', e => describeError(e));
  } catch (e) {
    secondClose = { threwSynchronously: true, ...describeError(e) };
  }
  out({ probe: 'P-after-close', afterCloseWrite, secondClose });
}

// ------------------------------------------------- onWriteError overrides default retry
{
  const writer = db.bulkWriter();
  const seen = [];
  writer.onWriteError(err => {
    seen.push({
      code: err.code,
      operationType: err.operationType,
      failedAttempts: err.failedAttempts,
      path: err.documentRef.path,
    });
    return false; // do not retry
  });
  const p = writer.create(col.doc('a'), { n: 1 });
  await writer.close();
  out({ probe: 'P-onWriteError', handlerCalls: seen, result: await settle(p) });
}

// ------------------------------------------------- onWriteResult ordering
{
  const writer = db.bulkWriter();
  const events = [];
  writer.onWriteResult((ref, result) => events.push({ id: ref.id, hasWriteTime: !!result?.writeTime }));
  writer.set(col.doc('r1'), { n: 1 });
  writer.set(col.doc('r2'), { n: 2 });
  await writer.close();
  out({ probe: 'P-onWriteResult', events });
}

// ------------------------------------------------- throttling option accepted?
{
  let throttleErr = null;
  try {
    const writer = db.bulkWriter({ throttling: { initialOpsPerSecond: 5, maxOpsPerSecond: 10 } });
    const p = writer.set(col.doc('t1'), { n: 1 });
    await writer.close();
    await p;
  } catch (e) {
    throttleErr = describeError(e);
  }
  out({ probe: 'P-throttling-option', throttleErr });
}

// ------------------------------------------------- flush() then keep writing
{
  const writer = db.bulkWriter();
  const p1 = writer.set(col.doc('f1'), { n: 1 });
  await writer.flush();
  const first = await settle(p1);
  const p2 = writer.set(col.doc('f2'), { n: 2 });
  await writer.close();
  out({ probe: 'P-flush-then-write', first, second: await settle(p2) });
}

// ------------------------------------------------- >20 ops settle without explicit flush?
{
  const writer = db.bulkWriter();
  const ps = Array.from({ length: 25 }, (_, i) => writer.set(col.doc(`m${i}`), { n: i }));
  const raced = await Promise.race([
    Promise.all(ps.slice(0, 20)).then(() => 'first-20-settled-without-flush'),
    new Promise(r => setTimeout(() => r('first-20-STILL-PENDING-after-3000ms'), 3000)),
  ]);
  await writer.close();
  await Promise.allSettled(ps);
  out({ probe: 'P-autoflush-at-20', raced });
}

// cleanup
{
  const all = await col.get();
  const w = db.bulkWriter();
  all.docs.forEach(d => w.delete(d.ref));
  await w.close();
}

out({ probe: 'P-final-unhandled-total', count: unhandled.length });
await app.delete();
