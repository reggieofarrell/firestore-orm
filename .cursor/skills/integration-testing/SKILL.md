---
name: integration-testing
description:
  Write Jest integration tests against the Firestore emulator for firestore-orm repository and query
  builder behavior. Use for CRUD, hooks, transactions, sentinels, pagination, and subcollections.
  NOT for pure utils — see unit-testing skill.
---

# Integration Testing (firestore-orm)

## Scope

- Runner: **Jest** with `jest.config.integration.js`
- Location: `src/tests/integration/**/*.integration.test.ts`
- Requires Firestore emulator (Java)

## Commands

- `npm run test:integration:emulator` (recommended)
- `npm run test:integration` (emulator already running)
- `npm run test:integration:coverage`

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

- Unique collection per suite (harness handles via timestamped names)
- JSDoc file header with strategy
- Assert public contracts and hook payloads
- `after*` hooks do **not** run for `*InTransaction` helpers — test that explicitly when relevant

## Full guide

See `docs/development/testing.md`.
