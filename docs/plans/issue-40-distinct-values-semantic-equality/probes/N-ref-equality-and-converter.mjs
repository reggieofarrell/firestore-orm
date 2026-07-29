/**
 * Probe: DocumentReference.isEqual sensitivity to the attached converter + cross-instance identity,
 * and how Timestamp / GeoPoint / VectorValue / Bytes / maps come back from `doc.data()`.
 *
 * Run (from the repo root, emulator auto-started):
 *   npx firebase emulators:exec --only firestore --project demo-firestoreorm-test \
 *     "node docs/plans/issue-40-distinct-values-semantic-equality/probes/N-ref-equality-and-converter.mjs"
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, GeoPoint, FieldValue } from 'firebase-admin/firestore';
import { createRequire } from 'node:module';

const out = {};
const require = createRequire(import.meta.url);
const readPkg = name =>
  JSON.parse(
    require('node:fs').readFileSync(
      require('node:path').join(process.cwd(), 'node_modules', name, 'package.json'),
      'utf8',
    ),
  ).version;
out.firebase_admin_version = readPkg('firebase-admin');
out.gcloud_firestore_version = readPkg('@google-cloud/firestore');
out.ts_typeof_toJSON = typeof Timestamp.now().toJSON;

// Honour FIRESTORE_EMULATOR_HOST when the caller points at an alternate port (e.g. 8099 when
// 8080 is taken). Default to the repo's firebase.json port so a bare `node` run still works
// under `firebase emulators:exec` with the stock config.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const app = initializeApp({ projectId: 'demo-p40' });
const db = getFirestore(app);

// --- ref isEqual vs an attached converter ---
const plainRef = db.doc('targets/t1');
const convRef = db
  .collection('targets')
  .withConverter({ toFirestore: d => d, fromFirestore: s => s.data() })
  .doc('t1');
out.ref_same_path_plain_vs_converted_isEqual = plainRef.isEqual(convRef);
out.ref_same_path_plain_vs_converted_pathEq = plainRef.path === convRef.path;

const app2 = initializeApp({ projectId: 'demo-p40' }, 'second');
const db2 = getFirestore(app2);
out.ref_cross_instance_isEqual = plainRef.isEqual(db2.doc('targets/t1'));
out.ref_cross_instance_pathEq = plainRef.path === db2.doc('targets/t1').path;

// --- write structured values, read back, inspect ---
const col = db.collection(`p40_${process.pid}`);
await col.doc('a').set({
  m: { x: 1, y: { z: 'q' } },
  arr: [1, 'two', { k: 3 }],
  ts: new Timestamp(1700000000, 123456789),
  gp: new GeoPoint(1.5, -2.25),
  ref: db.doc('targets/t1'),
  bytes: Buffer.from([1, 2, 3]),
  vec: FieldValue.vector([1, 2, 3]),
  nan: NaN,
  negzero: -0,
});
// Same semantic values; map keys written in a DIFFERENT order.
await col.doc('b').set({
  m: { y: { z: 'q' }, x: 1 },
  arr: [1, 'two', { k: 3 }],
  ts: new Timestamp(1700000000, 123456789),
  gp: new GeoPoint(1.5, -2.25),
  ref: db.doc('targets/t1'),
  bytes: Buffer.from([1, 2, 3]),
  vec: FieldValue.vector([1, 2, 3]),
  nan: NaN,
  negzero: 0,
});

const snap = await col.get();
const byId = Object.fromEntries(snap.docs.map(d => [d.id, d.data()]));
const a = byId.a;
const b = byId.b;

const kinds = {};
for (const k of Object.keys(a)) {
  const v = a[k];
  kinds[k] = {
    ctor: v === null ? 'null' : (v?.constructor?.name ?? typeof v),
    protoIsObjectPrototype:
      v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype,
    hasIsEqual: typeof v?.isEqual === 'function',
    jsSetDedupesAcrossDocs: new Set([a[k], b[k]]).size === 1,
    isEqualSaysEqual: typeof v?.isEqual === 'function' ? v.isEqual(b[k]) : null,
  };
}
out.readBackKinds = kinds;
out.map_key_order_a = Object.keys(a.m);
out.map_key_order_b = Object.keys(b.m);
out.negzero_readback_isNegZero = [Object.is(a.negzero, -0), Object.is(b.negzero, -0)];
out.nan_jsSet_dedupes = new Set([a.nan, b.nan]).size === 1;
out.bytes_buffer_equals = a.bytes.equals(b.bytes);
out.ref_readback_isEqual = a.ref.isEqual(b.ref);
out.ref_readback_ownKeys = Object.keys(a.ref);

// JSON.stringify hazard on a read-back DocumentReference (it owns `_firestore`).
try {
  const s = JSON.stringify(a.ref);
  out.json_stringify_ref = `ok, ${s.length} chars`;
} catch (e) {
  out.json_stringify_ref = `THREW: ${e.constructor.name}: ${String(e.message).slice(0, 140)}`;
}

await Promise.all(snap.docs.map(d => d.ref.delete()));
console.log(JSON.stringify(out, null, 2));
process.exit(0);
