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

| ADR                                                            | Title                                                                        | Status                                                        | Date       |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------- |
| [0001](0001-fork-and-2.0.0-rearchitecture.md)                  | Fork `spacelabs-firestoreorm` and re-architect as a deliberate `2.0.0` break | Accepted                                                      | 2026-07-08 |
| [0002](0002-per-field-sentinel-write-validation.md)            | Per-field `FieldValue` sentinel approval via opt-in strict validation        | Accepted                                                      | 2026-07-16 |
| [0003](0003-timestamp-millis-converter-helper.md)              | `Timestamp ↔ millis` converter helper                                        | Accepted                                                      | 2026-07-17 |
| [0004](0004-schema-inferred-write-types.md)                    | Schema-inferred write-input types (and optional `id` on create)              | Superseded by [0007](0007-retire-curried-schema-factories.md) | 2026-07-17 |
| [0005](0005-from-snapshot-read-mapper.md)                      | `fromSnapshot()` read-mapper for raw Firestore snapshots                     | Accepted                                                      | 2026-07-17 |
| [0006](0006-starlight-docs-site-and-major-version-archives.md) | Starlight docs site and major-version archives                               | Accepted                                                      | 2026-07-17 |
| [0007](0007-retire-curried-schema-factories.md)                | Retire curried schema factories for value-inferred read/write types          | Accepted                                                      | 2026-07-17 |
| [0008](0008-read-only-converters.md)                           | Firestore converters are read-only (`readConverter`)                         | Accepted                                                      | 2026-07-18 |
| [0009](0009-explicit-read-validators.md)                       | Explicit `validate()` / `safeValidate()` read-boundary validators            | Accepted                                                      | 2026-07-18 |
| [0010](0010-type-safe-dot-notation.md)                         | Type-safe dot-notation and dot-aware write validation                        | Accepted                                                      | 2026-07-18 |
| [0011](0011-no-defaults-on-partial-update.md)                  | Zod `.default(...)` values are not injected on a partial update              | Accepted                                                      | 2026-07-18 |
| [0012](0012-drop-zod-v3.md)                                    | Drop zod v3; require zod `^4.0.0`                                            | Accepted                                                      | 2026-07-18 |
| [0013](0013-create-return-contract.md)                         | Create returns `{ id }` by default with opt-in read-back                     | Accepted (v3)                                                 | 2026-07-19 |
| [0014](0014-reject-empty-update-payloads.md)                   | Reject empty update payloads                                                 | Accepted (v3)                                                 | 2026-07-19 |
| [0015](0015-express-adapter-subpath.md)                        | Express adapter behind an optional `firestore-orm/express` subpath           | Accepted (v3)                                                 | 2026-07-19 |
| [0016](0016-dual-esm-cjs-build-and-support-floor.md)           | Dual ESM+CJS build and the v3 runtime/support floor                          | Accepted (v3)                                                 | 2026-07-19 |
