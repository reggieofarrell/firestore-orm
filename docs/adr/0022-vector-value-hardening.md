# ADR-0022: v3 vector-value hardening — genuine VectorValue recognition and object-form compatibility

- **Status:** Accepted (v3) — implemented in the Track B hardening series
- **Date:** 2026-07-22
- **Deciders:** Reggie O'Farrell
- **Related:** Refines [ADR-0002](0002-per-field-sentinel-write-validation.md) (per-field sentinel
  validation); the v3 pre-release codebase review (maintainer-local, findings B7 and B3);
  [`src/utils/vectorValue.ts`](../../src/utils/vectorValue.ts),
  [`src/vector/VectorSearch.ts`](../../src/vector/VectorSearch.ts),
  [`src/vector/vectorEmbeddingSchema.ts`](../../src/vector/vectorEmbeddingSchema.ts),
  [`src/core/Validation.ts`](../../src/core/Validation.ts).

## Context

**B7 — forged vector values.** A Firestore vector is produced by `FieldValue.vector([...])`, which
returns a standalone `VectorValue` object (not a `FieldValue` subclass in current firebase-admin
releases). The recognizer decided whether a write value is a "vector sentinel" — which, when true,
lets the value bypass ordinary schema validation. That recognizer classified **any** object shaped
like `{ _values: number[] }` as a vector, judged only on component finiteness. So a hand-built plain
map `{ _values: [0.1, 0.2] }` was accepted as a vector: it bypassed schema validation and was stored
as an ordinary map. The same breadth reached the public `vectorEmbeddingSchema`, whose value type
was `z.custom<number[] | ReturnType<typeof Object>>` (effectively `any` object) and whose runtime
predicate accepted the forged map. A first remediation tightened the recognizer to require callable
`toArray()`/`isEqual()` methods — but a structural method-presence check is still forgeable (a plain
object with two spoofed methods keeps `Object.prototype` yet passes), so it was **not** an
authenticity boundary. `@google-cloud/firestore` does not re-export the `VectorValue` class, so a
direct `instanceof` import is unavailable. Separately, the schema returned early on a recognized
vector, so a native `FieldValue.vector()` value **bypassed the exact- and maximum-dimension checks**
that a plain array is held to.

**B3 — object-form `findNearest` support.** The library always issues the **object-form**
`findNearest({ vectorField, queryVector, ... })`, which requires `@google-cloud/firestore >= 7.10`
(`findNearest` is absent `<= 7.5`, positional-only `7.6`–`7.9`, object-form `7.10+`). That floor is
guaranteed transitively by `firebase-admin >= 13`, and reachable on `firebase-admin 12` only when
the resolved `@google-cloud/firestore` is `>= 7.10`. The prior support message named only
`firebase-admin >= 12`, understating the real requirement.

## Decision

- **B7 — require a genuine `VectorValue` by nominal identity.** A value is recognized as a vector
  only when it is an `instanceof` the runtime `VectorValue` constructor — recovered lazily from
  `FieldValue.vector([0]).constructor` (firebase-admin is a declared peer dependency; we do not
  import the transitive `@google-cloud/firestore` directly). This is a prototype-chain identity an
  ordinary object cannot satisfy: a hand-built map keeps `Object.prototype`, so even spoofed
  `toArray()`/`isEqual()` methods and a `_values` array do **not** make it pass
  (`isGenuineVectorValue`). It is applied across every recognition path (`isVectorFieldValue`,
  `isVectorWriteValue`, and therefore `whichFieldValue` / `isFieldValueSentinel` /
  `collectSentinelPaths`, and the `vectorEmbeddingSchema` predicate). Components are read from the
  public `toArray()` and must be finite; the schema applies the **same** finite, exact-dimension,
  and maximum-dimension (`VECTOR_MAX_DIMENSIONS`) checks to both a native vector and a plain
  `number[]`, so a native vector no longer bypasses them. The schema value type is tightened from
  `ReturnType<typeof Object>` to the structural `VectorValueLike`
  (`{ toArray(): number[]; isEqual(other): boolean }`), which is re-exported from the `/vector`
  entry point so consumers can name it.
