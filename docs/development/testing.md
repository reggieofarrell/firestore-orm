# Testing Guide

This document describes how `@reggieofarrell/firestore-orm` is tested, how to run suites locally,
and conventions for adding new tests.

## Test pyramid

```
  /  Integration (emulator)  \   Fewer — real Firestore reads/writes, Java required
 /____________________________\
/   Unit (Jest, Node, mocks)   \   More — fast, isolated logic
```

| Tier            | What it tests                                                      | When to use                                        |
| --------------- | ------------------------------------------------------------------ | -------------------------------------------------- |
| **Unit**        | Pure utilities, validation, error mapping, mocked Firestore wiring | Logic that does not need emulator semantics        |
| **Integration** | Repository, QueryBuilder, hooks, transactions, sentinels           | Firestore behavior, batching, indexes, real writes |

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

| Command                                 | Description                                       |
| --------------------------------------- | ------------------------------------------------- |
| `npm run test:unit`                     | Unit tests only                                   |
| `npm run test:unit:coverage`            | Unit tests + `coverage/unit/`                     |
| `npm run test:integration`              | Integration tests (emulator must be running)      |
| `npm run test:integration:emulator`     | Start emulator, run integration tests, stop       |
| `npm run test:integration:coverage`     | Integration tests + `coverage/integration/`       |
| `npm run test:coverage:merge`           | Merge unit + integration LCOV and gate thresholds |
| `npm run test:coverage:merge:unit-only` | Gate unit coverage only (pre-push)                |
| `npm run test:coverage:all`             | Full local coverage run                           |
| `npm test`                              | Unit + integration (emulator auto-start)          |

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

- **Unit** and **integration** each produce `lcov.info`
- **CI** merges both reports and enforces merged thresholds (see `scripts/merge-coverage.mjs`)
- Default **merged** gate (CI / `test:coverage:all`): **70% lines**, **70% functions**, **60%
  branches**
- **Pre-push** (`test:coverage:merge:unit-only`): **50% lines**, **50% functions**, **45% branches**

Override thresholds for local experiments:

```bash
COVERAGE_LINES_THRESHOLD=50 npm run test:coverage:merge
```

## Anti-patterns

- Do not unit-test emulator-only repository paths when integration tests are appropriate
- Do not hand-roll Firestore logic inside `jest.mock()` factories
- Do not rely on shared collection names across test files
- Do not assert implementation details of internal private methods — test public contracts

## AI-assisted testing

Cursor rules and skills live under `.cursor/`:

- `rules/test-awareness.mdc` — suggests tests after code changes
- `rules/test-guardrails.mdc` — scoped guardrails for `src/tests/**`
- `skills/unit-testing/SKILL.md` — unit test patterns
- `skills/integration-testing/SKILL.md` — emulator integration patterns
- `commands/write-unit-tests.md` — diff-based test authoring workflow

## Related docs

- [test-coverage-followups.md](./test-coverage-followups.md) — backlog of future coverage work
