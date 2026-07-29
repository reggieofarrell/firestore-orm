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
- **ADR-0017 deferral footers:** amendment _blockquotes_ inside ADR-0017 are **historical
  snapshots** (they keep the remaining-list wording as of that amendment, e.g. `(#32–#41)` after
  #31). Feature ADRs that close a deferral (0023 / 0024 / 0025 …) may end with a short **"remaining
  deferrals (#N–#41)" footer kept as a living index** — update that list when a later issue ships,
  and note the living-index intent inline so the rewrite is not mistaken for silent history
  revision.

## Status values

`Proposed` · `Accepted` · `Superseded by ADR-NNNN` · `Deprecated`

## Index

| ADR                                                                    | Title                                                                            | Status                                                        | Date       |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------- |
| [0001](0001-fork-and-2.0.0-rearchitecture.md)                          | Fork `spacelabs-firestoreorm` and re-architect as a deliberate `2.0.0` break     | Accepted                                                      | 2026-07-08 |
| [0002](0002-per-field-sentinel-write-validation.md)                    | Per-field `FieldValue` sentinel approval via opt-in strict validation            | Accepted                                                      | 2026-07-16 |
| [0003](0003-timestamp-millis-converter-helper.md)                      | `Timestamp ↔ millis` converter helper                                            | Accepted                                                      | 2026-07-17 |
| [0004](0004-schema-inferred-write-types.md)                            | Schema-inferred write-input types (and optional `id` on create)                  | Superseded by [0007](0007-retire-curried-schema-factories.md) | 2026-07-17 |
| [0005](0005-from-snapshot-read-mapper.md)                              | `fromSnapshot()` read-mapper for raw Firestore snapshots                         | Accepted                                                      | 2026-07-17 |
| [0006](0006-starlight-docs-site-and-major-version-archives.md)         | Starlight docs site and major-version archives                                   | Accepted                                                      | 2026-07-17 |
| [0007](0007-retire-curried-schema-factories.md)                        | Retire curried schema factories for value-inferred read/write types              | Accepted                                                      | 2026-07-17 |
| [0008](0008-read-only-converters.md)                                   | Firestore converters are read-only (`readConverter`)                             | Accepted                                                      | 2026-07-18 |
| [0009](0009-explicit-read-validators.md)                               | Explicit `validate()` / `safeValidate()` read-boundary validators                | Accepted                                                      | 2026-07-18 |
| [0010](0010-type-safe-dot-notation.md)                                 | Type-safe dot-notation and dot-aware write validation                            | Accepted                                                      | 2026-07-18 |
| [0011](0011-no-defaults-on-partial-update.md)                          | Zod `.default(...)` values are not injected on a partial update                  | Accepted                                                      | 2026-07-18 |
| [0012](0012-drop-zod-v3.md)                                            | Drop zod v3; require zod `^4.0.0`                                                | Accepted                                                      | 2026-07-18 |
| [0013](0013-create-return-contract.md)                                 | Create returns `{ id }` by default with opt-in read-back                         | Accepted (v3)                                                 | 2026-07-19 |
| [0014](0014-reject-empty-update-payloads.md)                           | Reject empty update payloads                                                     | Accepted (v3)                                                 | 2026-07-19 |
| [0015](0015-express-adapter-subpath.md)                                | Express adapter behind an optional `firestore-orm/express` subpath               | Accepted (v3)                                                 | 2026-07-19 |
| [0016](0016-dual-esm-cjs-build-and-support-floor.md)                   | Dual ESM+CJS build and the v3 runtime/support floor                              | Accepted (v3)                                                 | 2026-07-19 |
| [0017](0017-v3-core-operations-scope.md)                               | v3 scope is Firestore Core operations; server-parity features deferred           | Accepted (v3)                                                 | 2026-07-19 |
| [0018](0018-document-identity-and-data-model.md)                       | v3 document identity and the read/write/stored data-model split                  | Accepted (v3)                                                 | 2026-07-21 |
| [0019](0019-operation-aware-sentinel-validation.md)                    | Operation-aware sentinel validation (reject delete sentinels on create)          | Accepted (v3)                                                 | 2026-07-21 |
| [0020](0020-aggregate-null-fidelity.md)                                | Aggregate null fidelity — `average` returns `number \| null`                     | Accepted (v3)                                                 | 2026-07-21 |
| [0021](0021-v3-query-builder-api-cleanups.md)                          | v3 query-builder and packaging API cleanups                                      | Accepted (v3)                                                 | 2026-07-21 |
| [0022](0022-vector-value-hardening.md)                                 | v3 vector-value hardening (genuine VectorValue, object-form compat)              | Accepted (v3)                                                 | 2026-07-22 |
| [0023](0023-composite-filter-factory.md)                               | Composite AND/OR filters via a schema-aware filter factory (`whereFilter`)       | Accepted (v3)                                                 | 2026-07-24 |
| [0024](0024-collection-group-queries.md)                               | Collection-group queries: read-only surface with full-path result identity       | Accepted (v3)                                                 | 2026-07-25 |
| [0025](0025-transaction-options-readonly-pitr.md)                      | Transaction options (read-only / PITR / maxAttempts) + getInTransaction rename   | Accepted (v3.x, pending merge/release)                        | 2026-07-25 |
| [0026](0026-conditional-writes-preconditions.md)                       | Conditional writes — create-only by explicit id + `lastUpdateTime` preconditions | Accepted (v3.x, pending merge/release)                        | 2026-07-25 |
| [0027](0027-generic-multi-aggregation.md)                              | Generic multi-aggregation — `aggregate(spec)` with typed aliases                 | Accepted (v3.x, pending merge/release)                        | 2026-07-26 |
| [0028](0028-distributive-omit-id.md)                                   | Distributive `Omit<_, 'id'>` for union data models                               | Accepted (v3.x, pending merge/release)                        | 2026-07-26 |
| [0029](0029-get-many-multi-document-reads.md)                          | `getMany(ids)` multi-document reads + `bulkDelete` consistent pre-read           | Accepted (v3.x, pending merge/release)                        | 2026-07-27 |
| [0030](0030-typed-query-bounds-and-limit-to-last.md)                   | Typed query bounds, `offset`, and `limitToLast`                                  | Accepted (v3.x, pending merge/release)                        | 2026-07-28 |
| [0031](0031-query-explain.md)                                          | Query Explain — `explain()` for Core and vector queries                          | Accepted (v3.x, pending merge/release)                        | 2026-07-28 |
| [0032](0032-bulkwriter-high-throughput-writes-and-recursive-delete.md) | BulkWriter high-throughput writes (`bulkWrite`) + explicit recursive delete      | Accepted (v3.x, pending merge/release)                        | 2026-07-28 |
| [0033](0033-snapshot-metadata-and-detailed-listeners.md)               | Opt-in snapshot metadata (`withMetadata`) + detailed `docChanges` listeners      | Accepted (v3.x, pending merge/release)                        | 2026-07-28 |
