import { z } from 'zod';
import { FirestoreDataConverter } from 'firebase-admin/firestore';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';

/**
 * Create a minimal Firestore converter used to assert that repository instances
 * pass converter objects into Firestore `withConverter(...)` correctly.
 */
function createConverter<T extends Record<string, unknown>>(): FirestoreDataConverter<T> {
  return {
    toFirestore: (data: T) => data,
    fromFirestore: (snapshot: FirebaseFirestore.QueryDocumentSnapshot) => snapshot.data() as T,
  };
}

describe('converter support', () => {
  it('keeps default behavior when no converter is provided', () => {
    const plainCollectionRef = {
      withConverter: jest.fn(),
    };
    const db = {
      collection: jest.fn().mockReturnValue(plainCollectionRef),
    } as any;

    const repo = new FirestoreRepository<{ id?: string; name: string }>(db, 'users');
    const resolvedCollection = (repo as any).col();

    expect(resolvedCollection).toBe(plainCollectionRef);
    expect(plainCollectionRef.withConverter).not.toHaveBeenCalled();
  });

  it('applies converter for top-level repositories when configured', () => {
    const converter = createConverter<{ id?: string; name: string }>();
    const convertedCollectionRef = { kind: 'converted' };
    const collectionRef = {
      withConverter: jest.fn().mockReturnValue(convertedCollectionRef),
    };
    const db = {
      collection: jest.fn().mockReturnValue(collectionRef),
    } as any;

    const repo = new FirestoreRepository<{ id?: string; name: string }>(
      db,
      'users',
      undefined,
      undefined,
      converter,
    );
    const resolvedCollection = (repo as any).col();

    expect(collectionRef.withConverter).toHaveBeenCalledWith(converter);
    expect(resolvedCollection).toBe(convertedCollectionRef);
  });

  it('does not inherit converter automatically in subcollections', () => {
    const parentConverter = createConverter<{ id?: string; name: string }>();
    const parentCollectionRef = {
      withConverter: jest.fn().mockReturnValue({ kind: 'parentConverted' }),
    };
    const childCollectionRef = {
      withConverter: jest.fn().mockReturnValue({ kind: 'childConverted' }),
    };

    const db = {
      collection: jest.fn((path: string) => {
        if (path === 'users') {
          return parentCollectionRef;
        }
        return childCollectionRef;
      }),
    } as any;

    const parentRepo = new FirestoreRepository<{ id?: string; name: string }>(
      db,
      'users',
      undefined,
      undefined,
      parentConverter,
    );
    // Access parent once to prove parent converter remains configured.
    (parentRepo as any).col();

    const subcollectionRepo = parentRepo.subcollection<{ id?: string; total: number }>(
      'user-123',
      'orders',
    );
    const childCollection = (subcollectionRepo as any).col();

    expect(db.collection).toHaveBeenCalledWith('users/user-123/orders');
    expect(childCollection).toBe(childCollectionRef);
    expect(childCollectionRef.withConverter).not.toHaveBeenCalled();
  });

  it('uses explicitly provided converter for subcollections', () => {
    const parentConverter = createConverter<{ id?: string; name: string }>();
    const childConverter = createConverter<{ id?: string; total: number }>();
    const parentCollectionRef = {
      withConverter: jest.fn().mockReturnValue({ kind: 'parentConverted' }),
    };
    const convertedChildCollectionRef = { kind: 'childConverted' };
    const childCollectionRef = {
      withConverter: jest.fn().mockReturnValue(convertedChildCollectionRef),
    };

    const db = {
      collection: jest.fn((path: string) => {
        if (path === 'users') {
          return parentCollectionRef;
        }
        return childCollectionRef;
      }),
    } as any;

    const parentRepo = new FirestoreRepository<{ id?: string; name: string }>(
      db,
      'users',
      undefined,
      undefined,
      parentConverter,
    );
    const subcollectionRepo = parentRepo.subcollection<{ id?: string; total: number }>(
      'user-123',
      'orders',
      undefined,
      childConverter,
    );
    const childCollection = (subcollectionRepo as any).col();

    expect(childCollectionRef.withConverter).toHaveBeenCalledWith(childConverter);
    expect(childCollection).toBe(convertedChildCollectionRef);
  });

  it('preserves converter configuration for transaction-scoped repositories', async () => {
    const converter = createConverter<{ id?: string; name: string }>();
    const convertedCollectionRef = {
      doc: jest.fn().mockReturnValue({}),
    };
    const collectionRef = {
      withConverter: jest.fn().mockReturnValue(convertedCollectionRef),
    };
    const db = {
      collection: jest.fn().mockReturnValue(collectionRef),
      runTransaction: jest.fn(
        async (handler: (tx: FirebaseFirestore.Transaction) => Promise<unknown>) => {
          return await handler({} as FirebaseFirestore.Transaction);
        },
      ),
    } as any;

    const repo = new FirestoreRepository<{ id?: string; name: string }>(
      db,
      'users',
      undefined,
      undefined,
      converter,
    );

    await repo.runInTransaction(async (_tx, txRepo) => {
      const txCollection = (txRepo as any).col();
      expect(collectionRef.withConverter).toHaveBeenCalledWith(converter);
      expect(txCollection).toBe(convertedCollectionRef);
      return null;
    });
  });

  it('supports converter usage through withSchema factory', () => {
    const userSchema = z.object({
      id: z.string(),
      name: z.string(),
    });
    const converter = createConverter<{ id?: string; name: string }>();
    const convertedCollectionRef = { kind: 'converted' };
    const collectionRef = {
      withConverter: jest.fn().mockReturnValue(convertedCollectionRef),
    };
    const db = {
      collection: jest.fn().mockReturnValue(collectionRef),
    } as any;

    const repo = FirestoreRepository.withSchema<{ id?: string; name: string }>(
      db,
      'users',
      userSchema,
      converter,
    );
    const resolvedCollection = (repo as any).col();

    expect(collectionRef.withConverter).toHaveBeenCalledWith(converter);
    expect(resolvedCollection).toBe(convertedCollectionRef);
  });

  it('throws when withSchema receives a schema without a required id field', () => {
    const missingIdSchema = z.object({
      name: z.string(),
    });
    const optionalIdSchema = z.object({
      id: z.string().optional(),
      name: z.string(),
    });
    const db = {} as any;

    expect(() =>
      FirestoreRepository.withSchema<{ id?: string; name: string }>(db, 'users', missingIdSchema),
    ).toThrow(/top-level "id" field/i);
    expect(() =>
      FirestoreRepository.withSchema<{ id?: string; name: string }>(db, 'users', optionalIdSchema),
    ).toThrow(/requires "id" to be required/i);
  });
});
