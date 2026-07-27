---
name: implementation-planning
description: Write a detailed, evidence-backed implementation plan for a firestore-orm issue or change, saved to tmp/plans/. Use when asked to plan/scope/spec a change, break down an issue, or hand work off to another agent before any code is written. NOT for writing the code itself, and not for trivial doc-only or config edits.
targets:
  - '*'
---
# Implementation Planning (firestore-orm)

A plan here is a **handoff contract**, not a to-do list. It is written for an implementer who has
none of your investigation in context, and it is graded by one question: _can they execute it
end-to-end, and does everything it asserts hold?_

Read [`CLAUDE.md`](../../../CLAUDE.md) "Working mode" first — the exhaustive standard applies to the
plan itself. The plan is exhaustive; the **change it prescribes is minimal**. When you find a second
defect while investigating, defer it, pin today's behavior with a test, and open a follow-up issue —
do not fold it in.

## Where it goes

| Artifact             | Path                                         | Notes                                                         |
| -------------------- | -------------------------------------------- | ------------------------------------------------------------- |
| The plan             | `tmp/plans/issue-NN-<kebab-slug>.md`         | `tmp/` is gitignored ([`.gitignore:52`](../../../.gitignore)) |
| Executable evidence  | `tmp/probes/issue-NN/`                       | Preserved, re-runnable; the review re-runs them               |
| Implementer's return | `tmp/notes/issue-NN-implementation-notes.md` | Deviations, unverified items, self-review — you specify it    |

Skeleton to copy: [`plan-template.md`](plan-template.md).

**Exemplars, best first** — read at least one end-to-end before writing:
`tmp/plans/issue-54-distributive-omit-id.md` (type-contract sweep, 707 lines),
`tmp/plans/issue-35-get-many.md` (new API surface, 723), `issue-34-generic-multi-aggregation.md`
(620), `issue-33-conditional-writes.md` (525). That 500–750 range is the observed size for a real
v3.x issue — a signal, not a target.

## Evidence discipline (the part that makes it a plan and not a guess)

1. **Every factual claim is executed, not remembered.** Emulator probe, TypeScript compiler API
   (`typeToString`) for type claims, `git log`, or reading the file. Cite `file:line`.
2. **Never trust the issue body.** Issue #54's "Affected sites" list was filed one minute before a
   PR merged: _every line number in it was wrong_, one whole file was missing, and one required site
   was unlisted. Re-enumerate from the current tree and say in §2 where the issue is stale.
3. **State the baseline.** `git log -1 --oneline` — the plan is only valid against that sha; say so
   in the header.
4. **Prototype it.** The strongest plans here carried a gate-green patch
   (`tmp/probes/issue-NN/prototype-verified.patch`) so §6's code blocks are copy-verbatim rather
   than sketches. If you prototype, mark it (`PROTOTYPE (#NN)`) and require the implementer to
   replace every marker with real JSDoc.
5. **Give every fact an id** (`P1`, `N1`, `R11`, `V1`) and cite those ids from the traps, the tests,
   and the definition of done. Traceability is what stops a partial sweep.
6. **Separate "verified" from "could not verify."** §5 exists so the implementer does not inherit
   your overclaim. Example: `check:consumer` defaults to the dev `firebase-admin`, so one local run
   covers **one** peer major; CI fans out over `^12` / `^13` / `^14` plus a pinned-firestore `^12`
   leg via `FIRESTORE_ORM_ADMIN_VERSION` / `FIRESTORE_ORM_FIRESTORE_VERSION`. Never claim the legs
   you did not run.

## Section contract

Number sections `§0`…`§11` and cross-reference by number.

