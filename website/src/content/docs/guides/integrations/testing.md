---
title: 'Testing with the Emulator'
description:
  'Test repositories against the local Firestore emulator — point the Admin SDK at it, run under
  emulators:exec, and isolate data between tests.'
---

Because FirestoreORM is built on the Firebase Admin SDK, you test it the same way you test any Admin
SDK code: against the **local Firestore emulator**. The emulator is fast, free, requires no real
credentials, and gives each test run a clean, disposable database.

## Point the Admin SDK at the emulator

The Admin SDK connects to the emulator automatically when `FIRESTORE_EMULATOR_HOST` is set. Combine
that with a **`demo-`-prefixed project id** — Firebase treats `demo-*` projects as emulator-only, so
no service-account credentials are needed:

```typescript
// test/firebase.ts
import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';

const app = getApps().length ? getApp() : initializeApp({ projectId: 'demo-test' });
export const db = getFirestore(app);
```

Construct repositories against this `db` exactly as in production — the connection to the emulator
is transparent.

## Run tests under the emulator

Wrap your test command with `firebase emulators:exec` so the emulator is started, your tests run
against it, and it shuts down afterward:

```json
{
  "scripts": {
    "test": "firebase emulators:exec --project demo-test --only firestore \"jest\""
  }
}
```

## Isolate data between tests

The emulator persists data for the life of the process, so keep tests independent. Two effective
patterns:

- **Unique collection per test** — suffix the collection name with a timestamp/random token so
  suites never collide.
- **Clean up what you wrote** — track created ids and `bulkDelete` them in `afterEach`, or clear the
  whole collection in `afterAll` as a safety net.

```typescript
import { FirestoreRepository } from '@reggieofarrell/firestore-orm';
import { db } from './firebase';
import { userSchema, type User } from '../src/schemas/user.schema';

describe('userRepo', () => {
  // Unique collection name isolates this suite from others in the same emulator.
  const repo = FirestoreRepository.withSchema(db, `users_${Date.now()}`, userSchema);
  const created: string[] = [];

  afterEach(async () => {
    if (created.length) {
      await repo.bulkDelete(created);
      created.length = 0;
    }
  });

  it('creates and reads a user', async () => {
    const { id } = await repo.create({ name: 'Ada', email: 'ada@example.com' });
    created.push(id);

    const user = await repo.getByIdOrThrow(id);
    expect(user.name).toBe('Ada');
    expect(user.id).toBe(id); // id is overlaid from the document name
  });
});
```

## Tips

- **Validation is real in tests.** A `withSchema` repository validates every write, so tests catch
  schema violations exactly as production would — assert on the thrown `ValidationError` where you
  expect one.
- **Hooks fire in tests.** Register a `before*` / `after*` hook and assert its effects; inside a
  transaction only `before*` hooks run (see
  [Lifecycle hooks](/firestore-orm/guides/concepts/lifecycle-hooks/)).
- **Prefer integration tests for repository behavior.** Reads, writes, batching, transactions, and
  hooks are best exercised against the emulator rather than mocked — the emulator reproduces
  Firestore's real semantics (index errors, batch limits, aggregation nulls).

See [CRUD Operations](/firestore-orm/guides/working-with-data/crud-operations/) and
[FirestoreRepository](/firestore-orm/reference/repository/) for the surface under test.
