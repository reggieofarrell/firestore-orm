/**
 * Probe: which Firestore value classes carry an SDK `isEqual`, what a JavaScript `Set` actually does
 * with them, and how `NaN` / `-0` / BigInt behave under `SameValueZero`.
 *
 * Backs §3.2 rows N1-N3 and N6-N7. **No emulator needed** — `db.doc('a/b')` builds a
 * `DocumentReference` without any I/O, so this runs standalone.
 *
 * Run from the repo root:
 *   node docs/plans/issue-40-distinct-values-semantic-equality/probes/N-sdk-value-shapes.mjs
 */
import { Timestamp, GeoPoint, FieldValue, getFirestore } from 'firebase-admin/firestore';
import { initializeApp } from 'firebase-admin/app';

const out = {};
const ts = new Timestamp(1700000000, 123456789);
const ts2 = new Timestamp(1700000000, 123456789);
const gp = new GeoPoint(1.5, -2.25);
const gp2 = new GeoPoint(1.5, -2.25);
const vec = FieldValue.vector([1, 2, 3]);
const vec2 = FieldValue.vector([1, 2, 3]);

out.ts_ctor = ts.constructor.name;
out.ts_isEqual_fn = typeof ts.isEqual;
out.ts_isEqual = ts.isEqual(ts2);
out.ts_proto_is_Object = Object.getPrototypeOf(ts) === Object.prototype;
out.ts_ownKeys = Object.keys(ts);
out.ts_seconds_nanos = [ts.seconds, ts.nanoseconds];
out.ts_toJSON = typeof ts.toJSON === 'function' ? ts.toJSON() : null;

out.gp_ctor = gp.constructor.name;
out.gp_isEqual_fn = typeof gp.isEqual;
out.gp_isEqual = gp.isEqual(gp2);
out.gp_lat_lng = [gp.latitude, gp.longitude];
out.gp_ownKeys = Object.keys(gp);
out.gp_toJSON = typeof gp.toJSON === 'function' ? gp.toJSON() : null;

out.vec_ctor = vec.constructor.name;
out.vec_isEqual_fn = typeof vec.isEqual;
out.vec_isEqual = typeof vec.isEqual === 'function' ? vec.isEqual(vec2) : null;
out.vec_toArray = typeof vec.toArray === 'function' ? vec.toArray() : null;
out.vec_ownKeys = Object.keys(vec);
out.vec_toJSON = typeof vec.toJSON === 'function' ? vec.toJSON() : 'NO toJSON';

// DocumentReference
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const app = initializeApp({ projectId: 'demo-p40' });
const db = getFirestore(app);
const r1 = db.doc('a/b');
const r2 = db.doc('a/b');
const r3 = db.doc('a/c');
out.ref_ctor = r1.constructor.name;
out.ref_isEqual_fn = typeof r1.isEqual;
out.ref_isEqual_same = r1.isEqual(r2);
out.ref_isEqual_diff = r1.isEqual(r3);
out.ref_identity_same = r1 === r2;
out.ref_path = r1.path;
out.ref_ownKeys = Object.keys(r1);
out.ref_toJSON = typeof r1.toJSON === 'function' ? 'has toJSON' : 'NO toJSON';

// Set semantics
out.set_NaN = [...new Set([NaN, NaN])].length;
out.set_negzero = [...new Set([0, -0])].length;
out.set_bigint_vs_num = [...new Set([1, 1n])].length;
out.set_ts = [...new Set([ts, ts2])].length;

// Buffer
const b1 = Buffer.from([1,2,3]);
const b2 = Buffer.from([1,2,3]);
out.buf_ctor = b1.constructor.name;
out.buf_isEqual_fn = typeof b1.isEqual;
out.buf_set = [...new Set([b1,b2])].length;
out.buf_base64 = b1.toString('base64');

console.log(JSON.stringify(out, (k,v) => typeof v === 'bigint' ? String(v)+'n' : v, 2));
process.exit(0);
