---
name: unit-testing
description: >-
  Write Jest unit tests for FlintFire pure logic, validation, error mapping, and
  mocked Firestore repository wiring. Use for src/utils, ErrorParser,
  ErrorHandler, Validation, and converter/schema unit tests. NOT for emulator
  integration tests — see integration-testing skill.
---
# Unit Testing (FlintFire)

## Scope

- Runner: **Jest** (`jest.config.unit.js`) — not Vitest
- Location: `src/tests/unit/**/*.unit.test.ts`
- No Firestore emulator — mock at boundaries
- Does **not** gate `FirestoreRepository`, `QueryBuilder`, or `CollectionGroup` coverage
  (integration-owned)

## Commands

- `npm run test:unit`
- `npm run test:unit:coverage`
- `npm run test:coverage:gate:unit` — enforces path thresholds for utils, errors, validation,
  exports
- `npm run test:watch`

## Coverage gates (unit-owned paths)

Pre-push and CI run `test:coverage:gate:unit` after unit coverage. Gates apply only to files this
suite is responsible for — not `FirestoreRepository`, `QueryBuilder`, or `CollectionGroup`
(integration-owned).

| Scope              | Paths                                                 | Thresholds (lines / branches / functions) |
| ------------------ | ----------------------------------------------------- | ----------------------------------------- |
| Pure utilities     | `src/utils/**`                                        | 95% / 90% / 90%                           |
| Error / validation | `Errors`, `ErrorParser`, `ErrorHandler`, `Validation` | 90% / 85% / 90%                           |
| Package exports    | `src/index.ts`                                        | 100% / 100% / 65%                         |

See `scripts/check-coverage-gates.mjs` and `docs/development/testing.md`.

## Workflow

1. Diff the current branch against its base and classify every changed production file before
   choosing a suite. Route `FirestoreRepository`, `QueryBuilder`, `CollectionGroup`, hooks,
   transactions, and other real-Firestore semantics to the `integration-testing` skill.
2. Read nearby tests and copy patterns.
3. Check `src/tests/shared/mocks/` and `src/tests/shared/factories/` before ad-hoc helpers.
4. Add a JSDoc header that explains the test strategy and verified behavior.
5. Mock with `jest.fn()` — never reimplement ORM/Firestore logic in mock factories.
6. Run `npm run test:unit` and `npm run test:coverage:gate:unit`.
7. If coverage infrastructure changed, run `npm run test:coverage:all` so both ownership gates are
   exercised.

## Key imports

```typescript
import { createMockFirestoreDb } from '../shared/mocks/firestore.mocks.js';
import { resetTestFactoryCounters } from '../shared/factories/counters.js';
```

## When to use integration instead

- `FirestoreRepository` write/read paths against real Firestore
- `QueryBuilder` pagination, aggregations, query delete
- Lifecycle hooks with real persistence
- Transaction commit/rollback behavior

See `.cursor/skills/integration-testing/SKILL.md`.
