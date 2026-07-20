import { ConflictError, NotFoundError, ValidationError } from '../../core/Errors.js';
import { createTestUserInput } from '../shared/factories/user.factory.js';
import { createUserRepoHarness } from './helpers/firestoreIntegrationHarness.js';

describe('FirestoreRepository update return and hook contracts', () => {
  const harness = createUserRepoHarness('test_users_update_contracts');
  const { userRepo, trackUser, cleanupTrackedUsers, cleanupCollection } = harness;

  afterEach(async () => {
    await cleanupTrackedUsers();
  });

  afterAll(async () => {
    await cleanupCollection();
  });

  it('should return only the updated document id from update()', async () => {
    const user = await userRepo.create(createTestUserInput({ name: 'Return Shape Test' }));
    trackUser(user.id);

    const result = await userRepo.update(user.id, {
      name: 'Return Shape Updated',
    });

    expect(result).toEqual({ id: user.id });
  });

  it('should return the updated document from update() when returnDoc is true', async () => {
    const user = await userRepo.create({
      name: 'ReturnDoc Update',
      email: 'returndoc-update-before@example.com',
      profile: { verified: false },
    } as any);
    trackUser(user.id);

    const result = await userRepo.update(
      user.id,
      {
        name: 'ReturnDoc Update After',
        'profile.verified': true,
      } as any,
      { returnDoc: true },
    );

    expect(result.id).toBe(user.id);
    expect(result.name).toBe('ReturnDoc Update After');
    expect(result.profile?.verified).toBe(true);
  });

  it('should throw NotFoundError when updating a missing document', async () => {
    await expect(
      userRepo.update('does-not-exist', { name: 'Missing User' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('should support update(..., { merge: true }) for existing documents', async () => {
    const user = await userRepo.create({
      name: 'Merge Existing',
      profile: {
        theme: 'light',
        notifications: false,
      },
    } as any);
    trackUser(user.id);

    const result = await userRepo.update(user.id, { 'profile.theme': 'dark' } as any, {
      merge: true,
    });

    expect(result).toEqual({ id: user.id });

    const updatedUser = await userRepo.getById(user.id);
    expect(updatedUser?.profile?.theme).toBe('dark');
    expect(updatedUser?.profile?.notifications).toBe(false);
  });

  it('should still throw NotFoundError when update(..., { merge: true }) targets missing document', async () => {
    await expect(
      userRepo.update('does-not-exist-merge', { name: 'Missing Merge User' } as any, {
        merge: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('should prefer explicit dot notation keys over flattened object keys in merge mode', async () => {
    const user = await userRepo.create({
      name: 'Conflict User',
      profile: {
        name: 'Before',
        age: 21,
      },
    } as any);
    trackUser(user.id);

    await userRepo.update(
      user.id,
      {
        profile: {
          name: 'From Object',
          age: 33,
        },
        'profile.name': 'From Dot Notation',
      } as any,
      { merge: true },
    );

    const updatedUser = await userRepo.getById(user.id);
    expect(updatedUser?.profile?.name).toBe('From Dot Notation');
    expect(updatedUser?.profile?.age).toBe(33);
  });

  it('should expose patch() as a merge-style convenience alias', async () => {
    const user = await userRepo.create({
      name: 'Patch Alias User',
      profile: {
        theme: 'light',
        notifications: false,
      },
    } as any);
    trackUser(user.id);

    const result = await userRepo.patch(user.id, {
      profile: {
        theme: 'dark',
      },
    } as any);

    expect(result).toEqual({ id: user.id });
    const updatedUser = await userRepo.getById(user.id);
    expect(updatedUser?.profile?.theme).toBe('dark');
    expect(updatedUser?.profile?.notifications).toBe(false);
  });

  it('should return the updated document from patch() when returnDoc is true', async () => {
    const user = await userRepo.create({
      name: 'Patch ReturnDoc',
      profile: { settings: { theme: 'light', notifications: false } },
    } as any);
    trackUser(user.id);

    const result = await userRepo.patch(
      user.id,
      {
        profile: {
          settings: {
            theme: 'dark',
          },
        },
      } as any,
      { returnDoc: true },
    );

    expect(result.id).toBe(user.id);
    expect(result.profile?.settings?.theme).toBe('dark');
    expect(result.profile?.settings?.notifications).toBe(false);
  });

  it('should throw NotFoundError when patch() targets a missing document', async () => {
    await expect(
      userRepo.patch('does-not-exist-patch', { name: 'Missing Patch User' } as any),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('should expose bulkPatch() as a merge-style convenience alias for batch updates', async () => {
    const user1 = await userRepo.create({
      name: 'Bulk Patch 1',
      profile: { settings: { theme: 'light', notifications: false } },
    } as any);
    const user2 = await userRepo.create({
      name: 'Bulk Patch 2',
      profile: { settings: { theme: 'light', notifications: false } },
    } as any);
    trackUser(user1.id);
    trackUser(user2.id);

    const result = await userRepo.bulkPatch([
      {
        id: user1.id,
        data: {
          profile: { settings: { theme: 'dark' } },
        } as any,
      },
      {
        id: user2.id,
        data: {
          'profile.settings.notifications': true,
        } as any,
      },
    ]);

    expect(result).toEqual([{ id: user1.id }, { id: user2.id }]);

    const updatedUser1 = await userRepo.getById(user1.id);
    const updatedUser2 = await userRepo.getById(user2.id);
    expect(updatedUser1?.profile?.settings?.theme).toBe('dark');
    expect(updatedUser1?.profile?.settings?.notifications).toBe(false);
    expect(updatedUser2?.profile?.settings?.theme).toBe('light');
    expect(updatedUser2?.profile?.settings?.notifications).toBe(true);
  });

  it('should let explicit dot notation override flattened object keys in bulkPatch()', async () => {
    const user = await userRepo.create({
      name: 'Bulk Patch Conflict',
      profile: { name: 'Before', age: 20 },
    } as any);
    trackUser(user.id);

    await userRepo.bulkPatch([
      {
        id: user.id,
        data: {
          profile: { name: 'From Object', age: 35 },
          'profile.name': 'From Dot Notation',
        } as any,
      },
    ]);

    const updatedUser = await userRepo.getById(user.id);
    expect(updatedUser?.profile?.name).toBe('From Dot Notation');
    expect(updatedUser?.profile?.age).toBe(35);
  });

  it('should emit id-only payload for afterUpdate', async () => {
    const user = await userRepo.create({
      name: 'After Hook Test',
    });
    trackUser(user.id);

    let afterUpdatePayload: unknown = null;
    userRepo.on('afterUpdate', payload => {
      afterUpdatePayload = payload;
    });

    await userRepo.update(user.id, { name: 'After Hook Test Updated' });
    expect(afterUpdatePayload).toEqual({ id: user.id });
  });

  it('should emit id-list payload for afterBulkUpdate', async () => {
    const user1 = await userRepo.create({ name: 'Bulk Hook 1' });
    const user2 = await userRepo.create({ name: 'Bulk Hook 2' });
    trackUser(user1.id);
    trackUser(user2.id);

    let afterBulkUpdatePayload: unknown = null;
    userRepo.on('afterBulkUpdate', payload => {
      afterBulkUpdatePayload = payload;
    });

    await userRepo.bulkUpdate([
      { id: user1.id, data: { name: 'Bulk Hook 1 Updated' } },
      { id: user2.id, data: { name: 'Bulk Hook 2 Updated' } },
    ]);

    expect(afterBulkUpdatePayload).toEqual({ ids: [user1.id, user2.id] });
  });

  it('should emit id-list payload for afterBulkUpdate from query().update()', async () => {
    const user1 = await userRepo.create({ name: 'Query Hook 1' }, { returnDoc: true });
    const user2 = await userRepo.create({ name: 'Query Hook 2' }, { returnDoc: true });
    trackUser(user1.id);
    trackUser(user2.id);

    let afterBulkUpdatePayload: unknown = null;
    userRepo.on('afterBulkUpdate', payload => {
      afterBulkUpdatePayload = payload;
    });

    await userRepo
      .query()
      .where('name', 'in', [user1.name, user2.name] as any)
      .update({ 'profile.verified': true } as any);

    expect(afterBulkUpdatePayload).toEqual({ ids: expect.arrayContaining([user1.id, user2.id]) });
  });

  it('should return id-only payload for upsert create path', async () => {
    const upsertId = `upsert-create-${Date.now()}`;
    trackUser(upsertId);

    const result = await userRepo.upsert(upsertId, {
      name: 'Upsert Create',
      email: 'upsert-create@example.com',
    });

    expect(result).toEqual({ id: upsertId });
  });

  it('should return created document payload for upsert create path when returnDoc is true', async () => {
    const upsertId = `upsert-create-returndoc-${Date.now()}`;
    trackUser(upsertId);

    const result = await userRepo.upsert(
      upsertId,
      {
        name: 'Upsert Create ReturnDoc',
        email: 'upsert-create-returndoc@example.com',
      },
      { returnDoc: true },
    );

    expect(result.id).toBe(upsertId);
    expect(result.name).toBe('Upsert Create ReturnDoc');
    expect(result.email).toBe('upsert-create-returndoc@example.com');
  });

  it('should return id-only payload for upsert update path', async () => {
    const user = await userRepo.create({
      name: 'Upsert Update',
      email: 'upsert-update-before@example.com',
    });
    trackUser(user.id);

    const result = await userRepo.upsert(user.id, {
      name: 'Upsert Updated',
      email: 'upsert-update-after@example.com',
    });

    expect(result).toEqual({ id: user.id });
  });

  it('should return updated document payload for upsert update path when returnDoc is true', async () => {
    const user = await userRepo.create({
      name: 'Upsert Update ReturnDoc Before',
      email: 'upsert-update-returndoc-before@example.com',
    });
    trackUser(user.id);

    const result = await userRepo.upsert(
      user.id,
      {
        name: 'Upsert Update ReturnDoc After',
        email: 'upsert-update-returndoc-after@example.com',
      },
      { returnDoc: true },
    );

    expect(result.id).toBe(user.id);
    expect(result.name).toBe('Upsert Update ReturnDoc After');
    expect(result.email).toBe('upsert-update-returndoc-after@example.com');
  });

  it('should return a document from getByIdOrThrow() when document exists', async () => {
    const user = await userRepo.create({
      name: 'OrThrow ById',
      email: 'orthrow-by-id@example.com',
    });
    trackUser(user.id);

    const result = await userRepo.getByIdOrThrow(user.id);

    expect(result.id).toBe(user.id);
    expect(result.email).toBe('orthrow-by-id@example.com');
  });

  it('should throw NotFoundError from getByIdOrThrow() when document is missing', async () => {
    await expect(userRepo.getByIdOrThrow('missing-getByIdOrThrow')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('should return a document from getOneByFieldOrThrow() when exactly one match exists', async () => {
    const uniqueEmail = `one-by-field-${Date.now()}@example.com`;
    const user = await userRepo.create({
      name: 'One By Field',
      email: uniqueEmail,
    });
    trackUser(user.id);

    const result = await userRepo.getOneByFieldOrThrow('email', uniqueEmail);

    expect(result.id).toBe(user.id);
    expect(result.email).toBe(uniqueEmail);
  });

  it('should throw NotFoundError from getOneByFieldOrThrow() when no match exists', async () => {
    await expect(
      userRepo.getOneByFieldOrThrow('email', 'missing-getOneByFieldOrThrow@example.com'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('should throw ConflictError from getOneByFieldOrThrow() when multiple matches exist', async () => {
    const duplicateName = `duplicate-name-${Date.now()}`;
    const userA = await userRepo.create({
      name: duplicateName,
      email: `dup-a-${Date.now()}@example.com`,
    });
    const userB = await userRepo.create({
      name: duplicateName,
      email: `dup-b-${Date.now()}@example.com`,
    });
    trackUser(userA.id);
    trackUser(userB.id);

    await expect(userRepo.getOneByFieldOrThrow('name', duplicateName)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe('FirestoreRepository empty-update policy (v3: reject empty patches)', () => {
  const harness = createUserRepoHarness('test_users_empty_update');
  const { userRepo, trackUser, cleanupTrackedUsers, cleanupCollection } = harness;

  afterEach(async () => {
    await cleanupTrackedUsers();
  });

  afterAll(async () => {
    await cleanupCollection();
  });

  it('update() rejects an empty payload instead of falsely succeeding on a missing document', async () => {
    // Previously an empty patch skipped the Firestore write, so a nonexistent doc was reported as
    // updated. Now it throws before any write.
    await expect(
      userRepo.update('missing-empty-id', { name: undefined } as any),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('update() still throws NotFoundError for a non-empty patch on a missing document', async () => {
    await expect(userRepo.update('missing-id', { name: 'x' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('bulkUpdate() rejects when any item sanitizes to an empty payload', async () => {
    const user = await userRepo.create(createTestUserInput({ name: 'Bulk Empty' }));
    trackUser(user.id);
    await expect(
      userRepo.bulkUpdate([{ id: user.id, data: { name: undefined } as any }]),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('updateInTransaction() rejects an empty payload', async () => {
    await expect(
      userRepo.runInTransaction(async (tx, repo) => {
        await repo.updateInTransaction(tx, 'missing-tx-id', { name: undefined } as any);
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('query().update() rejects an empty payload on matched documents', async () => {
    const user = await userRepo.create(
      createTestUserInput({ name: 'Query Empty', email: 'query-empty@example.com' }),
      { returnDoc: true },
    );
    trackUser(user.id);
    await expect(
      userRepo
        .query()
        .where('email', '==', 'query-empty@example.com')
        .update({ name: undefined } as any),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  // Regression: the empty-update contract must not be data-dependent. Previously query().update()
  // returned 0 on a zero-match query BEFORE validating, so an empty payload silently "succeeded"
  // when nothing matched but threw as soon as one document matched.
  it('query().update() rejects an empty payload even when the query matches nothing', async () => {
    await expect(
      userRepo
        .query()
        .where('email', '==', 'no-such-user@example.com')
        .update({} as any),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      userRepo
        .query()
        .where('email', '==', 'no-such-user@example.com')
        .update({ name: undefined } as any),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('query().update() returns 0 for a valid non-empty payload against a zero-match query', async () => {
    const count = await userRepo
      .query()
      .where('email', '==', 'no-such-user@example.com')
      .update({ name: 'Nobody' });
    expect(count).toBe(0);
  });
});
