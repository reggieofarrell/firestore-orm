/**
 * Strategy: emulator integration tests for bulk write return + hook contracts.
 * Verifies bulkUpdate/bulkPatch return id-only payloads, and that bulkCreate returns { id }[] by
 * default (read models via returnDoc) while never leaking Zod-stripped keys into results or the
 * afterBulkCreate hook payload (regression guard for the historic Object.assign-onto-raw bug).
 */
import { createTestUserInput } from '../shared/factories/user.factory.js';
import { resetTestFactoryCounters } from '../shared/factories/counters.js';
import {
  cleanupValidatedRepo,
  createUserRepoHarness,
  createValidatedRepo,
  getIntegrationDb,
} from './helpers/firestoreIntegrationHarness.js';

describe('FirestoreRepository bulk update return contracts', () => {
  const harness = createUserRepoHarness('test_users_bulk_returns');
  const { userRepo, trackUser, cleanupTrackedUsers, cleanupCollection } = harness;

  beforeEach(() => {
    resetTestFactoryCounters();
  });

  afterEach(async () => {
    await cleanupTrackedUsers();
  });

  afterAll(async () => {
    await cleanupCollection();
  });

  it('should return id-only payloads from bulkUpdate', async () => {
    const a = await userRepo.create(createTestUserInput({ name: 'Bulk Return A' }));
    const b = await userRepo.create(createTestUserInput({ name: 'Bulk Return B' }));
    trackUser(a.id);
    trackUser(b.id);

    const result = await userRepo.bulkUpdate([
      { id: a.id, data: { name: 'Bulk Return A Updated' } },
      { id: b.id, data: { name: 'Bulk Return B Updated' } },
    ]);

    expect(result).toEqual([{ id: a.id }, { id: b.id }]);
  });

  it('should return id-only payloads from bulkPatch', async () => {
    const user = await userRepo.create(
      createTestUserInput({
        name: 'Bulk Patch Return',
        profile: { verified: false },
      } as any),
    );
    trackUser(user.id);

    const result = await userRepo.bulkPatch([
      { id: user.id, data: { 'profile.verified': true } as any },
    ]);

    expect(result).toEqual([{ id: user.id }]);

    const updated = await userRepo.getById(user.id);
    expect(updated?.profile?.verified).toBe(true);
  });
});

describe('FirestoreRepository bulkCreate return + hook contracts', () => {
  it('returns { id }[] by default and drops Zod-stripped keys from results and afterBulkCreate', async () => {
    const repo = createValidatedRepo(getIntegrationDb());
    try {
      const hookPayload: Array<Record<string, unknown>> = [];
      repo.on('afterBulkCreate', docs => {
        hookPayload.push(...(docs as Array<Record<string, unknown>>));
      });

      const result = await repo.bulkCreate([
        { name: 'Bulk C1', score: 1, createdAt: new Date().toISOString(), extra: 'not persisted' },
        { name: 'Bulk C2', score: 2, createdAt: new Date().toISOString(), extra: 'not persisted' },
      ] as any[]);

      // Default contract: id-only results (no fields, no leaked keys).
      expect(result).toHaveLength(2);
      for (const entry of result) {
        expect(Object.keys(entry)).toEqual(['id']);
        expect(typeof entry.id).toBe('string');
      }

      // afterBulkCreate receives the VALIDATED write model + id — the stripped `extra` is absent.
      expect(hookPayload).toHaveLength(2);
      for (const payload of hookPayload) {
        expect(payload.extra).toBeUndefined();
        expect(typeof payload.id).toBe('string');
        expect(String(payload.name)).toMatch(/^Bulk C/);
      }

      // Stored documents never contain the stripped key either.
      const stored = await repo.getById(result[0].id);
      expect((stored as Record<string, unknown>).extra).toBeUndefined();
    } finally {
      await cleanupValidatedRepo(repo);
    }
  });

  it('bulkCreate(returnDoc) returns converted read models without stripped keys', async () => {
    const repo = createValidatedRepo(getIntegrationDb());
    try {
      const created = await repo.bulkCreate(
        [{ name: 'RD1', score: 3, createdAt: new Date().toISOString(), extra: 'x' }] as any[],
        { returnDoc: true },
      );
      expect(created[0].name).toBe('RD1');
      expect((created[0] as Record<string, unknown>).extra).toBeUndefined();
    } finally {
      await cleanupValidatedRepo(repo);
    }
  });
});
