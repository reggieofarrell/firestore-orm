/**
 * Safe object-copy primitives shared by the recursive object walkers (`convertTimestampsToMillis`,
 * `flattenToDotNotation`). These helpers accept arbitrary, potentially untrusted input (public
 * exports, request bodies, Firestore documents originally written by less-trusted clients), so key
 * assignment must never invoke an inherited setter.
 *
 * A plain `obj[key] = value` invokes the `__proto__` setter when `key === '__proto__'`, which
 * mutates the *output object's* prototype chain rather than creating an own property (CWE-1321
 * prototype pollution). Even though this pollutes only the local output (not the global
 * `Object.prototype`), it can still turn an absent own field into a truthy inherited field, which is
 * enough to subvert authorization / feature-flag checks that read the returned object. `safeAssign`
 * defines an own data property instead, so `__proto__` is copied faithfully as a normal key and the
 * returned object's prototype/own-key shape can never be attacker-controlled.
 */

/**
 * Assigns `value` to `target[key]` as an own, enumerable, writable data property without invoking
 * any inherited setter. Use in place of `target[key] = value` when `key` is caller-controlled.
 */
export function safeAssign(target: Record<string, unknown>, key: string, value: unknown): void {
  // `__proto__` (and, defensively, any key whose plain assignment would hit a setter on the
  // prototype chain) is written via defineProperty so it becomes an own data property.
  if (key === '__proto__') {
    Object.defineProperty(target, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    return;
  }
  target[key] = value;
}

/**
 * Recursively freezes a value and every nested plain object / array it owns, returning it. Used for
 * observe-only lifecycle payloads (e.g. delete hook documents) so a before-hook cannot mutate NESTED
 * data that a later after-hook — or an audit/outbox consumer — then observes (review R2). A shallow
 * `Object.freeze` leaves nested objects mutable; this closes that gap for payloads that have no
 * documented mutation contract.
 *
 * Traversal descends into plain objects and arrays REGARDLESS of whether the container is already
 * frozen — only the final `Object.freeze` call is skipped when the node is already frozen — so a
 * mutable grandchild beneath an already-frozen plain parent is still frozen (review S4). A `WeakSet`
 * makes traversal cycle-safe (a self-referential object would otherwise recurse forever, since the
 * freeze happens only after the descent).
 *
 * **Class-instance carve-out (documented limitation):** only plain objects and arrays are descended.
 * A class instance (Firestore `Timestamp`/`GeoPoint`/`DocumentReference`, or a mutable `Date`/`Map`/
 * custom class a read converter might return) is returned as-is and NOT frozen — its internals are
 * not our data to freeze, and `Object.freeze` cannot protect a `Date`'s internal slot anyway. Delete
 * hook payloads therefore guarantee immutable identity and immutable plain-container data; a
 * class-instance FIELD value must be treated as observe-only by contract. See ADR-0018 / the
 * lifecycle-hooks guide.
 */
export function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  // Only descend plain objects and arrays; leave SDK/other class instances untouched.
  const proto = Object.getPrototypeOf(value);
  const isPlain = Array.isArray(value) || proto === Object.prototype || proto === null;
  if (!isPlain) {
    return value;
  }
  const obj = value as object;
  if (seen.has(obj)) {
    // Cycle: already visited on this call — do not recurse again (the freeze below is idempotent).
    return value;
  }
  seen.add(obj);
  // Descend even when `value` is already frozen: a frozen container does not imply frozen children.
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key], seen);
  }
  return Object.isFrozen(value) ? value : Object.freeze(value);
}
