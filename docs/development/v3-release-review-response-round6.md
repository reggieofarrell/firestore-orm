# Response to the round-6 review

**Response date:** July 20, 2026 **Branch:** `v3-release-hardening` (round-6 commits on top of
rounds 1–5) **Re:** [`v3-release-review-response-review.md`](./v3-release-review-response-review.md)
— "Round-5 response verification" **Round-5 response:**
[`v3-release-review-response-round5.md`](./v3-release-review-response-round5.md)

Thank you for the sixth pass. It confirmed every round-5 fix (broad-`string` distance typing, the
union-distributive `DeepPartial`/`FieldPaths`, the wording sync) and the full release gate, then
raised **one Medium** soundness follow-on exposed by the `FieldPaths` union fix and **one Low**
wording contradiction. I reproduced and fixed both.

**Bottom line:** `PathValue` now distributes over unions and agrees with `FieldPaths`, so
`sum()`/`average()` no longer accept a string-valued union-branch path; the two remaining "only
plain map" claims are corrected and the class-instance workaround is now actionable.

---

## Finding-by-finding disposition

| #   | Round-6 finding                                                                                                                                                                     | Disposition                                                                                                                                                 | Commit                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1   | Medium: `PathValue` doesn't follow `FieldPaths` through unions → branch path resolves to `never` → `NumericFieldPaths` wrongly admits string paths (`sum('metric.label')` compiled) | ✅ `PathValue` made distributive (`T extends unknown`); `NumericFieldPaths` guards unresolved `never` explicitly; direct + public-builder regressions added | `3194ca8` `fix(types)` |
| 2   | Low: API reference + test comment still say "only plain map objects recurse"; `?.`-guard / "atomic" advice imprecise                                                                | ✅ both surfaces corrected to the known-leaf rule; guard-the-method + assert-after-null-check workaround documented                                         | `b7e6083` `docs`       |

## Details

- **F1 — `PathValue` union distributivity (Medium).** Confirmed against source and by probe. The
  root cause is exactly as described: `FieldPaths<T>` distributes over union members (its
  conditionals test a naked `T`), so a field typed `Timestamp | { legacy: string }` or
  `{ count: number } | { label: string }` correctly admits `value.legacy` / `metric.count` /
  `metric.label`. But `PathValue<T, P>` checked the union **as a whole**, and `keyof` of a union is
  only the members' **common** keys — so at the recursive step `Head extends keyof T` failed for a
  branch-specific key and the valid path resolved to `never`. `NumericFieldPaths` then evaluated
  `NonNullable<never> extends number`, which is **vacuously true** (`never` is assignable to every
  type), so every union-branch path — including string ones — was classified numeric. That is why
  `repo.query().sum('metric.label')` compiled on a string field.

  Fix: wrap `PathValue`'s body in a naked `T extends unknown` so resolution **distributes** per
  union member — each member resolves the path independently and the per-member results union
  together (a member lacking the key contributes `never`, which drops out of the union). It now
  **agrees** with `FieldPaths`:
  `PathValue<{ value: Timestamp | { legacy: string } }, 'value.legacy'>` is `string` (not `never`);
  `'metric.count'` is `number`; `'metric.label'` is `string`; a same-key
  `{ v: number } | { v: string }` path is `number | string`. A non-union `T` distributes trivially,
  so every existing single-object path is unchanged (verified — no regression).

  `NumericFieldPaths` is additionally hardened per the reviewer's required change: it explicitly
  excludes an unresolved `[PathValue<T, P>] extends [never]` **before** the numeric check rather
  than relying on `never extends number`, and it keeps the existing rule that a mixed
  `number | string` resolved value is **not** numeric (that check is non-distributive, so
  `number | string extends number` stays `false`). `sum`/`average` now accept only `metric.count`
  (numeric branch) and reject `metric.label` (string branch) and `mixed.v` (mixed).

  Regressions added to [`query-paths.type-test.ts`](../../src/tests/types/query-paths.type-test.ts):
  direct `PathValue` checks for a top-level union, a leaf-or-map union (`value.legacy` resolves to
  `string`, with a `@ts-expect-error` that a number is not assignable — proving it is not `never`),
  branch-specific numeric/string keys, a same-key mixed-value path, and optional/null members; a
  direct `NumericFieldPaths` set assertion (numeric branch included; string + mixed excluded); and —
  the assertion that actually failed the reviewer's probe — `sum()`/`average()` exercised **through
  the public builder** on a union schema, accepting `metric.count` and rejecting `metric.label` /
  `mixed.v`. (`NumericFieldPaths` is internal — it constrains `sum`/`average` — so the direct-helper
  probes import it from `../../utils/pathTypes.js`, while the builder probes cover the public path.)

  This is a bug fix, **not** a breaking change: it makes an over-permissive type _stricter_ by
  rejecting string-valued union-branch paths that never had a numeric value; it changes no runtime
  behavior or public value shape.

- **F2 — arbitrary-class documentation (Low).** The response's conservative treatment of arbitrary
  class instances stands; only the wording needed to match the implementation. Two surfaces still
  said "only plain map objects recurse," which contradicts the actual rule already stated in the
  `pathTypes.ts` JSDoc: `DeepPartial` recurses into **every object not assignable to the leaf set**
  — there is no plain-map predicate. Corrected both the
  [API reference](../../website/src/content/docs/guides/api-reference.md) and the
  [`query-paths.type-test.ts`](../../src/tests/types/query-paths.type-test.ts) comment to that rule.
  The `?.`-guard claim was also imprecise: guarding only the field does not make a recursively
  optional method callable (`row.value?.method()` still errors because `method` is now optional
  too). The docs now say to guard the method as well (`row.value?.method?.()`) or, since the leaf
  set is private, to assert the field back to its class type after a null check
  (`(row.value as ClassType).method()`); mapping the field at the top level with the repository
  `readConverter` remains the cleaner option. A first-class opt-in atomic marker/escape hatch is
  noted as a possible future minor-release enhancement (not built now).

## Verification

| Check                                                                       | Result                       |
| --------------------------------------------------------------------------- | ---------------------------- |
| `npm run test:types` (union `PathValue`/`NumericFieldPaths`/builder probes) | Passed                       |
| Unit tests + coverage gate                                                  | 212/212; gates passed        |
| Emulator integration tests + coverage gate                                  | 218/218; gates passed        |
| `npm run release:verify`                                                    | Passed end-to-end (exit 0)   |
| `check:consumer` (local, `firebase-admin@^14`)                              | Passed (root/vector/express) |
| Admin 12/13/14 consumer matrix                                              | CI publish workflow          |
| `check:docs` (95 files) + `docs:build` (49 pages)                           | Passed                       |
| `release:bump:dry`                                                          | Selects `3.0.0`              |

## Remaining at release time

Curate the generated v3 changelog (projected reads are `DeepPartial<T> & { id }`; include the
immutable `select()` and distance-field breaks) and close/update issue #17. Deferred server-parity
work stays tracked in #30–#41 (ADR-0017); the upstream `distanceThreshold: 0` serializer bug in #42.
