/**
 * Strategy: runtime coverage for the curried `withSchema<Read>()(...)` form, whose write-input
 * types are inferred from the write schema. Combinator fields accept their native values /
 * sentinels with no cast, `create` needs no `id`, and these round-trip through the emulator on the
 * create, update, and query().update() paths. Under `sentinelPolicy: 'strict'`, a value the schema
 * forbids is rejected at runtime.
 *
 * The *compile-time* guarantees (cast-free writes type-check; wrong values are type errors) are
 * asserted separately in `src/tests/types/write-types.type-test.ts`, checked by `npm run test:types`
 * — the jest suites run ts-jest with `isolatedModules` and do not type-check.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import { ValidationError } from '../../core/Errors.js';
import { zNumberWrite, zArrayWrite, zDateWrite } from '../../core/Validation.js';
import { getIntegrationDb } from './helpers/firestoreIntegrationHarness.js';

// Base schema = the read shape. Its z.infer type is clean (no sentinels, no firebase-admin).
const eventBase = z.object({
  id: z.string(),
  name: z.string().min(1),
  score: z.number(),
  tags: z.array(z.string()),
  happenedAt: z.number(), // ms since epoch on read
});
type EventDoc = z.infer<typeof eventBase>;

// Write overlay: combinators widen only write-time validation.
const eventWrite = eventBase.extend({
  score: zNumberWrite(), // number | increment
  tags: zArrayWrite(z.string()), // string[] | arrayUnion | arrayRemove
  happenedAt: zDateWrite(), // Date | serverTimestamp()
});

const COLLECTION = `test_inferred_write_types_${Date.now()}`;

describe('curried withSchema infers write-input types from the write schema', () => {
  const db = getIntegrationDb();
  // Read type stays the plain `EventDoc`; write type is inferred from `eventWrite`.
  const repo = FirestoreRepository.withSchema<EventDoc>()(db, COLLECTION, eventWrite, undefined, {
    sentinelPolicy: 'strict',
  });

  afterAll(async () => {
    const docs = await repo.query().get();
    if (docs.length > 0) {
      await repo.bulkDelete(docs.map(doc => doc.id));
    }
  });

  it('creates without an id and with a native Date — no casts', async () => {
    const created = await repo.create({
      name: 'launch',
      score: 5,
      tags: ['a'],
      happenedAt: new Date('2020-01-02T03:04:05.000Z'),
    });

    expect(created.id).toEqual(expect.any(String));

    const persisted = await repo.getById(created.id);
    expect(persisted?.score).toBe(5);
    expect(persisted?.tags).toEqual(['a']);
  });

  it('updates with increment / arrayUnion / serverTimestamp — no casts', async () => {
    const created = await repo.create({
      name: 'counter',
      score: 5,
      tags: ['a'],
      happenedAt: new Date('2020-01-02T03:04:05.000Z'),
    });

    await repo.update(created.id, {
      score: FieldValue.increment(3),
      tags: FieldValue.arrayUnion('b'),
      happenedAt: FieldValue.serverTimestamp(),
    });

    const persisted = await repo.getById(created.id);
    expect(persisted?.score).toBe(8);
    expect(persisted?.tags).toEqual(['a', 'b']);
  });

  it('bulk-updates a combinator field via query() — no cast', async () => {
    const created = await repo.create({
      name: 'bulk',
      score: 1,
      tags: [],
      happenedAt: new Date('2020-01-02T03:04:05.000Z'),
    });

    const count = await repo
      .query()
      .where('name', '==', 'bulk')
      .update({ score: FieldValue.increment(10) });

    expect(count).toBeGreaterThanOrEqual(1);
    const persisted = await repo.getById(created.id);
    expect(persisted?.score).toBe(11);
  });

  it('rejects a value the schema forbids at runtime under strict', async () => {
    const created = await repo.create({
      name: 'reject',
      score: 1,
      tags: [],
      happenedAt: new Date('2020-01-02T03:04:05.000Z'),
    });

    await expect(
      // A raw number is not a valid zDateWrite() value; strict rejects it at runtime.
      repo.update(created.id, { happenedAt: 123 as unknown as Date }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
