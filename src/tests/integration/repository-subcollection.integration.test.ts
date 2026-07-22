/**
 * Strategy: emulator integration tests for subcollection CRUD.
 * Verifies subcollection path resolution and basic read/write under a parent document.
 */
import { z } from 'zod';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import { createUserRepoHarness } from './helpers/firestoreIntegrationHarness.js';

const orderSchema = z.object({
  total: z.number(),
  status: z.string(),
});
type Order = z.infer<typeof orderSchema>;

describe('FirestoreRepository subcollections', () => {
  const harness = createUserRepoHarness('test_users_subcollections');
  const { userRepo, trackUser, cleanupTrackedUsers, cleanupCollection } = harness;

  let parentId: string;
  let orderRepo: FirestoreRepository<Order>;

  beforeAll(async () => {
    const parent = await userRepo.create({ name: 'Subcollection Parent' });
    parentId = parent.id;
    trackUser(parentId);
    orderRepo = userRepo.subcollection(parentId, 'orders', orderSchema);
  });

  afterEach(async () => {
    const orders = await orderRepo.query().get();
    if (orders.length > 0) {
      await orderRepo.bulkDelete(orders.map(o => o.id));
    }
  });

  afterAll(async () => {
    await cleanupTrackedUsers();
    await cleanupCollection();
  });

  it('should create and read documents in a subcollection', async () => {
    const order = await orderRepo.create({ total: 42, status: 'pending' });

    expect(orderRepo.getParentId()).toBe(parentId);
    expect(orderRepo.getCollectionPath()).toContain(`${parentId}/orders`);

    const fetched = await orderRepo.getById(order.id);
    expect(fetched?.total).toBe(42);
  });

  it('should query subcollection documents', async () => {
    await orderRepo.create({ total: 10, status: 'pending' });
    await orderRepo.create({ total: 20, status: 'shipped' });

    const pending = await orderRepo.query().where('status', '==', 'pending').get();
    expect(pending).toHaveLength(1);
    expect(pending[0].total).toBe(10);
  });
});
