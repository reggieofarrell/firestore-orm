/**
 * Probe 2 — What does `Firestore.recursiveDelete()` actually do against the Firestore emulator?
 *
 * Questions:
 *  - Does it work on the emulator at all? (It uses a KINDLESS all-descendants query internally —
 *    `QueryOptions.forKindlessAllDescendants` + `select(__name__)` + `startAfter` paging.)
 *  - Does it delete the target document AND all subcollection descendants (at depth > 1)?
 *  - Does it work on a `CollectionReference` (delete every doc in the collection, incl. nested)?
 *  - Does it delete siblings outside the target? (it must not)
 *  - Missing document / empty collection → resolve or reject?
 *  - Does it resolve to a count, or `undefined`?
 *  - When a delete fails, what does the rejection look like (message / code / ctor)?
 *  - Does a caller-supplied BulkWriter get CLOSED by recursiveDelete? (source says: only flushed)
 *  - Does passing an already-closed BulkWriter throw?
 *  - Does the internal lazy BulkWriter get reused across calls (does a 2nd call still work)?
 *  - Does it touch collections whose id merely PREFIXES the target collection id?
 *
 * Run:  firebase emulators:exec --project demo-firestoreorm-test --only firestore \
 *         "node docs/plans/issue-38-bulkwriter-recursive-delete/probes/02-recursive-delete-emulator.mjs"
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';

const app = initializeApp({ projectId: 'demo-firestoreorm-test' });
const db = getFirestore(app);
const out = obj => console.log(JSON.stringify(obj, null, 2));

const root = `probe_rd_${Date.now()}`;

function describeError(e) {
  return {
    ctorName: e?.constructor?.name,
    name: e?.name,
    code: e?.code,
    message: String(e?.message).slice(0, 220),
  };
}

/** Counts every doc reachable under a document, depth-first, via listCollections. */
async function countUnder(docRef) {
  let n = 0;
  const cols = await docRef.listCollections();
  for (const c of cols) {
    const snap = await c.get();
    n += snap.size;
    for (const d of snap.docs) n += await countUnder(d.ref);
  }
  return n;
}

// ---------------------------------------------- doc + nested descendants (depth 3)
{
  const target = db.collection(root).doc('parent');
  await target.set({ kind: 'target' });
  await target.collection('posts').doc('p1').set({ t: 'a' });
  await target.collection('posts').doc('p2').set({ t: 'b' });
  await target.collection('posts').doc('p1').collection('comments').doc('c1').set({ t: 'x' });
  await target.collection('tags').doc('t1').set({ t: 'y' });
  const sibling = db.collection(root).doc('sibling');
  await sibling.set({ kind: 'sibling' });
  await sibling.collection('posts').doc('sp1').set({ t: 'keep' });

  const before = { target: await countUnder(target), sibling: await countUnder(sibling) };
  const result = await db
    .recursiveDelete(target)
    .then(v => ({ resolved: true, value: v }), e => ({ resolved: false, error: describeError(e) }));
  const after = {
    targetDocExists: (await target.get()).exists,
    targetDescendants: await countUnder(target),
    siblingDocExists: (await sibling.get()).exists,
    siblingDescendants: await countUnder(sibling),
  };
  out({ probe: 'P-rd-document', before, result, after });
}

// ---------------------------------------------- collection reference
{
  const col = db.collection(`${root}_col`);
  await col.doc('d1').set({ n: 1 });
  await col.doc('d2').set({ n: 2 });
  await col.doc('d1').collection('kids').doc('k1').set({ n: 3 });
  // A collection whose id has the target id as a PREFIX — must survive.
  const prefixed = db.collection(`${root}_colX`);
  await prefixed.doc('keep').set({ n: 9 });

  const result = await db
    .recursiveDelete(col)
    .then(v => ({ resolved: true, value: v }), e => ({ resolved: false, error: describeError(e) }));
  out({
    probe: 'P-rd-collection',
    result,
    remainingInTarget: (await col.get()).size,
    nestedRemaining: (await col.doc('d1').collection('kids').get()).size,
    prefixedCollectionSurvived: (await prefixed.get()).size,
  });
  await db.recursiveDelete(prefixed);
}

