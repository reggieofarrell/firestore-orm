import { FieldValue } from 'firebase-admin/firestore';

/**
 * Shared recognizers for genuine Firestore `VectorValue` write sentinels (produced by
 * `FieldValue.vector([...])`, a standalone `VectorValue` object — not a `FieldValue` subclass in
 * current firebase-admin releases).
 *
 * Authenticity is **nominal**: a value is a genuine `VectorValue` only when it is an `instanceof`
 * the runtime constructor that `FieldValue.vector()` itself produces (see
 * {@link isGenuineVectorValue}). An ordinary object keeps `Object.prototype`, so a hand-built map —
 * even one with spoofed `toArray()`/`isEqual()` methods and a `_values` array — is NOT an instance
 * and is rejected (review T2 / finding B7). This lives in `utils` so the core validator
 * (`src/core/Validation.ts`, `isVectorWriteValue`) and the vector extension
 * (`src/vector/VectorSearch.ts`, `isVectorFieldValue`) share one authenticity definition and cannot
 * drift. The constructor is obtained from `firebase-admin` (an existing peer dependency), not by
 * importing `@google-cloud/firestore` directly (a transitive dependency).
 */

/**
 * The genuine `VectorValue` constructor, resolved lazily and cached. `firebase-admin/firestore` does
 * not re-export the class, so we recover it from the runtime value `FieldValue.vector()` produces.
 * `undefined` = not resolved yet; `null` = the installed SDK has no vector support, so no genuine
 * `VectorValue` can exist.
 */
type VectorValueCtor = new (...args: never[]) => object;

let resolvedVectorCtor: VectorValueCtor | null | undefined;

function vectorValueConstructor(): VectorValueCtor | null {
  if (resolvedVectorCtor === undefined) {
    try {
      const probe = (FieldValue as { vector?: (values: number[]) => object }).vector?.([0]);
      const ctor = probe?.constructor as VectorValueCtor | undefined;
      resolvedVectorCtor = typeof ctor === 'function' ? ctor : null;
    } catch {
      resolvedVectorCtor = null;
    }
  }
  return resolvedVectorCtor;
}

/**
 * True only when `value` is a **genuine** Firestore `VectorValue` — an `instanceof` the runtime
 * constructor `FieldValue.vector()` produces.
 *
 * This is a nominal (prototype-chain) identity an ordinary object cannot satisfy: a hand-built map
 * retains `Object.prototype`, so adding spoofed `toArray()`/`isEqual()` methods (or a `_values`
 * array) does not make it an instance. That closes the forged-map validation bypass that a
 * structural method-presence check left open (review T2 / finding B7). When the installed SDK
 * exposes no `FieldValue.vector` (no vector support), no genuine `VectorValue` can exist, so this
 * returns `false` for everything. Component finiteness/dimension are validated separately from the
 * public `toArray()` (see {@link genuineVectorComponents} / {@link areFiniteVectorComponents}).
 */
export function isGenuineVectorValue(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const ctor = vectorValueConstructor();
  return ctor !== null && value instanceof ctor;
}

/**
 * Returns the numeric components of a **genuine** `VectorValue` via its public `toArray()` API, or
 * `null` when `value` is not a genuine `VectorValue`. Callers validate finiteness and dimensions
 * against these components without reading the private `_values` field.
 */
export function genuineVectorComponents(value: unknown): number[] | null {
  if (!isGenuineVectorValue(value)) {
    return null;
  }
  try {
    const components = (value as { toArray(): unknown }).toArray();
    return Array.isArray(components) ? (components as number[]) : null;
  } catch {
    return null;
  }
}

/**
 * True when `values` is a non-empty array of **finite** numbers. `Number.isFinite` rejects `NaN` AND
 * `±Infinity` (unlike `!Number.isNaN`, which lets infinities through). An empty component list is
 * not a usable vector, so it is rejected too.
 */
export function areFiniteVectorComponents(values: unknown): values is number[] {
  return (
    Array.isArray(values) &&
    values.length > 0 &&
    values.every(entry => typeof entry === 'number' && Number.isFinite(entry))
  );
}
