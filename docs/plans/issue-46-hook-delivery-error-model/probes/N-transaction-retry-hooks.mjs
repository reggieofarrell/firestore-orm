/**
 * Probe: whether transaction contention can cause the callback and its before-hook to execute more
 * times than the number of logical public operations.
 *
 * This asks what the SDK/emulator does; it is not a future-contract assertion.
 *
 * Run from the repository root after `npm run build`:
 *   firebase emulators:exec --project demo-firestoreorm-test --only firestore \
 *     "node docs/plans/issue-46-hook-delivery-error-model/probes/N-transaction-retry-hooks.mjs"
 */
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { FirestoreRepository } from '../../../../dist/index.js';

const app = initializeApp({ projectId: 'demo-firestoreorm-test' }, `issue-46-retry-${Date.now()}`);
const db = getFirestore(app);
const path = `issue_46_retry_${Date.now()}`;
const repo = new FirestoreRepository(db, path);
const id = 'counter';

await db.collection(path).doc(id).set({ value: 0 });

let beforeUpdateCalls = 0;
repo.on('beforeUpdate', () => {
  beforeUpdateCalls += 1;
});

const callbackAttempts = [0, 0];
let firstReads = 0;
let releaseFirstReads;
const bothFirstReads = new Promise(resolve => {
  releaseFirstReads = resolve;
});

async function increment(worker) {
  return repo.runInTransaction(
    async (tx, txRepo) => {
      callbackAttempts[worker] += 1;
      const current = await txRepo.getInTransaction(tx, id);
      if (callbackAttempts[worker] === 1) {
        firstReads += 1;
        if (firstReads === 2) releaseFirstReads();
        await bothFirstReads;
      }
      await txRepo.updateInTransaction(tx, id, { value: current.value + 1 });
    },
    { maxAttempts: 5 },
  );
}

await Promise.all([increment(0), increment(1)]);
const final = await repo.getById(id);

console.log(
  JSON.stringify(
    {
      logical_transactions: 2,
      callback_attempts: callbackAttempts,
      total_callback_attempts: callbackAttempts[0] + callbackAttempts[1],
      before_update_hook_calls: beforeUpdateCalls,
      final_value: final?.value,
    },
    null,
    2,
  ),
);

await db.collection(path).doc(id).delete();
await deleteApp(app);
