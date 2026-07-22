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

  describe('delete sentinel rejected on create paths (B8, ADR-0019)', () => {
    // Every field below permits FieldValue.delete() at the schema level (withDelete / allowDelete),
    // so validation itself passes. B8's guarantee is that a create/set path must STILL reject the
    // delete sentinel before any I/O, because Firestore only honors delete on update-like writes.
    const deleteMessage = /delete\(\) is not valid on create\/set/;

    const withDeleteNote = () =>
      ({
        count: 1,
        tags: ['a'],
        when: new Date('2022-01-01T00:00:00.000Z'),
        note: FieldValue.delete() as unknown as string,
      }) as unknown as ComboDoc;

    it('rejects delete() on create() even though the field schema allows delete', async () => {
      await expect(repo.create(withDeleteNote())).rejects.toThrow(deleteMessage);
    });

    it('rejects delete() on bulkCreate()', async () => {
      await expect(repo.bulkCreate([withDeleteNote()])).rejects.toThrow(deleteMessage);
    });

    it('rejects delete() on createInTransaction()', async () => {
      await expect(
        repo.runInTransaction(async (tx, txRepo) =>
          txRepo.createInTransaction(tx, withDeleteNote()),
        ),
      ).rejects.toThrow(deleteMessage);
    });

    it('rejects delete() on upsert() for a document that does NOT exist', async () => {
      await expect(repo.upsert(`b8-upsert-new-${Date.now()}`, withDeleteNote())).rejects.toThrow(
        deleteMessage,
      );
    });

    it('rejects delete() on upsert() for a document that DOES exist (deterministic)', async () => {
      // The core ADR-0019 determinism guarantee: upsert rejects the delete sentinel up front,
      // regardless of document existence. Otherwise the same input succeeds on the update branch and
      // fails on the create branch depending purely on whether the doc happens to exist.
      const existing = await repo.create({
        count: 1,
        tags: ['a'],
        when: new Date('2022-01-01T00:00:00.000Z'),
      } as unknown as ComboDoc);

      await expect(repo.upsert(existing.id, withDeleteNote())).rejects.toThrow(deleteMessage);
    });

    it('still accepts non-delete sentinels (increment / arrayUnion / serverTimestamp) on create()', async () => {
      // Guards against over-rejection: Firestore accepts these sentinels on set/create, so B8 must
      // let them through.
      const created = await repo.create({
        count: FieldValue.increment(2) as unknown as number,
        tags: FieldValue.arrayUnion('a', 'b') as unknown as string[],
        when: FieldValue.serverTimestamp() as unknown as number,
      } as unknown as ComboDoc);

      const stored = await repo.getById(created.id);
      expect(stored).not.toBeNull();
      expect(stored?.count).toBe(2);
      expect(stored?.tags).toEqual(['a', 'b']);
    });
  });
});

describe('delete sentinels introduced during parsing are rejected (T1, ADR-0019)', () => {
  const db = getIntegrationDb();
  const deleteMessage = /delete\(\) is not valid on create\/set\/upsert/;

  // `note` transforms to FieldValue.delete() during parsing, so the delete lands in the PARSED
  // OUTPUT and never appears in the raw caller input. The guard must scan the output on every create
  // path and on both upsert branches. `note` is optional so a note-less document can be seeded.
  const transformSchema = z.object({
    name: z.string(),
    note: z
      .string()
      .transform(() => FieldValue.delete() as unknown as string)
      .optional(),
  });

  const makeTransformRepo = () =>
    FirestoreRepository.withSchema(
      db,
      `test_t1_transform_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      transformSchema,
    );

  it('create() rejects a transform-produced delete and writes nothing', async () => {
    const repo = makeTransformRepo();
    await expect(repo.create({ name: 'c', note: 'x' } as never)).rejects.toThrow(deleteMessage);
    expect(await repo.query().get()).toHaveLength(0);
  });

  it('bulkCreate() rejects a transform-produced delete and writes nothing', async () => {
    const repo = makeTransformRepo();
    await expect(repo.bulkCreate([{ name: 'b', note: 'x' }] as never[])).rejects.toThrow(
      deleteMessage,
    );
    expect(await repo.query().get()).toHaveLength(0);
  });

  it('createInTransaction() rejects a transform-produced delete and writes nothing', async () => {
    const repo = makeTransformRepo();
    await expect(
      repo.runInTransaction(async (tx, txRepo) =>
        txRepo.createInTransaction(tx, { name: 't', note: 'x' } as never),
      ),
    ).rejects.toThrow(deleteMessage);
    expect(await repo.query().get()).toHaveLength(0);
  });

  it('upsert() rejects a transform-produced delete for a MISSING document (create branch)', async () => {
    const repo = makeTransformRepo();
    const id = `t1-missing-${Date.now()}`;
    await expect(repo.upsert(id, { name: 'new', note: 'x' } as never)).rejects.toThrow(
      deleteMessage,
    );
    expect(await repo.getById(id)).toBeNull();
  });

  it('upsert() rejects a transform-produced delete for an EXISTING document (update branch)', async () => {
    // The core existence-independence guarantee: the same delete-producing input is rejected whether
    // or not the document exists. A note-less seed is valid (no transform runs).
    const repo = makeTransformRepo();
    const seeded = await repo.create({ name: 'seed' } as never);

    await expect(repo.upsert(seeded.id, { name: 'seed', note: 'x' } as never)).rejects.toThrow(
      deleteMessage,
    );

    // The existing document is untouched — no field was cleared.
    const after = await repo.getById(seeded.id);
    expect(after?.name).toBe('seed');
  });

  it('create() rejects a delete injected by a schema default and writes nothing', async () => {
    const defaultSchema = z.object({
      name: z.string(),
      cleared: z.custom<unknown>(() => true).default(() => FieldValue.delete()),
    });
    const repo = FirestoreRepository.withSchema(
      db,
      `test_t1_default_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      defaultSchema,
    );

    await expect(repo.create({ name: 'c' } as never)).rejects.toThrow(deleteMessage);
    expect(await repo.query().get()).toHaveLength(0);
  });
});