// ---------------------------------------------- missing document
{
  const missing = db.collection(root).doc('never-existed');
  const result = await db
    .recursiveDelete(missing)
    .then(v => ({ resolved: true, value: v }), e => ({ resolved: false, error: describeError(e) }));
  out({ probe: 'P-rd-missing-document', result });
}

// ---------------------------------------------- empty collection
{
  const empty = db.collection(`${root}_empty_never_written`);
  const result = await db
    .recursiveDelete(empty)
    .then(v => ({ resolved: true, value: v }), e => ({ resolved: false, error: describeError(e) }));
  out({ probe: 'P-rd-empty-collection', result });
}

// ---------------------------------------------- caller-supplied BulkWriter: closed after?
{
  const target = db.collection(root).doc('withWriter');
  await target.set({ n: 1 });
  await target.collection('kids').doc('k').set({ n: 2 });
  const writer = db.bulkWriter();
  await db.recursiveDelete(target, writer);
  let stillUsable;
  try {
    const p = writer.set(db.collection(root).doc('afterRd'), { n: 1 });
    await writer.close();
    await p;
    stillUsable = 'yes — writer was NOT closed by recursiveDelete';
  } catch (e) {
    stillUsable = { threw: describeError(e) };
  }
  out({
    probe: 'P-rd-supplied-writer-not-closed',
    stillUsable,
    targetGone: !(await target.get()).exists,
  });
}

// ---------------------------------------------- already-closed BulkWriter
{
  const writer = db.bulkWriter();
  await writer.close();
  const target = db.collection(root).doc('closedWriter');
  await target.set({ n: 1 });
  let result;
  try {
    result = await db
      .recursiveDelete(target, writer)
      .then(() => 'resolved', e => describeError(e));
  } catch (e) {
    result = { threwSynchronously: true, ...describeError(e) };
  }
  out({ probe: 'P-rd-closed-writer', result });
  await db.recursiveDelete(target);
}

// ---------------------------------------------- internal lazy writer reused across calls
{
  const a = db.collection(root).doc('lazyA');
  const b = db.collection(root).doc('lazyB');
  await a.set({ n: 1 });
  await b.set({ n: 2 });
  const r1 = await db.recursiveDelete(a).then(() => 'ok', e => describeError(e));
  const r2 = await db.recursiveDelete(b).then(() => 'ok', e => describeError(e));
  out({ probe: 'P-rd-lazy-writer-reuse', first: r1, second: r2 });
}

// ---------------------------------------------- failure surface: custom writer that never retries
{
  const target = db.collection(root).doc('failing');
  await target.set({ n: 1 });
  await target.collection('kids').doc('k').set({ n: 2 });
  const writer = db.bulkWriter();
  // Force every delete to fail by attaching a stale precondition is not possible through
  // recursiveDelete (it calls writer.delete(ref) with no precondition), so instead monkey-patch the
  // writer's delete to reject — this is what the ORM would see if the backend rejected deletes.
  const realDelete = writer.delete.bind(writer);
  let calls = 0;
  writer.delete = ref => {
    calls++;
    const err = Object.assign(new Error('probe: forced delete failure'), {
      code: 7,
      documentRef: ref,
      operationType: 'delete',
      failedAttempts: 1,
    });
    return Promise.reject(err);
  };
  const result = await db
    .recursiveDelete(target, writer)
    .then(() => 'resolved', e => describeError(e));
  writer.delete = realDelete;
  await writer.close();
  out({ probe: 'P-rd-failure-shape', deleteCalls: calls, result });
}

// ---------------------------------------------- cleanup
{
  await db.recursiveDelete(db.collection(root));
  const leftovers = await db.collection(root).get();
  out({ probe: 'P-rd-cleanup', leftovers: leftovers.size });
}

await app.delete();
