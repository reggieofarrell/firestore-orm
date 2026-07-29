---
name: implementation-planning
description: Write a detailed, evidence-backed implementation plan into docs/plans/ for an implementer who will not share your context — a teammate, a later session, or a Cursor Cloud Agent on a fresh clone. Use when handing off a firestore-orm issue, or via the write-plan command. NOT for planning a change you will implement yourself in the same session (plan mode is enough). NOT for executing an existing plan — see the plan-execution skill. NOT for trivial doc-only or config edits.
---
# Implementation Planning (firestore-orm)

A plan here is a **handoff contract**, not a to-do list. It is written for an implementer who has
none of your investigation in context, and it is graded by one question: _can they execute it
end-to-end, and does everything it asserts hold?_

Read [`AGENTS.md`](../../../AGENTS.md) "Working mode" first — the exhaustive standard applies to the
plan itself. The plan is exhaustive; the **change it prescribes is minimal**. When you find a second
defect while investigating, defer it, pin today's behavior with a test, and open a follow-up issue —
do not fold it in.

## Not for in-session planning

Use this only when the plan must **cross a context boundary** — a different agent, a cloud agent on a
fresh clone, or a later session. If you are planning a change you will implement yourself in this same
session, with the user reviewing the plan live, skip this skill: plan mode is enough. The committed
directory, the preserved probes and `notes.md` exist to survive a handoff, and without one they are
ceremony.

