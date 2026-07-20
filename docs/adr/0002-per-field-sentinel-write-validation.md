# ADR-0002: Per-field `FieldValue` sentinel approval via opt-in strict validation

- **Status:** Accepted (merged to main). The opt-in mechanism shipped in v2.x; **v3 flips the
  default to `'strict'`** — see the "v3 addendum" at the end of this ADR.
- **Date:** 2026-07-16
- **Deciders:** Reggie O'Farrell
- **Related:** Refines decision #6 of [ADR-0001](0001-fork-and-2.0.0-rearchitecture.md);
  [`src/core/Validation.ts`](../../src/core/Validation.ts)

## Context

ADR-0001 introduced sentinel-aware validation with a **blanket escape hatch**: when a write fails
Zod validation, `makeValidator` waives every error whose path holds a `FieldValue` sentinel and
writes the raw input. It only asks _"is there a sentinel at this path?"_ — never _"is this the right
**kind** of sentinel for this field?"_. Consequences we wanted to close:

- Any sentinel is accepted on any field. Verified by a live trace: `FieldValue.increment(5)` into a
  `z.string()` field **passes**, as do `arrayUnion` on a number field, `serverTimestamp` on an
  array, etc. Firestore is the only backstop.
- Two latent detector defects: a structural `toString().includes('FieldValue')` fallback in
  `isFieldValueSentinel` that is provably dead (admin sentinels subclass `FieldValue` and don't
  override `toString`), and a shared-prefix path-overlap test that let a sentinel nested at
  `['a','b']` suppress a genuine type error reported at the ancestor `['a']`.

The fix follows a per-field combinator pattern — `z.union([<type>, <specific sentinel kind>])`
backed by a sentinel-kind classifier. A classifier that must recognize sentinels from both the Web
and Admin SDKs is forced into SDK-agnostic, duck-typed detection; firestore-orm is **Admin-only**,
so we deliberately avoid that cross-SDK complexity.

Constraint: this must not break existing consumers, who rely on the permissive behavior shipped in
`2.0.0`.

## Decision

Add opt-in, per-field sentinel approval and fix the two detector defects, keeping the permissive
behavior as the default.

1. **Per-field write combinators** in `src/core/Validation.ts`: `zNumberWrite()`
   (`number | increment`), `zArrayWrite(elem)` (`elem[] | arrayUnion | arrayRemove`), `zDateWrite()`
   (`Date | serverTimestamp`), `withDelete(schema)`, and a generic `zSentinel(...kinds)`. Each is a
   plain `z.union` of the field's declared type with only its approved sentinel kinds.
   `zNumberWrite`/`zArrayWrite`/`zDateWrite` take an optional `{ allowDelete }`; `withDelete` always
   adds `delete`, and `zSentinel` takes the permitted kinds explicitly.

2. **`whichFieldValue(value)` kind classifier** — admin-native and minimal. It gates on
   `isVectorWriteValue` then `instanceof FieldValue`, then reads the admin `methodName` getter (e.g.
   `"FieldValue.increment"`). We deliberately avoid Web-SDK / duck-typed signals (dead weight for an
   Admin-only library): `methodName` is more robust than `constructor.name` (survives minification)
   and cleanly distinguishes `arrayUnion` from `arrayRemove`.

3. **`sentinelPolicy: 'permissive' | 'strict'`** on `makeValidator` (default `'permissive'`),
   threaded through `withSchema` / `subcollection` via an optional trailing `opts` argument. The
   policy is captured in the validator closure, so it propagates through transactions and
   `query().update()` with no constructor changes. Under `'strict'` the escape hatch is disabled:
   only sentinels a combinator explicitly permits pass; everything else throws. Combinators are the
   mechanism, strict mode is what _enforces_ them (in permissive mode the escape hatch would still
   waive a wrong-kind sentinel).

4. **Detector fixes.** Remove the dead `toString` fallback (detection is now `instanceof FieldValue`
   plus the `VectorValue` structural check). Narrow sentinel-error waiving to **exact-leaf**
   matching, so a nested sentinel can no longer excuse an ancestor type error. Leave
   `isVectorWriteValue`'s `{ _values }` breadth as-is (tightening it would diverge from the vector
   module's `isVectorFieldValue`, and it is moot under strict mode where the recommended vector path
   is `vectorEmbeddingSchema`); documented in code.

5. **Read/write divergence stays a documentation matter.** `withSchema<U>` already decouples the
   read type `U` from the runtime schema, so combinators widen only write-time validation and never
   pollute the shared read type. For teams sharing schema-derived types with a front-end, the
   recommended pattern is a plain base schema (shared, `zod`-only) plus a server-side `.extend(...)`
   overlay that applies combinators.

## Consequences

**Positive**

- Consumers can enforce "declared type **or** an approved sentinel, per field" — the original goal.
- `whichFieldValue` is a small, robust, admin-native primitive; detection no longer carries dead
  code, and nested sentinels can't mask real errors.
- Fully backward compatible: default `'permissive'` preserves `2.0.0` behavior; all additions are
  new exports plus optional arguments.

**Negative / costs**

- Combinators only enforce under `sentinelPolicy: 'strict'`; in permissive mode they are advisory.
  This two-mode model is a documented nuance, not an automatic guarantee.
- The exact-leaf narrowing can surface errors previously suppressed at a parent/descendant path
  (permissive users with _nested_ sentinels only) — called out in release notes.
- `whichFieldValue` depends on the admin `methodName` getter, an undocumented-but-stable internal of
  `@google-cloud/firestore`; guarded by unit tests that would fail loudly if it changes.
- Read/write type divergence is still not first-class; writing a `Date`/sentinel into a field typed
  as its read shape needs a cast (existing library idiom).

## Alternatives considered

- **Kind-aware escape hatch** (keep plain schemas; only waive if the field's declared Zod type is
  compatible with the sentinel kind). Rejected: requires introspecting Zod internals at the erroring
  path and walking the schema, with divergent behavior across the supported Zod 3 and Zod 4 —
  brittle over-engineering. Combinators let Zod do the resolution it already does.
- **Flip the default to `'strict'`.** Rejected for this change: it is a breaking change to `2.0.0`
  behavior. Deferred to a future major.
- **Adopt an SDK-agnostic, duck-typed detector.** Rejected: its Web-SDK signals are dead weight for
  an Admin-only library and widen the false-positive surface.

## References

- [`src/core/Validation.ts`](../../src/core/Validation.ts) — combinators, `whichFieldValue`,
  `sentinelPolicy`, detector fixes.
- Consumer usage: the "Per-Field Sentinel Approval" guide in the published docs.
- Branch `feat/per-field-sentinel-validation`.

## v3 addendum: `'strict'` is now the default

This ADR (in v2.x) kept `'permissive'` as the default for backward compatibility and reserved a
future major to reconsider it. In **v3 we flip the default to `'strict'`**.

The trigger was that the permissive escape hatch, on a sentinel-path parse failure, returned the
**entire raw input** — discarding every successful Zod coercion, default, unknown-key strip, and
transform elsewhere in the same payload. A caller reasonably expects a successful validate to be the
schema's parsed output, so permissive silently produced surprising, lossy writes.

Under the strict default, parsing succeeds normally and the parsed output is always returned; only
sentinels a field's combinator permits pass. `'permissive'` remains available as an explicit opt-in
(`{ sentinelPolicy: 'permissive' }`) for migration. This is a breaking change, recorded here rather
than as a separate ADR because it is the same decision axis this ADR introduced.
