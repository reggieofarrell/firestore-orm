# Response to the v3 release review

**Response date:** July 19, 2026 **Branch:** `v3-release-hardening` (19 commits; regular-merge, one
PR) **Re:** [`docs/development/v3-release-review.md`](./v3-release-review.md) (review dated July
18, 2026)

Thank you for the review — it was accurate and actionable. We independently re-verified every
finding against the current code (each claim read against source and adversarially cross-checked),
then fixed the confirmed issues and recorded the few we refuted or re-scoped. This document reports
what changed, the decisions we made where the review offered options, and the verification evidence.

> **Round-2 update (2026-07-19):** A follow-up review of this response and the branch found that
> four items marked fixed here were incomplete (F3 output-prototype pollution, F10 vector sentinels,
> F6 projection soundness, F8 zero-match empty-update) and that the CI/F16 and "everything
> satisfied" claims below overstated what was actually gated. All were addressed in a second round;
> some claims in this document are corrected inline. See
> [`v3-release-review-response-round2.md`](./v3-release-review-response-round2.md) for the full
> round-2 disposition. The text below is preserved as the original round-1 response with
> corrections.

**Bottom line (round 1, corrected in round 2):** all 18 findings are addressed at the design level;
four required additional round-2 fixes to be truly complete (see the banner above). The five release
blockers are fixed with regression tests; the high/medium items are fixed or explicitly documented.
The suite grew from 361 to **403 tests** (round 1); all dual coverage gates pass; a packed-consumer
gate now compiles a fresh ESM and CJS consumer (plus the Express subpath) against the tarball; and
the release rehearsal selects `3.0.0`.

---

## Contract decisions we made

Where the review posed a choice, here is what we decided and why:

| Area                          | Decision                                                                                                                         | Rationale                                                                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Create return (F2)**        | Return `{ id }` by default; `{ returnDoc: true }` reads back through the converter. `createInTransaction` returns `{ id }` only. | Mirrors `update`/`upsert`; avoids an implicit read; a transaction cannot read back a just-written doc.                                                 |
| **Sentinel policy (F4)**      | Flip the default to `'strict'`; keep `'permissive'` as an explicit opt-in.                                                       | The permissive escape hatch silently wrote the raw payload, discarding sibling Zod output. Recorded as the v3 addendum to ADR-0002.                    |
| **Empty updates (F8)**        | Reject empty patches with `ValidationError` at all four surfaces.                                                                | Simplest contract; preserves "update throws for a missing document".                                                                                   |
| **Express adapter (F1)**      | Move `errorHandler` to a `firestore-orm/express` subpath with an optional `express` peer (not the minimal local-types fix).      | Keeps the core type graph framework-agnostic and establishes the adapter pattern.                                                                      |
| **Module format (F18)**       | Ship a **dual ESM + CJS** build (add a `require` path); not ESM-only.                                                            | The Firebase Functions / NestJS audience is heavily CommonJS; ESM-only would force `require(esm)`/dynamic import. Additive for existing ESM consumers. |
| **Firebase Admin range (F9)** | Keep `^12                                                                                                                        |                                                                                                                                                        | ^13`and add`^14`; raise Node floor to `>=22`. | Avoids forcing an immediate consumer migration while supporting the current SDK. |
| **Scope**                     | Address all 18 findings before v3 (not just blockers).                                                                           | Per maintainer direction.                                                                                                                              |

---

## Finding-by-finding disposition

Legend: ✅ fixed · 📝 fixed as documentation · 🔎 refuted / re-scoped.

