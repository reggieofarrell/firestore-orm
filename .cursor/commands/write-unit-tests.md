# Write Unit Tests

Analyze changed files on the current branch and write or update Jest tests. Proceed directly unless
business behavior is ambiguous.

## Classify changes

| Path                                                          | Test type                              |
| ------------------------------------------------------------- | -------------------------------------- |
| `src/utils/**`                                                | Unit                                   |
| `src/core/ErrorParser.ts`, `ErrorHandler.ts`, `Validation.ts` | Unit                                   |
| `src/core/FirestoreRepository.ts`, `QueryBuilder.ts`          | Integration (emulator)                 |
| `src/tests/**`                                                | Update existing tests only when needed |
| `docs/**`, config-only                                        | Skip                                   |

## Skills

- Unit → `.cursor/skills/unit-testing/SKILL.md`
- Integration → `.cursor/skills/integration-testing/SKILL.md`

## Steps

1. Diff changed files against base branch
2. Check for existing `*.unit.test.ts` or `*.integration.test.ts` nearby
3. Use shared factories/mocks — no duplicate helpers
4. Add JSDoc header to new test files
5. Run `npm run test:unit` or `npm run test:integration:emulator`
6. If coverage infrastructure changed, run `npm run test:coverage:all`
