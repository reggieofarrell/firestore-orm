<!--
Skeleton for docs/plans/issue-NN-<kebab-slug>/PLAN.md — see SKILL.md for the rules behind each
section, and docs/plans/README.md for the directory layout and lifecycle.
Delete every bracketed prompt and any section that genuinely does not apply (and say why it does
not, rather than dropping it silently).
-->

# Issue #NN — [one-line title]

**Implementer:** [agent/person] · **Reviewer:** [agent/person] · **Baseline:** `main` @ `<sha>`
(`<commit subject>`) · **Branch:** `<type>/issue-NN-<slug>` — already created and pushed with this
plan on it; check it out, do not cut a new one

**Issue:** [#NN](https://github.com/reggieofarrell/firestore-orm/issues/NN) — labels `…`. [If the
labels put it in ADR-0017's `#35–#41` parity/`v3.x` deferral set, say so — it changes the §9
bookkeeping. If it is a plain `bug`, say that too, and that the deferral bookkeeping does **not**
apply.]

> **Acceptance (verbatim from the issue):** "…"

---

## §0 How to use this plan

1. Read §1 (settled — do not re-litigate) and §4 (traps) **before** writing code.
2. §6 blocks are copy-verbatim; they [compiled and gated / are specifications]. §7 is the ordered
   build sequence, §8 the tests, §9 docs/ADR, §10 the gate, §11 done.
3. Every claim in §3 was produced by an executed probe on this baseline. Probes are in
   `docs/plans/issue-NN-<slug>/probes/` — re-run them if you doubt one. **Do not trust the issue body
   over §3.**
4. [If you prototyped: the patch path, **which gate legs it actually passed**, and that every
   `PROTOTYPE (#NN)` marker must be replaced with real JSDoc. If you did not prototype, say so here
   and point at §5 for what that leaves unverified.]
5. **Follow the `plan-execution` skill** — it owns the implementer's contract: `notes.md` written as
   you go, the mutation checks, and the independent refute-first self-review you must pass before
   declaring this ready for external review.

---

## §1 Owner-approved decisions

| Id     | Fork | Decision | Rejected alternative and why |
| ------ | ---- | -------- | ---------------------------- |
| **D1** |      |          |                              |
| **D2** |      |          |                              |

[Any decision derived rather than asked — label it `(derived, not asked)`.]

---

## §2 Scope

### In scope

| Area | Change |
| ---- | ------ |

### Explicitly **out** of scope

- [Each with the reason, and the issue it belongs to if it belongs to one.]

### [Scope correction — where the issue is stale]

[Wrong line numbers, missing files, sites added by PRs that landed after the issue was filed.]

---

## §3 Verified facts

### 3.1 [Claim] — `<probe file>`

| Id  | Expression / condition | Observed | Note |
| --- | ---------------------- | -------- | ---- |
| P1  |                        |          |      |

### 3.N Authoritative site enumeration (`main` @ `<sha>`)

| File | Lines |
| ---- | ----- |

**Deliberately NOT changed** (justify in your notes if you touch them):

- `path:line` — why it is out of scope.

### 3.N+1 [Prototype gate results, if prototyped]

| Step | Result |
| ---- | ------ |

---

## §4 Traps

Ordered by how badly a reasonable implementer gets them wrong.

### T1 — [mechanism, not warning] ([evidence id])

[What goes wrong, why, whether it fails silently, and what catches it.]

---

## §5 Could not verify / scope bounds

- **[Bound]** — [what is verified vs assumed; what CI still owes.]
- **[If unprototyped]** — [what the blast radius / gate impact was reasoned about rather than
  observed, so the implementer knows where to expect surprises.]
- **Carried over, explicitly deferred** — [findings from prior issues that stay deferred.]

---

## §6 API specification

### 6.1 `<file>` — [change]

```ts

```

[The JSDoc each new symbol owes, and the trap that JSDoc guards against.]

### 6.N Size

