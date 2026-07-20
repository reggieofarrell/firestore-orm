/**
 * Shared structural recognizer for Firestore `VectorValue` write sentinels (produced by
 * `FieldValue.vector([...])`, which is a standalone `VectorValue` object exposing a numeric
 * `_values` array — not a `FieldValue` subclass in current firebase-admin releases).
 *
 * This lives in `utils` (dependency-free) so the core validator (`src/core/Validation.ts`) and the
 * vector extension (`src/vector/VectorSearch.ts`) share one definition and cannot drift — a real
 * bug in round 1, where both used `!Number.isNaN` (which accepts ±Infinity) and disagreed with the
 * plain-array path that used `Number.isFinite`.
 */

/**
 * True only when `value` is shaped like a `VectorValue` (`{ _values: number[] }`) whose components
 * are all **finite** numbers. `Number.isFinite` rejects `NaN` AND `±Infinity` (unlike
 * `!Number.isNaN`, which lets infinities through). An empty `_values` array is not a usable vector,
 * so it is rejected too.
 */
export function hasFiniteVectorValues(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const values = (value as { _values?: unknown })._values;
  return (
    Array.isArray(values) &&
    values.length > 0 &&
    values.every(entry => typeof entry === 'number' && Number.isFinite(entry))
  );
}

/**
 * True when `value` carries a `VectorValue`-shaped `_values` array, regardless of whether its
 * contents are valid. Callers use this to treat a `_values`-bearing value as "definitely a vector
 * shape" and judge it solely on {@link hasFiniteVectorValues} — so a shaped-but-invalid vector
 * (e.g. containing `Infinity`) is rejected rather than falling through to a looser heuristic.
 */
export function hasVectorValuesShape(value: unknown): boolean {
  return (
    !!value && typeof value === 'object' && Array.isArray((value as { _values?: unknown })._values)
  );
}
