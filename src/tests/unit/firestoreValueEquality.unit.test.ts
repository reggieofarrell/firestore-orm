/**
 * Strategy: unit-test `distinctFirestoreValues` (issue #40) through its public API only — no private
 * `canonicalize` access. Constructs Firestore value classes directly (`Timestamp`, `GeoPoint`,
 * `FieldValue.vector`) and builds `DocumentReference`s via a real Admin `Firestore` pointed at the
 * emulator host without I/O (`db.doc(...)` never connects). No Firestore mock is needed.
 *
 * Verification points (plan §8.2 U-1…U-23):
 *  - Structured maps/arrays dedupe by semantic equality with sorted map keys (T4 / T1).
 *  - Timestamp / GeoPoint / DocumentReference / Bytes / VectorValue compare by value (P1).
 *  - Refs key by `.path`, not `isEqual` — converted vs unconverted same-path refs merge (T3).
 *  - Delimiter-injection pairs stay distinct (T1); cross-type pairs stay distinct (T6 / T8).
 *  - `undefined` drops, `null` survives; nested undefined ≠ nested null (T5 / ADR-0020 B9).
 *  - Unrecognized instances use a call-scoped identity registry (T2); `Date` is special-cased (D4).
 *  - `NaN` / `-0` preserve SameValueZero / Firestore ordering (T6); BigInt shares the numeric tag (N3).
 *  - Cycles and depth past MAX_DEPTH terminate on markers without throwing (T7).
 *  - First-seen order and first-instance retention are preserved.
 */
import { getApps, initializeApp } from 'firebase-admin/app';
import {
  DocumentReference,
  FieldValue,
  GeoPoint,
  getFirestore,
  Timestamp,
} from 'firebase-admin/firestore';
import { distinctFirestoreValues } from '../../utils/firestoreValueEquality.js';

/**
 * Returns a Firestore instance suitable for building DocumentReferences without I/O.
 * Reuses an existing admin app when present so parallel unit suites do not collide on the default
 * app name; otherwise creates a dedicated demo app pointed at the emulator host.
 */
function testDb() {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
  const existing = getApps()[0];
  const app = existing ?? initializeApp({ projectId: 'demo-firestoreorm-unit-p40' }, 'p40-unit');
  return getFirestore(app);
}

/** Minimal custom class used to exercise the identity-fallback path (D4 / T2). */
class Custom {
  constructor(readonly n: number) {}
}

