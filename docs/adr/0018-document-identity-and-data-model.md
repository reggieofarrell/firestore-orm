# ADR-0018: v3 document identity and the read/write/stored data-model split

- **Status:** Accepted (v3) — implementing on branch `v3-release-hardening-part-2`
- **Date:** 2026-07-21
- **Deciders:** Reggie O'Farrell
- **Related:**
  [`reviews/v3-pre-release-codebase-review.md`](../../reviews/v3-pre-release-codebase-review.md),
  [`reviews/v3-document-id-and-query-typing-recommendation.md`](../../reviews/v3-document-id-and-query-typing-recommendation.md);
  refines [ADR-0004](0004-schema-inferred-write-types.md) /
  [ADR-0007](0007-retire-curried-schema-factories.md) (write-input types),
  [ADR-0008](0008-read-only-converters.md) (`readConverter`),
  [ADR-0009](0009-explicit-read-validators.md) (read validators),
  [ADR-0010](0010-type-safe-dot-notation.md) (`FieldPaths`);
  [ADR-0013](0013-create-return-contract.md) (create contract) stands unchanged.

## Context

A pre-release review found that `id` is modeled two incompatible ways at once. The repository
constrains `T extends { id?: string }`, `withSchema`/`subcollection` require a top-level `id`, and
reads return `T & { id }` — yet the repository strips `id` on writes and overlays `snapshot.id` on
reads. `id` is therefore simultaneously "stored document data" and "synthetic metadata sourced from
the document name." That single confusion is the root of several confirmed defects:

- `FieldPaths<T>` includes `id`, so `where('id', …)`/`orderBy('id')`/`distinctValues('id')` compile
  but address a **stored field that does not exist** — they silently match nothing. The active docs
  even recommended the broken form. (Reviewed as B4.)
- `assertSchemaHasRequiredId` verifies the `id` schema by parsing the literal `'firestoreorm-id'`,
  which **rejects every valid refined id schema** — UUID, regex, `min(20)`, branded. (B6.)
- `ReadConverter<T>` is typed to return a model _including_ `id`, contradicting its own contract
  that the mapper omits `id` (the repository overlays it). (D8.)
- Write typing uses `z.infer` (= `z.output`) for **caller input**, so a
  `z.string().transform(v => v.length)` field forces callers to pass a `number` even though runtime
  validation needs a `string`. (B5.)
- Caller-supplied ids flow straight into `CollectionReference.doc(id)` with no validation; a
  slash-bearing id escapes the collection boundary, and `getById` echoes the supplied path as the
  returned `id`. (B1.) Mutable hook payloads can redirect bulk writes/deletes. (B2.)

The Admin SDK authenticates via IAM and bypasses Firestore Security Rules, so the repository's own
scoping is the only server-side boundary — path validation is a real boundary, not cosmetics.

A follow-up design doc proposed a Typesaurus-influenced model. We adopt its foundational ideas
(document name is authoritative; query values derive from stored data; separate read/write/stored
types) and deliberately **decline** its heavier machinery (universal `{ data, ref }` wrapper,
mirrored-identity subsystem, and — for v3 — scoped/branded IDs and typed query operands).

## Decision

We will make the document-identity model explicit and split the three observable data contracts.

1. **Virtual identity only.** The native Firestore document name is the sole authority for `id`. A
   top-level `id` in any read/write/stored schema is **rejected at construction** with a remedial
   error. Existing collections that physically store `id === document name` drop the field with a
   one-line schema edit; the stored value becomes inert (reads overlay `snapshot.id`, which wins)
   and can be removed later via an optional data migration. We do **not** implement a "mirrored
   identity" policy — being opinionated here removes a large subsystem (read-invariant checks, write
   injection across every mutation spelling, mismatch errors, audit tooling) for a compatibility
   case a single schema edit already covers.

2. **Three data models, three generics.**
   `FirestoreRepository<ReadData, WriteInput = ReadData, StoredData = ReadData>` (the
   `T extends { id?: string }` constraint is removed):
   - `ReadData = z.output<RS>` — application shape after any `readConverter`.
   - `WriteInput = z.input<WS>` — caller input to create/update. Using `z.input` (not `z.infer`)
     fixes the transform/coerce/default input-vs-output inversion (B5).
   - `StoredData = z.output<SS>` — the at-rest shape; the source of query field paths. Defaults to
     `z.output<RS>`, and is **required** (via `storedSchema`) whenever a `readConverter` is
     configured, because a converter can make the read model diverge from what is stored (D8).

3. **Flat, authoritative result.** Reads return
   `FirestoreDocument<ReadData> = Omit<ReadData, 'id'> & { readonly id: ID }`, with `id` always from
   `snapshot.id`. This preserves the library's flat-result ergonomics (`user.id`, `user.name`)
   rather than a `{ data, ref }` wrapper. Extraction helpers `DataOf`/`StoredDataOf`/`DocumentOf`
   let consumers name these types without spelling generics.

