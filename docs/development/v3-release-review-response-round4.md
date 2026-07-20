# Response to the round-4 review

**Response date:** July 20, 2026 **Branch:** `v3-release-hardening` (round-4 commits on top of
rounds 1–3) **Re:** [`v3-release-review-response-review.md`](./v3-release-review-response-review.md)
— "Round-3 response verification" **Round-3 response:**
[`v3-release-review-response-round3.md`](./v3-release-review-response-round3.md)

Thank you for the fourth pass. It confirmed all six round-3 findings fixed and the release gate
green, then raised three new issues: one High result-typing/​runtime bug on `distanceResultField`
collisions, one Medium `DeepPartial` type-quality issue, and one Low stale-wording cleanup. I
re-verified all three against the current source — all held — and fixed each with the reviewer's
recommended approach. No finding was pushed back.

**Bottom line:** all three round-4 findings are addressed. A `distanceResultField` collision now
types as replacement (and the reserved `id` is rejected), `DeepPartial` preserves native Firestore
value APIs, and the remaining stale `Partial<T>` references are synced.

---

## Finding-by-finding disposition

| #   | Round-4 finding                                                                        | Disposition                                                                                                                    | Commit                   |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| 1   | `distanceResultField` collisions produce unsound result types; `id` loses the distance | ✅ replacement typing `Omit<R, DF> & Record<DF, number>`; reject reserved `id`; type + unit + emulator regressions             | `ab89b94` `fix(vector)!` |
| 2   | `DeepPartial` destroys native Firestore value APIs (`Timestamp`, `GeoPoint`, …)        | ✅ reuse `Leaf`/`IsLeaf` so only plain objects recurse; add `Uint8Array`; arrays preserved whole; leaf-preservation type-tests | `eb55f03` `fix(types)`   |
| 3   | Stale `Partial<T>` references (source + scope doc); changelog wording                  | ✅ synced QueryBuilder JSDoc + scope table to `DeepPartial`; changelog wording is a release-time curation note                 | `<docs>`                 |

## Details

- **F1 — distance-field collisions.** `findNearest()` composed the result as
  `R & Record<DF, number>` (intersection). A collision with a model field (`name: string`) became
  `string & number` = `never` (assignable to both, so `const s: string = rows[0].name` compiled
  while the runtime value was a number), and `distanceResultField: 'id'` was worse — Firestore
  writes the distance under `id`, but `get()`'s `{ ...doc.data(), id: doc.id }` overlay replaced it
  with the string document id, losing the distance. The result type (and the exported
  `VectorSearchResult`) is now `DF extends string ? Omit<R, DF> & Record<DF, number> : R` — a
  colliding literal field is typed as the numeric distance (matching Firestore's runtime overwrite);
  a fresh field is unchanged. `validateFindNearestOptions()` rejects `distanceResultField: 'id'`. A
  dynamically-typed (`string`) field name degrades to a broad shape — the guide/JSDoc recommend a
  string literal for precise typing. Regressions: type-tests (colliding field replaced with
  `number`; string assignment is a compile error; dotted output name), a unit test for the `id`
  rejection, and emulator tests (a `name` collision returns a number; `id` rejected before touching
  Firestore).

- **F2 — `DeepPartial` leaf preservation.** `DeepPartial` special-cased only arrays and `Date`,
  recursively mapping `Timestamp`/`GeoPoint`/`DocumentReference`/vector values and destroying their
  method types (a projected `Timestamp` lost `.toMillis()`). It now reuses the file's existing
  `Leaf`/`IsLeaf` helpers: only plain (map) objects recurse; every leaf value is preserved whole —
  scalars, `Date`, the Firestore value classes, byte values, functions, and **arrays** (a field mask
  never projects into array elements, so the array is returned whole, not element-partialized).
  `Uint8Array` was added to `Leaf` (covering `Buffer` via subtype) so byte fields are atomic in both
  `DeepPartial` and `FieldPaths`. Type-tests assert a selected `Timestamp`, `GeoPoint`,
  `DocumentReference`, `Uint8Array`, and array keep their real APIs after the parent is guarded.

- **F3 — stale wording.** Synced the `@template R` JSDoc in `QueryBuilder.ts` and the capability
  table in the Scope & Capabilities guide to `DeepPartial<T> & { id }`. (The `findNearest()`
  result-shape comment was updated with the F1 change.) The `DeepPartial` JSDoc's contrastive
  "Unlike `Partial<T>`" wording, the type-test's explanatory comment, and the unrelated generic
  `Partial<T>` in the advanced-patterns custom-method example are intentionally left as-is, and the
  frozen `2.0/` archive is untouched.

## Verification

| Check                                                           | Result                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------- |
| `npm run test:types` (collision + leaf-preservation type-tests) | Passed                                                  |
| Unit tests + coverage gate                                      | Passed                                                  |
| Emulator integration tests + coverage gate                      | Passed (incl. `name` collision → number; `id` rejected) |
| `npm run release:verify`                                        | Passed end-to-end                                       |
| `check:consumer` — `firebase-admin@12/13/14`                    | Passed                                                  |
| `check:docs` + `docs:build`                                     | Passed                                                  |
| `release:bump:dry`                                              | Selects `3.0.0`                                         |

## Remaining at release time

Curate the generated v3 changelog and close/update issue #17. **Changelog curation note:** the
generated breaking-change text must describe projected reads as `DeepPartial<T> & { id }` (not the
earlier `Partial<T> & { id }`) and include the immutable core/vector `select()` transition and the
`distanceResultField` replacement/`id`-rejection break. Deferred server-parity work remains tracked
in issues #30–#41 (ADR-0017); the upstream `distanceThreshold: 0` serializer bug in #42.
