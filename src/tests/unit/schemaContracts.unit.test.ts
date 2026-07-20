import { z } from 'zod';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';

/**
 * Creates a repository with a deterministic Firestore mock so tests can assert
 * exactly which payload reaches Firestore write APIs.
 */
function createSchemaRepoHarness() {
  const add = jest.fn().mockResolvedValue({ id: 'generated-doc-id' });
  const update = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn().mockResolvedValue(undefined);
  const get = jest.fn().mockResolvedValue({ exists: false });
  const doc = jest.fn(() => ({
    id: 'doc-ref-id',
    update,
    set,
    get,
  }));
  const collection = jest.fn(() => ({
    add,
    doc,
    withConverter: jest.fn(),
  }));
  const db = { collection } as any;

  const userSchema = z.object({
    id: z.string(),
    name: z.string().min(1),
    score: z.number().min(0).optional(),
  });
  const repo = FirestoreRepository.withSchema(db, 'users', userSchema);

  return { repo, userSchema, add, update, set, doc, collection };
}

describe('repository schema contracts', () => {
  it('throws when subcollection schema does not include required id', () => {
    const baseRepo = new FirestoreRepository<{ id?: string; name: string }>(
      { collection: jest.fn() } as any,
      'users',
    );
    const invalidSubcollectionSchema = z.object({
      total: z.number(),
    });

    expect(() => baseRepo.subcollection('parent-id', 'orders', invalidSubcollectionSchema)).toThrow(
      /top-level "id" field/i,
    );
  });

  describe('id-schema validation (withSchema)', () => {
    const db = { collection: jest.fn() } as any;

    it('accepts a plain required string id', () => {
      expect(() =>
        FirestoreRepository.withSchema(db, 'users', z.object({ id: z.string(), name: z.string() })),
      ).not.toThrow();
    });

    it('rejects an optional id', () => {
      const schema = z.object({ id: z.string().optional(), name: z.string() });
      expect(() => FirestoreRepository.withSchema(db, 'users', schema as any)).toThrow(/required/i);
    });

    it('rejects a nullable id', () => {
      const schema = z.object({ id: z.string().nullable(), name: z.string() });
      expect(() => FirestoreRepository.withSchema(db, 'users', schema as any)).toThrow(
        /non-nullable/i,
      );
    });

    it('rejects an id whose transform changes the parsed output type', () => {
      // z.string().transform(v => v.length) accepts a string but yields a number — this would
      // break the repository's `T & { id: string }` contract.
      const schema = z.object({ id: z.string().transform(v => v.length), name: z.string() });
      expect(() => FirestoreRepository.withSchema(db, 'users', schema as any)).toThrow(
        /accept and preserve string values/i,
      );
    });
  });

  it('exposes read/create/update schemas and keeps them aligned with validator behavior', () => {
    const { repo, userSchema } = createSchemaRepoHarness();

    // The read schema should be the exact schema supplied by the consumer.
    expect(repo.schemas?.read).toBe(userSchema);
    expect(repo.readSchema).toBe(userSchema);
    expect(repo.createSchema).toBe(repo.schemas?.create);
    expect(repo.updateSchema).toBe(repo.schemas?.update);

    // Create schema should drop top-level id from parsed payloads.
    const createParsed = repo.schemas?.create.parse({
      id: 'client-provided-id',
      name: 'Alice',
    }) as Record<string, unknown>;
    expect(createParsed).toEqual({ name: 'Alice' });

    // Update schema should allow partial updates while still dropping top-level id.
    const updateParsed = repo.schemas?.update.parse({
      id: 'client-provided-id',
      score: 5,
    }) as Record<string, unknown>;
    expect(updateParsed).toEqual({ score: 5 });
  });

  it('strips top-level id from create payloads and returns Firestore-derived ids', async () => {
    const { repo, add } = createSchemaRepoHarness();

    const created = await repo.create({
      id: 'client-id-should-be-ignored',
      name: 'Create Test',
    } as any);

    // The payload persisted to Firestore must not include a client id field.
    expect(add).toHaveBeenCalledWith({ name: 'Create Test' });
    // The repository contract uses Firestore ids as the authoritative id.
    expect(created.id).toBe('generated-doc-id');
  });

  it('strips top-level id from update payloads before Firestore writes', async () => {
    const { repo, update, doc } = createSchemaRepoHarness();

    await repo.update(
      'server-doc-id',
      {
        id: 'client-id-should-be-ignored',
        score: 8,
      } as any,
      { merge: true },
    );

    // This confirms the id strip happens after hooks and before the write API call.
    expect(doc).toHaveBeenCalledWith('server-doc-id');
    expect(update).toHaveBeenCalledWith({ score: 8 });
  });
});
