# ADR-0011: Zod `.default(...)` values are not injected on a partial update

- **Status:** Accepted (pending merge/release on branch `fix/update-default-injection`)
- **Date:** 2026-07-18
- **Deciders:** Reggie O'Farrell
- **Related:** [0010](0010-type-safe-dot-notation.md) (dot-aware write validation — same
  `.partial()` update-schema construction, different failure mode),
  [0002](0002-per-field-sentinel-write-validation.md) (sentinel validation),
  [issue #25](https://github.com/reggieofarrell/firestore-orm/issues/25)

## Context

The update validator derives its schema as `createWriteSchema.partial()` (`src/core/Validation.ts`).
Zod's `.partial()` makes each key optional but **keeps the `ZodDefault` wrapper**, so
`safeParse(input).data` fires a field's `.default(...)` for every key absent from the input. On a
partial `update()` that is silent data loss: `update(id, { name })` on a schema with
`prefs: z.object({ … }).default({})` parses to `{ name, prefs: {} }`, and Firestore then **replaces
the stored `prefs` map with `{}`** — clobbering a field the caller never mentioned. A nested leaf
default behaves the same way (`update(id, { config: {} })` → `{ config: { count: 0 } }`).

This is **pre-existing** (it predates the type-safe dot-notation work in ADR-0010) and was surfaced
while hardening tests for that review — the dot-notation integration schema deliberately used an
inner-leaf default inside an optional object to avoid tripping it. It is the same
`createWriteSchema.partial()` construction that produced ADR-0010's silent-drop bug, but a distinct
failure mode: there the payload was emptied; here it is over-filled.

The affected paths all route through `parseUpdate`'s whole-object parse: `update()`,
`query().update()`, and `patch()` / merge updates whose payload has only non-dotted top-level keys.
Merge/patch with a nested object is not affected — it flattens to dot-notation leaf paths, so
omitted `.default(...)` siblings are never parsed. The bug is especially easy to hit because the
read-side `.default(...)` backfill pattern (Core Concepts) is recommended for schema evolution — the
same default that self-heals reads was corrupting writes.

Constraints: `zod` is a peer at `^3.25 || ^4`, so any fix must be robust across both wrapper
internals (`_def.typeName` v3 / `_def.type` v4). Defaults on **create** are correct (every field is
being written for the first time) and must be preserved.

## Decision

**We will strip, from an update payload after parsing, any key Zod added that the caller did not
provide — recursively — so a partial update writes exactly the keys the caller supplied.**

- A pure post-parse **deep key-diff** (`stripInjectedDefaults(parsed, input)`) keeps only the keys
  present in the caller's `input` at each level. For a plain object schema the only way Zod adds a
  key absent from the input is a `ZodDefault`, so this removes injected defaults precisely.
- It is applied at the `parseUpdate` boundary that every repository write path uses — the two
  top-level parses (fast path + mixed non-dotted) and the dotted-leaf parse (a no-op for scalar
  leaves such as `'address.city': 'LA'`). **Create keeps defaults** (`parseCreate` is untouched).
- The helper is deliberately **schema-agnostic**: it inspects values, not Zod internals (`_def`), so
  it is inherently correct across the `^3.25 || ^4` peer range and cannot regress refinements or
  effects. It treats arrays and class instances (`Date`, `Timestamp`, `GeoPoint`,
  `DocumentReference`, `FieldValue`) as leaves — they replace the stored value wholesale on write —
  and preserves the _parsed_ leaf value, so Zod coercions and `FieldValue` sentinels survive.

## Consequences

- A partial update no longer clobbers stored fields the caller did not mention, at any nesting
  level; `update(id, { config: {} })` writes `{}` rather than `{ count: 0 }`. Defaults still apply
  on create.
- **Behavior change** (v2 → v3): code that relied on a partial update re-applying a schema default
  must now set that value explicitly in the update payload. No API signature changes.
- **Known limitation:** a schema that uses `.transform()` / `.pipe()` to _add_ keys during an update
  parse would have those added keys stripped. The library's write schemas are plain object +
  combinator (`zNumberWrite`, etc.) schemas, not key-adding transforms, so this is not exercised in
  practice; it is the accepted trade-off for a value-only (Zod-internals-free) fix.
- The raw `schemas.update` remains the plain `.partial()` schema and still applies defaults if
  parsed **directly** (`schemas.update.parse(...)`); the stripping lives in the repository's write
  path, not in the exposed schema. Documented so a caller poking at the raw schema is not surprised.

## Alternatives considered

- **Rebuild a default-free update schema (deep "remove defaults + partial").** Rejected: it requires
  recursively reconstructing `ZodObject` shapes across v3/v4 internals (fragile, and risks dropping
  refinements/effects), and it does not even produce the intended result — removing a nested field's
  default makes it _required_ again, so `update(id, { config: {} })` would then **throw** ("count
  required") rather than write `{}`. The post-parse strip gives the caller exactly what they wrote.
- **Strip only omitted top-level keys.** Rejected: fixes the headline clobber but leaves the nested
  `update(id, { config: {} })` → `{ count: 0 }` injection, which issue #25 explicitly reports.
- **Accept the injected write and re-normalize on read.** Rejected: the wrong value is what lands in
  Firestore, so raw consumers, security rules, exports, and indexes all see the corrupted document —
  read-side masking hides the data loss instead of preventing it.

## References

- Issue: [#25](https://github.com/reggieofarrell/firestore-orm/issues/25) (Zod `.default()` fields
  silently reset on partial update).
- Code: `src/core/Validation.ts` (`isPlainObject`, `stripInjectedDefaults`, `parseUpdate`).
- Tests: `src/tests/unit/updateDefaultStripping.unit.test.ts`,
  `src/tests/integration/repository-update-defaults.integration.test.ts`.
- Docs: `website/src/content/docs/guides/schema-validation.md` (validation behavior),
  `.../core-concepts.md` (backfill pattern), `.../migration-v2-to-v3.md` (behavior fix).
