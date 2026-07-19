/**
 * Strategy: emulator integration tests for core CRUD lifecycle methods.
 * Verifies create/read/list/find/delete paths and create hooks.
 */
import { createTestUserInput } from '../shared/factories/user.factory.js';
import { resetTestFactoryCounters } from '../shared/factories/counters.js';
import { createUserRepoHarness } from './helpers/firestoreIntegrationHarness.js';

describe('FirestoreRepository CRUD lifecycle', () => {
  const harness = createUserRepoHarness('test_users_crud_lifecycle');
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

  it('should create and read a document by id', async () => {
    const created = await userRepo.create(createTestUserInput({ name: 'CRUD Create' }));
    trackUser(created.id);

    const fetched = await userRepo.getById(created.id);
    expect(fetched?.name).toBe('CRUD Create');
  });

  it('should bulk create multiple documents', async () => {
    const created = await userRepo.bulkCreate(
      [createTestUserInput({ name: 'Bulk 1' }), createTestUserInput({ name: 'Bulk 2' })],
      { returnDoc: true },
    );
    created.forEach(doc => trackUser(doc.id));

    expect(created).toHaveLength(2);
    expect(created.map(d => d.name)).toEqual(['Bulk 1', 'Bulk 2']);
  });

  it('should find documents by field and return all documents', async () => {
    const alpha = await userRepo.create(
      createTestUserInput({ name: 'Alpha', email: 'alpha-find@example.com' }),
    );
    const beta = await userRepo.create(
      createTestUserInput({ name: 'Beta', email: 'beta-find@example.com' }),
    );
    trackUser(alpha.id);
    trackUser(beta.id);

    const byEmail = await userRepo.findByField('email', 'alpha-find@example.com');
    expect(byEmail).toHaveLength(1);
    expect(byEmail[0].id).toBe(alpha.id);

    const all = await userRepo.getAll();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('should emit afterCreate with generated id', async () => {
    const afterCreate = jest.fn();
    userRepo.on('afterCreate', afterCreate);

    const created = await userRepo.create(createTestUserInput({ name: 'Hook Create' }));
    trackUser(created.id);

    expect(afterCreate).toHaveBeenCalledWith(
      expect.objectContaining({ id: created.id, name: 'Hook Create' }),
    );
  });

  it('should delete a single document', async () => {
    const created = await userRepo.create(createTestUserInput());
    await userRepo.delete(created.id);

    const fetched = await userRepo.getById(created.id);
    expect(fetched).toBeNull();
  });

  it('should bulk delete documents and return deleted count', async () => {
    const a = await userRepo.create(createTestUserInput());
    const b = await userRepo.create(createTestUserInput());

    const deletedCount = await userRepo.bulkDelete([a.id, b.id]);
    expect(deletedCount).toBe(2);

    expect(await userRepo.getById(a.id)).toBeNull();
    expect(await userRepo.getById(b.id)).toBeNull();
  });
});
