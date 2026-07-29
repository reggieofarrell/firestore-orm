/**
 * Probe: does the proposed canonical-key algorithm actually dedupe Firestore values by semantic
 * equality WITHOUT over-merging? Standalone — it re-implements the candidate algorithm here rather
 * than importing `src/`, so it can be run against the unfixed baseline.
 *
 * Two candidate encodings are compared:
 *   NAIVE  — hand-rolled delimiters (`a[s:a,s:b]`), the shape an implementer reaches for first
 *   NESTED — a JSON-safe nested tagged structure passed through JSON.stringify
 *
 * The point of the probe is the ADVERSARIAL cases: values that must stay distinct and that NAIVE
 * silently merges (delimiter injection), plus the type-tag collisions JSON.stringify alone produces.
 *
 * Run: node docs/plans/issue-40-distinct-values-semantic-equality/probes/P-canonical-key-algorithm.mjs
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, GeoPoint, FieldValue } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const db = getFirestore(initializeApp({ projectId: 'demo-p40' }));

// ── shared recognizers (mirrors src/utils/vectorValue.ts's nominal check) ────────────────────────
let vecCtor;
try {
  vecCtor = FieldValue.vector?.([0])?.constructor ?? null;
} catch {
  vecCtor = null;
}
const isVec = v => vecCtor !== null && v instanceof vecCtor;
const isTs = v => v instanceof Timestamp;
const isGp = v => v instanceof GeoPoint;
const isRef = v => !!v && typeof v === 'object' && typeof v.isEqual === 'function' && 'path' in v && typeof v.path === 'string' && !isTs(v) && !isGp(v);
const isBytes = v => v instanceof Uint8Array;
const isPlain = v => {
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
};

const numKey = n => (n === 0 ? '0' : String(n)); // collapses -0 into 0; String(NaN) === 'NaN'

// ── CANDIDATE A: naive delimiter join ───────────────────────────────────────────────────────────
function naive(v) {
  if (v === undefined) return 'u';
  if (v === null) return 'n';
  switch (typeof v) {
    case 'boolean':
      return `b:${v}`;
    case 'number':
      return `d:${numKey(v)}`;
    case 'bigint':
      return `d:${String(v)}`;
    case 'string':
      return `s:${v}`;
  }
  if (isTs(v)) return `t:${v.seconds}.${v.nanoseconds}`;
  if (isGp(v)) return `g:${v.latitude},${v.longitude}`;
  if (isRef(v)) return `r:${v.path}`;
  if (isBytes(v)) return `y:${Buffer.from(v).toString('base64')}`;
  if (isVec(v)) return `v:[${v.toArray().map(numKey).join(',')}]`;
  if (Array.isArray(v)) return `a[${v.map(naive).join(',')}]`;
  if (isPlain(v))
    return `o{${Object.keys(v)
      .sort()
      .map(k => `${k}=${naive(v[k])}`)
      .join(',')}}`;
  return 'x';
}

// ── CANDIDATE B: JSON-safe nested tagged structure ──────────────────────────────────────────────
const MAX_DEPTH = 64;
function canon(v, seen, ids, depth = 0) {
  if (depth > MAX_DEPTH) return ['deep'];
  if (v === undefined) return ['u'];
  if (v === null) return ['n'];
  switch (typeof v) {
    case 'boolean':
      return ['b', v];
    case 'number':
      return ['d', numKey(v)];
    case 'bigint':
      return ['d', String(v)];
    case 'string':
      return ['s', v];
  }
  if (typeof v !== 'object') return ['ident', identityId(v, ids)];
  if (isTs(v)) return ['t', v.seconds, v.nanoseconds];
  if (isGp(v)) return ['g', numKey(v.latitude), numKey(v.longitude)];
  if (isRef(v)) return ['r', v.path];
  if (isBytes(v)) return ['y', Buffer.from(v).toString('base64')];
  if (isVec(v)) return ['v', v.toArray().map(numKey)];
  if (v instanceof Date) return ['date', numKey(v.getTime())];
  if (seen.has(v)) return ['cycle'];
  if (Array.isArray(v)) {
    seen.add(v);
    const out = ['a', v.map(e => canon(e, seen, ids, depth + 1))];
    seen.delete(v);
    return out;
  }
  if (isPlain(v)) {
    seen.add(v);
    const out = [
      'o',
      Object.keys(v)
        .sort()
        .map(k => [k, canon(v[k], seen, ids, depth + 1)]),
    ];
    seen.delete(v);
    return out;
  }
  return ['ident', identityId(v, ids)]; // unrecognized class instance → never over-merge
}
function identityId(v, ids) {
  if (!ids.map.has(v)) ids.map.set(v, ids.next++);
  return ids.map.get(v);
}
/**
 * IMPORTANT (finding P6): the identity registry must be scoped to the whole dedupe pass, not to one
 * key computation. A fresh registry per call restarts `next` at 0, so EVERY unrecognized instance
 * keys to `["ident",0]` and they all silently collapse into one — the exact over-merge the identity
 * fallback exists to prevent. So the keyer is a factory that closes over one registry.
 */