| #   | Finding                                           | Disposition                                                                                                                                                                                                      | Commit                             |
| --- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1   | Express types leak into every consumer            | ✅ subpath + optional peer; root graph express-free                                                                                                                                                              | `feat(express)!`                   |
| 2   | Create returns write model, not read model        | ✅ `{ id }` default + `returnDoc`; bulkCreate leak + id-schema fixed                                                                                                                                             | `feat(repository)!`                |
| 3   | Dot-notation prototype pollution + input mutation | ✅ (expand/merge/validate); 🔎 `convertTimestampsToMillis` refuted                                                                                                                                               | `fix(security)`                    |
| 4   | Permissive sentinel discards Zod output           | ✅ strict is the default                                                                                                                                                                                         | `feat(validation)!`                |
| 5   | Stale package contents + peer metadata            | ✅ exclude tests, drop maps, regenerate lockfile; 🔎 downgraded from "blocker"                                                                                                                                   | `fix(build)`                       |
| 6   | `select()` statically unsound                     | ✅ projection-aware result generic (incl. `offsetPaginate`)                                                                                                                                                      | `feat(query)!`                     |
| 7   | `stream()` buffers the whole query                | ✅ native `Query.stream()`                                                                                                                                                                                       | `fix(query)`                       |
| 8   | Empty updates report success for missing docs     | ✅ reject empty patches everywhere                                                                                                                                                                               | `fix(repository)!`                 |
| 9   | Firebase/Node/TS support floor behind             | ✅ Node 22, Admin 14 peer, TS 5.5, dual build                                                                                                                                                                    | `feat!`                            |
| 10  | Vector accepts non-finite; result typing gaps     | ✅ finiteness + field/dimension validation + distance-field typing; 🔎 High→Medium                                                                                                                               | `fix(vector)`                      |
| 11  | Query hook docs contradict implementation         | 📝 docs corrected (code was right and tested)                                                                                                                                                                    | `docs`                             |
| 12  | Bulk duplicate-ID / >500 atomicity undefined      | ✅ reject duplicate ids; documented non-atomic chunking                                                                                                                                                          | `fix(repository)`                  |
| 13  | Pagination inputs + cursor scope                  | ✅ positive-int validation; cursor bound to collection                                                                                                                                                           | `fix(query)`                       |
| 14  | Aggregation / distinct / findByField typing       | ✅ numeric paths for sum/avg, dotted findByField; distinct/where documented                                                                                                                                      | `feat(query)!`                     |
| 15  | Error normalization consistency                   | ✅ `unknown` input, numeric+string codes, 503 index mapping                                                                                                                                                      | `fix(errors)`                      |
| 16  | CI doesn't exercise the installed artifact        | ⚠️ round 1 added the checks but neither workflow invoked `release:verify`; **round 2** wires it into publish, adds an Admin 12/13/14 matrix, a runtime load smoke test, an audit policy, and a website-build job | `ci`                               |
| 17  | Changelog / ADR statuses                          | ✅ ADR statuses + 4 new v3 ADRs; changelog/issue #17 remain release-time                                                                                                                                         | `docs(adr)`                        |
| 18  | Module format & build portability                 | ✅ dual build, rimraf, removed orphan config, keyword typos                                                                                                                                                      | `feat(package)` / `chore(package)` |

---

## Refutations and re-scoping

A few claims did not hold as stated, or we adjusted their severity:

- **F3 — `convertTimestampsToMillis` (corrected in round 2).** This refutation was too strong. The
  round-2 review is right: while the helper does not pollute the global `Object.prototype`, it did
  rebuild plain objects by assigning arbitrary keys, so an own `__proto__` key could control the
  _output object's_ prototype — enough to turn an absent own field into a truthy inherited one. As a
  public export documented for reuse in shared code, it should not do that. **We fixed it** (and the
  same pattern in `flattenToDotNotation`) with a shared safe-copy primitive that writes
  caller-controlled keys as own data properties. The narrower point stands — the global prototype
  was never affected, unlike the original dot-notation bug — but the fix was warranted. See the
  [round-2 response](./v3-release-review-response-round2.md).
- **F5 — real, but not a true release blocker.** All four sub-claims were true and fixed, but none
  breaks a consumer's build or runtime the way F1's `.d.ts` leak does (leaked fixtures are
  unreachable from the exports; declaration maps only affect editor go-to-definition; the lockfile
  drift never ships). We fixed everything but note the severity was closer to "should-fix" than
  "blocker".
- **F10 — closer to Medium than High (and the round-1 fix was incomplete).** Firestore rejects
  non-finite vectors downstream anyway; the concrete harm was an error message that promised
  "finite" while `Number.isNaN` let infinities through. Round 1 fixed the plain-array path but — as
  the round-2 review found — left the `VectorValue` _sentinel_ recognition paths using
  `!Number.isNaN`, so `FieldValue.vector([Infinity])` was still accepted. **Round 2 fixes this**
  with a shared finite-value recognizer used by both the vector extension and the core validator.
  The field-name / dimension validation and distance-field result typing from round 1 stand. See the
  [round-2 response](./v3-release-review-response-round2.md).
