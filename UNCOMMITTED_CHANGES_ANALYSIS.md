# Uncommitted Changes Analysis (Reconciled)

## Snapshot (Jun 28, 2026)

This document replaces the earlier analysis snapshot and reflects the **current** working tree state.

Current status after cleanup:

- Index normalized: there are currently **no staged changes** (all changes are unstaged or untracked).
- Core library files are heavily refactored (`FirestoreRepository`, `QueryBuilder`, `Validation`, docs).
- The legacy single integration test file was removed and replaced by separate unit/integration suites.
- Tooling and CI setup were introduced (ESLint, Prettier, Husky, lint-staged, GitHub Actions, Firebase emulator config).

Verification run against current local state:

- `npm run test:unit` -> passed (4 suites, 20 tests)
- `npm run test:integration:emulator` -> passed (5 suites, 69 tests)
- `npm run lint` -> passed
- `npm run build` -> passed

---

## What Has Been Implemented

## 1) Repository Contract Changes (`src/core/FirestoreRepository.ts`)

Primary behavioral shift:

- Write/update semantics now rely on Firestore-native update behavior instead of local merge reconstruction.
- `update`, `bulkUpdate`, and `upsert` default to ID-based return payloads.
- Optional read-after-write support was added via `returnDoc` where needed.

Implemented API contract:

- `update(id, data)` -> `{ id }`
- `update(id, data, { returnDoc: true })` -> full persisted doc
- `patch(...)` convenience alias for merge-style updates (`merge: true`)
- `bulkPatch(...)` convenience alias for merge-style bulk updates
- `patchInTransaction(...)` convenience alias for merge-style transaction updates
- `upsert(...)` supports both ID-only and `returnDoc` forms

Hook and validation ordering:

- Write flow consistently follows `before* hook -> validation -> Firestore write -> after* hook`.
- `afterUpdate` payload is `{ id }`.
- `afterBulkUpdate` payload is `{ ids }`.

Input typing and validation:

- Write signatures now use sentinel-capable input aliases:
  - create paths: `CreateInput<T>` (`WithFieldValue<T>`)
  - update paths: `UpdateInput<T>` (`PartialWithFieldValue<T>`)
- Top-level `id` is stripped from write payloads before persistence.

Transaction and converter behavior:

- Transaction repository instances preserve hooks, validator state, and converter configuration.
- `getForUpdateInTransaction(...)` naming is in place.
- Converters are explicit and not auto-inherited by subcollections.

Soft-delete surface:

- Soft-delete methods and modes are removed from repository/query paths in the current code.

## 2) Query Builder Changes (`src/core/QueryBuilder.ts`)

Update behavior:

- `query().update(data)` now aligns with repository bulk update flow:
  - runs `beforeBulkUpdate`
  - validates/sanitizes per doc update payload
  - writes batched `update(...)`
  - runs `afterBulkUpdate` with `{ ids }`

Aggregation changes:

- Replaced legacy `aggregate(field, operation)` usage with explicit methods:
  - `sum(field)`
  - `average(field)`
- Uses Firestore native aggregate queries (`AggregateField.sum` / `AggregateField.average`).

Count behavior:

- `totalCount()` now counts from base collection reference and intentionally ignores accumulated `where` clauses.

Typing compatibility:

- Query/reference typing is adjusted to remain compatible with converter-backed repositories.

## 3) Validation Layer Changes (`src/core/Validation.ts`)

Sentinel-aware validation is implemented:

- Added shared write input aliases (`CreateInput`, `UpdateInput`).
- Added sentinel detection (`isFieldValueSentinel`) and path collection (`collectSentinelPaths`).
- Parsing uses `safeParse`.
- Validation accepts writes when all schema issues are scoped to sentinel-valued paths.
- Non-sentinel violations still fail with `ValidationError`.

Schema/write contracts:

- Derived create/update schemas omit top-level `id` from write payloads.
- Repository exposes schema bundle (`schemas`, `readSchema`, `createSchema`, `updateSchema`) for introspection.

## 4) Error Handling and Public API Surface

`src/core/ErrorParser.ts`:

- Firestore not-found errors (`code === 5` or `'not-found'`) map to `NotFoundError`.

`src/index.ts`:

- Type exports are separated cleanly (`ID`, `HookEvent`, `PaginatedResult`, `Validator`).

`src/core/ErrorHandler.ts` and `src/core/Errors.ts`:

