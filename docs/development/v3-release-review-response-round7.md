# Response to the round-7 review

**Response date:** July 20, 2026 **Branch:** `v3-release-hardening` (round-7 commit on top of rounds
1–6) **Re:** [`v3-release-review-response-review.md`](./v3-release-review-response-review.md) —
"Round-6 response verification" **Round-6 response:**
[`v3-release-review-response-round6.md`](./v3-release-review-response-round6.md)

Thank you for the seventh pass. It confirmed the round-6 fixes (distributive `PathValue`,
union-backed numeric-aggregate rejection, corrected class-instance wording) and the full release
gate, then raised **one Medium follow-on** on the `never` defense I added last round. I reproduced
and fixed it.

**Bottom line:** the numeric-path empty-value guard now runs on the normalized (`NonNullable`)
value, so a field typed exactly `null` / `undefined` / `null | undefined` is no longer classified
numeric — `sum('nil')` / `average(...)` now reject it, while nullable/optional number fields remain
numeric.

---

## Finding-by-finding disposition

| #   | Round-7 finding                                                                                                                      | Disposition                                                                                                                                                             | Commit                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1   | Medium: null-only / undefined-only / null-or-undefined fields still classified numeric (guard ran on the pre-normalized `PathValue`) | ✅ guard moved to the normalized `NonNullable<PathValue>` value; tuple-wrapped number test retained; nullish/nullable regressions added through helper + public builder | `cfaa428` `fix(types)` |

## Details

- **F1 — nullish-only fields classified numeric (Medium).** Confirmed against source and by probe.
  The round-6 `NumericFieldPaths` ran its empty-value guard on the **raw** `PathValue<T, P>` while
  the numeric check ran on `NonNullable<PathValue<T, P>>`. The two disagreed precisely for a field
  whose resolved type is exactly `null`, `undefined`, or `null | undefined`:

  ```ts
  PathValue<T, 'nil'>        // null
  [null] extends [never]     // false — guard passes
  NonNullable<null>          // never
  never extends number       // true — 'nil' wrongly admitted
  ```

  So `repo.query().sum('nil')` compiled for a `z.null()` field (same for undefined-only and
  `null | undefined`). This did not invalidate the distributive `PathValue`; it was narrowly the
  guard operating on the pre-normalized type.

  Fix ([`src/utils/pathTypes.ts`](../../src/utils/pathTypes.ts)): run **both** guards on the same
  normalized value so a nullish-only field collapses to `never` **before** the empty-value guard:

  ```ts
  export type NumericFieldPaths<T> = {
    [P in FieldPaths<T>]: [NonNullable<PathValue<T, P>>] extends [never]
      ? never
      : [NonNullable<PathValue<T, P>>] extends [number]
        ? P
        : never;
  }[FieldPaths<T>];
  ```

  The tuple around the number test keeps a mixed `number | string` value from distributing and
  admitting only its numeric half. Case coverage: `null` / `undefined` / `null | undefined` →
  `never` → excluded; `number | null`, `number | undefined` (optional), plain `number` → `number` →
  included; `string | null` → `string` → excluded; `number | string` → excluded; an unresolved path
  (raw `never`) → still excluded. Existing non-nullish numeric paths (`score`, `stats.count`,
  `rating`) are unchanged.

  Regressions added to [`query-paths.type-test.ts`](../../src/tests/types/query-paths.type-test.ts),
  through **both** the helper and the public builder (the exact probe the reviewer ran): a
  `NullishDoc` with `null` / `undefined` / `null | undefined` / `number | null` / optional `number`
  / `string | null` fields asserts the two numeric fields are members and the three nullish-only
  fields plus the nullable string are excluded; a Zod schema (`z.null()`, `z.number().nullable()`,
  `z.number().optional()`, `z.string().nullable()`) asserts `sum('maybeNumber')` /
  `average('optNumber')` compile while `sum('nil')` / `average('maybeString')` are compile errors.
  The round-6 mixed `number | string` and union-branch regressions remain in place.

  Like round 6, this is a bug fix, **not** a breaking change: it makes an over-permissive type
  _stricter_ by rejecting nullish-only fields that never held a number; it changes no runtime
  behavior or public value shape.

## Verification

| Check                                                           | Result                       |
| --------------------------------------------------------------- | ---------------------------- |
| `npm run test:types` (nullish/nullable + retained union probes) | Passed                       |
| Unit tests + coverage gate                                      | 212/212; gates passed        |
| Emulator integration tests + coverage gate                      | 218/218; gates passed        |
| `npm run release:verify`                                        | Passed end-to-end (exit 0)   |
| `check:consumer` (local, `firebase-admin@^14`)                  | Passed (root/vector/express) |
| Admin 12/13/14 consumer matrix                                  | CI publish workflow          |
| `check:docs` + `docs:build`                                     | Passed                       |
| `release:bump:dry`                                              | Selects `3.0.0`              |

## Remaining at release time

Curate the generated v3 changelog (projected reads are `DeepPartial<T> & { id }`; include the
immutable `select()` and distance-field breaks) and close/update issue #17. Deferred server-parity
work stays tracked in #30–#41 (ADR-0017); the upstream `distanceThreshold: 0` serializer bug in #42.
The reviewer states rounds 1–6 close after this normalized-value guard lands; the documented
custom-class limitation and server-side parity remain appropriate post-v3 scope.
