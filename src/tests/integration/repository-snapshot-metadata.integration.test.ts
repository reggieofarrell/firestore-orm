/**
 * Strategy: emulator integration coverage for opt-in `{ withMetadata: true }` on repository reads
 * and the QueryBuilder `paginateWithCount` forwarding path (issue #39, ADR-0033).
 *
 * Verification points (plan §8 I-1):
 *  - Wrapper `doc` deep-equals the bare read; metadata path/parentPath/ref agree with the collection
 *  - createTime / updateTime / readTime are Timestamps; createTime stable across update (T1 / P1k)
 *  - Missing id → null (never a metadata object with undefined times) (T1)
 *  - getByIdOrThrow forwards options (T5); getMany preserves null positions (T1)
 *  - getMany fieldMask+withMetadata cell returns projected doc + populated metadata (T3)
 *  - getManyInTransaction still returns bare documents (T7)
 *  - getAll / findByField / getOneByField / getOneByFieldOrThrow wrappers wired
 *  - Default (no-options) calls keep the legacy unwrapped shape (acceptance)
 *  - readConverter still applies to `doc` under withMetadata
 *  - paginateWithCount forwards the third arg so items[0].metadata.readTime is defined (T4)
 */
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { FirestoreRepository, type ReadConverter } from '../../core/FirestoreRepository.js';
import { NotFoundError } from '../../core/Errors.js';
import { createUserRepoHarness, getIntegrationDb } from './helpers/firestoreIntegrationHarness.js';

