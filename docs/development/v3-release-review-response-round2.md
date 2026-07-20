# Response to the round-2 review

**Response date:** July 19, 2026 **Branch:** `v3-release-hardening` (round-2 commits on top of the
round-1 work) **Re:**
[`v3-release-review-response-review.md`](./v3-release-review-response-review.md) **Round-1
response:** [`v3-release-review-response.md`](./v3-release-review-response.md)

Thank you for the second pass — it was correct on every count. Four items the round-1 response
marked fixed were incomplete, the release-engineering claims overstated what was actually gated, and
the closing "everything else is satisfied" line ignored the server-parity follow-up. We re-verified
each finding against the source, fixed the confirmed defects with regression tests, made an explicit
re-scope decision, filed tracking issues for the deferred parity work, and corrected the round-1
response's overclaims inline.

**Bottom line:** all seven round-2 findings are addressed. The four implementation defects are fixed
with unit + emulator-integration + type-level regression tests; the CI/release gate now runs the
canonical `release:verify` and tests every declared Firebase Admin major; and v3 is now honestly
scoped and documented as a **Firestore Core operations** ORM, with the parity gaps tracked as issues
rather than implied complete.

---

## Finding-by-finding disposition

Legend: ✅ fixed · 🧭 scope decision.

| #   | Round-2 finding                                                                                                     | Disposition                                                                                                                              | Commit                                     |
| --- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1   | Output prototype pollution remains in `convertTimestampsToMillis()` + `flattenToDotNotation()`                      | ✅ shared safe-copy primitive (`safeAssign`) writes caller-controlled keys as own data properties; adversarial tests for both            | `fix(security)` `4b6725c`                  |
| 2   | `FieldValue.vector([Infinity])` bypasses finite validation (sentinel path)                                          | ✅ shared `hasFiniteVectorValues` recognizer; `isVectorFieldValue` is terminal on `_values`; core validator delegates to it              | `fix(vector)` `089d723`                    |
| 3   | Vector projection reset by `findNearest()`; distance field not selectable                                           | ✅ `findNearest()` composes with the current result shape `R` and auto-widens the mask for the computed distance field                   | `fix(query)!` `a0d3c77`                    |
| 4   | Core projection unsound through mutable builder aliases                                                             | ✅ `select()` returns a new (immutable) builder; kept `Partial<T>` (precise `Pick` deferred by decision)                                 | `fix(query)!` `a0d3c77`                    |
| 5   | `query().update({})` returns `0` on zero matches instead of rejecting                                               | ✅ empty-snapshot path now validates + sanitizes + rejects an empty payload                                                              | `fix(query)!` `a0d3c77`                    |
| 6   | Workflows don't run `release:verify`; gaps (docs build, Admin matrix, runtime smoke, audit, `peerDependenciesMeta`) | ✅ publish runs `release:verify`; PR union is equivalent; Admin 12/13/14 matrix; runtime load smoke; audit policy; deep meta check       | `ci` `13e84d7`                             |
| 7   | Server-parity follow-up not addressed; response overclaimed                                                         | 🧭 re-scoped to "Core operations" + `select().onSnapshot()` guard + capability doc + escape hatch; parity deferred and tracked (#30–#41) | `fix(query)!` `a0d3c77`, docs (this round) |

---

## The four implementation defects

- **F-R1 — output prototype pollution (complete now).** Round 1 guarded the dot-notation path
  traversals but left two builders that assign arbitrary keys with `obj[key] = value`, which invokes
  the `__proto__` setter and lets untrusted input control the _output object's_ prototype. We added
  a shared `safeAssign` primitive (`src/utils/safeObject.ts`) that defines `__proto__` as an own
  data property instead, and used it in `convertTimestampsToMillis`'s walker and
  `flattenToDotNotation`. Tests assert both the global `Object.prototype` and the returned object's
  prototype stay clean for own `__proto__`/`constructor`/`prototype` keys, including
  `JSON.parse`-sourced input. (The round-1 refutation of `convertTimestampsToMillis` was too strong;
  corrected inline in the round-1 response.)

- **F-R2 — non-finite vector sentinels (complete now).** The finite check was applied only to plain
  query arrays; the `VectorValue` sentinel paths used `!Number.isNaN` (accepts ±Infinity) and, in
  the vector extension, fell through to a `toString().includes('vector')` acceptance. We centralized
  a `hasFiniteVectorValues` recognizer (`src/utils/vectorValue.ts`, `Number.isFinite`), made
  `isVectorFieldValue` decide `_values`-shaped values solely on it and return terminally, and had
  the core validator delegate to the same helper so the two cannot drift again.

- **F-R3 / F-R4 — projection soundness (close the hole, keep `Partial<T>`).** `select()` now returns
  a **new** builder instead of mutating and re-casting `this`, so a pre-select alias keeps the full
  model at both type and runtime. Vector `findNearest()` composes with the builder's current result
  shape `R` (rather than resetting to full `T`), so a `select()` projection survives as
  `Partial<T> & { id } & { [DF]: number }`. Because a Firestore field mask drops the computed
  distance field unless named, `findNearest()` auto-widens the mask to include the configured
  `distanceResultField` — so callers never name a non-schema field in `select()` (which was the
  type/runtime contradiction the review flagged). We kept the conservative `Partial<T>` result and
  deliberately deferred precise `Pick<T, K>` inference (a decision, not an oversight).

- **F-R5 — zero-match empty-update.** `query().update({})` returned `0` on a zero-match query before
  any validation, making the empty-update contract data-dependent. The empty-snapshot path now
  validates + sanitizes the payload and rejects an empty one regardless of matches; a valid
  non-empty payload against zero matches still returns `0`. ADR-0014's zero-match note is corrected.

## Release-engineering honesty (F-R6)

`release:verify` existed but neither workflow invoked it. Now the publish workflow runs
`npm run release:verify` as the single canonical gate, and the PR workflow's parallel jobs are kept
definitionally equivalent (with a sync note). We also added the pieces that were missing entirely: a
**firebase-admin 12/13/14 consumer matrix** (the packed-consumer check reads
`FIRESTORE_ORM_ADMIN_VERSION`), a **runtime load smoke test** that `require()`s / `import()`s the
built root, `/vector`, and `/express` entrypoints (not only type-checks them), a **runtime-only
audit policy** (`npm audit --omit=dev`; the shipped package has no runtime deps), a
**website-build** job, and a **deep `peerDependenciesMeta`** comparison in the manifest/lockfile
check.

## Scope decision (F-R7)

Per the maintainer's direction, v3 ships as a **Firestore Core operations** ORM. We did not
implement the server-parity feature set for v3. Instead:

- Added the one cheap local guard the review called out — `select().onSnapshot()` now fails locally.
- Added a
  **[Scope & Capabilities](../../website/src/content/docs/guides/scope-and-capabilities.md)** guide:
  a supported-vs-deferred capability matrix and the documented raw-SDK escape hatch (use the
  `Firestore` instance you injected; `fromSnapshot()` re-enters the read model).
- Recorded the decision in **ADR-0017** and **filed a tracking issue for every deferred feature**,
  labeled `parity` / `v3.x`:

  | Feature                                      | Issue                                                            |
  | -------------------------------------------- | ---------------------------------------------------------------- |
  | Composite `where(Filter)` AND/OR             | [#30](https://github.com/reggieofarrell/firestore-orm/issues/30) |
  | Collection-group queries                     | [#31](https://github.com/reggieofarrell/firestore-orm/issues/31) |
  | Transaction options / PITR                   | [#32](https://github.com/reggieofarrell/firestore-orm/issues/32) |
  | Conditional writes / preconditions           | [#33](https://github.com/reggieofarrell/firestore-orm/issues/33) |
  | Generic multi-aggregation                    | [#34](https://github.com/reggieofarrell/firestore-orm/issues/34) |
  | `getMany(ids)`                               | [#35](https://github.com/reggieofarrell/firestore-orm/issues/35) |
  | Typed lower-level bounds + `limitToLast()`   | [#36](https://github.com/reggieofarrell/firestore-orm/issues/36) |
  | Query Explain                                | [#37](https://github.com/reggieofarrell/firestore-orm/issues/37) |
  | BulkWriter + recursive delete                | [#38](https://github.com/reggieofarrell/firestore-orm/issues/38) |
  | Snapshot/write metadata + detailed listeners | [#39](https://github.com/reggieofarrell/firestore-orm/issues/39) |
  | Server-side / structured distinct            | [#40](https://github.com/reggieofarrell/firestore-orm/issues/40) |
  | Experimental Enterprise Pipeline subpath     | [#41](https://github.com/reggieofarrell/firestore-orm/issues/41) |

We also corrected the round-1 response's overclaims (F3 refutation, F10 "reject non-finite", the F16
gating row, and the "everything else is satisfied" closing line) inline in that document.

---

## Verification

| Check                                                                      | Result                                                                      |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Lint                                                                       | Passed                                                                      |
| Type tests (`test:types`, incl. new alias + vector-composition type-tests) | Passed                                                                      |
| Unit tests + coverage gate                                                 | Passed (utils gate 100% lines incl. new `safeObject.ts` / `vectorValue.ts`) |
| Emulator integration tests + coverage gate                                 | Passed                                                                      |
| `check:manifest` (now incl. `peerDependenciesMeta`)                        | Passed                                                                      |
| `check:consumer` — compile + runtime load, `firebase-admin@12/13/14`       | Passed for all three                                                        |
| `check:audit` (runtime deps only)                                          | 0 vulnerabilities                                                           |
| `check:docs` + `docs:build`                                                | Passed                                                                      |
| `release:bump:dry`                                                         | Selects `3.0.0`                                                             |

## What still remains for release time (unchanged from round 1)

Curate the generated v3 changelog and close/update issue #17. (The original review's stale
`src/core/ErrorHandler.ts` link was already de-linked to `src/express/index.ts`; `check:docs` passes
across all committed review files, so that task is done.)
