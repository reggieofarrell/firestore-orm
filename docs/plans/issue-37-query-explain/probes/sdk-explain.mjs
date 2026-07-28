/**
 * Investigation probe: Admin SDK Query / VectorQuery / AggregateQuery explain()
 * against the Firestore emulator. Asks — does not assert.
 *
 * Proves (on this baseline's peers):
 * - Query has explain + explainStream
 * - VectorQuery has explain at runtime but NOT explainStream; explain missing from firestore.d.ts
 * - AggregateQuery has explain, not explainStream
 * - Emulator: explain() throws "No explain results" (no explainMetrics in response)
 * - Emulator: explainStream({analyze:true}) yields documents WITHOUT a metrics chunk
 *
 * Run:
 *   firebase emulators:exec --project demo-firestoreorm-test --only firestore \
 *     "node docs/plans/issue-37-query-explain/probes/sdk-explain.mjs"
 */
import { createRequire } from 'node:module';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const gcloudPkg = require('@google-cloud/firestore/package.json');
const gcloudRoot = dirname(require.resolve('@google-cloud/firestore/package.json'));
const dts = readFileSync(join(gcloudRoot, 'types/firestore.d.ts'), 'utf8');
const vqBlock = dts.slice(dts.indexOf('export class VectorQuery<'), dts.indexOf('export class VectorValue'));

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';

const appName = `explain-probe-${Date.now()}`;
const app = initializeApp({ projectId: 'demo-firestoreorm-test' }, appName);
const db = getFirestore(app);
const col = db.collection(`explain_probe_${Date.now()}`);

await col.doc('a').set({ score: 10, name: 'a', embedding: FieldValue.vector([1, 0, 0]) });
await col.doc('b').set({ score: 20, name: 'b', embedding: FieldValue.vector([0, 1, 0]) });

const q = col.where('score', '>=', 10).orderBy('score');

async function dump(label, promise) {
  try {
    const r = await promise;
    const m = r.metrics;
    console.log(
      JSON.stringify(
        {
          label,
          ok: true,
          snapshotNull: r.snapshot === null,
          snapshotSize: r.snapshot?.size ?? null,
          indexesUsed: m?.planSummary?.indexesUsed,
          executionStats: m?.executionStats
            ? {
                resultsReturned: m.executionStats.resultsReturned,
                readOperations: m.executionStats.readOperations,
                executionDuration: m.executionStats.executionDuration,
                debugStatsKeys: Object.keys(m.executionStats.debugStats || {}),
              }
            : null,
        },
        null,
        2,
      ),
    );
  } catch (e) {
    console.log(
      JSON.stringify(
        {
          label,
          ok: false,
          name: e?.name,
          code: e?.code,
          message: String(e?.message || e),
        },
        null,
        2,
      ),
    );
  }
}

console.log(
  JSON.stringify(
    {
      label: 'env',
      gcloudFirestore: gcloudPkg.version,
      Query_explain: typeof q.explain,
      Query_explainStream: typeof q.explainStream,
      VectorQuery_d_ts_has_explain: /explain\s*\(/.test(vqBlock),
      ExplainMetrics_exported: /export interface ExplainMetrics/.test(dts),
      ExplainOptions_exported: /export interface ExplainOptions/.test(dts),
    },
    null,
    2,
  ),
);

await dump('plan-only', q.explain());
await dump('analyze', q.explain({ analyze: true }));
await dump('analyze-false', q.explain({ analyze: false }));

const vq = col.findNearest({
  vectorField: 'embedding',
  queryVector: [1, 0, 0],
  limit: 2,
  distanceMeasure: 'EUCLIDEAN',
});
console.log(
  JSON.stringify(
    {
      label: 'vector-surface',
      explain: typeof vq.explain,
      explainStream: typeof vq.explainStream,
    },
    null,
    2,
  ),
);
await dump('vector-plan', vq.explain());
await dump('vector-analyze', vq.explain({ analyze: true }));

const aq = col.where('score', '>=', 10).count();
console.log(
  JSON.stringify(
    {
      label: 'aggregate-surface',
      explain: typeof aq.explain,
      explainStream: typeof aq.explainStream,
    },
    null,
    2,
  ),
);
await dump('agg-plan', aq.explain());
await dump('agg-analyze', aq.explain({ analyze: true }));

try {
  const chunks = [];
  await new Promise((resolve, reject) => {
    q.explainStream({ analyze: true })
      .on('data', d => chunks.push({ hasDoc: !!d.document, hasMetrics: !!d.metrics }))
      .on('error', reject)
      .on('end', resolve);
  });
  console.log(JSON.stringify({ label: 'explainStream', ok: true, chunks }, null, 2));
} catch (e) {
  console.log(
    JSON.stringify({ label: 'explainStream', ok: false, message: String(e?.message || e) }, null, 2),
  );
}

await deleteApp(app);
process.exit(0);
