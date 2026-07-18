# ADR-0004: Opt-in schema-inferred write-input types (and optional `id` on create)

- **Status:** Superseded by [ADR-0007](0007-retire-curried-schema-factories.md)
- **Date:** 2026-07-17
- **Deciders:** Reggie O'Farrell
- **Related:** Refines [ADR-0002](0002-per-field-sentinel-write-validation.md) (per-field
  combinators); [`src/core/FirestoreRepository.ts`](../../src/core/FirestoreRepository.ts),
  [`src/core/Validation.ts`](../../src/core/Validation.ts)

## Context

ADR-0002 added per-field write combinators and an opt-in `'strict'` policy that govern **runtime**
validation. Two **compile-time** gaps remained:

- **`withSchema<U>` typed writes from the read generic `U` and discarded the schema's type** (the
  `schema` parameter was `z.ZodObject<any>`). So a `zDateWrite()` field whose read type is `number`
  still typed writes as `number`, forcing `new Date() as unknown as number` at call sites.
  (Firestore's `WithFieldValue`/`PartialWithFieldValue` widen every field to `… | FieldValue`, which
  is why a `FieldValue` sentinel needed no cast but a plain `Date` did.)
- **`CreateInput<T> = WithFieldValue<T>` required a top-level `id`**, even though create
  auto-generates it and strips any supplied `id` — so the documented `create({ …no id… })` was a
  type error.

Two hard constraints shaped the design, both **verified with `tsc` probes** during implementation:

- **TypeScript has no partial type-argument inference.** Once a caller writes `withSchema<User>(…)`,
  the compiler will not also infer a schema type parameter from the argument — it falls back to the
  default. A first attempt (a second defaulted generic on the direct call) therefore collapsed the
  write type to `z.infer<z.ZodObject<any>>` = `Record<string, unknown>`, silently making writes
  permissive. The only way to infer the schema type **and** keep an explicit read type is to curry.
- **Firestore's write types are permissive by construction.** `WithFieldValue` accepts any
  `FieldValue` on any field, and `PartialWithFieldValue` (used by `update`) is looser still for
  object-typed fields. So the compiler cannot enforce the sentinel **kind**, and `update` cannot
  reject every wrong value. Runtime `'strict'` remains the real enforcement.

A further hazard: the jest suites run ts-jest with `isolatedModules`, which **does not type-check**,
so type-level regressions (and `@ts-expect-error`) are invisible to them.

## Decision

1. **Curried opt-in factory.** `FirestoreRepository.withSchema<Read>()(db, collection, schema, …)` —
   the first (type-only) call fixes the read type, and the returned function infers the write type
   `W = z.infer<schema>`. The **direct** form `withSchema<Read>(db, collection, schema, …)` is kept
   as an overload (backwards compatible), typing writes by the read type. Both are one method via
   overloads; no existing call site changes.

2. **Write generic on the repository.** `FirestoreRepository<T, W = T>` — `T` read model, `W` write
   model. `create`/`bulkCreate`/`update`/`upsert`/`query().update()`/transactions and the write-side
   hooks are typed by `W`; reads (`T`), the converter, and the delete hook stay on `T`. `W` is
   unconstrained (`= T`). `subcollection` gets the same curried opt-in form
   (`repo.subcollection<Read>()(parentId, name, schema, …)`); its direct form stays read-typed.

3. **Optional `id` on create.** `CreateInput<T> = WithFieldValue<Omit<T, 'id'>> & { id?: string }`.

4. **A real type-check gate.** `tsconfig.typecheck.json` + `npm run test:types` compile
   `src/tests/types/*.type-test.ts` (which the jest suites cannot check), wired into the pre-push
   hook and a CI `Type checks` job. The type-test asserts only guarantees that actually hold.

## Consequences

**Positive**

- The curried form gives **cast-free** combinator writes (`Date`, `serverTimestamp()`, `increment`,
  `arrayUnion`) and `create` without `id`, while reads stay typed as `Read`.
- `create` (backed by `WithFieldValue`) rejects wrong scalar types at compile time.
- Fully backwards compatible: the direct form and existing `withSchema<U>(…)` call sites are
  unchanged; `CreateInput` only loosens.
- Type-level behavior is now guarded by a compiler gate, closing the `isolatedModules` blind spot.

**Negative / costs**

- The type safety is **partial and documented as such**: `update` (`PartialWithFieldValue`) is
  looser than `create` for object-typed fields, and the sentinel **kind** is never compile-checked
  (only runtime `'strict'` enforces it).
- Two call shapes for one method (direct vs curried), on both `withSchema` and `subcollection`, is a
  small surface/learning cost.
- `FirestoreRepository`/`FirestoreQueryBuilder` gained a `W` type parameter (source-compatible via
  the `= T` default; the vector wrapper is made `W`-tolerant).

## Alternatives considered

- **Single-call inference (`withSchema<U>(…, schema)` infers `W`).** Rejected: impossible under
  TypeScript's lack of partial type-argument inference — verified that `W` collapses to
  `Record<string, unknown>`, which is worse than the status quo (permissive writes, no safety).
- **Hard-curry every call site (breaking).** Rejected: the overload keeps the direct form working,
  so currying is opt-in rather than a forced breaking change.
- **Omit `id` from `CreateInput` entirely (not optional).** Rejected: breaks code that passes an
  (ignored) `id`. Optional `id` fixes the ergonomic with zero breakage.
- **Constrain `W extends { id?: ID }`.** Rejected: an inferred `z.infer<S>` is not statically known
  to satisfy that bound.

## Future direction

The curry is required only because TypeScript has no partial type-argument inference (naming the
read type defaults the write-type parameter instead of inferring it) — not for backwards
compatibility. A future **major** could retire the curry by inferring the read type from a _value_
too: e.g. `withSchema(db, collection, readSchema, writeOverlaySchema?, converter?, opts?)`, where
both the read type (`z.infer<readSchema>`) and the write type (`z.infer<writeOverlaySchema>`) come
from arguments, so no explicit type parameter is given and single-call inference works (verified).
The trade-off: the read type must be schema-derived (not a hand-written interface decoupled from a
schema), and it is a breaking API change. Tracked as a v3 candidate in
[issue #10](https://github.com/reggieofarrell/firestore-orm/issues/10). (If TypeScript ever ships
partial type-argument inference, the single-generic `withSchema<Read>(db, collection, schema)` form
would infer the write type directly and the curry could collapse with no redesign — but that is not
something to design around.)

## References

- [`src/core/FirestoreRepository.ts`](../../src/core/FirestoreRepository.ts) — curried/direct
  `withSchema`, the `W` generic, write methods and hooks.
- [`src/core/Validation.ts`](../../src/core/Validation.ts) — `CreateInput` (optional `id`).
- [`src/tests/types/write-types.type-test.ts`](../../src/tests/types/write-types.type-test.ts) +
  `tsconfig.typecheck.json` — the compile-time gate (`npm run test:types`).
- Consumer usage: the "Per-Field Sentinel Approval" guide in the published docs.
- Branch `feat/schema-inferred-write-types`.