function createNestedKeyer() {
  const ids = { map: new WeakMap(), next: 0 };
  return v => JSON.stringify(canon(v, new Set(), ids));
}
/** The broken shape, kept to demonstrate the collapse. */
function nestedFreshRegistryPerCall(v) {
  return JSON.stringify(canon(v, new Set(), { map: new WeakMap(), next: 0 }));
}

// ── the current (baseline) behavior, for comparison ─────────────────────────────────────────────
const baseline = values => [...new Set(values)].filter(v => v !== undefined);
/** `makeKeyer` is a factory so each dedupe pass gets its own identity registry. */
const dedupe = (values, makeKeyer) => {
  const key = makeKeyer();
  const out = new Map();
  for (const v of values) {
    if (v === undefined) continue;
    const k = key(v);
    if (!out.has(k)) out.set(k, v);
  }
  return [...out.values()];
};
const constKeyer = fn => () => fn;

// ── cases ───────────────────────────────────────────────────────────────────────────────────────
const ref = db.doc('targets/t1');
const ref2 = db.doc('targets/t1');
const refOther = db.doc('targets/t2');

const cases = [
  // name, values, expected distinct count under SEMANTIC equality
  ['equal maps, different key order', [{ x: 1, y: 2 }, { y: 2, x: 1 }], 1],
  ['different maps', [{ x: 1 }, { x: 2 }], 2],
  ['equal nested maps', [{ a: { b: [1, { c: 'z' }] } }, { a: { b: [1, { c: 'z' }] } }], 1],
  ['equal arrays', [[1, 2, 3], [1, 2, 3]], 1],
  ['array order matters', [[1, 2], [2, 1]], 2],
  ['equal Timestamps', [new Timestamp(1, 2), new Timestamp(1, 2)], 1],
  ['different Timestamps (nanos)', [new Timestamp(1, 2), new Timestamp(1, 3)], 2],
  ['equal GeoPoints', [new GeoPoint(1.5, -2.25), new GeoPoint(1.5, -2.25)], 1],
  ['equal refs (distinct objects)', [ref, ref2], 1],
  ['different refs', [ref, refOther], 2],
  ['equal Bytes', [Buffer.from([1, 2]), Buffer.from([1, 2])], 1],
  ['different Bytes', [Buffer.from([1, 2]), Buffer.from([2, 1])], 2],
  ['equal VectorValues', [FieldValue.vector([1, 2]), FieldValue.vector([1, 2])], 1],
  ['different VectorValues', [FieldValue.vector([1, 2]), FieldValue.vector([1, 3])], 2],
  ['null survives, undefined dropped', [null, undefined, null], 1],
  ['NaN dedupes', [NaN, NaN], 1],
  ['-0 and 0 are one value', [0, -0], 1],
  ['bigint 1n and number 1', [1n, 1], 1],
  ['scalars unchanged', ['a', 'a', 'b'], 2],
  // ── adversarial: cross-type collisions ────────────────────────────────────────────────────────
  ['string "1" vs number 1', ['1', 1], 2],
  ['NaN vs null', [NaN, null], 2],
  ['empty map vs empty array', [{}, []], 2],
  ['map {a:1} vs array', [{ a: 1 }, [1]], 2],
  ['ref path vs equal string', [ref, 'targets/t1'], 2],
  // ── adversarial: DELIMITER INJECTION (this is the one NAIVE gets wrong) ───────────────────────
  ['["a","b"] vs ["a,s:b"]', [['a', 'b'], ['a,s:b']], 2],
  ['{a:"1"} vs {"a=d:1":null} shape', [{ a: '1' }, { 'a=s:1': undefined }], 2],
  ['{"a=s:x,b":1} vs {a:"x", b:1}', [{ 'a=s:x,b': 1 }, { a: 'x', b: 1 }], 2],
];

