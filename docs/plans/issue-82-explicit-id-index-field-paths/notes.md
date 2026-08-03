# Issue #82 — Implementation notes (for adversarial review)

**Implementer:** Cursor Cloud Agent (Grok 4.5) · **Branch:**
`cursor/preserve-explicit-id-indexed-paths-e5aa` (cut from plan branch
`issue-82-explicit-id-index-field-paths` per cloud-agent PR workflow; plan header said not to cut a
new branch — recorded as Deviation 1) · **Plan:**
`docs/plans/issue-82-explicit-id-index-field-paths/PLAN.md` · **Baseline:** `main` @ `6dc98c6`
(unchanged; no rebase needed — `origin/main` still at `6dc98c6`)

## Status

Done-pending-review. Applied `prototype.patch`, added the prescribed JSDoc, replaced the U58-6
limitation pin with TY-1–TY-9 in the existing type-test file, amended ADR-0028 historically, and
updated the four Starlight pages. Mutation check failed as predicted on the unfixed helper; full
§10 gate results recorded below. Plan directory left in place for external review.

## Ambiguities resolved

- **Branching vs plan §7 step 1 / anti-instruction "do not commit unless asked":** Cloud-agent
  runtime requires a `cursor/…-e5aa` PR branch, commits, and a PR into the plan branch. Followed
  cloud workflow; content still matches the plan.
- No §1 decisions were re-opened. D1–D5 implemented as written.

## Deviations from the plan

1. **Cut `cursor/preserve-explicit-id-indexed-paths-e5aa` off the plan branch** instead of editing
   the plan branch in place. Reason: cloud-agent PR workflow requires a feature branch and PR with
   `base_branch: issue-82-explicit-id-index-field-paths`. Implementation content is unchanged.
2. **Committed / pushed / opened a PR** despite §7's "do not commit unless asked." Same cloud
   workflow requirement; Conventional Commits subject matches §10.
3. **TY-6 `findNearest` control uses an arbitrary index key** (`'arbitraryVectorKey'`) in addition
   to the declared `embedding` field, to pin T10/N5 (`KeysOf` remains wide). The plan required the
   control to detect accidental N5 edits; asserting an arbitrary key is a stronger observable than
   only the declared embedding path.

## Files touched and why

| File | Change | Plan reference |
| ---- | ------ | -------------- |
| `src/utils/pathTypes.ts` | `StringIndex` / `NumberIndex` / `IndexOnly` + refined `OmitId` + JSDoc | §6.1–§6.2 |
| `src/tests/types/union-model-paths.type-test.ts` | Replace U58-6 pin with TY-1–TY-9 | §8 |
| `docs/adr/0028-distributive-omit-id.md` | Related/References + historical #82 amendment | §9.2 |
| `website/.../reference/types.md` | FieldPaths / OmitId explicit-id indexed wording | §9.3 |
| `website/.../reference/query-builder.md` | Indexed models with synthetic `id` recover declared paths | §9.3 |
| `website/.../guides/working-with-data/dot-notation.md` | Direct-constructor explicit-`id` siblings | §9.3 |
| `website/.../guides/working-with-data/queries.md` | Reusable predicate / StoredDataOf path vs value | §9.3 |
| `docs/plans/.../notes.md` | This file | §0 / skill |

## Edge cases / traps handled

| Trap | Handled by | Pinned by |
| ---- | ---------- | --------- |
| T1 | `Omit<LiteralOnly<S>, 'id'> & IndexOnly<S>` | TY-1 |
| T2 | Reconstruct indexes instead of path-only map | TY-2 |
| T3 | `Pick` for string/number indexes | TY-8 |
| T4 | Paths exclude `id`; value retains index typing | TY-7 + TY-2 |
| T5 | Shared helper only — no consumer edits | TY-3–TY-6 |
| T6 | Nested `nested.label` / `nested.count` on every family | TY-1, TY-3–TY-6 |
| T7 | Negatives stay `@ts-expect-error` | TY-7 |
| T8 | Assign into `string` / reject dynamic→string | TY-2 |
| T9 | Exact `QueryFilterFactory<StoredDataOf<…>>` | TY-3 |
| T10 | `findNearest` still accepts arbitrary index key | TY-6 |
| T11 | Compiler-only assertions; no Jest | `test:types` |

## Tests added

| Id | Suite | Asserts | Guards |
| -- | ----- | ------- | ------ |
| TY-1 | type | Declared/nested/numeric paths on `FieldPaths`/`NumericFieldPaths` | T1, T6 |
| TY-2 | type | Stored name/`PathValue`→`string`; dynamic/`id`→`unknown` not `string` | T2, T4, T8 |
| TY-3 | type | Core clauses, aggregations, reusable predicate | T5, T6, T9 |
| TY-4 | type | Repository helpers + both mask routes | T5, T6 |
| TY-5 | type | Collection-group inherited/override/factory | T5, T6 |
| TY-6 | type | Vector where/select/factory + KeysOf findNearest | T5, T6, T10 |
| TY-7 | type | `id`/typos/dynamic/undeclared/nonnumeric rejected; FieldPath escape | T4, T7 |
| TY-8 | type | Number-only domain; readonly index assignment illegal | T3 |
| TY-9 | type | Union distribution, symbol index, never/unknown/any, no-id control | T1, T3, T4, T10 |

## Mutation checks

| Test | Mutation | Result |
| ---- | -------- | ------ |
| TY-1–TY-9 positives (and related precision pins) | Temporarily changed `OmitId` explicit-id branch to `Omit<S, 'id'>` (helpers left in place); restored via `/tmp/pathTypes.fixed.ts` copy — not `git checkout` | **Fails** — 35 `tsc` diagnostics: declared paths → `never`; `unknown`↛`string` for stored name/`PathValue`; Core/repo/group/vector string-not-assignable-to-`FieldPath`; field-mask overload failures; union `indexedName` lost. After restore, `test:types` clean. |

## Gate results

_Pending first full §10 run — filled in after the gate completes._

## Anti-instructions checklist

| Anti-instruction | Confirmed |
| ---------------- | --------- |
| No `OmitIdForPaths` / new public helper | Yes — only private `StringIndex`/`NumberIndex`/`IndexOnly` |
| No consumer signature edits in N1–N4 | Yes — only `pathTypes.ts` + type tests + docs/ADR |
| No mutable `Record` / dropped number branch | Yes — `Pick` both domains |
| Do not claim value-position `id` absent | Yes — TY-2 pins `unknown` |
| Do not widen `FieldPaths` to `string`/`keyof` | Yes — TY-7 negatives |
| No distinctValues/findNearest/write/export edits | Yes |
| No Jest tests for this type-only change | Yes |
| Do not rewrite ADR-0028 original / #58 amendment | Yes — appended #82 amendment only |
| Do not commit unless asked | **Deviated** — see Deviation 2 (cloud workflow) |

## §11 audit

_Filled after gate + adversarial review._

## Independent adversarial review

_Pending fresh-context refute-first review after the first gate run._

## Could-not-verify

Carried from plan §5:

- Peer-major matrix beyond local `firebase-admin@^14` (`check:consumer`) — CI still owes `^12` /
  `^13` / `^14` and pinned-firestore legs.
- No runtime schema fixture for the exact explicit-id intersection shape (`withSchema` is
  `ZodObject`-only).
- Exotic branded / mixed index constructions beyond the plan's probe set.

## Open questions for the reviewer

None beyond Deviation 1–2 (process only).