4. **Delete the probe.** `assertSchemaHasRequiredId` is removed (B6). Construction validates schema
   _shape/policy_ (no top-level `id`); real native ids are validated at the `repo.id()`, create, and
   read boundaries against Firestore's actual id rules — never a fabricated placeholder.

5. **Query from `StoredData`; document-name via `whereId`/`orderById`.** `where`/`orderBy`/`select`/
   aggregation field paths and the `findByField`/`getOneByField*` helpers (and the vector builder's
   `where`/`select`) derive from `FieldPaths<StoredData>`, which excludes the synthetic `id` — so
   `where('id', …)` becomes a compile error (B4). Native document-name queries use new `whereId` and
   `orderById` methods (`FieldPath.documentId()`). The `where` **value** stays `unknown` in v3
   (operand typing is deferred — see below).

6. **Centralized runtime id/path validation** applied to every id-taking surface (all single, bulk,
   transaction, listener, and subcollection methods): reject empty, `/`, `.`, `..`, `/^__.*__$/`,
   `> 1500` UTF-8 bytes, and invalid UTF-8 — aligned with Firestore's documented constraints so
   valid ids (dots, spaces, unicode) are not over-rejected (B1). Reads return `snapshot.id`, never
   the caller-supplied path. Add `repo.id(raw)` (validating boundary) and `repo.newId()` (validated
   auto-id, no write).

7. **Immutable hook identity** (B2): capture target ids / `DocumentReference`s **before** invoking
   before-hooks and build write actions and after-hook payloads from the captured values; freeze the
   event envelopes. Documented data-field mutation still works.

8. **Deferrals, recorded so the design is not lost:**
   - **Scoped/branded `DocumentId<Scope>`.** v3 ships runtime id validation and returns plain string
     `ID`. Branding is deferred: branded _return_ types and `repo.id()`/`newId()`/`zDocumentId`
     helpers can be added later **non-breakingly** (a brand is a `string` subtype, so narrowing a
     return is covariant); only _requiring_ branded ids at method **inputs** is breaking (a
     `string | DocumentId` union collapses back to `string`), so hard enforcement is reserved for a
     future major.
   - **Typed query operands.** v3 restricts query _field paths_ to `StoredData` but keeps
     `value: unknown`. Typing the operand from `PathValue<StoredData, P>` is a post-v3 experiment,
     gated on a `tsc --extendedDiagnostics` baseline; it is purely additive because `StoredData`
     already exists.

## Consequences

- Resolves the reviewed findings B1, B2, B4, B5, B6, D8, and D9 (hook payloads now carry
  `FirestoreDocument<ReadData>` / `WriteInput`) at the model level rather than by per-symptom
  patches.
- **Breaking (v3):** schemas no longer declare `id`; query field-path types drop `id`; write-input
  types follow `z.input`; the result type is `FirestoreDocument<…>` (flat and assignment-compatible
  with the old `T & { id }`, so most read code is unaffected). Migration is a one-line schema edit
  per repository plus optional stored-`id` cleanup; the migration guide must distinguish a
  _historical fake_ `id` from a _legitimately stored_ one and advise dropping it (not a data
  rewrite).
- The repository keeps **three** generics with defaults; common usage
  (`withSchema(db, 'users', schema)`) gets simpler (no fake `id` in the schema) and stronger.
  `ADR-0013` (create returns `{ id }`) stands.
- **Perf risk:** propagating `FieldPaths<StoredData>` adds type-level work; bounded by keeping the
  existing depth-limited path types and deferring operand typing. Verify against a captured
  baseline.

## Alternatives considered

- **Mirrored identity mode** (enforce a stored `id === name` invariant on every read/write).
  Rejected for v3: a large subsystem for a compatibility case that a single schema edit resolves; we
  chose to be opinionated and reject a stored top-level `id`.
- **Full scoped/branded IDs in v3.** Deferred: the security fix is runtime validation (no brand
  needed); enforcement adds compiler-perf cost and call-site friction and is mostly addable later
  without a break.
- **Typed query operands in v3.** Deferred: the one real compiler-perf risk; additive later.
- **Curried `unvalidated()()` factory** to infer scope for unvalidated repos. Rejected: reintroduces
  currying that [ADR-0007](0007-retire-curried-schema-factories.md) retired; unvalidated repos take
  a broad scope instead.
- **Typesaurus `{ data, ref }` document wrapper.** Rejected: the flat result is a deliberate
  strength.

## References

- [`reviews/v3-pre-release-codebase-review.md`](../../reviews/v3-pre-release-codebase-review.md),
  [`reviews/v3-document-id-and-query-typing-recommendation.md`](../../reviews/v3-document-id-and-query-typing-recommendation.md)
- [`src/core/FirestoreRepository.ts`](../../src/core/FirestoreRepository.ts),
  [`src/core/QueryBuilder.ts`](../../src/core/QueryBuilder.ts),
  [`src/core/Validation.ts`](../../src/core/Validation.ts),
  [`src/utils/pathTypes.ts`](../../src/utils/pathTypes.ts), a new `src/core/DocumentId.ts`.
