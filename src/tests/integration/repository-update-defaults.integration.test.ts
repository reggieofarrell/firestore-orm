/**
 * Strategy: emulator-backed regression coverage for issue #25 — Zod `.default(...)` fields must not
 * be silently injected into a partial `update()` and clobber stored data. The update schema is
 * `createWriteSchema.partial()`, and `.partial()` keeps the `ZodDefault` wrapper, so before the fix a
 * partial update re-defaulted every omitted field and overwrote it in Firestore. This was the exact
 * coverage gap that hid the bug: no test wrote a defaulted-schema document and read it back.
 *
 * Each case writes a real document and reads it back. Where the read schema would re-apply the same
 * default (masking the written value), the stored document is read RAW (bypassing the ORM read
 * converter) to assert the true write payload. `create` must still apply defaults.
 *
 * Covers update() / query().update() / patch() (merge) preserving an omitted defaulted field, a
 * nested-object replace not re-injecting a nested default, and create still backfilling defaults.
 * FirestoreRepository.ts and QueryBuilder.ts are owned by the integration coverage gate.
 */
import { z } from 'zod';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import { getIntegrationDb } from './helpers/firestoreIntegrationHarness.js';

const userSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  role: z.string().optional(),
  // A top-level scalar default. Seeded to a non-default value so re-injection of the default is an
  // observable clobber through the normal ORM read.
  status: z.string().default('active'),
  // A top-level object-level `.default({})`. Its inner `theme` leaf has no default, so a clobber to
  // `{}` is observable through the ORM read (theme becomes undefined).
  prefs: z.object({ theme: z.string().optional() }).default({}),
  // A nested leaf default inside an optional object — the read schema re-applies `count` on read, so
  // the written value is asserted via a RAW read.
  config: z.object({ count: z.number().default(0) }).optional(),
});

type User = z.infer<typeof userSchema>;

const COLLECTION = `test_update_defaults_${Date.now()}`;

describe('partial update() does not inject Zod defaults (#25, integration)', () => {
  const db = getIntegrationDb();
  const repo = FirestoreRepository.withSchema(db, COLLECTION, userSchema);
  const trackedIds: string[] = [];

  const track = (id: string) => {
    trackedIds.push(id);
    return id;
  };
  const getOrFail = async (id: string): Promise<User & { id: string }> => {
    const doc = await repo.getById(id);
    expect(doc).not.toBeNull();
    return doc as User & { id: string };
  };
  // Raw stored document, bypassing the ORM read converter (which would re-apply read-side defaults).
  const getRaw = async (id: string): Promise<Record<string, unknown>> => {
    const snap = await db.collection(COLLECTION).doc(id).get();
    expect(snap.exists).toBe(true);
    return snap.data() as Record<string, unknown>;
  };

  afterAll(async () => {
    if (trackedIds.length > 0) {
      await repo.bulkDelete(trackedIds);
    }
  });

  it('update() leaves an omitted scalar-defaulted field untouched (the regression)', async () => {
    // Seed a non-default value; before the fix, update() re-injected status:'active' and clobbered it.
    const user = await repo.create({ name: 'Jane', status: 'archived' });
    track(user.id);

    await repo.update(user.id, { name: 'Jane R.' });
    const updated = await getOrFail(user.id);

    expect(updated.name).toBe('Jane R.');
    expect(updated.status).toBe('archived'); // NOT reset to the default 'active'
  });

  it('update() does not clobber an omitted object-defaulted field', async () => {
    const user = await repo.create({ name: 'Obj', prefs: { theme: 'dark' } });
    track(user.id);

    await repo.update(user.id, { name: 'Obj R.' });
    const updated = await getOrFail(user.id);

    // Before the fix, prefs:{} was injected and replaced the stored map, dropping theme.
    expect(updated.prefs?.theme).toBe('dark');
  });

  it('query().update() leaves an omitted defaulted field untouched', async () => {
    const role = `qtest_defaults_${Date.now()}`;
    const user = await repo.create({ name: 'Q', role, status: 'archived' });
    track(user.id);

    const count = await repo.query().where('role', '==', role).update({ name: 'Q R.' });

    expect(count).toBe(1);
    const updated = await getOrFail(user.id);
    expect(updated.name).toBe('Q R.');
    expect(updated.status).toBe('archived');
  });

  it('patch() (merge, non-dotted) leaves an omitted scalar-defaulted field untouched', async () => {
    const user = await repo.create({ name: 'Merge', status: 'archived' });
    track(user.id);

    await repo.patch(user.id, { name: 'Merge R.' });
    const updated = await getOrFail(user.id);

    expect(updated.name).toBe('Merge R.');
    expect(updated.status).toBe('archived');
  });

  it('update({ config: {} }) writes an empty map, not the nested default', async () => {
    const user = await repo.create({ name: 'Nested', config: { count: 5 } });
    track(user.id);

    // Replacing config with {} must persist {}, not re-inject the nested count default.
    await repo.update(user.id, { config: {} } as any);
    const raw = await getRaw(user.id);

    // Asserted RAW: the ORM read schema would otherwise re-apply count:0 on read.
    expect((raw.config as Record<string, unknown> | undefined)?.count).toBeUndefined();
  });

  it('create() still backfills defaults for omitted fields', async () => {
    // Guards against the fix over-reaching into create — defaults on create are correct.
    const user = await repo.create({ name: 'Fresh' });
    track(user.id);

    const raw = await getRaw(user.id);
    expect(raw.status).toBe('active');
    expect(raw.prefs).toEqual({});
  });
});
