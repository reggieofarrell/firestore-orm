# Testing Guide

This document describes how `@reggieofarrell/firestore-orm` is tested, how to run suites locally,
and conventions for adding new tests.

## Design decisions

These choices are intentional for a **database library** — false confidence is worse than a lower
global percentage.

| Decision             | Choice                                               | Rationale                                                                         |
| -------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| Test runner          | **Jest** (not Vitest)                                | Matches existing suite, ts-jest ESM setup, Firebase emulator `exec` workflow      |
| Primary confidence   | **Integration** (emulator)                           | Real Firestore reads/writes, batching, indexes, hooks — what can wreck a database |
| Secondary confidence | **Unit** (mocks)                                     | Fast feedback on pure logic, errors, validation, dot notation                     |
| Coverage gates       | **Dual, path-specific** per suite                    | Merged LCOV counts a line covered if _either_ suite hit it — overstates safety    |
| Gate enforcement     | `scripts/check-coverage-gates.mjs`                   | Jest `coverageThreshold` cannot express per-suite ownership of the same files     |
| Pre-push hook        | Unit coverage + unit gate only                       | No Java/emulator required for everyday pushes                                     |
| CI                   | Parallel unit + integration jobs, each with its gate | Full ORM surface checked on every PR                                              |
| Shared test infra    | Factories + mocks under `src/tests/shared/`          | No barrel re-exports; import specific modules                                     |
| File naming          | `*.unit.test.ts` / `*.integration.test.ts`           | Clear tier at a glance                                                            |

## Test pyramid

```
  /  Integration (emulator)  \   Fewer — real Firestore reads/writes, Java required
 /____________________________\
/   Unit (Jest, Node, mocks)   \   More — fast, isolated logic
```

| Tier            | What it tests                                                      | When to use                                                                     |
| --------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| **Unit**        | Pure utilities, validation, error mapping, mocked Firestore wiring | Logic that does not need emulator semantics                                     |
| **Integration** | Repository, QueryBuilder, hooks, transactions, sentinels           | Firestore behavior, batching, indexes, real writes — **primary ORM safety net** |

## Directory layout

```
src/tests/
├── unit/                    # Fast tests (no emulator)
├── integration/             # Emulator-backed tests
│   └── helpers/             # firestoreIntegrationHarness.ts
└── shared/
    ├── factories/           # createTestUserInput, resetTestFactoryCounters, …
    └── mocks/               # createMockFirestoreDb for unit tests
```

**Naming:** `{domain}.unit.test.ts` and `{domain}.integration.test.ts`.

## Commands

| Command                                  | Description                                  |
| ---------------------------------------- | -------------------------------------------- |
| `npm run test:unit`                      | Unit tests only                              |
| `npm run test:unit:coverage`             | Unit tests + `coverage/unit/`                |
| `npm run test:integration`               | Integration tests (emulator must be running) |
| `npm run test:integration:emulator`      | Start emulator, run integration tests, stop  |
| `npm run test:integration:coverage`      | Integration tests + `coverage/integration/`  |
| `npm run test:coverage:gate:unit`        | Enforce unit-suite path thresholds           |
| `npm run test:coverage:gate:integration` | Enforce integration-suite path thresholds    |
| `npm run test:coverage:all`              | Full local coverage run + both gates         |
| `npm test`                               | Unit + integration (emulator auto-start)     |

### Local integration prerequisites

- Node.js 20+
- Java (Firestore emulator)
- `FIRESTORE_EMULATOR_HOST` defaults to `127.0.0.1:8080`

## Integration harness

Use
[firestoreIntegrationHarness.ts](../src/tests/integration/helpers/firestoreIntegrationHarness.ts):

- `createUserRepoHarness(prefix)` — isolated collection per suite, `trackUser`, cleanup helpers
- `createValidatedRepo(db)` — schema-validated repo for sentinel/hook tests
- Unique collection names prevent cross-test interference

## Shared factories

Import from specific modules (no barrel files):

