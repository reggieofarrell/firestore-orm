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
