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
 *   6. `withSchema` rejects a top-level `id` on any schema (v3 virtual identity, ADR-0018).
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
const orderSubSchema = z.object({ total: z.number() });

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
      // A readConverter requires a storedSchema (ADR-0018 / R6). This converter does not restructure
      // fields, so the at-rest shape equals the read schema.
      storedSchema: orderSubSchema,
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
      name: z.string(),
    });
    const readConverter = createReadConverter<{ name: string }>();
    const convertedCollectionRef = { kind: 'converted' };
    const collectionRef = {
      withConverter: jest.fn().mockReturnValue(convertedCollectionRef),
    };
    const db = {
      collection: jest.fn().mockReturnValue(collectionRef),
    } as any;

    // A readConverter is present, so storedSchema is required (ADR-0018 / A3).
    const repo = FirestoreRepository.withSchema(db, 'users', userSchema, {
      readConverter,
      storedSchema: userSchema,
    });

    expect((repo as any).readCol()).toBe(convertedCollectionRef);
    expectWrappedWith(collectionRef.withConverter, readConverter);
  });

  it('forwards options.readConverter to the read ref through the raw() factory (review R7)', () => {
    // raw() is the unvalidated escape hatch and takes no storedSchema (no schema to infer from), so
    // this is the only factory that wires a converter without one. Locks raw()'s converter threading.
    const readConverter = createReadConverter<{ name: string }>();
    const convertedCollectionRef = { kind: 'converted' };
    const collectionRef = {
      withConverter: jest.fn().mockReturnValue(convertedCollectionRef),
    };
    const db = {
      collection: jest.fn().mockReturnValue(collectionRef),
    } as any;

    const repo = FirestoreRepository.raw<{ name: string }>(db, 'users', { readConverter });

    expect((repo as any).readCol()).toBe(convertedCollectionRef);
    expectWrappedWith(collectionRef.withConverter, readConverter);
  });

  it('rejects a read schema that declares a top-level id (v3 virtual identity)', () => {
    const mirroredSchema = z.object({
      id: z.string(),
      name: z.string(),
    });
    const idlessSchema = z.object({
      name: z.string(),
    });
    const db = {} as any;

    expect(() => FirestoreRepository.withSchema(db, 'users', mirroredSchema)).toThrow(
      /top-level "id" field/i,
    );
    // A read schema without a top-level id is accepted.
    expect(() => FirestoreRepository.withSchema(db, 'users', idlessSchema)).not.toThrow();
  });

  // Review R6: the storedSchema-with-converter invariant must be enforced at RUNTIME, not only by the
  // TypeScript overloads. A JavaScript caller — or a TS call crossing an `any` boundary — must get a
  // construction-time error rather than a structurally-unsound repository.
  describe('storedSchema required with a readConverter at runtime (review R6)', () => {
    const db = { collection: jest.fn() } as any;
    const userSchema = z.object({ name: z.string() });
    const orderSchema = z.object({ total: z.number() });
    const readConverter = createReadConverter<{ name: string }>();

    it('throws when withSchema gets a readConverter without a storedSchema (any boundary)', () => {
      expect(() =>
        FirestoreRepository.withSchema(db, 'users', userSchema, { readConverter } as any),
      ).toThrow(/readConverter requires a storedSchema/i);
    });

    it('does not throw when storedSchema is present with a readConverter', () => {
      expect(() =>
        FirestoreRepository.withSchema(db, 'users', userSchema, {
          readConverter,
          storedSchema: userSchema,
        }),
      ).not.toThrow();
    });

    it('does not throw for a converter-absent call (guard is gated on readConverter presence)', () => {
      expect(() =>
        FirestoreRepository.withSchema(db, 'users', userSchema, { storedSchema: userSchema }),
      ).not.toThrow();
    });

    it('does not throw when readConverter is explicitly undefined (overload 1)', () => {
      expect(() =>
        FirestoreRepository.withSchema(db, 'users', userSchema, { readConverter: undefined }),
      ).not.toThrow();
    });

    it('throws for a subcollection readConverter without a storedSchema', () => {
      const parent = new FirestoreRepository<{ name: string }>(db, 'users');
      expect(() =>
        (parent as any).subcollection('p1', 'orders', orderSchema, { readConverter }),
      ).toThrow(/readConverter requires a storedSchema/i);
    });

    it('does not throw for a subcollection with both a readConverter and a storedSchema', () => {
      const parent = new FirestoreRepository<{ name: string }>(db, 'users');
      expect(() =>
        parent.subcollection('p1', 'orders', orderSchema, {
          readConverter: createReadConverter<{ total: number }>(),
          storedSchema: orderSchema,
        }),
      ).not.toThrow();
    });
  });
});