```typescript
import { createTestUserInput } from '../shared/factories/user.factory.js';
import { resetTestFactoryCounters } from '../shared/factories/counters.js';
```

Call `resetTestFactoryCounters()` in `beforeEach` when deterministic IDs matter.

## Unit test conventions

- Mock **at the Firestore boundary** using `createMockFirestoreDb()` from `src/tests/shared/mocks/`
- Mock factories hold **`jest.fn()` spies** — do not reimplement Firestore behavior inline
- Add a **JSDoc file header** stating strategy and what is verified

## Integration test conventions

- Use isolated collections via harness (never share collection names across suites)
- `afterEach`: `cleanupTrackedUsers()`
- `afterAll`: `cleanupCollection()` as safety net
- Prefer factories over inline object literals for create payloads

## Coverage policy

Merged LCOV reports are **not** used as the primary gate. Unit and integration suites are
complementary — a line hit in either suite would count as covered in a merged report, which
overstates confidence for a database library. Instead, each suite enforces **path-specific**
thresholds via `scripts/check-coverage-gates.mjs`.

### Unit gate (pre-push + CI)

| Scope                    | Files                                                 | Lines | Branches | Functions |
| ------------------------ | ----------------------------------------------------- | ----- | -------- | --------- |
| Pure utilities           | `src/utils/**`                                        | 95%   | 90%      | 90%       |
| Error / validation layer | `Errors`, `ErrorParser`, `ErrorHandler`, `Validation` | 90%   | 85%      | 90%       |
| Package exports          | `src/index.ts`                                        | 100%  | 100%     | 65%       |

### Integration gate (CI)

| Scope                       | Files                    | Lines | Branches | Functions |
| --------------------------- | ------------------------ | ----- | -------- | --------- |
| ORM core                    | `FirestoreRepository.ts` | 90%   | 75%      | 85%       |
| Query layer                 | `QueryBuilder.ts`        | 90%   | 75%      | 95%       |
| Validation (emulator paths) | `Validation.ts`          | 90%   | 80%      | 95%       |

**Pre-push** runs `test:unit:coverage` + `test:coverage:gate:unit` (no Java/emulator).

**CI** runs each suite with coverage, then its gate, in parallel matrix jobs.

**Local full check:** `npm run test:coverage:all`

### What we do not gate

- **Merged LCOV** — report-only if you merge manually; never used as a CI/pre-push gate
- **Global suite percentages** — a 60% unit run is expected; only path-specific gates matter
- **FirestoreRepository / QueryBuilder on unit reports** — owned by integration gate
- **Utils / error layer on integration reports** — owned by unit gate

Thresholds live in `scripts/check-coverage-gates.mjs`. Update that file and this doc together when
ratcheting.

## Git hooks

| Hook           | Command                                          | Purpose                                  |
| -------------- | ------------------------------------------------ | ---------------------------------------- |
| **pre-commit** | `lint-staged`                                    | ESLint + Prettier on staged files        |
| **pre-push**   | `test:unit:coverage` + `test:coverage:gate:unit` | Fast path-specific gate without emulator |

## Anti-patterns

- Do not unit-test emulator-only repository paths when integration tests are appropriate
- Do not hand-roll Firestore logic inside `jest.mock()` factories
- Do not rely on shared collection names across test files
- Do not assert implementation details of internal private methods — test public contracts
- Do not use merged LCOV or global suite % as a release gate for this library

## AI-assisted testing

Cursor rules and skills live under `.cursor/`:

- `rules/test-awareness.mdc` — suggests tests after code changes
- `rules/test-guardrails.mdc` — scoped guardrails for `src/tests/**`
- `skills/unit-testing/SKILL.md` — unit test patterns
- `skills/integration-testing/SKILL.md` — emulator integration patterns
- `commands/write-unit-tests.md` — diff-based unit test workflow
- `commands/write-integration-tests.md` — diff-based integration test workflow

## Related docs

- [test-coverage-followups.md](./test-coverage-followups.md) — backlog of future coverage work
