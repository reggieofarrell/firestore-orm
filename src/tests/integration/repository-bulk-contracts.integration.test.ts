/**
 * Strategy: emulator integration tests for bulk update return contracts.
 * Verifies bulkUpdate and bulkPatch return id-only payloads.
 */
import { createTestUserInput } from '../shared/factories/user.factory.js';
import { resetTestFactoryCounters } from '../shared/factories/counters.js';
import { createUserRepoHarness } from './helpers/firestoreIntegrationHarness.js';

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