const rows = [];
for (const [name, values, expected] of cases) {
  rows.push({
    case: name,
    expected,
    baseline: baseline(values).length,
    NAIVE: dedupe(values, constKeyer(naive)).length,
    NESTED: dedupe(values, createNestedKeyer).length,
  });
}

// cycle + unrecognized-class safety (a readConverter can return either)
const cyc = { a: 1 };
cyc.self = cyc;
const cyc2 = { a: 1 };
cyc2.self = cyc2;
let cycleResult;
try {
  cycleResult = `${dedupe([cyc, cyc2], createNestedKeyer).length} distinct (no throw)`;
} catch (e) {
  cycleResult = `THREW ${e.constructor.name}`;
}
let naiveCycle;
try {
  naiveCycle = `${dedupe([cyc, cyc2], constKeyer(naive)).length} distinct`;
} catch (e) {
  naiveCycle = `THREW ${e.constructor.name}: ${String(e.message).slice(0, 60)}`;
}

class Custom {
  constructor(n) {
    this.n = n;
  }
}
const classResult = {
  'expected: two Custom instances stay distinct (identity fallback)': 2,
  'NESTED, call-scoped registry': dedupe([new Custom(1), new Custom(1)], createNestedKeyer).length,
  'NESTED, fresh registry PER KEY (the bug — collapses)': dedupe(
    [new Custom(1), new Custom(1)],
    constKeyer(nestedFreshRegistryPerCall),
  ).length,
  'expected: Custom vs Map vs Set stay distinct': 3,
  'NAIVE (all tagged "x")': dedupe([new Custom(1), new Map(), new Set()], constKeyer(naive)).length,
  'NESTED, call-scoped registry ': dedupe(
    [new Custom(1), new Map(), new Set()],
    createNestedKeyer,
  ).length,
  'expected: equal Dates merge': 1,
  'NESTED Dates': dedupe([new Date(5), new Date(5)], createNestedKeyer).length,
  'expected: same instance appearing twice merges': 1,
  'NESTED same instance twice': (() => {
    const one = new Custom(1);
    return dedupe([one, one], createNestedKeyer).length;
  })(),
};

const fails = rows.filter(r => r.NESTED !== r.expected);
const naiveFails = rows.filter(r => r.NAIVE !== r.expected);
const baselineFails = rows.filter(r => r.baseline !== r.expected);

console.log(JSON.stringify({ rows, cycleResult, naiveCycle, classResult }, null, 2));
console.log('\n--- summary ---');
console.log(`cases: ${rows.length}`);
console.log(`baseline (new Set) wrong on: ${baselineFails.length} -> ${baselineFails.map(r => r.case).join(' | ')}`);
console.log(`NAIVE wrong on: ${naiveFails.length} -> ${naiveFails.map(r => r.case).join(' | ')}`);
console.log(`NESTED wrong on: ${fails.length} -> ${fails.map(r => r.case).join(' | ')}`);
process.exit(fails.length === 0 ? 0 : 1);
