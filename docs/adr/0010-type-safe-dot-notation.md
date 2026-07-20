# ADR-0010: Type-safe dot-notation and dot-aware write validation

- **Status:** Accepted (merged to main)
- **Date:** 2026-07-18
- **Deciders:** Reggie O'Farrell
- **Related:** [0002](0002-per-field-sentinel-write-validation.md) (sentinel validation),
  [0004](0004-schema-inferred-write-types.md) / [0007](0007-retire-curried-schema-factories.md)
  (write-input types), [0008](0008-read-only-converters.md) (read-only converters)

## Context

Dot-notation (Firestore nested field paths such as `'address.city'`) was inherited from the upstream
fork as a **runtime-only, stringly-typed** feature. Two problems surfaced while reviewing it for v3:

1. **Silent data loss on schema-validated repositories.** The update validator built its schema as
   `writeSchema.partial()`. Zod's default `.strip()` mode treats a dotted key as an _unknown key_
   and removes it — and stripping is a **success**, not an error. The resulting empty payload then
   hit the `Object.keys(payload).length > 0` write guard and the write was **skipped with no
   error**. Every validator-backed write path was affected (`update`, `patch`, merge `update`,
   `bulkUpdate`, `bulkPatch`, `updateInTransaction`, `patchInTransaction`, `query().update()`). No
   test covered the schema + dot-notation combination — all existing dot-notation tests used a
   schema-less repository, so the bug was invisible.

2. **No type-level support, inconsistent query typing.** `UpdateInput<W> = PartialWithFieldValue<W>`
   cannot express dotted keys, so every nested update required an `as any` cast — which discards
   _all_ type safety for the whole payload. `where` accepted any `string`; `orderBy`/`select`
   accepted only `keyof T` (no nested paths without a cast). `WhereOpsForValue` existed but was
   inert dead code.

Constraints: the library targets `firebase-admin` `^12 || ^13` and `zod` `^3.25 || ^4` as peers, and
uses a read-only `readConverter` seam (ADR-0008), so a field's _stored_ shape can differ from the
read type `T`. `firebase-admin/firestore` already types `DocumentReference.update()` with
`UpdateData<T>`, which generates typed dot-notation keys, and re-exports that type publicly.

## Decision

**We will make dot-notation first-class and honest — typed at compile time and validated + persisted
at runtime.**

- **Reuse the SDK's write type.** `UpdateInput<W>` becomes `UpdateData<Omit<W, 'id'>>`. This gives
  typed dot-notation keys with correct per-leaf value types and `FieldValue` at every level, with no
  new TypeScript floor beyond what the SDK already requires. `CreateInput` stays on
  `WithFieldValue`, which generates no dotted keys — so `create`/`upsert` reject dot-notation at the
  type level (and at runtime via a guard), matching Firestore's rule that dots are only field paths
  on `update()`.
- **Hand-roll query field paths.** A new `FieldPaths<T>` (with `PathValue<T, P>`) types
  `where`/`orderBy`/`select` (and the vector builder's `where`/`select`) as
  `FieldPaths<T> | FieldPath`. The SDK offers nothing schema-aware here. `where` values stay loose
  (`unknown`) because a `readConverter` can change a field's stored shape; the dead
  `WhereOpsForValue` is deleted.
- **Make update validation dot-aware.** `parseUpdate` splits the payload: non-dotted entries
  validate as before; each explicit dotted key is structurally checked (`validateDotNotationPath`),
  resolved to its leaf schema (`resolveSchemaAtPath`), and validated in place — the dotted key is
  **preserved**. An unknown field path throws `ValidationError` (fail loud); paths into a dynamic
  container (`z.record`) pass through unvalidated. The per-leaf sentinel escape hatch and
  `sentinelPolicy` are reused unchanged.
- **Fix adjacent inconsistencies.** `bulkPatch` now validates raw input then normalizes (matching
  single-doc `patch`); merge normalization drops `undefined` leaves so nested and explicit-dot forms
  behave identically; `query().update()` returns the number of documents actually written.

## Consequences

- Nested updates and query field paths are type-checked with no `as any`; typos, wrong leaf values,
  a non-writable `id`, and arbitrary dynamic field-name strings become compile errors.
- Dotted writes on schema repositories are validated and persisted instead of silently dropped — a
  **behavior change**: code that previously (unknowingly) relied on the no-op now throws on invalid
  values/paths.
- Breaking for v3: query methods no longer accept arbitrary `string` field names (use `FieldPath`
  for dynamic names); `id` is no longer allowed in update payloads; `create`/`set` reject dotted
  keys; `vectorField` is constrained to top-level keys; `query().update()`'s return count semantics
  changed.
- `resolveSchemaAtPath`/`unwrapWrappers` must tolerate both Zod v3 and v4 wrapper internals. Unit
  tests exercise the wrapper/container permutations on the installed Zod (v4); the code is written
  defensively for v3 (an unresolvable schema degrades to passthrough, never a false rejection). A
  zod-v3 CI matrix run is a tracked follow-up rather than a merge blocker.
- `FieldPaths<T>` is depth-bounded (6) to avoid "excessively deep" on recursive schemas; the SDK's
  `UpdateData` recursion is unbounded (a depth-bounded hand-rolled `NestedUpdate<W>` is documented
  as a fallback if a recursive write type ever trips the compiler).

## Alternatives considered

- **Hand-roll the update type (`NestedUpdate<W>`).** Rejected as the primary approach — `UpdateData`
  already exists, is SDK-faithful, and (verified against the type-test suite) preserves every
  existing `@ts-expect-error`. Kept only as a documented fallback.
- **Type `where` values from `T` (operator-aware).** Rejected: unsound under a `readConverter` that
  transforms stored values, and high friction across operator families (`in`, `array-contains`, …).
- **Fix the runtime only (fail-loud, no types).** Rejected: leaves `as any` everywhere and does not
  deliver the type safety v3 targets.
- **Global `.passthrough()` to stop the strip.** Rejected: would also let unknown _non-dotted_ typos
  through, weakening validation for every field.

## References

- Plan: type-safe dot-notation for v3 (branch `feat/overhaul-dot-notation`).
- Code: `src/utils/pathTypes.ts`, `src/core/Validation.ts` (`UpdateInput`, `parseUpdate`,
  `resolveSchemaAtPath`), `src/core/QueryBuilder.ts`, `src/core/FirestoreRepository.ts`,
  `src/vector/VectorQueryBuilder.ts`, `src/vector/VectorSearch.ts`.
- Docs: `website/src/content/docs/guides/dot-notation.md`, `.../migration-v2-to-v3.md`,
  `.../api-reference.md`, and the v2 archive warning in `.../2.0/guides/dot-notation.md`.
