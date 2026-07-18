import { z } from 'zod';
import { FirestoreRepository, ReadConverter } from '../../core/FirestoreRepository.js';

/**
 * Strategy: unit tests asserting how repository instances wire a `readConverter` into Firestore refs.
 *
 * A `readConverter` is the `fromFirestore` half of a converter only (a `(snapshot) => T` mapper). The
 * repository builds the full `FirestoreDataConverter` internally — the supplied `fromFirestore` plus a
 * pass-through `toFirestore` — and attaches it to the READ ref only, so `fromFirestore` runs on reads
 * while the WRITE ref stays raw (so `toFirestore` is never invoked on any write path). These tests
 * verify:
 *   1. no converter → both refs are the plain collection ref;
 *   2. with a `readConverter` → the READ ref is `.withConverter(...)`-wrapped with an object whose
 *      `fromFirestore` is the supplied mapper, and the WRITE ref is raw (not wrapped);
 *   3. subcollections do not inherit a parent converter and honor their own `readConverter`;
 *   4. transaction-scoped repositories preserve the read-ref converter wrapping;
 *   5. the `withSchema` factory forwards `options.readConverter` to the read ref;
 *   6. `withSchema` still enforces a required top-level `id` on the read schema.
 */
function createReadConverter<T>(): ReadConverter<T> {
  return snapshot => snapshot.data() as T;
}

/** Assert `withConverter` was called with a converter object carrying the given `fromFirestore`. */
function expectWrappedWith(withConverter: jest.Mock, fromFirestore: ReadConverter<unknown>): void {
  expect(withConverter).toHaveBeenCalledTimes(1);
  const passed = withConverter.mock.calls[0][0];
  expect(passed.fromFirestore).toBe(fromFirestore);
  expect(typeof passed.toFirestore).toBe('function');
}

// Minimal subcollection read schema — subcollections require a schema; converter behavior below is
// independent of it.
const orderSubSchema = z.object({ id: z.string(), total: z.number() });

describe('read-only converter support', () => {
  it('keeps default behavior when no converter is provided', () => {
    const plainCollectionRef = {
      withConverter: jest.fn(),
    };
    const db = {
      collection: jest.fn().mockReturnValue(plainCollectionRef),
    } as any;

    const repo = new FirestoreRepository<{ id?: string; name: string }>(db, 'users');

    expect((repo as any).readCol()).toBe(plainCollectionRef);
    expect((repo as any).writeCol()).toBe(plainCollectionRef);
    expect(plainCollectionRef.withConverter).not.toHaveBeenCalled();
  });

  it('wraps the READ ref with the built converter but leaves the WRITE ref raw', () => {
    const readConverter = createReadConverter<{ id?: string; name: string }>();
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
      readConverter,
    );

    // Read ref: wrapped with a converter whose fromFirestore is the supplied mapper.
    expect((repo as any).readCol()).toBe(convertedCollectionRef);
    expectWrappedWith(collectionRef.withConverter, readConverter);

    // Write ref: raw — the converter is never attached, so `toFirestore` can never run on writes.
    collectionRef.withConverter.mockClear();
    expect((repo as any).writeCol()).toBe(collectionRef);
    expect(collectionRef.withConverter).not.toHaveBeenCalled();
  });

  it('does not inherit converter automatically in subcollections', () => {
    const parentReadConverter = createReadConverter<{ id?: string; name: string }>();
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
      parentReadConverter,
    );
    // Access parent once to prove parent converter remains configured.
    (parentRepo as any).readCol();

    const subcollectionRepo = parentRepo.subcollection('user-123', 'orders', orderSubSchema);
    const childCollection = (subcollectionRepo as any).readCol();

    expect(db.collection).toHaveBeenCalledWith('users/user-123/orders');
    expect(childCollection).toBe(childCollectionRef);
    expect(childCollectionRef.withConverter).not.toHaveBeenCalled();
  });

  it('uses explicitly provided readConverter for subcollections', () => {
    const parentReadConverter = createReadConverter<{ id?: string; name: string }>();
    const childReadConverter = createReadConverter<{ id?: string; total: number }>();
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
      parentReadConverter,
    );
    const subcollectionRepo = parentRepo.subcollection('user-123', 'orders', orderSubSchema, {
      readConverter: childReadConverter,
    });
    const childCollection = (subcollectionRepo as any).readCol();

    expectWrappedWith(childCollectionRef.withConverter, childReadConverter);
    expect(childCollection).toBe(convertedChildCollectionRef);
  });

  it('preserves read-ref converter configuration for transaction-scoped repositories', async () => {
    const readConverter = createReadConverter<{ id?: string; name: string }>();
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
      readConverter,
    );

    await repo.runInTransaction(async (_tx, txRepo) => {
      const txCollection = (txRepo as any).readCol();
      expectWrappedWith(collectionRef.withConverter, readConverter);
      expect(txCollection).toBe(convertedCollectionRef);
      return null;
    });
  });

  it('forwards options.readConverter to the read ref through the withSchema factory', () => {
    const userSchema = z.object({
      id: z.string(),
      name: z.string(),
    });
    const readConverter = createReadConverter<{ id?: string; name: string }>();
    const convertedCollectionRef = { kind: 'converted' };
    const collectionRef = {
      withConverter: jest.fn().mockReturnValue(convertedCollectionRef),
    };
    const db = {
      collection: jest.fn().mockReturnValue(collectionRef),
    } as any;

    const repo = FirestoreRepository.withSchema(db, 'users', userSchema, { readConverter });

    expect((repo as any).readCol()).toBe(convertedCollectionRef);
    expectWrappedWith(collectionRef.withConverter, readConverter);
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

    expect(() => FirestoreRepository.withSchema(db, 'users', missingIdSchema)).toThrow(
      /top-level "id" field/i,
    );
    expect(() => FirestoreRepository.withSchema(db, 'users', optionalIdSchema)).toThrow(
      /requires "id" to be required/i,
    );
  });
});
