import { z } from 'zod';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';

/**
 * Strategy: unit-test the v3 schema/identity contract (ADR-0018) at the Firestore-mock boundary.
 *  - The schema bundle describes the document's own read/create/update fields and must NOT declare a
 *    top-level `id` on any member (rejected at construction).
 *  - No hard-coded probe value is parsed, so refined non-`id` fields (uuid/regex/etc.) are accepted
 *    (this is the review B6 fix — the old probe wrongly rejected refined id schemas).
 *  - create/update still strip any client-supplied top-level `id`; the Firestore document name is
 *    authoritative.
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
    name: z.string().min(1),
    score: z.number().min(0).optional(),
  });
  const repo = FirestoreRepository.withSchema(db, 'users', userSchema);

  return { repo, userSchema, add, update, set, doc, collection };
}

describe('repository schema contracts', () => {
  it('rejects a subcollection schema that declares a top-level id', () => {
    const baseRepo = new FirestoreRepository<{ name: string }>(
      { collection: jest.fn() } as any,
      'users',
    );
    const mirroredSubcollectionSchema = z.object({
      id: z.string(),
      total: z.number(),
    });

    expect(() =>
      baseRepo.subcollection('parent-id', 'orders', mirroredSubcollectionSchema),
    ).toThrow(/top-level "id" field/i);
  });

  describe('top-level id rejection (withSchema)', () => {
    const db = { collection: jest.fn() } as any;

    it('accepts a schema with no top-level id', () => {
      expect(() =>
        FirestoreRepository.withSchema(db, 'users', z.object({ name: z.string() })),
      ).not.toThrow();
    });

    it('accepts refined, non-id fields (the old probe wrongly rejected these — B6)', () => {
      // No fabricated probe value is parsed, so uuid/regex/branded fields are fine as long as none is
      // the reserved top-level `id`.
      expect(() =>
        FirestoreRepository.withSchema(
          db,
          'users',
          z.object({
            externalId: z.string().uuid(),
            slug: z.string().regex(/^[a-z-]+$/),
            code: z.string().min(20),
          }),
        ),
      ).not.toThrow();
    });

    it('rejects a top-level id regardless of how it is declared', () => {
      for (const idField of [
        z.string(),
        z.string().uuid(),
        z.string().optional(),
        z.string().nullable(),
        z.string().transform(v => v.length),
      ]) {
        const schema = z.object({ id: idField as any, name: z.string() });
        expect(() => FirestoreRepository.withSchema(db, 'users', schema as any)).toThrow(
          /top-level "id" field/i,
        );
      }
    });
  });

  it('exposes read/create/update schemas and keeps them aligned with validator behavior', () => {
    const { repo, userSchema } = createSchemaRepoHarness();

    // The read schema should be the exact schema supplied by the consumer.
    expect(repo.schemas?.read).toBe(userSchema);
    expect(repo.readSchema).toBe(userSchema);
    expect(repo.createSchema).toBe(repo.schemas?.create);
    expect(repo.updateSchema).toBe(repo.schemas?.update);

    // A stray client-supplied top-level id is an unknown key and is stripped by parsing.
    const createParsed = repo.schemas?.create.parse({
      id: 'client-provided-id',
      name: 'Alice',
    }) as Record<string, unknown>;
    expect(createParsed).toEqual({ name: 'Alice' });

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

  // Review R3: the invariant is centralized in the constructor and must cover EVERY effective schema
  // member (read/create/update), not only `read`. `Validator` and `RepositorySchemaSet` are exported,
  // so a hand-rolled schema set / validator passed to the low-level constructor could otherwise
  // smuggle a top-level `id` in create/update even with an id-free read schema. The existing A8 tests
  // only exercise the factories (withSchema/subcollection).
  describe('top-level id rejection (low-level constructor — review R3)', () => {
    const db = { collection: jest.fn() } as any;
    const idFree = z.object({ name: z.string() });
    const idBearing = z.object({ id: z.string(), name: z.string() });
    const schemaSet = (create: z.ZodObject<any>, update: z.ZodObject<any>) => ({
      read: idFree,
      create,
      update,
    });

    it('rejects a custom schema set with a top-level id in the CREATE schema', () => {
      expect(
        () =>
          new FirestoreRepository(
            db,
            'users',
            undefined,
            undefined,
            undefined,
            schemaSet(idBearing, idFree),
          ),
      ).toThrow(/create schema.*top-level "id"/i);
    });

    it('rejects a custom schema set with a top-level id in the UPDATE schema', () => {
      expect(
        () =>
          new FirestoreRepository(
            db,
            'users',
            undefined,
            undefined,
            undefined,
            schemaSet(idFree, idBearing),
          ),
      ).toThrow(/update schema.*top-level "id"/i);
    });

    it('rejects a hand-rolled Validator whose create schema carries a top-level id', () => {
      const validator = {
        schemas: schemaSet(idBearing, idFree),
        parseCreate: (x: unknown) => x,
        parseUpdate: (x: unknown) => x,
      };
      expect(() => new FirestoreRepository(db, 'users', validator as any)).toThrow(
        /create schema.*top-level "id"/i,
      );
    });

    it('accepts a fully id-free custom schema set', () => {
      expect(
        () =>
          new FirestoreRepository(
            db,
            'users',
            undefined,
            undefined,
            undefined,
            schemaSet(idFree, idFree),
          ),
      ).not.toThrow();
    });

    it('accepts a nested author.id in create/update (only the top level is checked)', () => {
      const nested = z.object({ name: z.string(), author: z.object({ id: z.string() }) });
      expect(
        () =>
          new FirestoreRepository(
            db,
            'users',
            undefined,
            undefined,
            undefined,
            schemaSet(nested, nested),
          ),
      ).not.toThrow();
    });
  });
});
