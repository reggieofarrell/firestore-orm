# Architecture Decision Records

This directory holds **Architecture Decision Records (ADRs)** — short documents that capture a
significant architectural or contract-level decision, the context that forced it, and its
consequences. They explain _why_ the codebase looks the way it does, which commit messages and the
`CHANGELOG` alone don't convey.

## Conventions

- One decision per file, named `NNNN-kebab-case-title.md` with a zero-padded, monotonic number.
- Start from [`0000-template.md`](0000-template.md).
- A record is immutable once **Accepted**. To change a decision, add a _new_ ADR that supersedes the
  old one and update the old one's status to `Superseded by ADR-NNNN`.
- Keep records decision-focused. Link to the `CHANGELOG`, code, or design docs for exhaustive detail
  rather than duplicating it.

## Status values

`Proposed` · `Accepted` · `Superseded by ADR-NNNN` · `Deprecated`

## Index

| ADR                                                 | Title                                                                        | Status   | Date       |
| --------------------------------------------------- | ---------------------------------------------------------------------------- | -------- | ---------- |
| [0001](0001-fork-and-2.0.0-rearchitecture.md)       | Fork `spacelabs-firestoreorm` and re-architect as a deliberate `2.0.0` break | Accepted | 2026-07-08 |
| [0002](0002-per-field-sentinel-write-validation.md) | Per-field `FieldValue` sentinel approval via opt-in strict validation        | Accepted | 2026-07-16 |
