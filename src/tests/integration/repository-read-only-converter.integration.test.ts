/**
 * Strategy: integration proof that repository converters are strictly READ-ONLY (issue #11).
 *
 * A `readConverter` is only the `fromFirestore` mapper — the library builds the full converter
 * internally and attaches it to the read ref alone, so writes go through a raw ref and no
 * `toFirestore` can ever run. The mapper here uppercases `name` on read, which lets us prove, against
 * the real Admin SDK across create / bulkCreate / upsert (create branch) / createInTransaction:
 *   1. the stored document is the RAW value (read back via a converter-free ref) — writes applied no
 *      transform;
 *   2. reading through the repository transforms it (`fromFirestore` ran) — the converter is applied
 *      on reads only.
 *
 * This locks in the v3 contract: converters affect reads only; write-time normalization belongs in a
 * `before*` hook.
 *
 * It also asserts the converter transform on the read paths whose wiring is distinct from `getById`:
 * the query builder (`query().get()` / `.stream()`, which feed `readCol()` into the QueryBuilder),
 * a transactional read (`getForUpdateInTransaction`), and delete-path hook payloads (`delete()` reads
 * via the converter-wrapped ref before firing the `beforeDelete` / `afterDelete` hooks).
 */
import { z } from 'zod';
import { FirestoreRepository, ReadConverter } from '../../core/FirestoreRepository.js';
import { getIntegrationDb } from './helpers/firestoreIntegrationHarness.js';

interface WidgetDoc {
  id: string;
  name: string;
  value: number;
}

const widgetSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  value: z.number(),
});

// readConverter is the fromFirestore half only; uppercasing `name` on read proves it ran.
const readConverter: ReadConverter<WidgetDoc> = snapshot => {
  const data = snapshot.data();
  return { ...data, name: String(data.name).toUpperCase() } as WidgetDoc;
};

const COLLECTION = `test_read_only_converter_${Date.now()}`;

describe('read-only converters: writes bypass the converter (issue #11)', () => {
  const db = getIntegrationDb();
  const repo = FirestoreRepository.withSchema(db, COLLECTION, widgetSchema, { readConverter });

  /** Read a document via a raw, converter-free ref to observe exactly what was stored. */
  async function rawName(id: string): Promise<unknown> {
    const snap = await db.collection(COLLECTION).doc(id).get();
    return (snap.data() as Record<string, unknown> | undefined)?.name;
  }

  afterAll(async () => {
    const docs = await repo.query().get();
    if (docs.length > 0) {
      await repo.bulkDelete(docs.map(doc => doc.id));
    }
  });

  it('create(): stores the raw value; the converter transforms only on read', async () => {
    const created = await repo.create({ name: 'alpha', value: 1 });
    // create() returns the validated write payload (not a read) → untransformed.
    expect(created.name).toBe('alpha');

    // Stored verbatim (no write-side transform).
    expect(await rawName(created.id)).toBe('alpha');

    // Repo read applies the converter's fromFirestore.
    const read = await repo.getById(created.id);
    expect(read?.name).toBe('ALPHA');
    expect(read?.value).toBe(1);
  });

  it('bulkCreate(): stores raw values; reads transform', async () => {
    const created = await repo.bulkCreate([
      { name: 'beta', value: 2 },
      { name: 'gamma', value: 3 },
    ]);

    expect(await rawName(created[0].id)).toBe('beta');
    const read = await repo.getById(created[0].id);
    expect(read?.name).toBe('BETA');
  });

  it('upsert() (create branch): stores raw; reads transform', async () => {
    const id = `upsert-${Date.now()}`;
    await repo.upsert(id, { name: 'delta', value: 4 });

    expect(await rawName(id)).toBe('delta');
    const read = await repo.getById(id);
    expect(read?.name).toBe('DELTA');
  });

  it('createInTransaction(): stores raw; reads transform', async () => {
    const created = await repo.runInTransaction(async (tx, txRepo) => {
      return await txRepo.createInTransaction(tx, { name: 'epsilon', value: 5 });
    });

    expect(await rawName(created.id)).toBe('epsilon');
    const read = await repo.getById(created.id);
    expect(read?.name).toBe('EPSILON');
  });

  it('query() read terminals apply the converter (get + stream share the query()->readCol wiring)', async () => {
    // Distinct wiring from getById: query() feeds readCol() into the QueryBuilder. Assert the
    // converter transform flows through both a terminal get() and the streaming path.
    await repo.bulkCreate([
      { name: 'qb-lo', value: 20 },
      { name: 'qb-hi', value: 21 },
    ]);

    const items = await repo.query().where('value', '>=', 20).orderBy('value', 'asc').get();
    expect(items.map(i => i.name)).toEqual(['QB-LO', 'QB-HI']);

    const streamed: string[] = [];
    for await (const doc of repo
      .query()
      .where('value', '>=', 20)
      .orderBy('value', 'asc')
      .stream()) {
      streamed.push(doc.name);
    }
    expect(streamed).toEqual(['QB-LO', 'QB-HI']);
  });

  it('getForUpdateInTransaction() applies the converter on a transactional read', async () => {
    const created = await repo.create({ name: 'zeta', value: 7 });

    const read = await repo.runInTransaction(async (tx, txRepo) => {
      return await txRepo.getForUpdateInTransaction(tx, created.id);
    });

    expect(read?.name).toBe('ZETA');
  });

  it('delete() hook payloads are converter-transformed (delete reads via the read ref)', async () => {
    const created = await repo.create({ name: 'omega', value: 8 });

    const seen: string[] = [];
    const hookRepo = FirestoreRepository.withSchema(db, COLLECTION, widgetSchema, {
      readConverter,
    });
    hookRepo.on('beforeDelete', doc => seen.push((doc as WidgetDoc).name));
    hookRepo.on('afterDelete', doc => seen.push((doc as WidgetDoc).name));

    await hookRepo.delete(created.id);

    // Both hooks receive the fromFirestore-transformed document (delete reads via readCol()).
    expect(seen).toEqual(['OMEGA', 'OMEGA']);
  });
});
