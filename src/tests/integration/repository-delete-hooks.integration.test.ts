/**
 * Strategy: emulator integration tests for delete hook payloads.
 * Verifies before/after delete and bulk delete hook contracts.
 */
import { createTestUserInput } from '../shared/factories/user.factory.js';
import { resetTestFactoryCounters } from '../shared/factories/counters.js';
import { createUserRepoHarness } from './helpers/firestoreIntegrationHarness.js';

describe('FirestoreRepository delete hooks', () => {
  const harness = createUserRepoHarness('test_users_delete_hooks');
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

  it('should pass deleted document to beforeDelete and afterDelete', async () => {
    const beforeDelete = jest.fn();
    const afterDelete = jest.fn();
    userRepo.on('beforeDelete', beforeDelete);
    userRepo.on('afterDelete', afterDelete);

    const created = await userRepo.create(createTestUserInput({ name: 'Delete Hooks' }));

    await userRepo.delete(created.id);

    expect(beforeDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: created.id, name: 'Delete Hooks' }),
    );
    expect(afterDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: created.id, name: 'Delete Hooks' }),
    );
  });

  it('should pass ids and documents to bulk delete hooks', async () => {
    const beforeBulkDelete = jest.fn();
    const afterBulkDelete = jest.fn();
    userRepo.on('beforeBulkDelete', beforeBulkDelete);
    userRepo.on('afterBulkDelete', afterBulkDelete);

    const a = await userRepo.create(createTestUserInput({ name: 'Bulk Del A' }));
    const b = await userRepo.create(createTestUserInput({ name: 'Bulk Del B' }));

    await userRepo.bulkDelete([a.id, b.id]);

    expect(beforeBulkDelete).toHaveBeenCalledWith({
      ids: expect.arrayContaining([a.id, b.id]),
      documents: expect.arrayContaining([
        expect.objectContaining({ id: a.id, name: 'Bulk Del A' }),
        expect.objectContaining({ id: b.id, name: 'Bulk Del B' }),
      ]),
    });

    expect(afterBulkDelete).toHaveBeenCalledWith({
      ids: expect.arrayContaining([a.id, b.id]),
      documents: expect.arrayContaining([
        expect.objectContaining({ id: a.id }),
        expect.objectContaining({ id: b.id }),
      ]),
    });
  });
});
