import { DocumentReference, GeoPoint, Timestamp } from 'firebase-admin/firestore';
import { isGenuineVectorValue } from './vectorValue.js';

/**
 * Firestore-aware semantic deduplication of read field values (issue #40).
 *
 * `QueryBuilder.distinctValues()` is a **client-side** terminal: it downloads the matching documents
 * and dedupes `doc.data()[field]` in process. A JavaScript `Set` dedupes objects by *reference
 * identity*, so two structurally identical maps — or two `Timestamp`s naming the same instant read
 * from two documents — were reported as separate values. Firestore's own value equality is
 * structural (maps are unordered key/value sets; references compare by path), so identity dedupe
 * contradicted the method's documented contract for every non-scalar type.
 *
 * The fix canonicalizes each value into a **JSON-serializable, type-tagged tree** and dedupes on
 * `JSON.stringify` of that tree, keeping the first value seen for each key. Type tags keep values of
 * different Firestore types apart (`'1'` never keys the same as `1`, `NaN` never as `null`), and
 * letting `JSON.stringify` do the quoting is what makes the encoding injection-proof: a hand-rolled
 * delimiter join silently merges `['a', 'b']` with `['a,s:b']`.
 *
 * **Never over-merge.** Two values collapse only when the canonical form proves them equal. Anything
 * unrecognized — a `Map`, a `Set`, a custom class a `readConverter` returned — falls back to
 * per-instance identity, which is exactly the old behavior. That direction is safe (a distinct value
 * survives as distinct); the other direction silently drops results from a caller's list. Every
 * Firestore value class has a prototype other than `Object.prototype`, so a failed nominal check
 * lands in the identity fallback rather than in the plain-object branch.
 */

/** The canonical tree emitted by {@link canonicalize} — JSON-serializable by construction. */
type CanonicalNode = string | number | boolean | null | CanonicalNode[];

/**
 * Depth ceiling for the canonicalization walk. Firestore itself caps map nesting at 20 levels, but
 * `doc.data()` returns `readConverter` output, which is arbitrary caller code — so the walk needs its
 * own bound. Hitting it emits a terminal marker instead of recursing, which can only ever *merge*
 * values that agree down to this depth. Together with the path-scoped cycle `seen` set, that bounds
 * *recursion depth* so cyclic or over-deep input cannot overflow the stack.
 *
 * It does **not** bound memory. The canonical form is fully expanded, so converter output that
 * reuses one shared subtree under many keys (an acyclic shared-subtree DAG) can still exhaust heap —
 * the path-scoped `seen` set correctly treats that sharing as a DAG, not a cycle, and `MAX_DEPTH`
 * never fires on a shallow graph. Stored Firestore data cannot trigger this (`doc.data()` builds
 * fresh unshared objects per map, and nesting is capped at 20); only memoized `readConverter` graphs
 * can. Memoizing `canonicalize` on a per-pass `WeakMap` would make the walk linear in distinct
 * nodes — that is a follow-up, not this change (see #77).
 */
const MAX_DEPTH = 64;

/**
 * Per-instance identity registry for values the canonicalizer cannot describe structurally.
 *
 * Scoped to a whole dedupe pass, **not** to one key computation: a registry created per value would
 * restart the counter at `0`, so every unrecognized instance would key to `['ident', 0]` and they
 * would all silently collapse into a single value — the precise over-merge the identity fallback
 * exists to prevent.
 */
type IdentityRegistry = { readonly map: WeakMap<object, number>; next: number };

function identityKey(value: object, ids: IdentityRegistry): number {
  const existing = ids.map.get(value);
  if (existing !== undefined) {
    return existing;
  }
  const assigned = ids.next++;
  ids.map.set(value, assigned);
  return assigned;
}

/**
 * Canonical key for a number.
 *
 * `-0` collapses into `0` and `NaN` keys as the string `'NaN'`, matching both Firestore's total
 * ordering (where `-0.0`, `0.0` and integer `0` compare equal, and `NaN` is a single value) and the
 * `Set` behavior this replaces (`SameValueZero` already merged `-0`/`0` and `NaN`/`NaN`). Preserving
 * that is a compatibility requirement, not an incidental detail.
 */
function numberKey(value: number): string {
  return value === 0 ? '0' : String(value);
}

