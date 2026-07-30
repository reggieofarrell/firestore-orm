/**
 * Investigation probe for issue #65.
 *
 * Run through the emulator so FIRESTORE_EMULATOR_HOST is set:
 * firebase emulators:exec --project demo-firestoreorm-test --only firestore \
 *   "node docs/plans/issue-65-query-explain-stream/probes/emulator-stream.mjs"
 *
 * Records the raw chunks from `Query.explainStream({ analyze: true })`. It asks whether
 * the emulator supplies a terminal metrics chunk; it is not a permanent regression test.
 */
import { Firestore } from 'firebase-admin/firestore';

const db = new Firestore({ projectId: 'demo-firestoreorm-test' });
const collection = `issue_65_explain_stream_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const ref = db.collection(collection).doc('one');

try {
  await ref.set({ score: 1 });
  const chunks = [];
  for await (const chunk of db.collection(collection).orderBy('score').explainStream({ analyze: true })) {
    chunks.push({
      documentId: chunk.document?.id ?? null,
      hasDocument: chunk.document !== undefined,
      hasMetrics: chunk.metrics !== undefined,
    });
  }
  console.log(JSON.stringify(chunks, null, 2));
} finally {
  await ref.delete().catch(() => undefined);
  await db.terminate();
}
