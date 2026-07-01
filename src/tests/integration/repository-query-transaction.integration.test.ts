import { createUserRepoHarness } from './helpers/firestoreIntegrationHarness.js';
import { NotFoundError } from '../../core/Errors.js';

describe('FirestoreRepository query and transaction behavior', () => {
  const harness = createUserRepoHarness('test_users_query_transaction');
  const { userRepo, trackUser, getUserOrFail, cleanupTrackedUsers, cleanupCollection } = harness;

  afterEach(async () => {
    await cleanupTrackedUsers();
  });

  afterAll(async () => {
    await cleanupCollection();
  });

  describe('getOneByField()', () => {
    it('should return a single matching document when one exists', async () => {
      const user = await userRepo.create({
        name: 'Single Match User',
        profile: { verified: true },
      });
      trackUser(user.id);

      const result = await userRepo.getOneByField('name', 'Single Match User');

      expect(result).toBeTruthy();
      expect(result?.id).toBe(user.id);
      expect(result?.name).toBe('Single Match User');
      expect(result?.profile?.verified).toBe(true);
    });

    it('should return null when no matching document exists', async () => {
      const result = await userRepo.getOneByField('name', 'Missing Match User');

      expect(result).toBeNull();
    });

    it('should return the first matching document when multiple documents match', async () => {
      const user1 = await userRepo.create({
        name: 'Duplicate Match User',
        profile: { verified: false },
      });
      trackUser(user1.id);

      const user2 = await userRepo.create({
        name: 'Duplicate Match User',
        profile: { verified: true },
      });
      trackUser(user2.id);

      const result = await userRepo.getOneByField('name', 'Duplicate Match User');

      expect(result).toBeTruthy();
      expect(result?.name).toBe('Duplicate Match User');
      expect([user1.id, user2.id]).toContain(result?.id);
    });
  });

  describe('listenOne()', () => {
    it('should emit document updates for an existing document', async () => {
      const user = await userRepo.create({
        name: 'Listen One User',
        profile: { verified: false },
      } as any);
      trackUser(user.id);

      await new Promise<void>((resolve, reject) => {
        let emissionCount = 0;

        const timeout = setTimeout(() => {
          unsubscribe();
          reject(new Error('listenOne timed out before receiving expected emissions'));
        }, 10000);

        const unsubscribe = userRepo.listenOne(
          user.id,
          doc => {
            emissionCount += 1;

            if (emissionCount === 1) {
              expect(doc.id).toBe(user.id);
              expect(doc.name).toBe('Listen One User');

              void userRepo
                .update(user.id, {
                  name: 'Listen One Updated',
                  'profile.verified': true,
                } as any)
                .catch(reject);
              return;
            }

            if (emissionCount === 2) {
              expect(doc.id).toBe(user.id);
              expect(doc.name).toBe('Listen One Updated');
              expect(doc.profile?.verified).toBe(true);
              clearTimeout(timeout);
              unsubscribe();
              resolve();
            }
          },
          error => {
            clearTimeout(timeout);
            unsubscribe();
            reject(error);
          },
        );
      });
    });

    it('should report NotFoundError through onError for missing documents', async () => {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          unsubscribe();
          reject(new Error('listenOne missing-document path did not trigger onError'));
        }, 10000);

        const unsubscribe = userRepo.listenOne(
          'listen-one-missing-doc',
          () => {
            clearTimeout(timeout);
            unsubscribe();
            reject(new Error('listenOne callback should not run for missing documents'));
          },
          error => {
            clearTimeout(timeout);
            unsubscribe();
            try {
              expect(error).toBeInstanceOf(NotFoundError);
              resolve();
            } catch (assertionError) {
              reject(assertionError);
            }
          },
        );
      });
    });
  });

  describe('query().update() with dot notation', () => {
    it('should update all matching documents with dot notation', async () => {
      const user1 = await userRepo.create({
        name: 'Admin 1',
        profile: { verified: false },
      });
      trackUser(user1.id);

      const user2 = await userRepo.create({
        name: 'Admin 2',
        profile: { verified: false },
      });
      trackUser(user2.id);

      const count = await userRepo
        .query()
        .where('name', 'in', ['Admin 1', 'Admin 2'])
        .update({ 'profile.verified': true } as any);

      expect(count).toBe(2);

      const users = await userRepo.query().where('name', 'in', ['Admin 1', 'Admin 2']).get();

      users.forEach(user => {
        expect(user.profile?.verified).toBe(true);
      });
    });

    it('should handle complex nested updates via query', async () => {
      const user = await userRepo.create({
        name: 'User 1',
        profile: {
          settings: {
            theme: 'light',
            notifications: false,
          },
        },
      });
      trackUser(user.id);

      await userRepo
        .query()
        .where('name', '==', 'User 1')
        .update({
          'profile.settings.theme': 'dark',
          'profile.settings.notifications': true,
        } as any);

      const updatedUser = await userRepo.query().where('name', '==', 'User 1').getOne();

      expect(updatedUser?.profile?.settings?.theme).toBe('dark');
      expect(updatedUser?.profile?.settings?.notifications).toBe(true);
    });

    it('should return 0 when no documents match', async () => {
      const count = await userRepo
        .query()
        .where('name', '==', 'NonExistent')
        .update({ 'profile.verified': true } as any);

      expect(count).toBe(0);
    });
  });

  describe('updateInTransaction() with dot notation', () => {
    it('should update with dot notation in transaction', async () => {
      const user = await userRepo.create({
        name: 'Transaction User',
        address: { city: 'Portland' },
      });
      trackUser(user.id);

      await userRepo.runInTransaction(async (tx, repo) => {
        const existing = await repo.getForUpdateInTransaction(tx, user.id);
        expect(existing).toBeTruthy();

        await repo.updateInTransaction(tx, user.id, {
          'address.city': 'Seattle',
          'address.zipCode': '98101',
        } as any);
      });

      const updated = await getUserOrFail(user.id);
      expect(updated?.address?.city).toBe('Seattle');
      expect(updated?.address?.zipCode).toBe('98101');
    });

    it('should handle complex transaction updates', async () => {
      const user1 = await userRepo.create({
        name: 'User A',
        profile: { verified: false },
      });
      trackUser(user1.id);

      const user2 = await userRepo.create({
        name: 'User B',
        profile: { verified: false },
      });
      trackUser(user2.id);

      await userRepo.runInTransaction(async (tx, repo) => {
        const existing1 = await repo.getForUpdateInTransaction(tx, user1.id);
        const existing2 = await repo.getForUpdateInTransaction(tx, user2.id);

        expect(existing1).toBeTruthy();
        expect(existing2).toBeTruthy();

        await repo.updateInTransaction(tx, user1.id, {
          'profile.verified': true,
        } as any);

        await repo.updateInTransaction(tx, user2.id, {
          'profile.verified': true,
        } as any);
      });

      const updated1 = await userRepo.getById(user1.id);
      const updated2 = await userRepo.getById(user2.id);

      expect(updated1?.profile?.verified).toBe(true);
      expect(updated2?.profile?.verified).toBe(true);
    }, 10000);

    it('should support updateInTransaction(..., { merge: true }) for existing documents', async () => {
      const user = await userRepo.create({
        name: 'Transaction Merge User',
        profile: {
          theme: 'light',
          notifications: false,
        },
      } as any);
      trackUser(user.id);

      await userRepo.runInTransaction(async (tx, repo) => {
        await repo.updateInTransaction(tx, user.id, { 'profile.theme': 'dark' } as any, {
          merge: true,
        });
      });

      const updatedUser = await getUserOrFail(user.id);
      expect(updatedUser?.profile?.theme).toBe('dark');
      expect(updatedUser?.profile?.notifications).toBe(false);
    });

    it('should throw NotFoundError for updateInTransaction(..., { merge: true }) on missing document', async () => {
      await expect(
        userRepo.runInTransaction(async (tx, repo) => {
          await repo.updateInTransaction(
            tx,
            'missing-transaction-merge-doc',
            { name: 'Should Not Exist' } as any,
            { merge: true },
          );
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('should expose patchInTransaction() as a merge-style convenience alias', async () => {
      const user = await userRepo.create({
        name: 'Transaction Patch User',
        profile: {
          theme: 'light',
          notifications: false,
        },
      } as any);
      trackUser(user.id);

      await userRepo.runInTransaction(async (tx, repo) => {
        await repo.patchInTransaction(tx, user.id, {
          profile: {
            theme: 'dark',
          },
        } as any);
      });

      const updatedUser = await getUserOrFail(user.id);
      expect(updatedUser?.profile?.theme).toBe('dark');
      expect(updatedUser?.profile?.notifications).toBe(false);
    });

    it('should throw NotFoundError for patchInTransaction() on missing document', async () => {
      await expect(
        userRepo.runInTransaction(async (tx, repo) => {
          await repo.patchInTransaction(tx, 'missing-transaction-patch-doc', {
            profile: {
              theme: 'dark',
            },
          } as any);
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('should rollback on error', async () => {
      const user = await userRepo.create({
        name: 'Rollback Test',
        profile: { verified: false },
      });
      trackUser(user.id);

      await expect(
        userRepo.runInTransaction(async (tx, repo) => {
          await repo.getForUpdateInTransaction(tx, user.id);

          await repo.updateInTransaction(tx, user.id, {
            'profile.verified': true,
          } as any);

          throw new Error('Transaction failed');
        }),
      ).rejects.toThrow('Transaction failed');

      const unchanged = await userRepo.getById(user.id);
      expect(unchanged?.profile?.verified).toBe(false);
    });
  });
});