/** True for an object literal / `Object.create(null)` map — the shape a Firestore map decodes to. */
function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function canonicalize(
  value: unknown,
  seen: Set<object>,
  ids: IdentityRegistry,
  depth: number,
): CanonicalNode {
  if (depth > MAX_DEPTH) {
    return ['deep'];
  }
  if (value === undefined) {
    // Unreachable for a top-level field (dropped before keying) but reachable nested, because a
    // readConverter may return `{ a: undefined }`. Tagged distinctly from `null` (ADR-0020, B9).
    return ['u'];
  }
  if (value === null) {
    return ['n'];
  }
  switch (typeof value) {
    case 'boolean':
      return ['b', value];
    case 'number':
      return ['d', numberKey(value)];
    // With `Firestore.settings({ useBigInt: true })` integers decode to BigInt. Firestore treats an
    // integer and the equal double as one value, so BigInt shares the numeric tag: `1n` keys as `1`.
    case 'bigint':
      return ['d', String(value)];
    case 'string':
      return ['s', value];
    case 'symbol':
    case 'function':
      return ['ident', identityKey(value as object, ids)];
  }

  const obj = value as object;

  // Nominal checks first: each of these types has a non-`Object.prototype` prototype, so if the
  // check fails (e.g. a duplicated @google-cloud/firestore copy defeats `instanceof`) the value
  // falls through to the identity fallback, never to the plain-object branch.
  if (obj instanceof Timestamp) {
    return ['t', obj.seconds, obj.nanoseconds];
  }
  if (obj instanceof GeoPoint) {
    return ['g', numberKey(obj.latitude), numberKey(obj.longitude)];
  }
  if (obj instanceof DocumentReference) {
    // Keyed by document path, NOT `isEqual`: `DocumentReference.isEqual` also compares the attached
    // converter, so the same path read through a converted vs. unconverted reference is reported as
    // unequal. Firestore's own reference equality is the resource path.
    return ['r', obj.path];
  }
  if (obj instanceof Uint8Array) {
    // Firestore Bytes decode to a Node `Buffer`, which extends `Uint8Array`; neither has `isEqual`.
    return ['y', Buffer.from(obj).toString('base64')];
  }
  if (isGenuineVectorValue(obj)) {
    return ['v', (obj as { toArray(): number[] }).toArray().map(numberKey)];
  }
  if (obj instanceof Date) {
    // Firestore never stores a `Date` (it encodes to Timestamp), but a readConverter commonly
    // returns one, and this method is typed against the READ model.
    return ['date', numberKey(obj.getTime())];
  }

  if (seen.has(obj)) {
    // Cycle on the current path — only reachable through readConverter output. Terminating on a
    // marker keeps the walk total; a plain recursion overflows the stack.
    return ['cycle'];
  }

  if (Array.isArray(obj)) {
    seen.add(obj);
    const node: CanonicalNode = ['a', obj.map(entry => canonicalize(entry, seen, ids, depth + 1))];
    seen.delete(obj);
    return node;
  }

  if (isPlainObject(obj)) {
    seen.add(obj);
    const record = obj as Record<string, unknown>;
    // Keys are sorted because a Firestore map is an unordered key/value set, and the emulator
    // preserves each document's written key order — so two semantically equal maps genuinely arrive
    // with different `Object.keys` order.
    const entries: CanonicalNode = Object.keys(record)
      .sort()
      .map(key => [key, canonicalize(record[key], seen, ids, depth + 1)]);
    seen.delete(obj);
    return ['o', entries];
  }

  return ['ident', identityKey(obj, ids)];
}

/**
 * Returns the semantically distinct members of `values`, preserving first-seen order.
 *
 * Drops `undefined` (an absent field) but preserves a stored `null` as a real, distinct value — a
 * loose `!= undefined` would strip both, conflating "field absent" with "field is null" (ADR-0020).
 *
 * Structured and reference values (maps, arrays, `Timestamp`, `GeoPoint`, `DocumentReference`,
 * `Bytes`, `VectorValue`) are compared by Firestore-aware semantic equality rather than by object
 * identity. Values the canonicalizer cannot describe fall back to per-instance identity and are
 * therefore never merged — see the module JSDoc.
 */
export function distinctFirestoreValues<V>(values: Iterable<V>): V[] {
  const ids: IdentityRegistry = { map: new WeakMap(), next: 0 };
  const distinct = new Map<string, V>();
  for (const value of values) {
    if (value === undefined) {
      continue;
    }
    const key = JSON.stringify(canonicalize(value, new Set<object>(), ids, 0));
    if (!distinct.has(key)) {
      distinct.set(key, value);
    }
  }
  return [...distinct.values()];
}
