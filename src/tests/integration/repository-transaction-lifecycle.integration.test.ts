/**
 * Strategy: emulator integration tests for transaction create/delete helpers.
 * Verifies createInTransaction/deleteInTransaction and after-hook absence on tx helpers.
 */
import { createTestUserInput } from '../shared/factories/user.factory.js';
import { resetTestFactoryCounters } from '../shared/factories/counters.js';
import { createUserRepoHarness } from './helpers/firestoreIntegrationHarness.js';

describe('FirestoreRepository transaction lifecycle', () => {
  const harness = createUserRepoHarness('test_users_tx_lifecycle');
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

  it('should create a document inside a transaction via createInTransaction', async () => {
    const created = await userRepo.runInTransaction(async (tx, repo) => {
      return repo.createInTransaction(tx, createTestUserInput({ name: 'Tx Create' }));
    });
    trackUser(created.id);

    const fetched = await userRepo.getById(created.id);
    expect(fetched?.name).toBe('Tx Create');
  });

  it('should delete a document inside a transaction via deleteInTransaction', async () => {
    const created = await userRepo.create(createTestUserInput({ name: 'Tx Delete' }));
    trackUser(created.id);

    await userRepo.runInTransaction(async (tx, repo) => {
      await repo.deleteInTransaction(tx, created.id);
    });

    expect(await userRepo.getById(created.id)).toBeNull();
  });

  it('should run beforeCreate but not afterCreate for createInTransaction', async () => {
    const beforeCreate = jest.fn();
    const afterCreate = jest.fn();
    userRepo.on('beforeCreate', beforeCreate);
    userRepo.on('afterCreate', afterCreate);

    const created = await userRepo.runInTransaction(async (tx, repo) => {
      return repo.createInTransaction(tx, createTestUserInput({ name: 'Tx Hooks' }));
    });
    trackUser(created.id);

    expect(beforeCreate).toHaveBeenCalled();
    expect(afterCreate).not.toHaveBeenCalled();
  });

  it('should run beforeDelete but not afterDelete for deleteInTransaction', async () => {
    const created = await userRepo.create(createTestUserInput({ name: 'Tx Delete Hooks' }));

    const beforeDelete = jest.fn();
    const afterDelete = jest.fn();
    userRepo.on('beforeDelete', beforeDelete);
    userRepo.on('afterDelete', afterDelete);

    await userRepo.runInTransaction(async (tx, repo) => {
      await repo.deleteInTransaction(tx, created.id);
    });

    expect(beforeDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: created.id, name: 'Tx Delete Hooks' }),
    );
    expect(afterDelete).not.toHaveBeenCalled();
  });
});
