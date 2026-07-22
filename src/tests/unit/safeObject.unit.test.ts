/**
 * Strategy: unit tests for the safe object-copy / immutability primitives in src/utils/safeObject.ts.
 *  - `safeAssign`: assigns own data properties without invoking an inherited setter (prototype-
 *    pollution safe for the `__proto__` key).
 *  - `deepFreeze`: recursively freezes plain objects/arrays (used for observe-only delete hook
 *    payloads, review R2) while leaving non-plain values (class instances) untouched, and is
 *    idempotent on already-frozen input.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { safeAssign, deepFreeze } from '../../utils/safeObject.js';

describe('safeAssign', () => {
  it('assigns a normal key as an own enumerable property', () => {
    const target: Record<string, unknown> = {};
    safeAssign(target, 'name', 'Ada');
    expect(target.name).toBe('Ada');
    expect(Object.prototype.hasOwnProperty.call(target, 'name')).toBe(true);
  });

  it('writes __proto__ as an OWN data property without polluting the prototype chain', () => {
    const target: Record<string, unknown> = {};
    safeAssign(target, '__proto__', { polluted: true });
    // Own property carrying the literal key — not a prototype mutation.
    expect(Object.prototype.hasOwnProperty.call(target, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(target)).toBe(Object.prototype);
    // A fresh object is unaffected (no global pollution).
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('deepFreeze', () => {
  it('freezes a plain object and its nested objects/arrays recursively', () => {
    const value = deepFreeze({ a: 1, nested: { b: 2 }, list: [{ c: 3 }] });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.nested)).toBe(true);
    expect(Object.isFrozen(value.list)).toBe(true);
    expect(Object.isFrozen(value.list[0])).toBe(true);
  });

  it('makes a nested mutation throw in strict mode', () => {
    'use strict';
    const value = deepFreeze({ nested: { city: 'Portland' } });
    expect(() => {
      (value as { nested: { city: string } }).nested.city = 'HACKED';
    }).toThrow(TypeError);
    expect(value.nested.city).toBe('Portland');
  });

  it('returns primitives and null unchanged', () => {
    expect(deepFreeze(null)).toBeNull();
    expect(deepFreeze(42)).toBe(42);
    expect(deepFreeze('x')).toBe('x');
    expect(deepFreeze(undefined)).toBeUndefined();
  });

  it('does NOT freeze the internals of a non-plain class instance (e.g. Firestore Timestamp)', () => {
    const ts = Timestamp.fromMillis(1_000);
    // A nested Timestamp is returned as-is, not frozen — its methods must keep working.
    const value = deepFreeze({ when: ts });
    expect(Object.isFrozen(value)).toBe(true); // the plain container is frozen
    expect(Object.isFrozen(value.when)).toBe(false); // the Timestamp instance is left alone
    expect(value.when.toMillis()).toBe(1_000); // still functional
  });

  it('is idempotent on an already-frozen flat value', () => {
    const frozen = Object.freeze({ a: 1 });
    expect(deepFreeze(frozen)).toBe(frozen);
    expect(Object.isFrozen(frozen)).toBe(true);
  });

  it('freezes a mutable grandchild beneath an already-frozen plain parent (review S4)', () => {
    // A shallow-frozen container does NOT imply frozen children; deepFreeze must still descend.
    const mutable = { score: 'original' };
    const shallowFrozenParent = Object.freeze({ mutable });
    deepFreeze({ shallowFrozenParent });

    expect(Object.isFrozen(mutable)).toBe(true);
    expect(() => {
      'use strict';
      mutable.score = 'forged';
    }).toThrow(TypeError);
    expect(mutable.score).toBe('original');
  });

  it('freezes array elements beneath an already-frozen plain container', () => {
    const el = { v: 1 };
    const frozenHolder = Object.freeze({ list: [el] });
    deepFreeze({ frozenHolder });
    expect(Object.isFrozen(el)).toBe(true);
  });

  it('is cycle-safe (a self-referential object does not overflow the stack)', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => deepFreeze(cyclic)).not.toThrow();
    expect(Object.isFrozen(cyclic)).toBe(true);
  });

  it('leaves a mutable class instance (Date) mutable — documented carve-out (review S4)', () => {
    // A read converter may return a mutable Date/Map/custom instance in a delete payload. deepFreeze
    // does NOT clone/freeze class instances (Object.freeze cannot protect a Date's internal slot),
    // so class-instance field values are observe-only by CONTRACT, not by enforcement.
    const date = new Date('2020-01-01T00:00:00.000Z');
    const value = deepFreeze({ when: date });
    expect(Object.isFrozen(value)).toBe(true); // the plain container is frozen
    expect(Object.isFrozen(value.when)).toBe(false); // the Date instance is left alone
    value.when.setUTCFullYear(2030); // still mutable (the documented limitation)
    expect(value.when.getUTCFullYear()).toBe(2030);
  });
});
