/**
 * Investigation probe P1 for issue #72.
 *
 * Run through the Firestore emulator with ts-node. It answers SDK behavior only: whether every
 * direct document write and WriteBatch.commit() exposes a FirebaseFirestore.Timestamp writeTime.
 * It is deliberately not a permanent regression test; the implementation must promote these
 * observations to the integration suite described in PLAN.md §8.
 */
import { Firestore, Timestamp } from 'firebase-admin/firestore';

async function main(): Promise<void> {
  const db = new Firestore({ projectId: 'demo-firestoreorm-test' });
  const col = db.collection(`issue_72_probe_${Date.now()}`);
  const a = col.doc('a');
  const b = col.doc('b');

  const direct = await a.set({ n: 1 });
  const batch = db.batch();
  batch.set(b, { n: 2 });
  const batched = await batch.commit();

  console.log(JSON.stringify({
    directIsTimestamp: direct.writeTime instanceof Timestamp,
    batchLength: batched.length,
    batchIsTimestamp: batched[0]?.writeTime instanceof Timestamp,
  }));
  await db.recursiveDelete(col);
  await db.terminate();
}

void main();
