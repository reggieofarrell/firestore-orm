/**
 * Probe: do the NOMINAL checks the canonicalizer relies on hold for values decoded by a real read?
 *
 * "The class is exported from firebase-admin/firestore" and "a value out of `doc.data()` is an
 * `instanceof` that exported class" are different claims. `firebase-admin` re-exports an allowlist
 * from its bundled `@google-cloud/firestore`, and the serializer that decodes a snapshot constructs
 * values from that same package — but only one copy on disk makes `instanceof` hold. This probe
 * asserts the claim the plan actually makes, not the one next to it.
 *
 * Also checks the own-`__proto__` key read (this repo hardens against prototype pollution in
 * `src/utils/safeObject.ts` / `src/utils/dotNotation.ts`, so the canonicalizer's `Object.keys` +
 * `record[key]` walk must handle it) and whether `isGenuineVectorValue`'s lazily-resolved
 * constructor matches a read-back VectorValue.
 *
 * Run (from the repo root):
 *   npx firebase emulators:exec --only firestore --project demo-firestoreorm-test \
 *     "node docs/plans/issue-40-distinct-values-semantic-equality/probes/N-instanceof-across-read-path.mjs"
 */
import { initializeApp } from 'firebase-admin/app';
import {
  getFirestore,
  DocumentReference,
  GeoPoint,
  Timestamp,
  FieldValue,
} from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const db = getFirestore(initializeApp({ projectId: 'demo-p40' }));

// Mirrors src/utils/vectorValue.ts: recover the genuine ctor from FieldValue.vector().
let vecCtor = null;
try {
  vecCtor = FieldValue.vector?.([0])?.constructor ?? null;
} catch {
  vecCtor = null;
}

const col = db.collection(`p40_inst_${process.pid}`);
await col.doc('a').set({
  ts: new Timestamp(1700000000, 123456789),
  gp: new GeoPoint(1.5, -2.25),
  ref: db.doc('targets/t1'),
  bytes: Buffer.from([1, 2, 3]),
  vec: FieldValue.vector([1, 2, 3]),
  map: { x: 1 },
  arr: [1, 2],
});

// Read the SAME document twice, through a converted and an unconverted reference, so the probe also
// covers the path `distinctValues` actually takes on a repository that has a readConverter.
const plainData = (await col.get()).docs[0].data();
const convertedData = (
  await col.withConverter({ toFirestore: d => d, fromFirestore: s => s.data() }).get()
).docs[0].data();

const check = data => ({
  ts_instanceof_Timestamp: data.ts instanceof Timestamp,
  gp_instanceof_GeoPoint: data.gp instanceof GeoPoint,
  ref_instanceof_DocumentReference: data.ref instanceof DocumentReference,
  bytes_instanceof_Uint8Array: data.bytes instanceof Uint8Array,
  bytes_is_Buffer: Buffer.isBuffer(data.bytes),
  vec_instanceof_resolved_ctor: vecCtor !== null && data.vec instanceof vecCtor,
  map_proto_is_ObjectPrototype: Object.getPrototypeOf(data.map) === Object.prototype,
  arr_isArray: Array.isArray(data.arr),
  // The classes must NOT satisfy the plain-object branch, or a failed nominal check would
  // over-merge instead of degrading to identity.
  ts_proto_is_ObjectPrototype: Object.getPrototypeOf(data.ts) === Object.prototype,
  ref_proto_is_ObjectPrototype: Object.getPrototypeOf(data.ref) === Object.prototype,
  bytes_proto_is_ObjectPrototype: Object.getPrototypeOf(data.bytes) === Object.prototype,
  vec_proto_is_ObjectPrototype: Object.getPrototypeOf(data.vec) === Object.prototype,
});

const out = {
  vecCtor_resolved: vecCtor !== null ? vecCtor.name : null,
  unconvertedRead: check(plainData),
  convertedRead: check(convertedData),
};

// own-`__proto__` data property: Object.keys must see it and the indexed read must return it.
const polluted = {};
Object.defineProperty(polluted, '__proto__', {
  value: 'own-value',
  writable: true,
  enumerable: true,
  configurable: true,
});
out.ownProtoKey = {
  objectKeys: Object.keys(polluted),
  indexedRead: polluted['__proto__'],
  readIsOwnValue: polluted['__proto__'] === 'own-value',
  protoUnchanged: Object.getPrototypeOf(polluted) === Object.prototype,
};

await Promise.all((await col.get()).docs.map(d => d.ref.delete()));

const flat = { ...out.unconvertedRead, ...out.convertedRead };
const mustBeTrue = Object.entries(flat).filter(([k]) => !k.endsWith('_proto_is_ObjectPrototype'));
const mustBeFalse = Object.entries(flat).filter(([k]) => k.endsWith('_proto_is_ObjectPrototype') && k !== 'map_proto_is_ObjectPrototype');
const bad = [
  ...mustBeTrue.filter(([, v]) => v !== true).map(([k]) => `${k} !== true`),
  ...mustBeFalse.filter(([, v]) => v !== false).map(([k]) => `${k} !== false`),
];

console.log(JSON.stringify(out, null, 2));
console.log(`\n--- ${bad.length === 0 ? 'ALL NOMINAL CHECKS HOLD' : 'FAILURES: ' + bad.join(', ')} ---`);
process.exit(bad.length === 0 ? 0 : 1);
