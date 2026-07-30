/**
 * Investigation probe for issue #65.
 *
 * Run: node docs/plans/issue-65-query-explain-stream/probes/sdk-surface.mjs
 *
 * Verifies the installed Admin SDK's typed/runtime explain-stream surface, the exact
 * `limitToLast()` throw, and that VectorQuery omits the method at runtime. This asks
 * about the SDK; it is deliberately not a regression test.
 */
import { Firestore, FieldValue } from 'firebase-admin/firestore';

const db = new Firestore({ projectId: 'demo-firestoreorm-plan-probe' });
const query = db.collection('probe').orderBy('score');
const limited = query.limitToLast(1);

console.log(
  JSON.stringify(
    {
      queryExplainStream: typeof query.explainStream,
      vectorExplainStream: typeof query.findNearest('embedding', FieldValue.vector([1]), {
        limit: 1,
        distanceMeasure: 'EUCLIDEAN',
      }).explainStream,
      limitToLastThrow: (() => {
        try {
          limited.explainStream({ analyze: true });
          return null;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      })(),
    },
    null,
    2,
  ),
);

await db.terminate();
