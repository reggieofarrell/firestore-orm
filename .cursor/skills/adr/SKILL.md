---
name: adr
description:
  Create or update an Architecture Decision Record (ADR) in docs/adr/ for this repo. Use when the
  user asks to record/write/add an ADR or an architecture decision, or when a change makes a
  significant architectural or contract-level decision (public API/return-contract changes, write or
  validation semantics, dependency/runtime floors, removing a subsystem, a new opt-in module). NOT
  for routine bug fixes, refactors, docs, or test-only changes.
---

# Architecture Decision Records (firestore-orm)

Capture the _why_ behind a significant decision — the context that forced it and its consequences —
in a durable, reviewable record. Commit messages and the `CHANGELOG` list _what_ changed; ADRs
explain _why_.

## Location & conventions

- Records live in [`docs/adr/`](../../../docs/adr/), one decision per file.
- Filename: `NNNN-kebab-case-title.md` — zero-padded, monotonically increasing number.
- Template: [`docs/adr/0000-template.md`](../../../docs/adr/0000-template.md).
- Index + process: [`docs/adr/README.md`](../../../docs/adr/README.md).
- A record is **immutable once Accepted**. To change a decision, write a _new_ ADR that supersedes
  it; do not rewrite history.

## Is it ADR-worthy?

Write one when the decision is hard to reverse or shapes the codebase's contracts, e.g.:

- Public API / return-contract / write- or validation-semantics changes
- Removing or replacing a subsystem
- Dependency model, peer-dependency, or supported-runtime floors
- A new opt-in module or subpath export
- A deliberate breaking change / major version

Skip routine bug fixes, internal refactors, docs, and test-only changes.

## Workflow

1. **Pick the number.** `ls docs/adr/` and take the highest `NNNN` + 1 (skip `0000`, the template).
2. **Create the file** `docs/adr/NNNN-<kebab-title>.md` by copying `0000-template.md`.
3. **Fill the sections** (keep it decision-focused; link out rather than duplicate):
   - **Status** — `Proposed` | `Accepted` | `Superseded by ADR-NNNN` | `Deprecated`
   - **Date** — `YYYY-MM-DD` (use the actual decision date, e.g. a release date for historical ADRs)
   - **Deciders**, **Related** (ADRs / PRs / issues / docs)
   - **Context** — the forces/constraints (Firestore & Firebase Admin SDK behavior, backward
     compatibility, fork obligations); facts, not the choice
   - **Decision** — active voice ("We will …"); group sub-decisions with per-item rationale
   - **Consequences** — positives, negatives/costs, migration and backward-compatibility impact
   - **Alternatives considered** — what was weighed and why it was rejected
   - **References** — `CHANGELOG`, code paths, PRs, upstream links
4. **Update the index** table in `docs/adr/README.md` (add a row: number, title, status, date).
5. **Cross-link.** If this refines or replaces an earlier ADR, link it and, when superseding, set
   the old ADR's status to `Superseded by ADR-NNNN`.
6. For a change tied to a branch/PR, note the branch and set Status to `Accepted` (add "pending
   merge/release" if not yet merged).

## Style

- Concise and scannable. Reference the `CHANGELOG` for exhaustive change lists; the ADR carries
  intent and rationale.
- Ground claims in repo facts — verify with `git log`, `CHANGELOG.md`, `NOTICE`, and the code before
  asserting history.
- Prefer relative links (they resolve on GitHub and in editors).

## Examples in this repo

- [`0001-fork-and-2.0.0-rearchitecture.md`](../../../docs/adr/0001-fork-and-2.0.0-rearchitecture.md)
  — a bundled, themed decision (the fork + deliberate 2.0.0 break).
- [`0002-per-field-sentinel-write-validation.md`](../../../docs/adr/0002-per-field-sentinel-write-validation.md)
  — a single decision that refines an earlier one.
