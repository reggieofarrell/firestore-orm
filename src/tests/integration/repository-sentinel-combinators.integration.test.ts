/**
 * Strategy: end-to-end coverage of every per-field sentinel combinator through real emulator
 * writes under `sentinelPolicy: 'strict'`. Exercises number/increment/delete, array/arrayUnion/
 * arrayRemove/delete, Date/serverTimestamp, and withDelete, asserting the persisted results.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import {
  withDelete,
  zArrayWrite,
  zDateWrite,
  zNumberWrite,
  zSentinel,
} from '../../core/Validation.js';
import { getIntegrationDb } from './helpers/firestoreIntegrationHarness.js';

interface ComboDoc {
  id: string;
  count: number;
  tags: string[];
  when: number;
  note?: string;
}

const comboSchema = z.object({
  count: zNumberWrite({ allowDelete: true }), // number | increment | delete
  tags: zArrayWrite(z.string(), { allowDelete: true }), // string[] | arrayUnion | arrayRemove | delete
  when: zDateWrite({ allowDelete: true }), // Date | serverTimestamp | delete
  note: withDelete(z.string()).optional(), // string | delete
  marker: z.union([z.string(), zSentinel('serverTimestamp', 'delete')]).optional(),
});

const COLLECTION = `test_sentinel_combinators_${Date.now()}`;

describe('per-field sentinel combinators (emulator, strict)', () => {
  const db = getIntegrationDb();
  const repo = FirestoreRepository.withSchema(db, COLLECTION, comboSchema, {
    sentinelPolicy: 'strict',
  });

  afterAll(async () => {
    const docs = await repo.query().get();
    if (docs.length > 0) {
      await repo.bulkDelete(docs.map(doc => doc.id));
    }
  });

  it('accepts plain values on create and every approved sentinel kind on update', async () => {
    const created = await repo.create({
      count: 1,
      tags: ['a'],
      when: new Date('2021-01-01T00:00:00.000Z'),
      note: 'hi',
      marker: 'initial',
    } as unknown as ComboDoc);

    // increment (number field) + arrayUnion (array field)
    await repo.update(created.id, {
      count: FieldValue.increment(2) as unknown as number,
      tags: FieldValue.arrayUnion('b') as unknown as string[],
    });

    // arrayRemove (array field) + serverTimestamp (date field) + serverTimestamp on a zSentinel field
    await repo.update(created.id, {
      tags: FieldValue.arrayRemove('a') as unknown as string[],
      when: FieldValue.serverTimestamp() as unknown as number,
      marker: FieldValue.serverTimestamp() as unknown as string,
    });

    const midway = await repo.getById(created.id);
    expect(midway?.count).toBe(3);
    expect(midway?.tags).toEqual(['b']);

    // delete() on a number field (allowDelete), an array field (allowDelete), and a withDelete field
    await repo.update(created.id, {
      count: FieldValue.delete() as unknown as number,
      note: FieldValue.delete() as unknown as string,
      marker: FieldValue.delete() as unknown as string,
    });

    const final = await repo.getById(created.id);
    expect(final).not.toBeNull();
    expect(final?.count).toBeUndefined();
    expect(final?.note).toBeUndefined();
    expect(final?.tags).toEqual(['b']);
  });

  it('rejects a wrong-kind sentinel on each combinator field', async () => {
    const created = await repo.create({
      count: 5,
      tags: ['x'],
      when: new Date('2021-06-01T00:00:00.000Z'),
    } as unknown as ComboDoc);

    // arrayUnion is not valid for a number field
    await expect(
      repo.update(created.id, { count: FieldValue.arrayUnion('y') as unknown as number }),
    ).rejects.toThrow();

    // increment is not valid for an array field
    await expect(
      repo.update(created.id, { tags: FieldValue.increment(1) as unknown as string[] }),
    ).rejects.toThrow();

    // increment is not valid for a date field
    await expect(
      repo.update(created.id, { when: FieldValue.increment(1) as unknown as number }),
    ).rejects.toThrow();
  });
});