- Mostly formatting/cleanup; behavior remains broadly consistent.

## 5) Test Suite Overhaul

The previous monolithic integration file was replaced with focused suites.

Removed:

- `src/tests/dotNotation.test.ts` (legacy all-in-one file)

Added unit suites:

- `src/tests/unit/dotNotation.unit.test.ts`
- `src/tests/unit/updateMergeNormalization.unit.test.ts`
- `src/tests/unit/converterSupport.unit.test.ts`
- `src/tests/unit/schemaContracts.unit.test.ts`

Added integration suites:

- `src/tests/integration/repository-dot-notation.integration.test.ts`
- `src/tests/integration/repository-query-transaction.integration.test.ts`
- `src/tests/integration/repository-sentinels-validation.integration.test.ts`
- `src/tests/integration/repository-update-contracts.integration.test.ts`
- `src/tests/integration/repository-aggregation.integration.test.ts`
- `src/tests/integration/helpers/firestoreIntegrationHarness.ts`

Coverage emphasis in new tests:

- ID-return + `returnDoc` update contracts
- hook payload contracts (`afterUpdate`, `afterBulkUpdate`)
- merge helpers (`patch`, `bulkPatch`, `patchInTransaction`)
- sentinel behavior across create/update/bulk/query/transaction paths
- converter behavior and schema requirements
- aggregation semantics (`sum`, `average`, `totalCount`)

## 6) Tooling and CI Baseline Added

New project tooling/config:

- `eslint.config.js`
- `.prettierrc`
- `.husky/pre-commit`
- `.github/workflows/tests.yml`
- `firebase.json`
- `.firebaserc`

`package.json` changes include:

- scripts for lint/format/unit/integration/emulator test flows
- Husky prepare hook
- lint-staged integration
- dev dependency additions for eslint/prettier/firebase-tools/husky

`jest.config.js`, `tsconfig.json`, and `tsconfig.esm.json` were updated to support the new workflow.

---

## Differences From The Earlier Analysis Snapshot

The earlier analysis correctly identified the core direction, but this reconciled view adds material changes that happened later:

- `returnDoc` update/upsert support
- merge convenience APIs (`patch`, `bulkPatch`, `patchInTransaction`)
- schema exposure and required-id schema contract checks
- converter behavior and transaction preservation details
- full test architecture split (unit + integration + harness)
- lint/format/hook/CI/emulator setup and package script changes

---

## Remaining Non-Release Tasks

The following still require a product-level decision or cleanup pass:

1. Review giant formatting+content churn in `README.md` and keep only intended doc changes.
2. Confirm the large `package-lock.json` change only reflects intended dependency/tooling updates.
3. Decide whether benchmark script imports and module style in `src/benchmarks/performance.test.ts` should be modernized now or later.
4. Finalize commit slicing so history is understandable and bisect-friendly.

---

## Cleanup Actions Already Performed

As part of this reconciliation pass:

- normalized the git index so staged/unstaged overlap is removed
- updated this analysis file to reflect current reality
- added emulator log ignore rules to reduce local noise (see `.gitignore`)

---

## Proposed Commit Split (No Commits Created Yet)

Suggested sequence with concise Conventional Commit messages:

1. **Core behavior + types**
   - Files: `src/core/FirestoreRepository.ts`, `src/core/QueryBuilder.ts`, `src/core/Validation.ts`, `src/core/ErrorParser.ts`, `src/index.ts`, `src/utils/dotNotation.ts`
   - Message: `feat(core)!: align update semantics with firestore-native writes`

2. **Tests restructure + new coverage**
   - Files: `src/tests/unit/**`, `src/tests/integration/**`, deletion of `src/tests/dotNotation.test.ts`, relevant `jest.config.js`
   - Message: `test: split repository coverage into unit and emulator integration suites`

3. **Tooling/CI/emulator**
   - Files: `.github/workflows/tests.yml`, `.husky/pre-commit`, `.prettierrc`, `eslint.config.js`, `firebase.json`, `.firebaserc`, `package.json`, `package-lock.json`, `.gitignore`, tsconfig adjustments
   - Message: `chore(tooling): add linting formatting hooks and emulator ci workflow`

4. **Documentation**
   - Files: `README.md`, `UNCOMMITTED_CHANGES_ANALYSIS.md`
   - Message: `docs: update contracts migration notes and change analysis`

If you prefer fewer commits, combine (1)+(2) and keep docs/tooling separate.