- **F11 — the code is correct; the docs were wrong.** `query().update()`/`.delete()` do run the bulk
  hooks, and `repository-update-contracts.integration.test.ts` already asserts it. We did **not**
  remove the hooks (that would be a breaking regression); we corrected the six documentation pages
  that claimed otherwise.

We also want to flag two mild overstatements in the review's framing (both still worth the fixes):
the F1 leak breaks compilation only under `skipLibCheck:false` (many consumers set it `true`, and it
predates v3), and ADR-0002's reservation of a future major for strict-by-default was directional
rather than an explicit promise — the change is sound regardless.

---

## Notable implementation decisions

- **Projection typing (F6)** uses a conservative `Partial<T> & { id }` after `select(...)` rather
  than precise `Pick`-from-literal-paths inference. It closes the soundness hole (projected-away
  fields become compile errors) without heavy type machinery; precise inference can follow later. We
  also included `offsetPaginate()`, which the review's list omitted but was equally unsound.
- **Dual build (F18) uses two `tsc` passes**, not a bundler. ESM stays at `dist/` (zero churn for
  existing consumers); a second pass emits CommonJS to `dist/cjs/` with a `{ "type": "commonjs" }`
  marker. This adds only `rimraf` as a devDependency — no new build tool.
- **The packed-consumer gate (F16)** compiles with the realistic `skipLibCheck: true` (the ecosystem
  default; a strict pass drowns in firebase-admin's transitive `.d.ts`). The precise "no express in
  the root declaration graph" guarantee is enforced separately and network-free by a grep-style scan
  in `check-package-contents.mjs`, so F1 can never silently regress.
- **Firebase Admin 14 + firebase-tools 15** were adopted in development, not just added to the peer
  range — the full emulator integration suite (209 tests) passes against the current SDK and
  emulator, and the upgrade cleared the 2 high-severity `npm audit` advisories from the old CLI
  tree. Remaining advisories are dev-toolchain-only (the shipped package declares no runtime
  dependencies).

---

## Verification

| Check                                                         | Result                         |
| ------------------------------------------------------------- | ------------------------------ |
| Lint                                                          | Passed                         |
| Type tests (`test:types`)                                     | Passed                         |
| Build (dual ESM+CJS)                                          | Passed                         |
| Unit tests + coverage gate                                    | 194 tests; all path gates pass |
| Emulator integration tests + coverage gate                    | 209 tests; all path gates pass |
| `check:manifest` (manifest ↔ lockfile)                        | Passed                         |
| `check:package` (tarball allowlist + express-free root graph) | 66 files; passed               |
| `check:consumer` (ESM + CJS + `/express` compile vs tarball)  | Passed                         |
| Documentation link check                                      | Passed (see note below)        |
| Website build                                                 | 48 pages built                 |
| Release rehearsal (`release:bump:dry`)                        | Selects `3.0.0`                |

The tarball no longer contains `dist/tests/**` or declaration maps; a fresh consumer type-checks the
root and `/vector` without `express` installed, and the `/express` subpath compiles once `express`
is added.

---

## Remaining release-time items (not code changes)

Per the review's F17 and the final release gate, these are deliberately left for release time:

1. **Curate the generated v3 changelog** — `CHANGELOG.md` is generated from Conventional Commits
   (not hand-edited); the breaking commits are marked with `!` / `BREAKING CHANGE:`, so
   `commit-and-tag-version` already selects `3.0.0`. Lead with breaking changes and link the
   migration guide; drop co-author/squash noise from the generated GitHub release notes.
2. **Close or update issue #17** with the final v2 tag and the stable archived-v2-docs URL.
3. **The `docs/development/v3-release-review.md` artifact is untracked** and references the old
   `src/core/ErrorHandler.ts` path (now `src/express/index.ts`). If you commit the review into the
   repo, update that link or the doc-link check will flag it. This response document links to it by
   relative path but does not depend on that link resolving.

Everything else in the review's "Final release gate" is satisfied on this branch **for the original
18 findings** — with the round-2 corrections noted in the banner at the top. The review's expanded
final gate also lists server-side parity items (composite filters, transaction options, conditional
writes); those are **deliberately deferred** and tracked, not claimed complete — see the round-2
response and ADR-0017 for the explicit v3 = "Firestore Core operations" scope decision.
