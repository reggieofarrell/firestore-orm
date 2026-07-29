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
 * a transactional read (`getInTransaction`), and delete-path hook payloads (`delete()` reads
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
  // A readConverter is present, so storedSchema is required (ADR-0018 / A3). This converter only
  // uppercases `name` on read — it does not restructure fields — so the at-rest shape equals the
  // read schema.
  const repo = FirestoreRepository.withSchema(db, COLLECTION, widgetSchema, {
    readConverter,
    storedSchema: widgetSchema,
  });

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

  it('create(): returns { id } by default and stores the raw value (converter runs only on read)', async () => {
    const result = await repo.create({ name: 'alpha', value: 1 });
    // Default contract: create() returns only { id } (no implicit read-back).
    expect(Object.keys(result)).toEqual(['id']);

    // Stored verbatim (no write-side transform).
    expect(await rawName(result.id)).toBe('alpha');

    // Repo read applies the converter's fromFirestore.
    const read = await repo.getById(result.id);
    expect(read?.name).toBe('ALPHA');
    expect(read?.value).toBe(1);
  });

  it('create(returnDoc): reads the created document back through the converter', async () => {
    // returnDoc re-reads via readCol(), so the returned value is the CONVERTED read model.
    const created = await repo.create({ name: 'delta', value: 9 }, { returnDoc: true });
    expect(created.name).toBe('DELTA');
    expect(created.value).toBe(9);
    // ...while the stored value stays raw.
    expect(await rawName(created.id)).toBe('delta');
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

  it('distinctValues() reads the read model consistently with its type (review A9)', async () => {
    // A9: distinctValues() is typed and executed against the READ model. With a value-transforming
    // converter (uppercasing `name`), the returned distinct values are the CONVERTED read values —
    // never an empty array from reading a field that the converter renamed away. `value` is untouched
    // by the converter and returns its raw distinct set.
    await repo.bulkCreate([
      { name: 'dup', value: 100 },
      { name: 'dup', value: 100 },
      { name: 'uniq', value: 101 },
    ]);

    const names = await repo.query().where('value', '>=', 100).distinctValues('name');
    expect([...names].sort()).toEqual(['DUP', 'UNIQ']);

    const values = await repo.query().where('value', '>=', 100).distinctValues('value');
    expect([...values].sort((a, b) => a - b)).toEqual([100, 101]);
  });

  it('I-6a: distinctValues merges equal Dates from a readConverter (issue #40 / D4)', async () => {
    // A readConverter that returns a Date for `when`: two documents with the same instant must
    // collapse to one — the Date special case in the canonicalizer (D4).
    const dateSchema = z.object({
      label: z.string(),
      whenMs: z.number(),
    });
    type DateDoc = { id: string; label: string; when: Date };
    const dateConverter: ReadConverter<DateDoc> = snapshot => {
      const data = snapshot.data() as { label: string; whenMs: number };
      return { label: data.label, when: new Date(data.whenMs) } as DateDoc;
    };
    const dateCol = `test_read_only_converter_date_${Date.now()}`;
    const dateRepo = FirestoreRepository.withSchema(db, dateCol, dateSchema, {
      readConverter: dateConverter,
      storedSchema: dateSchema,
    });

    await dateRepo.bulkCreate([
      { label: 'a', whenMs: 1_700_000_000_000 },
      { label: 'b', whenMs: 1_700_000_000_000 },
    ]);

    expect(await dateRepo.query().distinctValues('when' as any)).toHaveLength(1);

    const docs = await dateRepo.query().get();
    if (docs.length > 0) {
      await dateRepo.bulkDelete(docs.map(doc => doc.id));
    }
  });

  it('I-6b: distinctValues keeps custom-class converter output distinct by identity (issue #40 / T2)', async () => {
    // A converter returning a custom class instance: two structurally equal instances must stay
    // distinct (identity fallback — never over-merge unrecognized types).
    class Box {
      constructor(readonly n: number) {}
    }
    const boxSchema = z.object({
      label: z.string(),
      n: z.number(),
    });
    type BoxDoc = { id: string; label: string; box: Box };
    const boxConverter: ReadConverter<BoxDoc> = snapshot => {
      const data = snapshot.data() as { label: string; n: number };
      return { label: data.label, box: new Box(data.n) } as BoxDoc;
    };
    const boxCol = `test_read_only_converter_box_${Date.now()}`;
    const boxRepo = FirestoreRepository.withSchema(db, boxCol, boxSchema, {
      readConverter: boxConverter,
      storedSchema: boxSchema,
    });

    await boxRepo.bulkCreate([
      { label: 'a', n: 1 },
      { label: 'b', n: 1 },
    ]);

    expect(await boxRepo.query().distinctValues('box' as any)).toHaveLength(2);

    const docs = await boxRepo.query().get();
    if (docs.length > 0) {
      await boxRepo.bulkDelete(docs.map(doc => doc.id));
    }
  });

  it('I-6c: distinctValues does not throw on cyclic readConverter output (issue #40 / T7)', async () => {
    // §8.5 requires T7 on the converter read path: cyclic converter output must terminate on a
    // marker (merge), never crash the read terminal with RangeError.
    const cycleSchema = z.object({
      label: z.string(),
      n: z.number(),
    });
    type CycleDoc = { id: string; label: string; node: Record<string, unknown> };
    const cycleConverter: ReadConverter<CycleDoc> = snapshot => {
      const data = snapshot.data() as { label: string; n: number };
      const node: Record<string, unknown> = { n: data.n };
      node.self = node;
      return { label: data.label, node } as CycleDoc;
    };
    const cycleCol = `test_read_only_converter_cycle_${Date.now()}`;
    const cycleRepo = FirestoreRepository.withSchema(db, cycleCol, cycleSchema, {
      readConverter: cycleConverter,
      storedSchema: cycleSchema,
    });

    await cycleRepo.bulkCreate([
      { label: 'a', n: 1 },
      { label: 'b', n: 1 },
    ]);

    await expect(cycleRepo.query().distinctValues('node' as any)).resolves.toHaveLength(1);

    const docs = await cycleRepo.query().get();
    if (docs.length > 0) {
      await cycleRepo.bulkDelete(docs.map(doc => doc.id));
    }
  });

  it('getInTransaction() applies the converter on a transactional read', async () => {
    const created = await repo.create({ name: 'zeta', value: 7 });

    const read = await repo.runInTransaction(async (tx, txRepo) => {
      return await txRepo.getInTransaction(tx, created.id);
    });

    expect(read?.name).toBe('ZETA');
  });

  it('delete() hook payloads are converter-transformed (delete reads via the read ref)', async () => {
    const created = await repo.create({ name: 'omega', value: 8 });

    const seen: string[] = [];
    const hookRepo = FirestoreRepository.withSchema(db, COLLECTION, widgetSchema, {
      readConverter,
      storedSchema: widgetSchema,
    });
    hookRepo.on('beforeDelete', doc => seen.push((doc as WidgetDoc).name));
    hookRepo.on('afterDelete', doc => seen.push((doc as WidgetDoc).name));

    await hookRepo.delete(created.id);

    // Both hooks receive the fromFirestore-transformed document (delete reads via readCol()).
    expect(seen).toEqual(['OMEGA', 'OMEGA']);
  });
});