Three things still apply to in-session work, because they are not handoff-specific: the **docs and ADR
bookkeeping map** below (this repo's main defect mode), the **§10 gate**, and the rule that **every new
test must fail on the unfixed baseline**.

The explicit entry point is the `write-plan` command; being invoked through it settles the boundary
question. Absent that, prefer the lighter path.

## Where it goes

One **committed** directory per issue, on the feature branch:

```
docs/plans/issue-NN-<kebab-slug>/
  PLAN.md          the plan (§0–§12)
  probes/          investigation scripts, re-runnable
  prototype.patch  optional: the reverted prototype diff, so §6 can be copy-verbatim
  notes.md         the implementer writes this back (incl. self-review dispositions)
  review.md        optional inbound: **external/third-party** reviewer report only, written via
                   the `implementation-review` skill / `write-review` command — implementers must
                   not write this file; their self-review stays in chat + notes
```

Committed, because an implementer may be a **Cursor Cloud Agent** that only ever sees committed
content — and because `notes.md` on the branch makes the handoff work in both directions.

**You create and push the branch with the plan on it before the implementer starts.** So the plan is
already there when they arrive: their first step is to check the branch out and rebase it if `main`
moved, never to cut a new one. Write §7 step 1 that way.

**Removed in a final cleanup commit, after review** — put it in §11. Ordering matters: while the
directory is present the reviewer can read `notes.md` and the plan in the PR's Files-changed view;
once it is deleted the whole directory nets to zero there and is only visible per-commit. So review
first, then delete, then merge. A plan is pinned to a baseline and its site enumeration is wrong the
moment the PR lands, so keeping it would leave a stale document that reads as authoritative. The
durable record is the ADR, and §1 is its raw material. Conventions and tooling carve-outs:
[`docs/plans/README.md`](../../../docs/plans/README.md).

Skeleton to copy: [`plan-template.md`](plan-template.md). Expect 500–750 lines for a real v3.x issue;
that is a calibration, not a target.

## Evidence discipline (the part that makes it a plan and not a guess)

1. **Every factual claim is executed, not remembered.** Emulator probe, TypeScript compiler API
   (`typeToString`) for type claims, `git log`, or reading the file. Cite `file:line`.
2. **Never trust the issue body.** Issue #54's "Affected sites" list was filed one minute before a
   PR merged: _every line number in it was wrong_, one whole file was missing, and one required site
   was unlisted. Re-enumerate from the current tree and say in §2 where the issue is stale.
3. **State the baseline.** `git log -1 --oneline` — the plan is only valid against that sha; say so
   in the header.
4. **Probe, and prototype only when it pays** — see below. Probes are always worth it; a full
   prototype is not.
5. **Give every fact an id** (`P1`, `N1`, `R11`, `V1`) and cite those ids from the traps, the tests,
   and the definition of done. Traceability is what stops a partial sweep.
6. **Separate "verified" from "could not verify."** §5 exists so the implementer does not inherit
   your overclaim. Example: `check:consumer` defaults to the dev `firebase-admin`, so one local run
   covers **one** peer major; CI fans out over `^12` / `^13` / `^14` plus a pinned-firestore `^12`
   leg via `FIRESTORE_ORM_ADMIN_VERSION` / `FIRESTORE_ORM_FIRESTORE_VERSION`. Never claim the legs
   you did not run.
7. **Verify the prescription, not just the findings.** Rules 1–6 govern §3 — the tree as it is.
   §6/§8/§9/§10 are what the implementer will _type_, and they need executing too. This is where
   plans fail even when §3 is perfect (#37: every §3 row exact, §6 did not compile). Four
   obligations, all cheap:
   - **Every code block in §6 goes through `tsc` before handoff.** Paste it into a scratch file
     under `src/`, run `npm run test:types`, delete the file. This is **not** a prototype — no real
     edit, no gate, no revert — and unlike a prototype it is **never optional on a handoff**. Record
     the result in §12. (If a gated prototype produced the code, its own `test:types` leg **is** this
     check — record which legs ran in §12 instead of staging the same code twice.)
   - **"Exported in some `.d.ts`" ≠ "importable from the module specifier in §6."** The §3 row must
     cite the exact `from '…'` string §6 will use and show that import compiling — or failing, when
     the failure _is_ the finding. A probe aimed one artifact to the left of the claim reads as
     verified and is not. (#37: `@google-cloud/firestore`'s d.ts exports `ExplainMetrics`, but
     `firebase-admin/firestore` re-exports an **allowlist** that omits it — the plan probed the
     first and prescribed the second. `firebase-admin` omits `VectorQuery` from that same allowlist,
     which is why `src/vector/` already carries a hand-written local type: assume nothing about what
     the admin entry point re-exports.)
   - **Every shell command written into the plan has been run, with its output recorded.** Greps,
     gate legs, probe invocations. State the expected result too — some checks pass by matching
     _nothing_ (a post-implementation `grep` for the old range must come back empty), so "it
     returned no rows" is not by itself a pass or a failure.
   - **No unresolved conditionals.** A plan may not say "assert this _if_ the suite checks type
     exports, otherwise rely on `test:types`" when one file read settles it. Conditionals are how
     work gets deferred to the implementer while the plan still reads as thorough; resolve them, and
     state the resolution.

## Probes vs. prototypes — spend tokens where the unknown is

Two different tools. Confusing them is how planning gets expensive for no gain.

A **probe** is a small standalone script that answers _one_ question in isolation: what does `tsc`
resolve this type to (compiler API + `typeToString`, not an error message), what does the Admin SDK
actually do with this input against the emulator, does this call throw on empty. Cheap, and it never
touches `src/`. **Always probe** — a plan whose §3 is reasoning rather than output is a guess.

Sort each probe by whether it _asserts_ or _asks_, because they have different destinations:

- **Asserts** what the fix must make true (e.g. "27 diagnostics on the unfixed baseline, 0 with the
  fix"). **Promote it to a committed test** — `src/tests/types/*.type-test.ts`, or the unit or
  integration suite — and reference it from §8. It becomes a regression guard CI runs, instead of a
  script that gets deleted. Do this at plan time; do not leave it for §8 to re-derive.
- **Asks** what the SDK, emulator or compiler actually does. No assertion to keep: it lives in
  `probes/`, backs a §3 row, and dies with the plan.

A **prototype** is the real change applied to real source, judged by the real gate, then reverted
(`git checkout -- src/`). It means writing the change twice. Only pay for it when reading cannot
answer the question:

| Prototype when                                                                                                  | Skip it when                                                                                              |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **The blast radius is unenumerable by reading** — a shared generic, an identity type, a hook payload, a widened constraint. `tsc` finds the downstream sites; you will not find them all by grep | The change is local to one method or file and every call site is greppable                                  |
| **Existing tests or gates may break in ways you cannot predict** and the plan must warn about it                 | A standalone probe already answers the behavioral question — that is a probe, not a prototype               |
| **Someone else implements it**, and a wrong §6 costs them a full 14-leg cycle                                    | You are implementing it yourself in the next turn                                                          |
| **The correct spelling of a type is genuinely uncertain** and two candidates need to be compiled against each other | The decision is already settled and you would only be building confidence                                   |

**Scope the prototype to the unknown, not the change.** You do not need a gate-green implementation
to learn a blast radius — you need the type or signature edit plus `npm run test:types`. Tests, JSDoc
and docs are never part of a prototype.

**Tripwire — if you have written a test or a JSDoc block, you have stopped prototyping and started
implementing.** Notice it out loud when it happens. It is not automatically the wrong call: #38's
36 %-inversion commit-order race was only findable by writing real tests and running the full suite
repeatedly, and it overturned a decision the owner had already approved. But it means the collapse
condition below now governs, and you must resolve it *before* writing more plan.

**Collapse condition — a gate-green prototype means the plan is no longer the deliverable.** A
verified implementation and a plan for producing one are alternatives, not a sequence. Reverting green
code so an implementer can re-derive it from prose describing that same code throws away the gate run
and turns a finished change into a transcription exercise. Being invoked through `write-plan` settles
that a **handoff** was wanted; it does not settle **which artifact** the handoff should carry. So stop
and put it to the owner in one message: _"this is built and passing N legs — do you want the PR, or
still the plan?"_ They may genuinely still want the plan: a cloud agent to do the §9 docs sweep, a
teammate who needs the reasoning, a review boundary they want preserved. Asking costs one message.
Not asking cost #38 a build-then-revert-then-transcribe cycle.

When the owner does want a plan on top of a gated prototype, say in §3 exactly which legs you ran and
save the reverted diff as `prototype.patch`. If any source in it is scaffolding rather than the real
thing, mark it `PROTOTYPE (#NN)` and require the implementer to replace every marker with real JSDoc.

If you skip the prototype, say so in §5 and name what is consequently unverified. An unprototyped
plan is fine; an unprototyped plan that reads as if it were verified is not.

> **Skipping the prototype never licenses skipping the §6 compile** (evidence rule 7). This table is
> a judgement call about _full prototypes_ only, and rows fire on both sides of it routinely — #37
> matched "someone else implements it" **and** "local to one method, every call site greppable," took
> the skip, and shipped two compile-blocking defects into §6. The type-spell compile is not on this
> table: it
> is unconditional, it costs about two minutes, and it is what the two-column judgement is not
> allowed to reach.

## Handing off to a Cursor Cloud Agent

A cloud agent clones the branch onto a fresh VM. It gets `AGENTS.md`, `.cursor/rules/`,
`.cursor/skills/` and the plan directory — and **nothing** from your working tree. Three consequences
for how you write:

1. **§6 must be executable from its own text** — but _executable_ is not _transcribed_. Inline the
   code when there is no prototype patch. When `prototype.patch` **is** committed beside the plan it
   is already self-contained branch content, so §6 should carry the **contract** — signatures, the new
   types, the invariants that must not be refactored away, and a pointer to the patch — rather than a
   second copy of the method bodies. Two copies of the same code in one directory is a maintenance
   hazard with no stated winner, and it is how #38's §6 reached ~400 duplicated lines. Either way,
   never point at anything outside the plan directory.
2. **Every command in §0 and §10 must run on a clean clone.** Reference probes by their in-repo path
   (`docs/plans/issue-NN-<slug>/probes/…`), and remember the environment: Node 24 per `.nvmrc` (the
   hooks hard-fail otherwise) and a JDK for `test:integration:emulator`. If a leg cannot run remotely,
   say which and move it to §5 rather than letting the agent discover it.
3. **`notes.md` is the return channel.** Spell out in §0 that the implementer commits it on the
   branch — that is how you get deviations and the adversarial self-review back.

Planning itself is a poor fit for a cloud agent: §1 exists because those forks were put to the owner
with evidence and answered, and a fire-and-forget run cannot wait for that. Plan where you have the
emulator and a tree to prototype in; hand the implementation off.

### Queued plans — several issues planned before any is implemented

**Default: don't.** Plan **just-in-time**, at the merge boundary you already stop at. Batching moves
planning away from the baseline it describes, and it buys less than it looks like it does: the next
agent has to rebase onto the previous PR's merged work, and merging needs a human, so queued agents
cannot actually run unattended. That stop is also the cheapest moment to plan — `main` is current,
line numbers are real, and a prototype still applies. The per-issue investigation dominates the cost
and does not amortize across plans either way.

Batch only when **nobody will be at the keyboard between merges**, and only for issues whose primary
surfaces do not overlap. Two plans rewriting one file, each blind to the other, is the worst case.

When you do batch, queued agents may work concurrently but their **merges serialize**, because the
ADR living index is a lock: every shipped v3.x issue decrements `(#N–#41)` in _every_ feature ADR
carrying that footer (the set grows by one each time an issue ships), claims the next ADR number, and
appends a row to `docs/adr/README.md`. Two agents doing that from hardcoded values conflict
_semantically_ — whoever merges second writes a range that is already wrong.

Most of a plan keeps: §1 decisions, §2 scope, §4 traps, §5 bounds, §6 API spec, §8 test spec, and
§9's _list_ of what to update. Five things go stale the instant a predecessor merges — **do not state
them, instruct the agent to read them**:

| Perishable                   | Write this instead                                                     |
| ---------------------------- | ---------------------------------------------------------------------- |
| §3 line numbers, baseline sha | §7 step 1: "rebase onto `main`, then re-run the §3 enumeration and fix any drifted line numbers before editing" |
| The ADR number               | "claim the next free number in `docs/adr/`" — never hardcode `NNNN`     |
| The `(#N–#41)` range         | "read the current range out of `docs/adr/0023`'s footer and decrement it" |
| The list of footer files     | "every feature ADR carrying a living-index footer" — grep, don't enumerate |
| §10 baseline suite counts    | "measure on your rebased baseline; both counts must go up"              |

Written that way a queued plan is order-independent: you can reorder or drop one without rewriting
the others.

## Section contract

Number sections `§0`…`§12` and cross-reference by number.

| §   | Section                   | Must contain                                                                                                                                                                             |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —   | Header                    | Implementer · reviewer · baseline `main` @ `<sha>` (+ subject) · the branch (already pushed with this plan) · issue URL **and labels** · verbatim acceptance criteria if the issue states any |
| 0   | How to use this plan      | Read order, what is copy-verbatim, how to re-run probes, where to leave notes                                                                                                            |
| 1   | Owner-approved decisions  | Table: `D1…Dn` · the fork · the decision · **the rejected alternative and why**. Settled — say "do not re-litigate"                                                                      |
| 2   | Scope / scope correction  | In scope, explicitly **out** of scope, and where the issue's own framing is stale or incomplete                                                                                          |
| 3   | Verified facts            | One subsection per probe, tables of ids → expression → observed result. Includes the **authoritative site enumeration** with current line numbers, and a "deliberately NOT changed" list where **every entry cites the fact id proving it is safe to leave alone** — an unproven entry is a decision wearing a fact's clothes, and these are the silent-omission class |
| 4   | Traps                     | `T1…Tn` ordered by _how badly a reasonable implementer gets it wrong_. Each names the evidence id proving it, and the silent-failure mode                                                |
| 5   | Could not verify / bounds | Honest limits. Anything carried over from a prior issue and deliberately still deferred                                                                                                  |
| 6   | API specification         | Copy-verbatim code blocks, per file, with the JSDoc each new symbol owes — **every block compile-checked as written** (rule 7). Signatures + invariants + a patch pointer instead, when `prototype.patch` carries the bodies. End with a size estimate (files / ±lines) |
| 7   | Implementation sequence   | Ordered steps where order matters (and _why_ it matters), then **Anti-instructions** — an explicit "do NOT" list                                                                         |
| 8   | Test specification        | Per suite, per id, what each asserts, **the observable that differs when it fails**, and which trap it guards. Plus the trap-coverage matrix and measured gate headroom (below)           |
| 9   | Docs and ADR bookkeeping  | Every edit, by file and line. See the map below — this is where partial sweeps happen                                                                                                    |
| 10  | Gate and commit           | The full command, expected baseline test counts, the Conventional Commits subject, and a breaking-or-not ruling with rationale                                                           |
| 11  | Definition of done        | Checklist mapping 1:1 onto §§1–10, including "nothing in the §7 anti-instruction list violated" **and** "`git rm -r docs/plans/issue-NN-*/` — the plan directory is removed in this PR"  |
| 12  | Pre-handoff verification  | **Your** evidence that §§6–10 were executed, not just written — see below. Short table, filled in before you push                                                                         |
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
| Same                                               | **Living-index footers** in every feature ADR carrying one: decrement `(#N–#41)` and add the new ADR to "have since shipped". **Grep for the current range rather than trusting a list — the set grows with every shipped issue.** See `docs/adr/README.md` Conventions |
| Issue is a `bug`, not a deferral                   | **None of the above.** Say so explicitly — copying the deferral pattern is a real failure mode (see #54 §9.1)                                                                                                                   |
| A deferred capability ships                        | Move its row `reference/scope-and-capabilities.md` "Deferred to v3.x" → "Supported (first-class)" with a real Notes cell                                                                                                        |
| An earlier ADR's decision is refined               | Add an `> Amendment` block in that ADR's voice; do **not** edit the original claim                                                                                                                                              |
| Public API change                                  | Starlight pages (below); `docs-api-sync` rule; `src/index.ts` export + `src/tests/unit/packageExports.unit.test.ts`. **Also `src/vector/index.ts`** when the new type is nameable from a `/vector` return signature — `QueryBuilder.ts` has no export-map subpath, so a `/vector`-only consumer cannot name it otherwise (the `VectorValueLike` re-export is the precedent) |
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

### Trap coverage runs both ways

"Guards: T3" in the test table is the easy direction. The direction that catches real holes is the
inverse: **for every trap, which test fails when that trap is realized, and what does that test
observe?** Add a trap-coverage matrix to §8 — one row per trap, per **site the trap can occur at** —
and for each cell name the observable. Two failure modes it catches, both from #37:

- **A test that cannot see what it claims to guard.** I-3 was listed as guarding T3 (collection-group
  `path`/`parentPath` identity), but the emulator throws `No explain results` _before_ a snapshot
  exists, so the assertion never reaches `toResult`. It passed identically with and without the trap.
  When the suite that owns the surface cannot reach the behavior, say so and require a unit mock that
  can — do not let the unreachable test stand as the guard.
- **A trap tested at one of the sites it spans.** T1 (`null` vs `[]`) applied to both the Core and the
  vector mapper; the tests covered Core only, which is exactly where the copy-paste slip lands. "Every
  trap has a test id" is satisfied by one test existing; per-site is what closes it.

**Measure gate headroom; do not reason about it.** When §8 claims a new uncovered branch is
gate-safe, parse the LCOV already on disk (`coverage/<suite>/lcov.info`) against
`scripts/check-coverage-gates.mjs` and put the numbers in §3 — lines/branches/functions per owning
gate, and the slack in each. A measured table is three rows; the paragraph of hedging it replaces is
longer, and #37's version contradicted itself in its own last sentence.

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

## §12 — pre-handoff verification

Evidence rule 7 is only as good as the record that it happened, so §12 is where you record it. It is
the planner's counterpart to `notes.md`: a reviewer can see at a glance whether the plan was checked
or merely written, and a missing row is visible in a way an unfollowed instruction is not.

Keep it to a short table — what you ran, and what came back:

| Check | Command / method | Result |
| ----- | ---------------- | ------ |
| §6 blocks compile as written | temp file under `src/` + `npm run test:types` (removed after), or the gated prototype's own `test:types` leg | clean / diagnostics + how §6 was fixed |
| Every `from '…'` specifier §6 uses | same compile, importing that exact specifier | resolved / TS2305 and what replaced it |
| Declaration emit, if a new type is public | `tsc --declaration --emitDeclarationOnly` | no undeclared package in the emitted `.d.ts` |
| Every §9 / §10 shell command | ran each one | output, and the expected result for checks that pass by matching nothing |
| Baseline suite counts | both suites | `N suites / M tests` per suite |
| Gate headroom, if §8 claims gate-safe | LCOV parse vs `check-coverage-gates.mjs` | per-gate slack |
| Unresolved conditionals | re-read §§2–9 | none (or: resolved to X by reading `<file>`) |

Two rows are worth their space beyond the compile itself. **Declaration emit** catches what a plain
type-check cannot: a type that compiles locally can still put an undeclared package into the
published `.d.ts` (`@google-cloud/firestore` is a transitive of the `firebase-admin` peer and is in
neither `dependencies` nor `peerDependencies`, so referencing it type-checks under npm hoisting and
breaks a strict pnpm consumer). And the **expected result** column stops a check that silently
matches nothing from reading as a pass.

If a row cannot be filled, that is a §5 entry, not a blank cell.

## Before you hand it off

- Re-read §3 and ask of each row: _did I actually run this?_ Delete or move to §5 anything you
  didn't.
- Re-check every `file:line` against the current tree — they rot fast on this repo.
- **Compile every §6 block as written**, exact module specifiers included, and fill in §12. This is
  the check whose absence cost #37 a review cycle.
- **Run every shell command the plan tells the implementer to run** — greps, gate legs, probe
  invocations — and record the output plus the expected result.
- **Walk §4 against §8 in the inverse direction:** each trap, at each site it can occur, has a test
  that would actually fail if the trap were realized. Name the observable, not just the test id.
- **Search the plan for conditionals** ("if the suite…", "if it turns out…") and resolve every one
  that a file read settles.
- Walk §11 against §§1–10: every prescribed change has a checklist row, and every row traces to a
  section.
- Ask the adversarial question: what surface did I miss? The usual answers are the vector wrapper
  (`src/vector/**`), `CollectionGroup.ts`, the read-only transaction surface, the express adapter,
  the `.d.ts` shape, the `/vector` subpath re-export, and the living-index footers.
- Surface open decisions to the owner **before** writing §1 — §1 is for settled calls, so an
  unresolved fork belongs in a question, not in the plan.
- **Did the prototype outgrow the plan?** If the change is built, gated and green, the collapse
  condition applies and the owner owes you an answer before this handoff happens at all. Reaching this
  list with a finished implementation in `prototype.patch` and a §6 that restates it means the
  tripwire fired and went unheard.