- **B3 — capability-probed support, and a functional CI floor.** `assertVectorSearchSupported`
  detects object-form support by **capability**, not by catching arbitrary errors: it rejects a
  totally absent `findNearest` (`<= 7.5`), then constructs a throwaway `findNearest` with valid
  minimal arguments. The positional-only `7.6`–`7.9` signature rejects a single object argument, so
  the probe throws and a deterministic ORM object-form-compatibility error (naming the `>= 7.10`
  requirement) is surfaced; `7.10+` constructs the probe and passes. Because this runs BEFORE the
  real `findNearest` call, that call is left **unwrapped** — a genuine construction error on a
  supported SDK (e.g. an invalid Firestore field path) propagates as an ordinary input error and is
  never relabeled a version incompatibility (review R1). A CI matrix pins the transitive
  `@google-cloud/firestore` to `7.9` **and** `7.10` (via an npm `override`) and the packed consumer
  **functionally constructs** an object-form `findNearest`, asserting it constructs on `7.10` and
  yields the ORM compatibility error on `7.9` — a behavioral guard, not merely import/load.

## Consequences

- **Breaking (write validation):** a forged `{ _values: number[] }` map — even with spoofed
  `toArray()`/`isEqual()` — is no longer accepted as a vector; it is validated as an ordinary object
  and rejected unless a field's schema permits that shape. This only rejects input Firestore would
  not have stored as a vector anyway; a genuine `FieldValue.vector()` is unaffected.
  `isVectorFieldValue` (exported from `./vector`) and the root-exported `collectSentinelPaths` /
  `whichFieldValue` / `isFieldValueSentinel` observe the tightened behavior.
- **Breaking (dimension enforcement):** a native `FieldValue.vector()` value is now held to the
  schema's exact- and maximum-dimension constraints, like a plain array — a fixed-dimension schema
  rejects a native vector of the wrong length, and over-`VECTOR_MAX_DIMENSIONS` values are rejected
  on input rather than deferred to the backend.
- **Type-level:** `vectorEmbeddingSchema`'s value type narrows from an effectively-`any` object to
  `number[] | VectorValueLike` (now exported from `/vector`); a caller passing an arbitrary object
  where a vector is expected gets a compile error.
- **Vector search on `7.6`–`7.9`:** the object-form call fails there, now with a deterministic ORM
  compatibility error naming the `>= 7.10` requirement (previously a raw SDK argument error). The
  support contract is: vector search requires `@google-cloud/firestore >= 7.10`.
- **Identity caveat:** nominal `instanceof` identity assumes a single resolved
  `@google-cloud/firestore` in the tree (the normal case). Duplicate installs producing two
  `VectorValue` classes would not be cross-recognized — an accepted, rare edge over the forgeable
  structural check.
- `isVectorFieldValue` keeps one extra defensive `instanceof FieldValue` fallback the core
  recognizer omits; it is unreachable with current SDKs and does not diverge on any recognized
  value.

## Alternatives considered

- **Keep the broad `{ _values }` acceptance** (documented previously as intentional). Rejected: it
  is the B7 vulnerability — it lets a forged map bypass validation and persist as a non-vector map.
- **A structural `toArray()`/`isEqual()` method-presence check** (the first remediation). Rejected
  on review: two spoofed methods on a plain object defeat it, so it is not an authenticity boundary.
- **`instanceof` via a direct `@google-cloud/firestore` import.** Rejected: it is only a transitive
  dependency; recovering the constructor from firebase-admin's own `FieldValue.vector()` gives the
  same nominal identity without an undeclared import.
- **Detecting the two `findNearest` forms by arity.** Rejected: unreliable (`8.x` overloads both
  into one signature). A valid-args capability probe is used instead.
- **Wrapping the real `findNearest` call in a catch-all that relabels any throw as a version
  error.** Rejected on review (R1): a supported SDK also throws ordinary construction errors (e.g.
  an invalid field path), which the catch-all mislabeled as an upgrade instruction. The capability
  probe runs before the real call and detects only the object-form/positional mismatch, leaving
  genuine input errors to propagate.

## References

- [`src/utils/vectorValue.ts`](../../src/utils/vectorValue.ts) — `isGenuineVectorValue` (nominal
  identity), `genuineVectorComponents`, `areFiniteVectorComponents`.
- [`src/vector/VectorSearch.ts`](../../src/vector/VectorSearch.ts) — `isVectorFieldValue`,
  `assertVectorSearchSupported`.
- [`src/vector/VectorQueryBuilder.ts`](../../src/vector/VectorQueryBuilder.ts) — object-form
  `findNearest` compatibility-error wrapper.
- [`src/vector/vectorEmbeddingSchema.ts`](../../src/vector/vectorEmbeddingSchema.ts) (dimension
  enforcement), [`src/vector/index.ts`](../../src/vector/index.ts) (`VectorValueLike` re-export),
  [`src/core/Validation.ts`](../../src/core/Validation.ts) — `isVectorWriteValue`.
- [`scripts/check-packed-consumer.mjs`](../../scripts/check-packed-consumer.mjs) — the pinned
  firestore floor legs and object-form construction probe.