| §   | Section                   | Must contain                                                                                                                                                                             |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —   | Header                    | Implementer · reviewer · baseline `main` @ `<sha>` (+ subject) · branch to cut · issue URL **and labels** · verbatim acceptance criteria if the issue states any                         |
| 0   | How to use this plan      | Read order, what is copy-verbatim, how to re-run probes, where to leave notes                                                                                                            |
| 1   | Owner-approved decisions  | Table: `D1…Dn` · the fork · the decision · **the rejected alternative and why**. Settled — say "do not re-litigate"                                                                      |
| 2   | Scope / scope correction  | In scope, explicitly **out** of scope, and where the issue's own framing is stale or incomplete                                                                                          |
| 3   | Verified facts            | One subsection per probe, tables of ids → expression → observed result. Includes the **authoritative site enumeration** with current line numbers, and a "deliberately NOT changed" list |
| 4   | Traps                     | `T1…Tn` ordered by _how badly a reasonable implementer gets it wrong_. Each names the evidence id proving it, and the silent-failure mode                                                |
| 5   | Could not verify / bounds | Honest limits. Anything carried over from a prior issue and deliberately still deferred                                                                                                  |
| 6   | API specification         | Copy-verbatim code blocks, per file, with the JSDoc each new symbol owes. End with a size estimate (files / ±lines)                                                                      |
| 7   | Implementation sequence   | Ordered steps where order matters (and _why_ it matters), then **Anti-instructions** — an explicit "do NOT" list                                                                         |
| 8   | Test specification        | Per suite, per id, what each asserts and which trap it guards                                                                                                                            |
| 9   | Docs and ADR bookkeeping  | Every edit, by file and line. See the map below — this is where partial sweeps happen                                                                                                    |
| 10  | Gate and commit           | The full command, expected baseline test counts, the Conventional Commits subject, and a breaking-or-not ruling with rationale                                                           |
| 11  | Definition of done        | Checklist mapping 1:1 onto §§1–10, including "nothing in the §7 anti-instruction list violated"                                                                                          |
| —   | Appendix (optional)       | Probe inventory: file → what it proves                                                                                                                                                   |

### Traps are the highest-value section

A trap is a failure a competent implementer will hit, usually one that **fails silently**. Write the
mechanism, not the warning:

> **T2 — Widening a `keyof` constraint without fixing the return type degrades silently (N1).**
> Widen only the constraint and there is _no compile error_ — `T['a']` resolves to `unknown`, so the
> method returns `unknown[]`. Constraint, return type, and body cast must move together. Test U-3
> asserts `string[]`, not just that the call compiles.

### Anti-instructions

End §7 with the do-nots, each with its reason: sites that look in scope but are not, a
correct-for-a-different-issue pattern that is wrong here, a "simplification" that breaks an
invariant, an unverified claim not to repeat. `Do not commit unless asked` belongs here.

## Docs and ADR bookkeeping map

Enumerate these **by file and line** in §9. Silent omissions here are the repo's main defect mode.

