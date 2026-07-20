# Response to the round-3 review

**Response date:** July 20, 2026 **Branch:** `v3-release-hardening` (round-3 commits on top of
rounds 1–2) **Re:** [`v3-release-review-response-review.md`](./v3-release-review-response-review.md)
— "Round-2 response verification" **Round-2 response:**
[`v3-release-review-response-round2.md`](./v3-release-review-response-round2.md)

Thank you for the third pass. It confirmed the round-2 fixes and correctly found that projection
soundness was still incomplete in three ways, plus a vector threshold bug and two
release-engineering/doc gaps. I re-verified every finding against the current source and the
**installed** `@google-cloud/firestore@8.6.0` serializer — all six hold — and fixed each. No finding
was pushed back.

**Bottom line:** all six round-3 findings are addressed. Projection is now sound for dotted/deep
selections (core and vector), the vector wrapper is immutable like the core builder, an ID-only
projection keeps its distance field, `distanceThreshold: 0` is rejected instead of silently ignored,
publishing is bound to the release identity and the full Admin matrix, and the API reference uses
the result generic `R`.

---

## Finding-by-finding disposition

| #   | Round-3 finding                                                             | Disposition                                                                                        | Commit         |
| --- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------- |
| 1   | Dotted projections statically unsound under shallow `Partial<T>`            | ✅ `select()` returns `DeepPartial<T> & { id }` (nested props optional); dotted/deep type-tests    | `fix(query)`   |
| 2   | Vector `select()` recreates mutable-alias unsoundness                       | ✅ vector `select()` is now an immutable transition (new wrapper); alias type-test + emulator test | `fix(vector)!` |
| 3   | Empty vector projection drops the promised distance field                   | ✅ track `projectionActive` (not `selectedFields.length`); widen mask for ID-only projections      | `fix(vector)!` |
| 4   | `distanceThreshold: 0` accepted but silently ignored by the SDK             | ✅ reject `0` locally + measure-aware negative guard; upstream tracked (#42)                       | `fix(vector)!` |
| 5   | Publish not bound to release identity; Admin matrix only in PR              | ✅ tag/prerelease preflight + Admin 12/13/14 loop on publish                                       | `ci`           |
| 6   | API reference terminal signatures still full-model; stale ErrorHandler task | ✅ terminal signatures use `R`; `sum`/`average` corrected; stale task removed                      | `docs`         |

---

## Details

- **F1 — sound dotted/deep projection.** `Partial<T>` only makes root properties optional, so after
  `select('address.city')` the unselected sibling `address.zip` stayed statically required. Added a
  `DeepPartial<T>` helper (recursively optional; preserves arrays and `Date`) and used it as the
  `select()` result for both the core and vector builders. Type-tests now assert one-level and deep
  dotted selections, unselected-sibling soundness, multiple paths, parent+child, and dynamic
  `FieldPath`. We kept the conservative recursive shape rather than precise `Pick`-from-paths (the
  maintainer's minimal-and-sound preference); this fully closes the flagged hole.

- **F2 — immutable vector `select()`.** The wrapper mutated `this` and re-cast it, so a pre-select
  vector alias kept the full model while its runtime query was projected — the same unsoundness core
  `select()` was fixed to remove. Vector `select()` now returns a **new** wrapper around the
  projected core builder. Added an alias type-test and an emulator test proving the ignored alias
  returns the full model.

- **F3 — empty-projection distance field.** The mask-widening guard used
  `selectedFields.length > 0`, conflating "never selected" with "selected zero fields". An explicit
  `projectionActive` flag now drives widening, so an ID-only `select()` still gets the configured
  `distanceResultField` (the mask becomes `[distanceResultField]`). Unit tests distinguish the two
  states; an emulator regression asserts the field is present and numeric.

- **F4 — reject `distanceThreshold: 0`.** Confirmed against the installed `@google-cloud/firestore`
  `8.6.0` `vector-query.js` serializer, which drops a zero threshold via a truthiness check
  (`threshold ? { value } : undefined`), silently broadening the query. Rather than depend on an
  uncertain SDK upgrade, `validateFindNearestOptions()` now rejects `0` with a specific error (and
  rejects negative thresholds for EUCLIDEAN/COSINE while allowing negative DOT_PRODUCT). The
  upstream serializer bug is tracked in
  [#42](https://github.com/reggieofarrell/firestore-orm/issues/42), which also notes the interim
  guard and the upgrade follow-up.

- **F5 — publish integrity.** Added a "Verify release identity" preflight that fails unless the
  release is not a prerelease and the GitHub tag equals `v${package.json.version}` (fields read via
  env to avoid injection), and a `firebase-admin` 12/13/14 packed-consumer loop on publish so the
  publish gate matches PR CI. Strengthened the guidance to enable the npm GitHub Environment
  approval gate (a one-time npmjs/GitHub configuration).

- **F6 — docs.** The API reference terminal-read signatures (`get`, `getOne`, `stream`,
  `onSnapshot`, and the `items` of the paginate family) now use the result generic `R`, and
  `sum`/`average` are corrected to `NumericFieldPaths<T> | FieldPath`. `DeepPartial<T>` is added to
  the exported-types list, and the `select()` result wording is updated to `DeepPartial<T> & { id }`
  across the API reference, queries, vector, and migration guides. The round-2 response's stale "fix
  the ErrorHandler link" release task is removed (already done; `check:docs` passes).

---

## Verification

| Check                                                                      | Result                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `npm run test:types` (dotted + vector-alias + empty-projection type-tests) | Passed                                                                   |
| Unit tests + coverage gate                                                 | Passed                                                                   |
| Emulator integration tests + coverage gate                                 | Passed (incl. ID-only projection distance field, immutable vector alias) |
| `npm run release:verify`                                                   | Passed end-to-end                                                        |
| `check:consumer` — `firebase-admin@12/13/14` (compile + runtime)           | Passed                                                                   |
| `check:audit` (runtime deps)                                               | 0 vulnerabilities                                                        |
| `check:docs` + `docs:build`                                                | Passed                                                                   |
| `release:bump:dry`                                                         | Selects `3.0.0`                                                          |
| `publish.yml` parse (preflight + Admin matrix steps)                       | Valid                                                                    |

## Remaining at release time

Curate the generated v3 changelog and close/update issue #17. The deferred server-parity features
remain tracked in issues #30–#41 (ADR-0017), and the upstream `distanceThreshold: 0` serializer bug
in #42.
