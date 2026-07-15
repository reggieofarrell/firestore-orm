# Write Integration Tests

Analyze changed files on the current branch and write or update Jest integration tests against the
Firestore emulator. Proceed directly unless business behavior is ambiguous.

## When to use this command

Use for **`FirestoreRepository`**, **`QueryBuilder`**, hooks, transactions, sentinels, pagination,
subcollections, and any behavior that must be verified with **real Firestore semantics**.

Integration tests are the **primary safety net** for this database library. Do not substitute unit
mocks for emulator-backed repository or query behavior.

## Classify changes

| Path                                                                     | Action                                 |
| ------------------------------------------------------------------------ | -------------------------------------- |
| `src/core/FirestoreRepository.ts`, `QueryBuilder.ts`                     | Integration tests required             |
| Hook / transaction / batch / query behavior                              | Integration tests                      |
| `src/utils/**`, `ErrorParser`, `ErrorHandler`, `Validation` (pure paths) | Use write-unit-tests instead           |
| `src/tests/**`                                                           | Update existing tests only when needed |
| `docs/**`, config-only                                                   | Skip                                   |

## Skill

`.cursor/skills/integration-testing/SKILL.md`

## Steps

1. Diff changed files against base branch
2. Check for existing `*.integration.test.ts` nearby
3. Use `createUserRepoHarness()` — unique collection per suite
4. Use shared factories from `src/tests/shared/factories/` — no duplicate helpers
5. Add JSDoc header to new test files
6. Run `npm run test:integration:emulator`
7. Run `npm run test:integration:coverage` + `npm run test:coverage:gate:integration`
8. If coverage infrastructure changed, run `npm run test:coverage:all`

## Coverage gate (integration-owned)

| Scope                 | Files                    |
| --------------------- | ------------------------ |
| ORM core              | `FirestoreRepository.ts` |
| Query layer           | `QueryBuilder.ts`        |
| Validation (emulator) | `Validation.ts`          |

Merged LCOV is not gated. See `docs/development/testing.md`.
