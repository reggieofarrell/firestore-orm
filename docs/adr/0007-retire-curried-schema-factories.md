# ADR-0007: Retire curried `withSchema`/`subcollection` for value-inferred read/write types

- **Status:** Accepted
- **Date:** 2026-07-17
- **Deciders:** Reggie O'Farrell
- **Related:** Supersedes [ADR-0004](0004-schema-inferred-write-types.md); refines
  [ADR-0002](0002-per-field-sentinel-write-validation.md);
  [issue #10](https://github.com/reggieofarrell/firestore-orm/issues/10);
  [`src/core/FirestoreRepository.ts`](../../src/core/FirestoreRepository.ts),
  [`src/core/Validation.ts`](../../src/core/Validation.ts)

## Context

[ADR-0004](0004-schema-inferred-write-types.md) introduced a **curried** opt-in factory —
`FirestoreRepository.withSchema<Read>()(db, collection, schema, …)` (and the analogous
`subcollection<Read>()(…)`) — purely to work around TypeScript's lack of **partial type-argument
inference**: once a caller names the read type (`withSchema<User>(…)`), the compiler will not also
infer a write-type parameter from the `schema` argument, so it falls back to the default and
collapses the write type to `Record<string, unknown>`. Currying (an empty first call that fixes the
read type, then a second call that infers the schema type) was the only way to keep an explicit read
type **and** infer the write type.

That left three lasting costs:

- **Two call shapes per method** (curried + direct) on both `withSchema` and `subcollection`, a
  standing surface/learning cost that ADR-0004 itself flagged.
- **Positional-optional soup:** `converter` and `opts` were trailing positional parameters, so
  reaching `sentinelPolicy` forced a filler `undefined` for the converter —
  `withSchema<User>(db, 'users', schema, undefined, { sentinelPolicy: 'strict' })`.
- **A `schemas.read` quirk:** the curried path passed the write/combinator schema as the sole
  `schema` argument, so `repo.schemas.read` returned the _write_ schema rather than the plain read
  schema.

ADR-0004's "Future direction" already scoped the exit: because a read type can be inferred from a
schema **value** (not only from an explicit generic), both read and write types can be inferred from
arguments in a single non-curried call. This is a deliberate breaking (v3) change and is not
contingent on any future TypeScript feature.

## Decision

We will replace the curried and direct forms with a **single non-curried signature** per factory,
inferring types from schema **values** and collecting every non-required argument in a trailing
options object.

1. **Value-inferred, single-call factories.**

   ```ts
   FirestoreRepository.withSchema(db, collection, readSchema, {
     writeSchema?,     // combinator overlay; when given, write type = z.infer<writeSchema>
     converter?,       // FirestoreDataConverter<z.infer<readSchema>>
     sentinelPolicy?,  // 'permissive' | 'strict'
   });
   repo.subcollection(parentId, name, readSchema, { writeSchema?, converter?, sentinelPolicy? });
   ```

   The read type is `z.infer<readSchema>`; the write type is `z.infer<writeSchema>` when a
   `writeSchema` overlay is supplied, otherwise it equals the read type. Signatures are
   `withSchema<RS extends z.ZodObject<any>, WS extends z.ZodObject<any> = RS>(…)`; `WS` is inferred
   from `options.writeSchema` and defaults to `RS` when absent. No explicit type parameter is passed
   — an explicit `withSchema<User>(…)` now fails to compile (`User` is not a `ZodObject`), which is
   the intended v3 break.

2. **Remove the curry and the old positional params.** The curried overloads and the runtime
   `db === undefined` / `parentId === undefined` dispatch are deleted, along with the positional
   `converter` and `opts` parameters (both now live in the options object).

3. **`schemas.read` is always the plain read schema.** The validator's create/update schemas derive
   from `writeBase = writeSchema ?? readSchema`, but the repository stores `readSchema` as
   `schemas.read`. `makeValidator`'s public signature is unchanged; the corrected schema set is
   supplied through the constructor's existing `schemas` argument.

4. **Only `readSchema` requires a top-level `id`.** It is the authoritative read shape
   (`T & { id }`) and is asserted at construction. The `writeSchema` overlay need not include `id` —
   `create` omits the top-level `id` and `update` is partial.

5. **`subcollection` requires a schema.** The former no-schema/untyped subcollection form is dropped
   (it relied on the explicit-generic anti-pattern this ADR removes). An unvalidated subcollection
   is still reachable via the public constructor against the full path, e.g.
   `new FirestoreRepository<Order>(db, 'users/user-123/orders')` — the same "raw constructor =
   untyped" pattern used at the top level.

## Consequences

**Positive**

- One call shape per factory; read and write types both inferred from values with no explicit
  generic.
- The trailing options object ends the positional-optional soup and lets future options land without
  a new positional parameter.
- Native support for the clean-read + combinator-write ("share the schema with a front-end") pattern
  via `writeSchema`, without a curry.
- `repo.schemas.read` / `repo.readSchema` are genuinely the read schema, which also makes the
  forthcoming opt-in read validation (issue #14) correct by construction.

**Negative / migration**

- Breaking: every curried call (`X()(…)`) and every positional `converter`/`opts` call must migrate
  to `X(…, { writeSchema?, converter?, sentinelPolicy? })`; drop explicit read-type generics.
- A hand-written read **interface** decoupled from a schema can no longer be passed to `withSchema`
  — the read type must be `z.infer<readSchema>` (derive it with
  `type User = z.infer<typeof userSchema>`, keeping a required `id`).
- Untyped subcollections lose their ergonomic shortcut and move to the raw constructor.
- Unchanged: the `CreateInput` optional-`id` behavior from ADR-0004, and the partial compile-time
  guarantees (the sentinel **kind** is enforced only at runtime under `'strict'`; the
  `isolatedModules` blind spot means `*.type-test.ts` + `npm run test:types` remain the compile-time
  gate).

## Alternatives considered

- **Keep the curry as an opt-in alongside the new form.** Rejected — the goal is to remove the
  second call shape, not add a third.
- **Positional `writeOverlaySchema?, converter?, opts?`** (the sketch in ADR-0004's "Future
  direction"). Rejected in favor of an options object, which is extensible and avoids filler
  `undefined`s.
- **A single generic `O` for the options + a conditional write-type extract.** Held as a fallback in
  case `tsc` failed to default `WS` to `RS` when `writeSchema` is absent; the two-parameter default
  was verified to work, so the simpler signature was kept.
- **Keep the untyped `subcollection` overload.** Rejected — it reintroduces the explicit-generic
  pattern and forces a second overload; the public constructor covers the unvalidated case.

## References

- [`src/core/FirestoreRepository.ts`](../../src/core/FirestoreRepository.ts) — the single-signature
  `withSchema` / `subcollection` factories and loose implementations.
- [`src/core/Validation.ts`](../../src/core/Validation.ts) — `makeValidator` (unchanged),
  `omitTopLevelId`, `CreateInput`.
- [`src/tests/types/write-types.type-test.ts`](../../src/tests/types/write-types.type-test.ts) +
  [`read-types.type-test.ts`](../../src/tests/types/read-types.type-test.ts) — the compile-time gate
  (`npm run test:types`), including the "options present, no `writeSchema` → write type = read type"
  regression lock.
- [ADR-0004](0004-schema-inferred-write-types.md) — the superseded curried design.
- [Docs → Per-Field Sentinel Approval](../usage/field-value-sentinels.md#per-field-sentinel-approval),
  [API Reference](../usage/api-reference.md), [Subcollections](../usage/subcollections.md).
- [issue #10](https://github.com/reggieofarrell/firestore-orm/issues/10).