describe('distinctFirestoreValues (issue #40)', () => {
  const db = testDb();

  it('U-1: equal maps with different key order → 1 (T4)', () => {
    expect(
      distinctFirestoreValues([
        { x: 1, y: 2 },
        { y: 2, x: 1 },
      ]),
    ).toHaveLength(1);
  });

  it('U-2: maps that differ in a value → 2 (T1, T8)', () => {
    expect(distinctFirestoreValues([{ x: 1 }, { x: 2 }])).toHaveLength(2);
  });

  it('U-3: equal deep nested map/array → 1 (T4)', () => {
    const a = { x: 1, nest: { y: [1, { z: 2 }] } };
    const b = { nest: { y: [1, { z: 2 }] }, x: 1 };
    expect(distinctFirestoreValues([a, b])).toHaveLength(1);
  });

  it('U-4: array order is significant → 2 (T1)', () => {
    expect(
      distinctFirestoreValues([
        [1, 2],
        [2, 1],
      ]),
    ).toHaveLength(2);
  });

  it('U-5: equal Timestamps → 1; nanosecond difference → 2 (P1, T8)', () => {
    const a = new Timestamp(1700000000, 123);
    const b = new Timestamp(1700000000, 123);
    const c = new Timestamp(1700000000, 124);
    expect(distinctFirestoreValues([a, b])).toHaveLength(1);
    expect(distinctFirestoreValues([a, c])).toHaveLength(2);
  });

  it('U-6: equal GeoPoints → 1; different → 2 (P1)', () => {
    expect(
      distinctFirestoreValues([new GeoPoint(1.5, -2.25), new GeoPoint(1.5, -2.25)]),
    ).toHaveLength(1);
    expect(
      distinctFirestoreValues([new GeoPoint(1.5, -2.25), new GeoPoint(1.5, -2.26)]),
    ).toHaveLength(2);
  });

  it('U-7: same-path refs (plain vs withConverter) → 1; different paths → 2 (T3)', () => {
    // DocumentReference.isEqual compares the attached converter, so plain vs converted isEqual is
    // false for the same path — keying by .path is what makes this assert length 1.
    const plain = db.doc('targets/t1');
    const converted = db
      .collection('targets')
      .withConverter({
        toFirestore: (d: Record<string, unknown>) => d,
        fromFirestore: s => s.data() as Record<string, unknown>,
      })
      .doc('t1');
    expect(plain.isEqual(converted)).toBe(false);
    expect(plain.path).toBe(converted.path);
    expect(distinctFirestoreValues([plain, converted])).toHaveLength(1);
    expect(distinctFirestoreValues([plain, db.doc('targets/t2')])).toHaveLength(2);
  });

  it('U-8: equal Buffers → 1; different byte order → 2 (N2, P1)', () => {
    expect(distinctFirestoreValues([Buffer.from([1, 2]), Buffer.from([1, 2])])).toHaveLength(1);
    expect(distinctFirestoreValues([Buffer.from([1, 2]), Buffer.from([2, 1])])).toHaveLength(2);
  });

  it('U-9: equal FieldValue.vector values → 1; different → 2 (P1)', () => {
    const a = FieldValue.vector([1, 2]);
    const b = FieldValue.vector([1, 2]);
    const c = FieldValue.vector([1, 3]);
    expect(distinctFirestoreValues([a, b])).toHaveLength(1);
    expect(distinctFirestoreValues([a, c])).toHaveLength(2);
  });

  it("U-10: ['a','b'] vs ['a,s:b'] → 2 (T1 delimiter injection)", () => {
    expect(distinctFirestoreValues([['a', 'b'], ['a,s:b']])).toHaveLength(2);
  });

  it("U-11: {'a=s:x,b':1} vs {a:'x',b:1} → 2 (T1 delimiter injection)", () => {
    expect(distinctFirestoreValues([{ 'a=s:x,b': 1 }, { a: 'x', b: 1 }])).toHaveLength(2);
  });

  it('U-12: cross-type pairs stay distinct (T6, T8)', () => {
    expect(distinctFirestoreValues(['1', 1])).toHaveLength(2);
    expect(distinctFirestoreValues([NaN, null])).toHaveLength(2);
    expect(distinctFirestoreValues([{}, []])).toHaveLength(2);
    expect(distinctFirestoreValues([{ a: 1 }, [1]])).toHaveLength(2);
    const ref = db.doc('targets/t1');
    expect(distinctFirestoreValues([ref, 'targets/t1'])).toHaveLength(2);
  });

  it('U-13: drops undefined, keeps null; nested undefined ≠ nested null (T5)', () => {
    expect(distinctFirestoreValues([null, undefined, null])).toEqual([null]);
    expect(distinctFirestoreValues([{ a: undefined }, { a: null }])).toHaveLength(2);
  });

  it('U-14: unrecognized instances use call-scoped identity registry (T2)', () => {
    const a = new Custom(1);
    const b = new Map();
    const c = new Set();
    expect(distinctFirestoreValues([a, b, c])).toHaveLength(3);
    expect(distinctFirestoreValues([new Custom(1), new Custom(1)])).toHaveLength(2);
    expect(distinctFirestoreValues([a, a])).toHaveLength(1);
  });

  it('U-15: equal Dates → 1 (D4)', () => {
    expect(distinctFirestoreValues([new Date(5), new Date(5)])).toHaveLength(1);
  });

  it('U-16: NaN twice → 1 (T6)', () => {
    expect(distinctFirestoreValues([NaN, NaN])).toHaveLength(1);
  });

  it('U-17: 0 and -0 → 1 (T6)', () => {
    expect(distinctFirestoreValues([0, -0])).toHaveLength(1);
  });

  it('U-18: structurally equal cyclic objects → 1 and do not throw (T7)', () => {
    const a: Record<string, unknown> = { x: 1 };
    a.self = a;
    const b: Record<string, unknown> = { x: 1 };
    b.self = b;
    expect(() => distinctFirestoreValues([a, b])).not.toThrow();
    expect(distinctFirestoreValues([a, b])).toHaveLength(1);
  });

  it('U-19: plain {path} map vs real DocumentReference → 2 (T8)', () => {
    const ref = db.doc('a/b');
    expect(distinctFirestoreValues([{ path: 'a/b' }, ref])).toHaveLength(2);
    expect(ref).toBeInstanceOf(DocumentReference);
  });

  it('U-20: nesting past MAX_DEPTH does not throw (T7)', () => {
    // Build a chain deeper than MAX_DEPTH (64) so the walk hits the depth marker instead of
    // overflowing the stack — only reachable through converter output in practice.
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 70; i++) {
      deep = { nest: deep };
    }
    expect(() => distinctFirestoreValues([deep])).not.toThrow();
    expect(distinctFirestoreValues([deep])).toHaveLength(1);
  });

  it('U-21: own enumerable __proto__ data property stays distinct and does not pollute (N12)', () => {
    const withProto = Object.create(Object.prototype);
    Object.defineProperty(withProto, '__proto__', {
      value: 'own-value',
      enumerable: true,
      writable: true,
      configurable: true,
    });
    const empty = {};
    expect(distinctFirestoreValues([withProto, empty])).toHaveLength(2);
    expect(Object.getPrototypeOf(withProto)).toBe(Object.prototype);
  });

  it('U-22: first-seen order preserved; retained representative is the first instance', () => {
    const first = { x: 1, y: 2 };
    const second = { y: 2, x: 1 }; // semantically equal, different instance
    const third = { z: 3 };
    const result = distinctFirestoreValues([first, third, second]);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(first);
    expect(result[1]).toBe(third);
  });

  it('U-23: 1n and 1 → 1 (N3 shared numeric tag)', () => {
    expect(distinctFirestoreValues([1n, 1])).toHaveLength(1);
  });
});
