# ADR-0009: Explicit `validate()` / `safeValidate()` read-boundary validators

- **Status:** Accepted (implemented on branch; pending merge/release)
- **Date:** 2026-07-18
- **Deciders:** Reggie O'Farrell
- **Related:** [issue #14](https://github.com/reggieofarrell/firestore-orm/issues/14);
  [ADR-0005](0005-from-snapshot-read-mapper.md) (`fromSnapshot` and the deferred validation
  question); [ADR-0008](0008-read-only-converters.md) (validate after `readConverter` + `id`
  overlay); [`src/core/FirestoreRepository.ts`](../../src/core/FirestoreRepository.ts)

## Context

Reads in this library are **compile-time casts**, not runtime validation. Every read path
(`getById`, query terminals, `fromSnapshot`, …) returns `snapshot.data() as T` plus the `id` overlay
/ `readConverter` transform without running the result through the Zod schema.

That is fine for trusted data, but there was no built-in, ergonomic way to assert that stored data
still matches the schema at a trust boundary (e.g. a Cloud Function trigger). The documented
workaround was:

```ts
repo.schemas?.read.parse(repo.fromSnapshot(snap));
```

That leaked a raw `ZodError` instead of the library's `ValidationError`, and forced callers to touch
the schema bag directly.

An earlier design for issue #14 proposed threading `{ validate: true }` through every read method
(optionally with a repo-level `validateReads` flag). That approach touched ~15 signatures and forced
thorny semantics for list/stream partial failure, per-call vs repo-flag precedence, and no-schema
behavior — all while changing the default read path's option surface for an opt-in feature.

## Decision

We will add two **explicit** instance methods on `FirestoreRepository` that validate an already-read
value against `schemas.read`. Callers compose them with any read; no existing read signature
changes.

1. **`validate(data)`** — throwing. Overloads for a single `T & { id }` and an array. Runs
   `schemas.read.parse`, returns the **parsed** value (Zod transforms/coercions apply), and on
   mismatch rethrows `new ValidationError(err.issues)` — matching write paths. Array form is
   all-or-nothing (first bad element throws).
2. **`safeValidate(data)`** — non-throwing on data mismatch. Same overloads; returns `SafeResult<T>`
   (or `SafeResult<T>[]` for arrays) with `{ success, data | error }` where failures are
   `ValidationError`, not `ZodError`. Array form is per-item so callers can filter.
3. **No schema configured.** Both methods throw a plain `Error` with a clear message. An explicit
   validate call without a schema is a programmer mistake — no silent no-op. This is distinct from a
   data-shape `ValidationError`.
4. **When / what.** Callers pass the final read shape (after `id` overlay and `readConverter`).
   Streaming / real-time listeners are not auto-validated; callers validate inside the callback
   (`repo.validate(doc)` / `repo.safeValidate(docs)`).
5. **Export `SafeResult<T>`** from the package entry.

`fromSnapshot` and all other reads remain unvalidated casts. The recommended trigger trust-boundary
pattern is now `repo.validate(mapped)` after a null guard — replacing the old
`schemas.read.parse(...)` workaround (see ADR-0005 Related / Consequences note).

## Consequences

**Positive**

- Additive only: two new methods + a type export; zero change to default read performance or
  signatures.
- One error type (`ValidationError`) across write and opt-in read validation.
- Partial-failure policy is expressed by method choice (`validate` vs `safeValidate`), not by
  options on every list/stream terminal.
- Future automatic at-read validation (if ever needed) can wrap these methods rather than
  reimplementing parse in each read path.

**Negative / costs**

- Callers must remember to compose validation; it is not automatic on reads.
- Streaming / `onSnapshot` is slightly less convenient than an inline `{ validate: true }` would
  have been — accepted trade-off for the far smaller surface.

## Alternatives considered

- **Per-call `{ validate: true }` on every read path (original #14).** Rejected: large signature
  churn, list/stream failure-policy ambiguity, and per-read perf surprises for an opt-in feature.
- **Repo-level `validateReads: true`.** Rejected as the primary design for the same reasons; a
  future layer could still sit on top of `validate()`.
- **Filter / `onError` inside multi-doc reads.** Rejected: `safeValidate`'s per-item results give
  callers the same capability without baking policy into the repository.
- **Silent no-op when no schema.** Rejected: an explicit `validate()` call without a schema can only
  be a mistake.

## References

- [issue #14](https://github.com/reggieofarrell/firestore-orm/issues/14)
- [`ValidationError`](../../src/core/Errors.ts)
- Firestore triggers usage guide (published docs) — “Validating at the boundary”