describe('repository snapshot metadata (issue #39)', () => {
  const harness = createUserRepoHarness('test_users_snapshot_metadata');
  const { userRepo, trackUser, cleanupTrackedUsers, cleanupCollection, db } = harness;
  const collectionPath = userRepo.getCollectionPath();

  afterEach(async () => {
    await cleanupTrackedUsers();
  });

  afterAll(async () => {
    await cleanupCollection();
  });

  it('I-1#1–4: getById withMetadata wraps doc and populates Timestamp metadata', async () => {
    const created = await userRepo.create({ name: 'Meta User', email: 'meta@example.com' });
    trackUser(created.id);

    const plain = await userRepo.getById(created.id);
    const wrapped = await userRepo.getById(created.id, { withMetadata: true });

    expect(wrapped).not.toBeNull();
    expect(wrapped!.doc).toEqual(plain);
    expect(wrapped!.metadata.path).toBe(`${collectionPath}/${created.id}`);
    expect(wrapped!.metadata.parentPath).toBe(collectionPath);
    expect(wrapped!.metadata.ref.path).toBe(wrapped!.metadata.path);
    expect(wrapped!.metadata.createTime).toBeInstanceOf(Timestamp);
    expect(wrapped!.metadata.updateTime).toBeInstanceOf(Timestamp);
    expect(wrapped!.metadata.readTime).toBeInstanceOf(Timestamp);

    const createTimeBefore = wrapped!.metadata.createTime;
    const updateTimeBefore = wrapped!.metadata.updateTime;

    // Emulator timestamps are millisecond-resolution; brief pause so updateTime can advance.
    await new Promise(resolve => setTimeout(resolve, 50));
    await userRepo.update(created.id, { name: 'Meta User Updated' });

    const afterUpdate = await userRepo.getById(created.id, { withMetadata: true });
    expect(afterUpdate!.metadata.createTime.isEqual(createTimeBefore)).toBe(true);
    expect(afterUpdate!.metadata.updateTime.toMillis()).toBeGreaterThan(
      updateTimeBefore.toMillis(),
    );
  });

  it('I-1#5: getById missing id withMetadata returns null', async () => {
    const missing = await userRepo.getById('definitely-missing-meta-id', { withMetadata: true });
    expect(missing).toBeNull();
  });

  it('I-1#6: getByIdOrThrow forwards options (T5)', async () => {
    const created = await userRepo.create({ name: 'OrThrow Meta' });
    trackUser(created.id);

    const wrapped = await userRepo.getByIdOrThrow(created.id, { withMetadata: true });
    expect(wrapped.metadata.updateTime).toBeInstanceOf(Timestamp);
    expect(wrapped.doc.name).toBe('OrThrow Meta');

    await expect(
      userRepo.getByIdOrThrow('missing-orthrow-meta', { withMetadata: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('I-1#7–8: getMany withMetadata preserves nulls and fieldMask cell (T1/T3)', async () => {
    const a = await userRepo.create({ name: 'Many A', email: 'a@example.com' });
    const b = await userRepo.create({ name: 'Many B', email: 'b@example.com' });
    trackUser(a.id);
    trackUser(b.id);

    const rows = await userRepo.getMany([a.id, 'ghost-meta-id', b.id], { withMetadata: true });
    expect(rows).toHaveLength(3);
    expect(rows[0]).not.toBeNull();
    expect(rows[0]!.doc.name).toBe('Many A');
    expect(rows[0]!.metadata.createTime).toBeInstanceOf(Timestamp);
    expect(rows[1]).toBeNull();
    expect(rows[2]).not.toBeNull();
    expect(rows[2]!.doc.name).toBe('Many B');

    const masked = await userRepo.getMany([a.id], {
      fieldMask: ['name'],
      withMetadata: true,
    });
    expect(masked[0]).not.toBeNull();
    expect(masked[0]!.doc.name).toBe('Many A');
    expect(masked[0]!.doc.id).toBe(a.id);
    // Field mask omitted email — must not be present on the projected doc.
    expect((masked[0]!.doc as { email?: string }).email).toBeUndefined();
    expect(masked[0]!.metadata.createTime).toBeInstanceOf(Timestamp);
  });

  it('I-1#9: getManyInTransaction still returns bare documents (T7)', async () => {
    const a = await userRepo.create({ name: 'Tx Many Meta' });
    trackUser(a.id);

    const rows = await userRepo.runInTransaction(async (tx, r) =>
      r.getManyInTransaction(tx, [a.id]),
    );

    expect(rows[0]).not.toBeNull();
    expect(rows[0]!.name).toBe('Tx Many Meta');
    // Shape must stay bare — a flagged shared mapper would put the document under `.doc`.
    expect((rows[0] as { doc?: unknown }).doc).toBeUndefined();
  });

  it('I-1#10–11: getAll / findByField / getOneByField* wrappers and legacy defaults', async () => {
    const created = await userRepo.create({ name: 'Field Meta', email: 'field-meta@example.com' });
    trackUser(created.id);

    const allWrapped = await userRepo.getAll({ withMetadata: true });
    const match = allWrapped.find(row => row.doc.id === created.id);
    expect(match).toBeDefined();
    expect(match!.metadata.readTime).toBeInstanceOf(Timestamp);

    const found = await userRepo.findByField('email', 'field-meta@example.com', {
      withMetadata: true,
    });
    expect(found).toHaveLength(1);
    expect(found[0].doc.id).toBe(created.id);
    expect(found[0].metadata.createTime).toBeInstanceOf(Timestamp);

    const one = await userRepo.getOneByField('email', 'field-meta@example.com', {
      withMetadata: true,
    });
    expect(one).not.toBeNull();
    expect(one!.metadata.updateTime).toBeInstanceOf(Timestamp);

    const oneOrThrow = await userRepo.getOneByFieldOrThrow('email', 'field-meta@example.com', {
      withMetadata: true,
    });
    expect(oneOrThrow.metadata.path).toBe(`${collectionPath}/${created.id}`);

    // Legacy defaults stay unwrapped (acceptance / I-1#11).
    const bareAll = await userRepo.getAll();
    expect(bareAll.find(u => u.id === created.id)?.name).toBe('Field Meta');
    expect((bareAll.find(u => u.id === created.id) as { doc?: unknown }).doc).toBeUndefined();

    const bareGet = await userRepo.getById(created.id);
    expect(bareGet?.name).toBe('Field Meta');
    expect((bareGet as { doc?: unknown } | null)?.doc).toBeUndefined();

    const bareFind = await userRepo.findByField('email', 'field-meta@example.com');
    expect(bareFind[0]?.name).toBe('Field Meta');
    expect((bareFind[0] as { doc?: unknown }).doc).toBeUndefined();

    const bareOne = await userRepo.getOneByField('email', 'field-meta@example.com');
    expect(bareOne?.name).toBe('Field Meta');
    expect((bareOne as { doc?: unknown } | null)?.doc).toBeUndefined();

    const bareOneOrThrow = await userRepo.getOneByFieldOrThrow('email', 'field-meta@example.com');
    expect(bareOneOrThrow.name).toBe('Field Meta');
    expect((bareOneOrThrow as { doc?: unknown }).doc).toBeUndefined();
  });

  it('I-1#12: readConverter still applies under withMetadata', async () => {
    const integrationDb = getIntegrationDb();
    const schema = z.object({ name: z.string(), value: z.number() });
    type Widget = z.infer<typeof schema>;
    const readConverter: ReadConverter<Widget & { id: string }> = snapshot => {
      const data = snapshot.data() as Widget;
      return { ...data, name: String(data.name).toUpperCase() } as Widget & { id: string };
    };
    const col = `test_meta_converter_${Date.now()}`;
    const repo = FirestoreRepository.withSchema(integrationDb, col, schema, {
      readConverter,
      // Converter only uppercases name — at-rest shape equals the read schema (ADR-0018 / A3).
      storedSchema: schema,
    });

    const created = await repo.create({ name: 'widget', value: 1 });
    const wrapped = await repo.getById(created.id, { withMetadata: true });
    expect(wrapped!.doc.name).toBe('WIDGET');
    expect(wrapped!.metadata.createTime).toBeInstanceOf(Timestamp);

    await integrationDb.recursiveDelete(integrationDb.collection(col));
    void db;
  });

  it('I-1#13: paginateWithCount forwards withMetadata to paginate (T4)', async () => {
    const a = await userRepo.create({ name: 'Page Meta A' });
    const b = await userRepo.create({ name: 'Page Meta B' });
    const c = await userRepo.create({ name: 'Page Meta C' });
    trackUser(a.id);
    trackUser(b.id);
    trackUser(c.id);

    const page = await userRepo
      .query()
      .orderBy('name')
      .paginateWithCount(2, null, { withMetadata: true });

    expect(page.total).toBeGreaterThanOrEqual(3);
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items[0].metadata.readTime).toBeInstanceOf(Timestamp);
    expect(typeof page.items[0].doc.name).toBe('string');

    // getOne uses toResultWithMetadata directly (not mapDocs) — pin that branch too (F5).
    const one = await userRepo
      .query()
      .where('name', '==', 'Page Meta A')
      .getOne({ withMetadata: true });
    expect(one).not.toBeNull();
    expect(one!.doc.name).toBe('Page Meta A');
    expect(one!.metadata.readTime).toBeInstanceOf(Timestamp);
  });
});
