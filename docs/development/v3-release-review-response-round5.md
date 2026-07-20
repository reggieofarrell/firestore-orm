# Response to the round-5 review

**Response date:** July 20, 2026 **Branch:** `v3-release-hardening` (round-5 commits on top of
rounds 1–4) **Re:** [`v3-release-review-response-review.md`](./v3-release-review-response-review.md)
— "Round-4 response verification" **Round-4 response:**
[`v3-release-review-response-round4.md`](./v3-release-review-response-round4.md)

Thank you for the fifth pass. It confirmed the literal-case round-4 fixes and the release gate, then
raised three follow-on issues on the new type machinery: one High broad-`string` distance-field bug,
one Medium `DeepPartial`/`FieldPaths` union-distributivity issue, and one Low wording gap (including
a guidance claim my round-4 response made prematurely). I re-verified all three and fixed them, with
one deliberately-documented residual (arbitrary `readConverter` class instances) that structural
typing cannot resolve soundly.

**Bottom line:** the two type-soundness findings are fixed; the wording is synced and the previously
missing literal-distance-field guidance is now actually present.

---

## Finding-by-finding disposition

| #   | Round-5 finding                                                                                  | Disposition                                                                                                                                                                           | Commit                   |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | Broad-`string` distanceResultField types every field as `number`                                 | ✅ conservative `DistanceFieldResult` for a non-literal `string` (`id` preserved, others `T \| number`, arbitrary keys `unknown`); `'id'` literal → `never`; literals unchanged       | `ef32cda` `fix(vector)!` |
| 2   | `DeepPartial`/`FieldPaths` leaf handling not union-distributive; `readConverter` classes recurse | ✅ distributive leaf test; `FieldPaths` recurses only map members (`Exclude<…, Leaf>`), no more `'value.toMillis'`. 📝 arbitrary class-instance field residual documented (see below) | `cc10058` `fix(types)`   |
| 3   | Stale test comment; vector-guide intersection formula; missing literal guidance                  | ✅ type-test comment, vector guide, `FindNearestOptions` JSDoc, and API reference synced                                                                                              | `<docs>`                 |

## Details

- **F1 — dynamic distance-field name.** The round-4 `Omit<R, DF> & Record<DF, number>` is right for
  a literal `DF`, but for the wide `string` (an options value from a variable) `Omit<R, string>`
  erased every known string key and `Record<string, number>` then promised every property (including
  the always-string `id`) was numeric. A shared `DistanceFieldResult<R, DF>` helper now branches:
  `string extends DF` → conservative (`id` keeps its ID type; other known fields `R[K] | number`;
  arbitrary keys `unknown`); literal `'id'` (or a union containing it) → `never`; other literals →
  replacement. Used by both `findNearest()` and the exported `VectorSearchResult`. Regressions cover
  a plain `string`, `string | undefined`, a union of literals, and the exported type for `string`
  and `'id'`; the broad case rejects `rows[0].id.toFixed()` and a numeric model-field assignment.

- **F2 — union-distributive leaf handling.** `DeepPartial` now uses a distributive
  `T extends Leaf ? T : …`, so a `Timestamp | { legacy }` field preserves the `Timestamp` member
  whole and recurses only into the map. `FieldPaths` recurses into
  `Exclude<NonNullable<T[K]>, Leaf>` — the map-only members — so it no longer emits a class method
  like `'value.toMillis'` while still exposing `'value.legacy'`. The unused `IsLeaf` helper was
  removed. **Residual (documented, not silently dropped):** an arbitrary class instance returned by
  a `readConverter` as a _field value_ is not a known `Leaf`, so it recurses and its methods type as
  optional after a projection. This is conservative (safe — a `?.` guard restores them; the runtime
  value is complete), and structural typing cannot distinguish such a class from a plain map that
  merely has a method **without** reintroducing the dotted-sibling unsoundness the whole projection
  effort exists to prevent (over-preserving a real nested map would leave its unselected siblings
  statically required). The `DeepPartial` JSDoc and the API reference now state this precisely and
  recommend a top-level `readConverter` or treating such a field as atomic — consistent with the
  already-documented "a converter written for full docs may throw on a projection" caveat.

- **F3 — wording.** Corrected the `query-paths.type-test` comment (`Partial<Doc>` →
  `DeepPartial<Doc>`), replaced the vector guide's intersection formula with the replacement /
  reserved-`id` / broad-`string` rules, added the **string-literal recommendation** to the vector
  guide and `FindNearestOptions.distanceResultField` JSDoc (the guidance my round-4 response
  referred to but had not actually added — now present), and expanded the API-reference
  `DeepPartial` note to the full atomic-value contract.

## A note on the round-4 response

The round-4 response stated the guide/JSDoc "recommend a string literal for precise typing." That
was aspirational — the text had not yet been added. It is now added (F3). Apologies for the
premature claim.

## Verification

| Check                                                        | Result            |
| ------------------------------------------------------------ | ----------------- |
| `npm run test:types` (broad-string + mixed-union type-tests) | Passed            |
| Unit tests + coverage gate                                   | Passed            |
| Emulator integration tests + coverage gate                   | Passed            |
| `npm run release:verify`                                     | Passed end-to-end |
| `check:consumer` — `firebase-admin@12/13/14`                 | Passed            |
| `check:docs` + `docs:build`                                  | Passed            |
| `release:bump:dry`                                           | Selects `3.0.0`   |

## Remaining at release time

Curate the generated v3 changelog (projected reads are `DeepPartial<T> & { id }`; include the
immutable `select()` and distance-field breaks) and close/update issue #17. Deferred server-parity
work stays tracked in #30–#41 (ADR-0017); the upstream `distanceThreshold: 0` serializer bug in #42.
