/**
 * Strategy: emulator-backed integration coverage for dot-notation writes on a SCHEMA-VALIDATED
 * repository — the combination that previously silently dropped writes (Zod stripped the unknown
 * dotted key, the empty payload skipped the write). Every case here writes a real document and
 * reads it back to assert the nested field actually persisted and siblings were preserved.
 *
 * Covers update / patch / merge-update / bulkUpdate / bulkPatch / updateInTransaction /
 * patchInTransaction / query().update(), plus fail-loud validation (bad leaf, unknown path), the
 * create dot-key guard, nested where/orderBy, and the query().update() written-count contract.
 * FirestoreRepository.ts and QueryBuilder.ts are owned by the integration coverage gate.
 */
import { z } from 'zod';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import { ValidationError } from '../../core/Errors.js';
import { getIntegrationDb } from './helpers/firestoreIntegrationHarness.js';

const userSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  address: z
    .object({
      city: z.string().optional(),
      zip: z.string().optional(),
      street: z.string().optional(),
    })
    .optional(),
  profile: z
    .object({
      verified: z.boolean().optional(),
      settings: z
        .object({
          theme: z.string().optional(),
          notifications: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
  // A nested object with REQUIRED siblings — exercises leaf-level merge validation (a partial
  // nested object must not require its siblings in merge mode).
  contact: z.object({ email: z.string(), phone: z.string() }).optional(),
  // A dynamic map: dotted paths into it cannot be resolved to a leaf schema and pass through.
  metadata: z.record(z.string(), z.any()).optional(),
  // A catchall object: declared `label`, plus arbitrary dynamic keys accepted (passthrough).
  attrs: z.object({ label: z.string().optional() }).catchall(z.any()).optional(),
  // An optional nested object whose `theme` leaf carries a default — the resolver must unwrap the
  // default wrapper to reach it. (Kept optional at the object level so the default is not injected
  // into unrelated updates.)
  prefs: z.object({ theme: z.string().default('light'), lang: z.string().optional() }).optional(),
});

type User = z.infer<typeof userSchema>;

const COLLECTION = `test_dot_schema_${Date.now()}`;

describe('dot-notation on a schema-validated repository (integration)', () => {
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

  afterAll(async () => {
    if (trackedIds.length > 0) {
      await repo.bulkDelete(trackedIds);
    }
  });

  it('update() persists an explicit dotted key and preserves siblings (the regression)', async () => {
    const user = await repo.create({
      name: 'Jane',
      address: { city: 'SF', zip: '94102', street: '1 Main' },
    });
    track(user.id);

    await repo.update(user.id, { 'address.city': 'Los Angeles' } as any);
    const updated = await getOrFail(user.id);

    expect(updated.address?.city).toBe('Los Angeles');
    expect(updated.address?.zip).toBe('94102');
    expect(updated.address?.street).toBe('1 Main');
  });

  it('update() persists a deep dotted path and preserves siblings', async () => {
    const user = await repo.create({
      name: 'Deep',
      profile: { verified: false, settings: { theme: 'light', notifications: true } },
    });
    track(user.id);

    await repo.update(user.id, { 'profile.settings.theme': 'dark' } as any);
    const updated = await getOrFail(user.id);

    expect(updated.profile?.settings?.theme).toBe('dark');
    expect(updated.profile?.settings?.notifications).toBe(true);
    expect(updated.profile?.verified).toBe(false);
  });

  it('patch() merges a nested object without replacing siblings', async () => {
    const user = await repo.create({ name: 'Patch', address: { city: 'A', zip: 'Z' } });
    track(user.id);

    await repo.patch(user.id, { address: { city: 'B' } } as any);
    const updated = await getOrFail(user.id);

    expect(updated.address?.city).toBe('B');
    expect(updated.address?.zip).toBe('Z');
  });

  it('patch() with a partial nested object does not require sibling fields (leaf-level merge)', async () => {
    const user = await repo.create({
      name: 'Contact',
      contact: { email: 'a@x.com', phone: '111' },
    });
    track(user.id);

    // `contact.phone` is REQUIRED by the schema, but a merge only touches `email` — it must not
    // require the sibling, and must preserve it.
    await repo.patch(user.id, { contact: { email: 'b@x.com' } } as any);
    const updated = await getOrFail(user.id);

    expect(updated.contact?.email).toBe('b@x.com');
    expect(updated.contact?.phone).toBe('111');
  });

  it('bulkPatch() with a partial nested object does not require sibling fields', async () => {
    const user = await repo.create({
      name: 'BulkContact',
      contact: { email: 'a@x.com', phone: '222' },
    });
    track(user.id);

    await repo.bulkPatch([{ id: user.id, data: { contact: { email: 'c@x.com' } } as any }]);
    const updated = await getOrFail(user.id);

    expect(updated.contact?.email).toBe('c@x.com');
    expect(updated.contact?.phone).toBe('222');
  });

  it('persists a dotted path into a record map (unresolvable leaf passes through)', async () => {
    const user = await repo.create({ name: 'Rec', metadata: { plan: 'free' } });
    track(user.id);

    await repo.update(user.id, { 'metadata.plan': 'pro', 'metadata.seats': 5 } as any);
    const updated = await getOrFail(user.id);

    expect((updated.metadata as Record<string, unknown>)?.plan).toBe('pro');
    expect((updated.metadata as Record<string, unknown>)?.seats).toBe(5);
  });

  it('persists a dotted path into a catchall object (dynamic key passes through)', async () => {
    const user = await repo.create({ name: 'Attrs', attrs: { label: 'x' } });
    track(user.id);

    await repo.update(user.id, { 'attrs.dynamic': 'v' } as any);
    const updated = await getOrFail(user.id);

    expect((updated.attrs as Record<string, unknown>)?.dynamic).toBe('v');
    expect((updated.attrs as Record<string, unknown>)?.label).toBe('x');
  });

  it('resolves a dotted path through a defaulted nested object', async () => {
    const user = await repo.create({ name: 'Pref', prefs: { theme: 'light', lang: 'en' } });
    track(user.id);

    await repo.update(user.id, { 'prefs.theme': 'dark' } as any);
    const updated = await getOrFail(user.id);

    expect(updated.prefs?.theme).toBe('dark');
    expect(updated.prefs?.lang).toBe('en');
  });

  it('handles a mixed regular + dotted update in one call', async () => {
    const user = await repo.create({ name: 'Mixed', role: 'member', address: { city: 'Old' } });
    track(user.id);

    await repo.update(user.id, { role: 'admin', 'address.city': 'New' } as any);
    const updated = await getOrFail(user.id);

    expect(updated.role).toBe('admin');
    expect(updated.address?.city).toBe('New');
  });

  it('rejects a bad dotted leaf value with ValidationError (no write)', async () => {
    const user = await repo.create({ name: 'Bad', address: { city: 'Keep' } });
    track(user.id);

    await expect(repo.update(user.id, { 'address.city': 123 } as any)).rejects.toBeInstanceOf(
      ValidationError,
    );
    const unchanged = await getOrFail(user.id);
    expect(unchanged.address?.city).toBe('Keep');
  });

  it('fails loud on an unknown dotted path', async () => {
    const user = await repo.create({ name: 'Unknown' });
    track(user.id);

    await expect(repo.update(user.id, { 'address.nope': 'x' } as any)).rejects.toThrow();
  });

  it('fails loud when a dotted path descends into a scalar field', async () => {
    const user = await repo.create({ name: 'Scalar' });
    track(user.id);

    // `name` is a string; `name.foo` has no addressable subfield and must throw (no silent map
    // corruption), not pass through.
    await expect(repo.update(user.id, { 'name.foo': 'bar' } as any)).rejects.toThrow();
  });

  it('rejects dot-notation keys on upsert() with a clear error', async () => {
    await expect(
      repo.upsert('upsert-dot-id', { name: 'Nope', 'address.city': 'LA' } as any),
    ).rejects.toThrow(/Dot-notation/);
  });

  it('bulkUpdate() and bulkPatch() persist dotted / nested updates', async () => {
    const a = await repo.create({ name: 'A', profile: { verified: false } });
    const b = await repo.create({ name: 'B', address: { city: 'X', zip: 'Y' } });
    track(a.id);
    track(b.id);

    await repo.bulkUpdate([{ id: a.id, data: { 'profile.verified': true } as any }]);
    await repo.bulkPatch([{ id: b.id, data: { address: { city: 'Z' } } as any }]);

    const ua = await getOrFail(a.id);
    const ub = await getOrFail(b.id);
    expect(ua.profile?.verified).toBe(true);
    expect(ub.address?.city).toBe('Z');
    expect(ub.address?.zip).toBe('Y'); // bulkPatch preserved the sibling
  });

  it('updateInTransaction() and patchInTransaction() persist dotted / nested updates', async () => {
    const user = await repo.create({
      name: 'Tx',
      address: { city: 'Old', zip: 'K' },
      profile: { settings: { theme: 'light' } },
    });
    track(user.id);

    await repo.runInTransaction(async (tx, r) => {
      await r.updateInTransaction(tx, user.id, { 'address.city': 'New' } as any);
    });
    await repo.runInTransaction(async (tx, r) => {
      await r.patchInTransaction(tx, user.id, { profile: { settings: { theme: 'dark' } } } as any);
    });

    const updated = await getOrFail(user.id);
    expect(updated.address?.city).toBe('New');
    expect(updated.address?.zip).toBe('K');
    expect(updated.profile?.settings?.theme).toBe('dark');
  });

  it('query().update() persists dotted updates and returns the written count', async () => {
    // Use a role value unique to this test so the count is not affected by documents other tests
    // leave in the shared collection.
    const role = 'qtest_admin';
    const admin1 = await repo.create({ name: 'Admin1', role, profile: { verified: false } });
    const admin2 = await repo.create({ name: 'Admin2', role, profile: { verified: false } });
    const member = await repo.create({
      name: 'Member',
      role: 'qtest_member',
      profile: { verified: false },
    });
    track(admin1.id);
    track(admin2.id);
    track(member.id);

    const count = await repo
      .query()
      .where('role', '==', role)
      .update({ 'profile.verified': true } as any);

    expect(count).toBe(2);
    expect((await getOrFail(admin1.id)).profile?.verified).toBe(true);
    expect((await getOrFail(admin2.id)).profile?.verified).toBe(true);
    expect((await getOrFail(member.id)).profile?.verified).toBe(false);
  });

  it('query().update() rejects a payload that sanitizes to empty (v3: empty patches are invalid)', async () => {
    const role = 'qtest_empty';
    const u1 = await repo.create({ name: 'Empty1', role, profile: { verified: true } });
    const u2 = await repo.create({ name: 'Empty2', role, profile: { verified: true } });
    track(u1.id);
    track(u2.id);

    // An all-undefined payload sanitizes to empty. v3 rejects empty patches rather than silently
    // no-op'ing (which previously mis-reported success on matched documents).
    await expect(
      repo
        .query()
        .where('role', '==', role)
        .update({ 'profile.verified': undefined } as any),
    ).rejects.toBeInstanceOf(ValidationError);

    // Nothing was written.
    expect((await getOrFail(u1.id)).profile?.verified).toBe(true);
    expect((await getOrFail(u2.id)).profile?.verified).toBe(true);
  });

  it('orders by a nested field path (where + orderBy on dot paths)', async () => {
    const marker = 'ordertest';
    const c = await repo.create({ name: 'C', role: marker, address: { city: 'Cairo' } });
    const a = await repo.create({ name: 'A', role: marker, address: { city: 'Austin' } });
    const b = await repo.create({ name: 'B', role: marker, address: { city: 'Boston' } });
    track(c.id);
    track(a.id);
    track(b.id);

    const results = await repo
      .query()
      .where('role', '==', marker)
      .orderBy('address.city', 'asc')
      .get();

    // Ordered by the nested path, not insertion order.
    expect(results.map(r => r.address?.city)).toEqual(['Austin', 'Boston', 'Cairo']);
  });

  it('rejects dot-notation keys on create() with a clear error', async () => {
    await expect(repo.create({ name: 'Nope', 'address.city': 'LA' } as any)).rejects.toThrow(
      /Dot-notation/,
    );
  });
});