| Trigger                                            | Required edits                                                                                                                                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any contract-level change                          | New ADR from [`docs/adr/0000-template.md`](../../../docs/adr/0000-template.md) via the `adr` skill; add its row to [`docs/adr/README.md`](../../../docs/adr/README.md). Enumerate the ADR's required content as a numbered list |
| Issue is in ADR-0017's `#35–#41` parity/`v3.x` set | `> Amendment (3.0.0, issue #NN)` blockquote in [`0017`](../../../docs/adr/0017-v3-core-operations-scope.md) + its References bullet. Amendment blockquotes are **historical snapshots — never rewrite earlier ones**            |
| Same                                               | **Living-index footers** in every shipped feature ADR (0023, 0024, 0025, 0026, 0027, …): decrement `(#N–#41)` and add the new ADR to "have since shipped". See `docs/adr/README.md` Conventions                                 |
| Issue is a `bug`, not a deferral                   | **None of the above.** Say so explicitly — copying the deferral pattern is a real failure mode (see #54 §9.1)                                                                                                                   |
| A deferred capability ships                        | Move its row `reference/scope-and-capabilities.md` "Deferred to v3.x" → "Supported (first-class)" with a real Notes cell                                                                                                        |
| An earlier ADR's decision is refined               | Add an `> Amendment` block in that ADR's voice; do **not** edit the original claim                                                                                                                                              |
| Public API change                                  | Starlight pages (below); `docs-api-sync` rule; `src/index.ts` export + `src/tests/unit/packageExports.unit.test.ts`                                                                                                             |
| New error class                                    | `src/core/Errors.ts`, `src/core/ErrorParser.ts`, `src/index.ts`, **and** the status mapping + JSDoc in [`src/express/index.ts`](../../../src/express/index.ts)                                                                  |
| Install / pitch / quick-start / peer-dep change    | Both READMEs via the `readme-sync` skill. Otherwise **grep both, then declare them unaffected in the plan** — do not leave it implicit                                                                                          |

**Starlight surface** (`website/src/content/docs/`) — name the exact pages and lines: `reference/` —
`repository.md`, `query-builder.md`, `types.md`, `errors.md`, `helpers.md`, `troubleshooting.md`,
`scope-and-capabilities.md`; `guides/concepts/`, `guides/working-with-data/`, `guides/designing/`,
`guides/integrations/`, `guides/migration-v2-to-v3.md`. Do not touch the frozen `docs/2.0/` archive.

> **`website/**/*.md` is prettier-exempt** ([`.prettierignore`](../../../.prettierignore)) — match
> surrounding style by hand. A `:::note` / `:::caution` aside whose closing fence lands on a content
> line renders as literal `:::` on the published page, and **neither `check:docs` nor `docs:build`
> catches it**. Instruct the implementer to grep the built HTML. This shipped live twice (#33, #34).

## Tests: specify them, and specify how they are proven

Every test must **fail on the unfixed baseline** — a test that passes both ways guards nothing.
Require the implementer to mutation-check the load-bearing ones (`git stash` is enough) and say so.

| Suite       | Location                                         | Gate                             |
| ----------- | ------------------------------------------------ | -------------------------------- |
| Type        | `src/tests/types/*.type-test.ts`                 | `test:types`                     |
| Unit        | `src/tests/unit/**/*.unit.test.ts`               | `test:coverage:gate:unit`        |
| Integration | `src/tests/integration/**/*.integration.test.ts` | `test:coverage:gate:integration` |

Gate ownership by changed path: `src/utils/**`, `Errors`, `ErrorParser`, `ErrorHandler`,
`Validation`, `src/index.ts` → **unit**. `FirestoreRepository.ts`, `QueryBuilder.ts`,
`CollectionGroup.ts`, `src/vector/**`, emulator validation paths → **integration**. Name the gate
for each changed path in §8, and flag paths in **neither** (e.g. `src/core/DocumentId.ts`).
Type-only modules are excluded from coverage entirely (`jest.config.base.js` `collectCoverageFrom`).
See the `unit-testing` / `integration-testing` skills for thresholds and harnesses.

## §10 — gate and commit

Give the full command; require real output and honest failure reporting.

```bash
npm run test:types && npm run lint && npm run check:format && npm run test:unit && npm run test:integration:emulator && npm run test:unit:coverage && npm run test:coverage:gate:unit && npm run test:integration:coverage && npm run test:coverage:gate:integration && npm run build && npm run check:package && npm run check:consumer && npm run check:docs && npm run docs:build
```

Fourteen legs. `test:unit` / `test:integration:emulator` run first for a fast signal; the
`:coverage` variants re-run them to produce the LCOV the gates read. `npm run release:verify` is the
release-time superset (adds `check:manifest`, `check:audit`).

Also state: the **baseline suite counts** — measure them yourself on your own baseline with a clean
tree, and say which must go up and which must stay unchanged (for reference, `3b00d7b` was
`28 suites / 346 tests` unit and `28 suites / 412 tests` integration). Then: re-runs of your own
probes; the Conventional Commits subject (commitlint runs on `commit-msg`); and a **breaking-or-not
ruling with rationale**, since v3.x work folds into the unreleased `3.0.0`.

## Before you hand it off

- Re-read §3 and ask of each row: _did I actually run this?_ Delete or move to §5 anything you
  didn't.
- Re-check every `file:line` against the current tree — they rot fast on this repo.
- Walk §11 against §§1–10: every prescribed change has a checklist row, and every row traces to a
  section.
- Ask the adversarial question: what surface did I miss? The usual answers are the vector wrapper
  (`src/vector/**`), `CollectionGroup.ts`, the read-only transaction surface, the express adapter,
  the `.d.ts` shape, and the living-index footers.
- Surface open decisions to the owner **before** writing §1 — §1 is for settled calls, so an
  unresolved fork belongs in a question, not in the plan.
