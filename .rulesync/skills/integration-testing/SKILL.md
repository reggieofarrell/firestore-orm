---
name: integration-testing
description: Write Jest integration tests against the Firestore emulator for FlintFire repository and query builder behavior. Use for CRUD, hooks, transactions, sentinels, pagination, and subcollections. NOT for pure utils — see unit-testing skill.
targets:
  - '*'
---
# Integration Testing (FlintFire)

## Scope

- Runner: **Jest** (`jest.config.integration.js`) — not Vitest
- Location: `src/tests/integration/**/*.integration.test.ts`
- Requires Firestore emulator (Java)
- **Primary ORM safety net** — real Firestore semantics for repository and query behavior

## Commands

- `npm run test:integration:emulator` (recommended)
- `npm run test:integration` (emulator already running)
- `npm run test:integration:coverage`
- `npm run test:coverage:gate:integration` — enforces ORM core thresholds on emulator report

## Coverage gates (integration-owned paths)

CI runs `test:coverage:gate:integration` after integration coverage. These gates protect the
emulator-backed ORM surface — the primary safety net for database behavior.

| Scope                 | Paths                    | Thresholds (lines / branches / functions) |
| --------------------- | ------------------------ | ----------------------------------------- |
| ORM core              | `FirestoreRepository.ts` | 90% / 75% / 85%                           |
| Query layer           | `QueryBuilder.ts`        | 90% / 75% / 95%                           |
| Collection groups     | `CollectionGroup.ts`     | 90% / 75% / 95%                           |
| Validation (emulator) | `Validation.ts`          | 90% / 80% / 95%                           |

Merged LCOV is **not** gated — it inflates confidence. See `scripts/check-coverage-gates.mjs`.

## Harness

```typescript
import { createUserRepoHarness } from './helpers/firestoreIntegrationHarness.js';

const harness = createUserRepoHarness('unique_suite_prefix');
const { userRepo, trackUser, cleanupTrackedUsers, cleanupCollection } = harness;

afterEach(() => cleanupTrackedUsers());
afterAll(() => cleanupCollection());
```

## Factories

```typescript
import { createTestUserInput } from '../shared/factories/user.factory.js';
import { resetTestFactoryCounters } from '../shared/factories/counters.js';

beforeEach(() => resetTestFactoryCounters());
const user = await userRepo.create(createTestUserInput({ name: 'Example' }));
trackUser(user.id);
```

## Conventions

- Start by diffing the current branch against its base and locate existing
  `*.integration.test.ts` coverage near every changed repository/query behavior.
- Unique collection per suite (harness handles via timestamped names)
- JSDoc file header with strategy
- Assert public contracts and hook payloads
- `after*` hooks do **not** run for `*InTransaction` helpers — test that explicitly when relevant

After writing or updating coverage, run `npm run test:integration:emulator`,
`npm run test:integration:coverage`, and `npm run test:coverage:gate:integration`. If coverage
infrastructure changed, also run `npm run test:coverage:all` so both suite-owned ratchets execute.

## Full guide

See `docs/development/testing.md`.
