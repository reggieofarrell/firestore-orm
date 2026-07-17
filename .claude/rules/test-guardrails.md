---
description: Critical guardrails for firestore-orm test files
paths:
  - 'src/tests/**/*.test.ts'
---

<!-- Body inlined from .cursor/rules/test-guardrails.mdc (Cursor's copy uses `globs:`).
     Claude Code does not expand @import inside rule files, so the body is duplicated here —
     keep the two copies in sync when editing. -->

# Test Guardrails

- Mock at the **Firestore boundary** — use `createMockFirestoreDb()` from
  `src/tests/shared/mocks/firestore.mocks.ts` for unit tests
- Mock factories hold **`jest.fn()` spies** — never reimplement Firestore or ORM logic inside
  `jest.mock()` factories
- Import factories from **specific module paths** (no barrel re-exports):
  - `src/tests/shared/factories/user.factory.ts` — `createTestUserInput`, `createTestUser`
  - `src/tests/shared/factories/hookValidatedUser.factory.ts` — `createHookValidatedUserInput`
  - `src/tests/shared/factories/counters.ts` — `resetTestFactoryCounters`
- Use `createUserRepoHarness()` from `src/tests/integration/helpers/firestoreIntegrationHarness.ts`
  for emulator integration tests
- Call `resetTestFactoryCounters()` in `beforeEach` when factory ID order must be deterministic
- Add a **JSDoc header** to new test files describing strategy and verification points
- Prefer **behavior-focused** assertions on public API contracts, not private implementation details
- **Unit tests** for pure logic; **integration tests** for emulator-dependent repository/query
  behavior
- **Integration is the primary ORM safety net** — never treat unit mocks as sufficient for
  repository/query changes
- Each suite has **path-specific coverage gates** — see `scripts/check-coverage-gates.mjs` and
  `docs/development/testing.md`. Do not rely on merged LCOV or global suite % as a safety metric.
