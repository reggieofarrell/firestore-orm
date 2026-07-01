import { FieldValue } from 'firebase-admin/firestore';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';

describe('update merge normalization helper', () => {
  function createRepo() {
    const db = {
      collection: jest.fn(),
    } as any;

    return new FirestoreRepository<{ id?: string }>(db, 'users');
  }

  it('should flatten plain nested objects into dot-notation keys', () => {
    const repo = createRepo();

    const normalized = (repo as any).normalizeUpdateDataForMerge({
      profile: {
        settings: {
          theme: 'dark',
        },
      },
      status: 'active',
    });

    expect(normalized).toEqual({
      'profile.settings.theme': 'dark',
      status: 'active',
    });
  });

  it('should let explicit dot-notation keys override flattened object keys', () => {
    const repo = createRepo();

    const normalized = (repo as any).normalizeUpdateDataForMerge({
      profile: {
        name: 'From Object',
        age: 30,
      },
      'profile.name': 'From Dot Notation',
    });

    expect(normalized).toEqual({
      'profile.age': 30,
      'profile.name': 'From Dot Notation',
    });
  });

  it('should not flatten arrays, dates, or sentinel values beyond their object path', () => {
    const repo = createRepo();
    const now = new Date('2026-01-01T00:00:00.000Z');
    const increment = FieldValue.increment(1);

    const normalized = (repo as any).normalizeUpdateDataForMerge({
      profile: {
        tags: ['a', 'b'],
        updatedAt: now,
        loginCount: increment,
      },
    });

    expect(normalized).toEqual({
      'profile.tags': ['a', 'b'],
      'profile.updatedAt': now,
      'profile.loginCount': increment,
    });
  });
});