[N files, ~±L lines, plus tests, ADR, docs. Any runtime behavior change.]

---

## §7 Implementation sequence and anti-instructions

1. Check out `<branch>` — it already exists and carries this plan. If `main` has moved past `<sha>`,
   rebase onto it and **re-verify the §3 line numbers before editing anything**.
2. …
3. [Where order matters, say why — e.g. "step N first, or step N+1 will not compile (T4)".]
4. Tests (§8) — **verify each new test fails on the unfixed baseline** (`git stash`).
5. Docs + ADR + bookkeeping (§9).
6. Full gate (§10), `prettier --write`, `notes.md`. Leave the plan directory in place for review —
   the cleanup commit that removes it comes after.

### Anti-instructions

- **Do not** …
- **Do not** commit unless asked; leave the tree clean and report the subject line (§10).

---

## §8 Test specification

### 8.1 [Suite] — `<path>`

| Id  | Asserts | Guards |
| --- | ------- | ------ |
| U-1 |         | T1     |

### 8.N Coverage gates

| Changed path | Gate |
| ------------ | ---- |

---

## §9 Docs and ADR bookkeeping

### 9.1 Bookkeeping — what does **not** apply

[Explicit. Especially the ADR-0017 amendment / living-index footers when the issue is not a
deferral.]

### 9.2 New ADR — `docs/adr/NNNN-<slug>.md`

From `docs/adr/0000-template.md`. Status `Accepted (v3.x, pending merge/release)`, Date
`YYYY-MM-DD`, Deciders `maintainer`. Must contain:

1. **Context** — …
2. **Decision** — …
3. **Consequences** — …
4. **Alternatives considered** — …
5. **References** — …
6. [Living-index footer, if it closes an ADR-0017 deferral.]

Add the row to `docs/adr/README.md`.

### 9.3 ADR bookkeeping edits

| File | Edit |
| ---- | ---- |

### 9.4 Website — N pages

| Page | Line | Change |
| ---- | ---- | ------ |

`website/**/*.md` is prettier-exempt — match style by hand. If you add an aside, run
`npm run docs:build` and grep the built HTML for a leaked literal `:::`.

### 9.5 READMEs

[Per the `readme-sync` skill, or: grepped both, neither is affected — say which, and say it in the
PR body.]

### 9.6 [Follow-up issue to open]

[Title, body contents, labels, and what should reference it.]

---

## §10 Gate and commit

```bash
npm run test:types && npm run lint && npm run check:format && npm run test:unit && npm run test:integration:emulator && npm run test:unit:coverage && npm run test:coverage:gate:unit && npm run test:integration:coverage && npm run test:coverage:gate:integration && npm run build && npm run check:package && npm run check:consumer && npm run check:docs && npm run docs:build
```

Fourteen legs. Report failures with output — never claim a leg passed that you did not execute.

Baseline before your change: unit **N suites / N tests**, integration **N suites / N tests**. [Which
must go up; which must stay unchanged.] [Which coverage gate to watch and why.]

Re-run the probes against the finished code:

```bash

```

**Commit subject** (Conventional Commits; commitlint runs on `commit-msg`):

```
type(scope): summary (#NN)
```

**Is it breaking?** [Ruling + rationale. v3.x work folds into the unreleased 3.0.0.]

---

## §11 Definition of done

| #   | Item                                                                                                |
| --- | --------------------------------------------------------------------------------------------------- |
| 1   |                                                                                                     |
| …   | Nothing in the §7 anti-instruction list violated                                                    |
| …   | Full gate green (§10) with real output; suite counts as predicted                                   |
| …   | `notes.md` committed: deviations, unverified items, adversarial self-review                          |
| …   | Assertion probes promoted to committed tests (§8), not left in `probes/`                            |
| …   | `git rm -r docs/plans/issue-NN-*/` — this plan directory is removed in this PR                       |

---

## Appendix — probe inventory (`probes/`, beside this file)

| File | What it proves |
| ---- | -------------- |
