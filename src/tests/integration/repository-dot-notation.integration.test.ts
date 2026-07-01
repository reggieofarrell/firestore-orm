import { createUserRepoHarness } from './helpers/firestoreIntegrationHarness.js';

describe('FirestoreRepository nested update behavior', () => {
  const harness = createUserRepoHarness('test_users_dot_notation');
  const { userRepo, trackUser, getUserOrFail, cleanupTrackedUsers, cleanupCollection } = harness;

  afterEach(async () => {
    await cleanupTrackedUsers();
  });

  afterAll(async () => {
    await cleanupCollection();
  });

  describe('update() with dot notation', () => {
    it('should update nested fields using dot notation', async () => {
      const user = await userRepo.create({
        name: 'John Doe',
        address: {
          street: '123 Main St',
          city: 'San Francisco',
          zipCode: '94102',
          country: 'USA',
        },
      });
      trackUser(user.id);

      await userRepo.update(user.id, {
        'address.city': 'Los Angeles',
        'address.zipCode': '90001',
      } as any);
      const updated = await getUserOrFail(user.id);

      expect(updated.address?.city).toBe('Los Angeles');
      expect(updated.address?.zipCode).toBe('90001');
      expect(updated.address?.street).toBe('123 Main St');
      expect(updated.address?.country).toBe('USA');
    });

    it('should update deeply nested fields', async () => {
      const user = await userRepo.create({
        name: 'Jane Doe',
        profile: {
          bio: 'Developer',
          verified: false,
          settings: {
            theme: 'light',
            notifications: false,
          },
        },
      });
      trackUser(user.id);

      await userRepo.update(user.id, {
        'profile.settings.theme': 'dark',
        'profile.verified': true,
      } as any);
      const updated = await getUserOrFail(user.id);

      expect(updated.profile?.settings?.theme).toBe('dark');
      expect(updated.profile?.verified).toBe(true);
      expect(updated.profile?.settings?.notifications).toBe(false);
      expect(updated.profile?.bio).toBe('Developer');
    });

    it('should handle mixed regular and dot notation updates', async () => {
      const user = await userRepo.create({
        name: 'Alice',
        email: 'alice@example.com',
        address: {
          city: 'Boston',
        },
      });
      trackUser(user.id);

      await userRepo.update(user.id, {
        name: 'Alice Smith',
        'address.city': 'New York',
      } as any);
      const updated = await getUserOrFail(user.id);

      expect(updated?.name).toBe('Alice Smith');
      expect(updated.address?.city).toBe('New York');
    });

    it('should create nested structure if it does not exist', async () => {
      const user = await userRepo.create({
        name: 'Bob',
      });
      trackUser(user.id);

      await userRepo.update(user.id, {
        'address.city': 'Seattle',
        'address.zipCode': '98101',
      } as any);
      const updated = await getUserOrFail(user.id);

      expect(updated.address?.city).toBe('Seattle');
      expect(updated.address?.zipCode).toBe('98101');
    });

    it('should throw error for invalid dot notation paths', async () => {
      const user = await userRepo.create({
        name: 'Charlie',
      });
      trackUser(user.id);

      await expect(
        userRepo.update(user.id, {
          'address..city': 'Invalid',
        } as any),
      ).rejects.toThrow();

      await expect(
        userRepo.update(user.id, {
          '.address': 'Invalid',
        } as any),
      ).rejects.toThrow();

      await expect(
        userRepo.update(user.id, {
          'address.': 'Invalid',
        } as any),
      ).rejects.toThrow();
    });

    it('should handle empty string path validation', async () => {
      const user = await userRepo.create({
        name: 'Dave',
      });
      trackUser(user.id);

      await expect(
        userRepo.update(user.id, {
          '': 'Invalid',
        } as any),
      ).rejects.toThrow();
    });
  });

  describe('bulkUpdate() with dot notation', () => {
    it('should bulk update with dot notation', async () => {
      const user1 = await userRepo.create({
        name: 'User 1',
        profile: { verified: false },
      });
      trackUser(user1.id);

      const user2 = await userRepo.create({
        name: 'User 2',
        profile: { verified: false },
      });
      trackUser(user2.id);

      await userRepo.bulkUpdate([
        { id: user1.id, data: { 'profile.verified': true } as any },
        { id: user2.id, data: { 'profile.verified': true } as any },
      ]);

      const updated1 = await userRepo.getById(user1.id);
      const updated2 = await userRepo.getById(user2.id);

      expect(updated1?.profile?.verified).toBe(true);
      expect(updated2?.profile?.verified).toBe(true);
    }, 15000);

    it('should handle mixed updates in bulk operation', async () => {
      const user1 = await userRepo.create({
        name: 'User 1',
        address: { city: 'Boston' },
      });
      trackUser(user1.id);

      const user2 = await userRepo.create({
        name: 'User 2',
        email: 'user2@example.com',
      });
      trackUser(user2.id);

      await userRepo.bulkUpdate([
        { id: user1.id, data: { 'address.city': 'NYC' } as any },
        { id: user2.id, data: { name: 'User Two' } },
      ]);

      const updated1 = await userRepo.getById(user1.id);
      const updated2 = await userRepo.getById(user2.id);

      expect(updated1?.address?.city).toBe('NYC');
      expect(updated2?.name).toBe('User Two');
    }, 15000);

    it('should reject invalid field paths in bulk update', async () => {
      const user1 = await userRepo.create({
        name: 'User 1',
      });
      trackUser(user1.id);

      const user2 = await userRepo.create({
        name: 'User 2',
      });
      trackUser(user2.id);

      await expect(
        userRepo.bulkUpdate([
          { id: user1.id, data: { 'address.city': 'NYC' } as any },
          { id: user2.id, data: { 'address..city': 'Invalid' } as any },
        ]),
      ).rejects.toThrow();
    });
  });

  describe('Backward compatibility', () => {
    it('should work with regular updates (no dot notation)', async () => {
      const user = await userRepo.create({
        name: 'Regular User',
        email: 'regular@example.com',
      });
      trackUser(user.id);

      await userRepo.update(user.id, {
        name: 'Updated User',
        email: 'updated@example.com',
      });
      const updated = await getUserOrFail(user.id);

      expect(updated?.name).toBe('Updated User');
      expect(updated?.email).toBe('updated@example.com');
    });

    it('should handle nested object updates without dot notation', async () => {
      const user = await userRepo.create({
        name: 'Nested User',
        address: {
          city: 'Denver',
          zipCode: '80201',
        },
      });
      trackUser(user.id);

      await userRepo.update(user.id, {
        address: {
          city: 'Boulder',
          zipCode: '80301',
          country: 'USA',
        },
      });
      const updated = await getUserOrFail(user.id);

      expect(updated.address?.city).toBe('Boulder');
      expect(updated.address?.zipCode).toBe('80301');
      expect(updated.address?.country).toBe('USA');
    });

    it('should replace nested object when using regular syntax', async () => {
      const user = await userRepo.create({
        name: 'Replace Test',
        address: {
          street: '123 Main St',
          city: 'Denver',
          zipCode: '80201',
        },
      });
      trackUser(user.id);

      await userRepo.update(user.id, {
        address: {
          city: 'Boulder',
        },
      });
      const updated = await getUserOrFail(user.id);

      expect(updated.address?.city).toBe('Boulder');
      expect(updated.address?.street).toBeUndefined();
      expect(updated.address?.zipCode).toBeUndefined();
    });

    it('should preserve fields with dot notation', async () => {
      const user = await userRepo.create({
        name: 'Preserve Test',
        address: {
          street: '123 Main St',
          city: 'Denver',
          zipCode: '80201',
        },
      });
      trackUser(user.id);

      await userRepo.update(user.id, {
        'address.city': 'Boulder',
      } as any);
      const updated = await getUserOrFail(user.id);

      expect(updated.address?.city).toBe('Boulder');
      expect(updated.address?.street).toBe('123 Main St');
      expect(updated.address?.zipCode).toBe('80201');
    }, 10000);
  });

  describe('Edge cases', () => {
    it('should handle null values with dot notation', async () => {
      const user = await userRepo.create({
        name: 'Null Test',
        address: { city: 'Portland' },
      });
      trackUser(user.id);

      await userRepo.update(user.id, {
        'address.city': null,
      } as any);
      const updated = await getUserOrFail(user.id);

      expect(updated.address?.city).toBeNull();
    }, 10000);

    it('should handle undefined values with dot notation', async () => {
      const user = await userRepo.create({
        name: 'Undefined Test',
        address: { city: 'Portland', zipCode: '97201' },
      });
      trackUser(user.id);

      await userRepo.update(user.id, {
        'address.city': undefined,
      } as any);
      const updated = await getUserOrFail(user.id);

      expect(updated.address?.city).toBe('Portland');
      expect(updated.address?.zipCode).toBe('97201');
    }, 10000);

    it('should handle multiple levels of new nesting', async () => {
      const user = await userRepo.create({
        name: 'Deep Nesting',
      });
      trackUser(user.id);

      await userRepo.update(user.id, {
        'profile.settings.advanced.debugMode': true,
      } as any);
      const updated = await getUserOrFail(user.id);

      expect((updated as any).profile?.settings?.advanced?.debugMode).toBe(true);
    }, 10000);
  });
});
