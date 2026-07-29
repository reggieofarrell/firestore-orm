/**
 * Probe 4 — is the commit order of two writes to the SAME document guaranteed by BulkWriter?
 *
 * The `BulkWriter` d.ts says "Writes to the same document will be executed sequentially", and the
 * first draft of this plan's integration test asserted last-write-wins on that basis. It flaked once
 * in a full-suite run.
 *
 * Reading the SDK source explains why. `bulk-writer.js:_sendFn` starts a NEW batch when the current
 * one already holds a write to that ref, so the two writes never share a batch — but each batch is
 * dispatched via its own `delayedExecution.promise.then(() => this._sendBatch(...))` microtask, and
 * `_sendBatch` awaits its own `bulkCommit()` RPC. The `_lastOp` chain that does serialize things
 * (`bulk-writer.js:830`) is GLOBAL to the writer, not per document. So the two commits race.
 *
 * This probe runs the two-writes-one-document case N times and reports how often the LAST enqueued
 * write is not the one that ends up stored.
 *
 * Run:  firebase emulators:exec --project demo-firestoreorm-test --only firestore \
 *         "node docs/plans/issue-38-bulkwriter-recursive-delete/probes/04-same-doc-commit-order.mjs"
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';

const app = initializeApp({ projectId: 'demo-firestoreorm-test' });
const db = getFirestore(app);
const col = db.collection(`probe_order_${Date.now()}`);

const ITERATIONS = 300;
let secondWon = 0;
let firstWon = 0;
let other = 0;

for (let i = 0; i < ITERATIONS; i++) {
  const ref = col.doc(`d${i}`);
  const writer = db.bulkWriter();
  const p1 = writer.set(ref, { v: 'first' });
  const p2 = writer.set(ref, { v: 'second' });
  await writer.close();
  await Promise.allSettled([p1, p2]);
  const stored = (await ref.get()).data();
  if (stored?.v === 'second') secondWon++;
  else if (stored?.v === 'first') firstWon++;
  else other++;
}

console.log(
  JSON.stringify(
    {
      probe: 'P-same-doc-commit-order',
      iterations: ITERATIONS,
      lastEnqueuedWon: secondWon,
      firstEnqueuedWon: firstWon,
      other,
      verdict:
        firstWon > 0
          ? 'ORDER IS NOT GUARANTEED — the first-enqueued write won at least once'
          : 'last-enqueued won every time in this run (absence of evidence, not a guarantee)',
    },
    null,
    2,
  ),
);

await db.recursiveDelete(col);
await app.delete();
