import { FieldValue } from 'firebase-admin/firestore';
import { ValidationError } from '../../core/Errors.js';
import {
  cleanupValidatedRepo,
  createUserRepoHarness,
  createValidatedRepo,
  HookValidatedUser,
} from './helpers/firestoreIntegrationHarness.js';

describe('FirestoreRepository hook-first validation ordering', () => {
  const harness = createUserRepoHarness('test_users_hook_validation');
  const { db, cleanupCollection } = harness;

  afterAll(async () => {
    await cleanupCollection();
  });

  it('should support serverTimestamp in create with schema validation enabled', async () => {
    const repo = createValidatedRepo(db);

    try {
      const created = await repo.create({
        name: 'Sentinel Create',
        score: 1,
        createdAt: FieldValue.serverTimestamp() as unknown as string,
      } as HookValidatedUser);

      const persisted = await repo.getById(created.id);
      expect(persisted).not.toBeNull();
      expect((persisted as any)?.createdAt?.toDate).toBeDefined();
    } finally {
      await cleanupValidatedRepo(repo);
    }
  });

  it('should support increment updates and still validate non-sentinel fields', async () => {
    const repo = createValidatedRepo(db);

    try {
      const created = await repo.create({
        name: 'Sentinel Update',
        score: 2,
        loginCount: 1,
        createdAt: new Date().toISOString(),
      } as HookValidatedUser);

      await repo.update(created.id, {
        loginCount: FieldValue.increment(3) as unknown as number,
      });

      const updated = await repo.getById(created.id);
      expect(updated?.loginCount).toBe(4);

      await expect(
        repo.update(created.id, {
          score: -1,
          createdAt: FieldValue.serverTimestamp() as unknown as string,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    } finally {
      await cleanupValidatedRepo(repo);
    }
  });

  it('should support bulkUpdate with increment sentinels', async () => {
    const repo = createValidatedRepo(db);

    try {
      const user1 = await repo.create({
        name: 'Sentinel Bulk 1',
        score: 1,
        loginCount: 0,
        createdAt: new Date().toISOString(),
      } as HookValidatedUser);
      const user2 = await repo.create({
        name: 'Sentinel Bulk 2',
        score: 2,
        loginCount: 10,
        createdAt: new Date().toISOString(),
      } as HookValidatedUser);

      await repo.bulkUpdate([
        { id: user1.id, data: { loginCount: FieldValue.increment(2) as unknown as number } },
        { id: user2.id, data: { loginCount: FieldValue.increment(5) as unknown as number } },
      ]);

      const updated1 = await repo.getById(user1.id);
      const updated2 = await repo.getById(user2.id);
      expect(updated1?.loginCount).toBe(2);
      expect(updated2?.loginCount).toBe(15);
    } finally {
      await cleanupValidatedRepo(repo);
    }
  });

  it('should support bulkCreate with serverTimestamp sentinels', async () => {
    const repo = createValidatedRepo(db);

    try {
      const created = await repo.bulkCreate([
        {
          name: 'Sentinel Bulk Create 1',
          score: 1,
          createdAt: FieldValue.serverTimestamp() as unknown as string,
        } as HookValidatedUser,
        {
          name: 'Sentinel Bulk Create 2',
          score: 2,
          createdAt: FieldValue.serverTimestamp() as unknown as string,
        } as HookValidatedUser,
      ]);

      const persisted = await Promise.all(created.map(item => repo.getById(item.id)));
      expect((persisted[0] as any)?.createdAt?.toDate).toBeDefined();
      expect((persisted[1] as any)?.createdAt?.toDate).toBeDefined();
    } finally {
      await cleanupValidatedRepo(repo);
    }
  });

  it('should support query().update with arrayUnion sentinels', async () => {
    const repo = createValidatedRepo(db);

    try {
      const user = await repo.create({
        name: 'Sentinel Query Update',
        score: 4,
        tags: ['initial'],
        createdAt: new Date().toISOString(),
      } as HookValidatedUser);

      await repo
        .query()
        .where('name', '==', user.name)
        .update({
          tags: FieldValue.arrayUnion('extra') as unknown as string[],
        });

      const updated = await repo.getById(user.id);
      expect(updated?.tags).toEqual(expect.arrayContaining(['initial', 'extra']));
    } finally {
      await cleanupValidatedRepo(repo);
    }
  });

  it('should support arrayRemove and delete sentinels in updates', async () => {
    const repo = createValidatedRepo(db);

    try {
      const created = await repo.create({
        name: 'Sentinel Remove/Delete',
        score: 5,
        tags: ['one', 'two', 'three'],
        loginCount: 99,
        createdAt: new Date().toISOString(),
      } as HookValidatedUser);

      await repo.update(created.id, {
        tags: FieldValue.arrayRemove('two') as unknown as string[],
        loginCount: FieldValue.delete() as unknown as number,
      });

      const updated = await repo.getById(created.id);
      expect(updated?.tags).toEqual(expect.arrayContaining(['one', 'three']));
      expect(updated?.tags).not.toContain('two');
      expect(updated?.loginCount).toBeUndefined();
    } finally {
      await cleanupValidatedRepo(repo);
    }
  });

  it('should support upsert create and update paths with sentinels', async () => {
    const repo = createValidatedRepo(db);
    const upsertId = `sentinel-upsert-${Date.now()}`;

    try {
      await repo.upsert(upsertId, {
        name: 'Sentinel Upsert',
        score: 3,
        loginCount: 1,
        createdAt: FieldValue.serverTimestamp() as unknown as string,
      } as HookValidatedUser);

      await repo.upsert(upsertId, {
        name: 'Sentinel Upsert',
        score: 3,
        loginCount: FieldValue.increment(2) as unknown as number,
        createdAt: FieldValue.serverTimestamp() as unknown as string,
      } as HookValidatedUser);

      const updated = await repo.getById(upsertId);
      expect(updated?.loginCount).toBe(3);
    } finally {
      await cleanupValidatedRepo(repo);
    }
  });

  it('should allow beforeCreate to enrich payload before schema validation', async () => {
    const repo = createValidatedRepo(db);

    try {
      repo.on('beforeCreate', payload => {
        (payload as HookValidatedUser).createdAt =
          FieldValue.serverTimestamp() as unknown as string;
      });

      const created = await repo.create({
        name: 'Create Hook Validation',
        score: 1,
      } as HookValidatedUser);

      const persisted = await repo.getById(created.id);
      expect((persisted as any)?.createdAt?.toDate).toBeDefined();
    } finally {
      await cleanupValidatedRepo(repo);
    }
  });

  it('should allow beforeUpdate to normalize payload before validation', async () => {
    const repo = createValidatedRepo(db);

    try {
      repo.on('beforeCreate', payload => {
        (payload as HookValidatedUser).createdAt = new Date().toISOString();
      });
      repo.on('beforeUpdate', payload => {
        if (typeof payload.score === 'number' && payload.score < 0) {
          payload.score = Math.abs(payload.score);
        }
      });

      const created = await repo.create({
        name: 'Update Hook Validation',
        score: 2,
      } as HookValidatedUser);

      await repo.update(created.id, { score: -7 } as Partial<HookValidatedUser>);
      const updated = await repo.getById(created.id);

      expect(updated?.score).toBe(7);
    } finally {
      await cleanupValidatedRepo(repo);
    }
  });

  it('should validate post-hook payloads for bulkUpdate', async () => {
    const repo = createValidatedRepo(db);

    try {
      repo.on('beforeCreate', payload => {
        (payload as HookValidatedUser).createdAt = new Date().toISOString();
      });
      repo.on('beforeBulkUpdate', payload => {
        for (const update of payload) {
          if (typeof update.data.score === 'number' && update.data.score < 0) {
            update.data.score = Math.abs(update.data.score);
          }
        }
      });

      const user1 = await repo.create({ name: 'Bulk Hook 1', score: 1 } as HookValidatedUser);
      const user2 = await repo.create({ name: 'Bulk Hook 2', score: 2 } as HookValidatedUser);

      await repo.bulkUpdate([
        { id: user1.id, data: { score: -10 } },
        { id: user2.id, data: { score: -20 } },
      ]);

      const updatedUser1 = await repo.getById(user1.id);
      const updatedUser2 = await repo.getById(user2.id);
      expect(updatedUser1?.score).toBe(10);
      expect(updatedUser2?.score).toBe(20);
    } finally {
      await cleanupValidatedRepo(repo);
    }
  });

  it('should validate query().update payloads after beforeBulkUpdate mutations', async () => {
    const repo = createValidatedRepo(db);

    try {
      repo.on('beforeCreate', payload => {
        (payload as HookValidatedUser).createdAt = new Date().toISOString();
      });

      const user = await repo.create({
        name: 'Query Hook Validation',
        score: 3,
      } as HookValidatedUser);

      await expect(
        repo.query().where('name', '==', user.name).update({ score: -1 }),
      ).rejects.toBeInstanceOf(ValidationError);

      repo.on('beforeBulkUpdate', payload => {
        for (const update of payload) {
          if (typeof update.data.score === 'number' && update.data.score < 0) {
            update.data.score = Math.abs(update.data.score);
          }
        }
      });

      await repo.query().where('name', '==', user.name).update({ score: -5 });

      const updated = await repo.getById(user.id);
      expect(updated?.score).toBe(5);
    } finally {
      await cleanupValidatedRepo(repo);
    }
  });

  it('should apply hook-first validation inside createInTransaction and updateInTransaction', async () => {
    const repo = createValidatedRepo(db);

    try {
      repo.on('beforeCreate', payload => {
        (payload as HookValidatedUser).createdAt =
          FieldValue.serverTimestamp() as unknown as string;
      });
      repo.on('beforeUpdate', payload => {
        if (typeof payload.score === 'number' && payload.score < 0) {
          payload.score = Math.abs(payload.score);
        }
      });

      const created = await repo.runInTransaction(async (tx, txRepo) => {
        return txRepo.createInTransaction(tx, {
          name: 'Tx Hook Validation',
          score: 9,
        } as HookValidatedUser);
      });

      await repo.runInTransaction(async (tx, txRepo) => {
        await txRepo.updateInTransaction(tx, created.id, {
          score: FieldValue.increment(3) as unknown as number,
        });
      });

      const updated = await repo.getById(created.id);
      expect((updated as any)?.createdAt?.toDate).toBeDefined();
      expect(updated?.score).toBe(12);
    } finally {
      await cleanupValidatedRepo(repo);
    }
  });

  it('should reject create payloads when sentinel fields pass but other fields fail validation', async () => {
    const repo = createValidatedRepo(db);

    try {
      await expect(
        repo.create({
          name: '',
          score: 1,
          createdAt: FieldValue.serverTimestamp() as unknown as string,
        } as HookValidatedUser),
      ).rejects.toBeInstanceOf(ValidationError);
    } finally {
      await cleanupValidatedRepo(repo);
    }
  });

  it('should reject update payloads when sentinel fields pass but other fields fail validation', async () => {
    const repo = createValidatedRepo(db);

    try {
      const created = await repo.create({
        name: 'Mixed Sentinel Failure',
        score: 1,
        createdAt: new Date().toISOString(),
      } as HookValidatedUser);

      await expect(
        repo.update(created.id, {
          name: '',
          score: FieldValue.increment(1) as unknown as number,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    } finally {
      await cleanupValidatedRepo(repo);
    }
  });
});
