/**
 * Strategy: emulator integration tests for the opt-in vector search extension.
 * Verifies withVectorSearch wiring, KNN queries, pre-filters, distance options, and guards.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import {
  assertVectorSearchSupported,
  isVectorFieldValue,
  VectorDistanceMeasure,
  withVectorSearch,
  vectorEmbeddingSchema,
} from '../../vector/index.js';
import { VectorQueryBuilder } from '../../vector/VectorQueryBuilder.js';
import { createVectorDocRepoHarness, VectorDoc } from './helpers/firestoreIntegrationHarness.js';

describe('Vector search extension', () => {
  const harness = createVectorDocRepoHarness();
  const { db, vectorRepo, prefilterRepo, cleanupVectorCollections } = harness;

  const vectorDocSchema = z.object({
    id: z.string(),
    name: z.string(),
    category: z.string().optional(),
    embedding: vectorEmbeddingSchema(3).optional(),
  });

  afterEach(async () => {
    await cleanupVectorCollections();
  });

  async function seedBasicVectors() {
    await vectorRepo.create({
      name: 'nearest',
      embedding: FieldValue.vector([1, 0, 0]),
    } as VectorDoc);
    await vectorRepo.create({
      name: 'middle',
      embedding: FieldValue.vector([0.9, 0.1, 0]),
    } as VectorDoc);
    await vectorRepo.create({
      name: 'far',
      embedding: FieldValue.vector([0, 1, 0]),
    } as VectorDoc);
  }

  it('should wrap a repository and return a VectorQueryBuilder from query()', () => {
    const wrapped = withVectorSearch(vectorRepo);
    const builder = wrapped.query();
    expect(builder).toBeInstanceOf(VectorQueryBuilder);
  });

  it('should create documents with a top-level FieldValue.vector embedding', async () => {
    const created = await vectorRepo.create({
      name: 'vector-doc',
      embedding: FieldValue.vector([1, 2, 3]),
    } as VectorDoc);

    const fetched = await vectorRepo.getById(created.id);
    expect(fetched?.name).toBe('vector-doc');
  });

  it('should support FieldValue.vector through schema validation on create', async () => {
    const schemaRepo = FirestoreRepository.withSchema(
      db,
      'test_vectors_schema_validated',
      vectorDocSchema,
    );
    const wrapped = withVectorSearch(schemaRepo);

    const created = await wrapped.create({
      name: 'schema-vector-doc',
      embedding: FieldValue.vector([1, 0, 0]),
    });

    const fetched = await wrapped.getById(created.id);
    expect(fetched?.name).toBe('schema-vector-doc');

    const schemaDocs = await schemaRepo.query().get();
    if (schemaDocs.length > 0) {
      await schemaRepo.bulkDelete(schemaDocs.map(doc => doc.id));
    }
  });

  it('should proxy repository write methods through withVectorSearch', async () => {
    const wrapped = withVectorSearch(vectorRepo);
    const created = await wrapped.create(
      {
        name: 'proxied-create',
        embedding: FieldValue.vector([0.5, 0.5, 0]),
      } as VectorDoc,
      { returnDoc: true },
    );

    expect(created.name).toBe('proxied-create');
  });

  it('should return nearest neighbors from findNearest().get()', async () => {
    await seedBasicVectors();

    const wrapped = withVectorSearch(vectorRepo);
    const results = await wrapped
      .query()
      .findNearest({
        vectorField: 'embedding',
        queryVector: [1, 0, 0],
        limit: 2,
        distanceMeasure: 'EUCLIDEAN',
      })
      .get();

    expect(results).toHaveLength(2);
    expect(results[0]?.name).toBe('nearest');
    expect(results[1]?.name).toBe('middle');
  });

  it('should support pre-filtered vector search with where()', async () => {
    await prefilterRepo.create({
      name: 'books-a',
      category: 'books',
      embedding: FieldValue.vector([1, 0, 0]),
    } as VectorDoc);
    await prefilterRepo.create({
      name: 'games-a',
      category: 'games',
      embedding: FieldValue.vector([0.2, 0.9, 0]),
    } as VectorDoc);

    const wrapped = withVectorSearch(prefilterRepo);
    const results = await wrapped
      .query()
      .where('category', '==', 'books')
      .findNearest({
        vectorField: 'embedding',
        queryVector: [1, 0, 0],
        limit: 5,
        distanceMeasure: 'EUCLIDEAN',
      })
      .get();

    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe('books-a');
  });

  it('should include distanceResultField values when configured', async () => {
    await seedBasicVectors();

    const wrapped = withVectorSearch(vectorRepo);
    const results = await wrapped
      .query()
      .findNearest({
        vectorField: 'embedding',
        queryVector: [1, 0, 0],
        limit: 2,
        distanceMeasure: 'EUCLIDEAN',
        distanceResultField: 'vectorDistance',
      })
      .get();

    expect(results[0]).toHaveProperty('vectorDistance');
    expect(typeof (results[0] as { vectorDistance?: number }).vectorDistance).toBe('number');
  });

  it('should apply distanceThreshold when configured', async () => {
    await seedBasicVectors();

    const wrapped = withVectorSearch(vectorRepo);
    const results = await wrapped
      .query()
      .findNearest({
        vectorField: 'embedding',
        queryVector: [1, 0, 0],
        limit: 10,
        distanceMeasure: 'EUCLIDEAN',
        distanceThreshold: 0.5,
      })
      .get();

    expect(results.length).toBe(2);
    expect(results.map(result => result.name).sort()).toEqual(['middle', 'nearest']);
    expect(results.some(result => result.name === 'far')).toBe(false);
  });

  it('should return a single nearest document from getOne()', async () => {
    await seedBasicVectors();

    const wrapped = withVectorSearch(vectorRepo);
    const nearest = await wrapped
      .query()
      .findNearest({
        vectorField: 'embedding',
        queryVector: [1, 0, 0],
        limit: 3,
        distanceMeasure: 'EUCLIDEAN',
      })
      .getOne();

    expect(nearest?.name).toBe('nearest');
  });

  it('should support select() before findNearest()', async () => {
    await seedBasicVectors();

    const wrapped = withVectorSearch(vectorRepo);
    // Select only stored fields — the computed distanceResultField is appended by findNearest() and
    // must NOT be listed in select() (it is not a stored document field).
    const results = await wrapped
      .query()
      .select('name')
      .findNearest({
        vectorField: 'embedding',
        queryVector: [1, 0, 0],
        limit: 1,
        distanceMeasure: 'EUCLIDEAN',
        distanceResultField: 'vectorDistance',
      })
      .get();

    expect(results).toHaveLength(1);
    expect(results[0]).toHaveProperty('name');
    // The distance field is present in the result even though it was not selected.
    expect(results[0]).toHaveProperty('vectorDistance');
  });

  it('should throw when orderBy() is called after findNearest()', () => {
    const wrapped = withVectorSearch(vectorRepo);
    const builder = wrapped.query().findNearest({
      vectorField: 'embedding',
      queryVector: [1, 0, 0],
      limit: 1,
      distanceMeasure: 'EUCLIDEAN',
    });

    expect(() => builder.orderBy()).toThrow(/orderBy\(\) is not supported on vector queries/i);
  });

  it('should throw when onSnapshot() is called after findNearest()', async () => {
    const wrapped = withVectorSearch(vectorRepo);
    const builder = wrapped.query().findNearest({
      vectorField: 'embedding',
      queryVector: [1, 0, 0],
      limit: 1,
      distanceMeasure: 'EUCLIDEAN',
    });

    await expect(builder.onSnapshot()).rejects.toThrow(
      /onSnapshot\(\) is not supported on vector queries/i,
    );
  });

  it('should expose vector barrel helpers for SDK detection and sentinel checks', () => {
    const wrapped = withVectorSearch(vectorRepo);
    const query = wrapped.query();
    expect(query).toBeInstanceOf(VectorQueryBuilder);
    expect(isVectorFieldValue(FieldValue.vector([1, 0, 0]))).toBe(true);
    expect(VectorDistanceMeasure.COSINE).toBe('COSINE');
    expect(() =>
      assertVectorSearchSupported(vectorRepo.query().getUnderlyingQuery()),
    ).not.toThrow();
  });

  it('should return null from getOne() when the collection is empty', async () => {
    const wrapped = withVectorSearch(vectorRepo);
    const nearest = await wrapped
      .query()
      .findNearest({
        vectorField: 'embedding',
        queryVector: [1, 0, 0],
        limit: 1,
        distanceMeasure: 'EUCLIDEAN',
      })
      .getOne();

    expect(nearest).toBeNull();
  });

  it('should support COSINE distance measure', async () => {
    await seedBasicVectors();

    const wrapped = withVectorSearch(vectorRepo);
    const results = await wrapped
      .query()
      .findNearest({
        vectorField: 'embedding',
        queryVector: [1, 0, 0],
        limit: 2,
        distanceMeasure: 'COSINE',
      })
      .get();

    expect(results).toHaveLength(2);
    expect(results[0]?.name).toBe('nearest');
  });

  it('should support DOT_PRODUCT distance measure', async () => {
    await seedBasicVectors();

    const wrapped = withVectorSearch(vectorRepo);
    const results = await wrapped
      .query()
      .findNearest({
        vectorField: 'embedding',
        queryVector: [1, 0, 0],
        limit: 2,
        distanceMeasure: 'DOT_PRODUCT',
      })
      .get();

    expect(results).toHaveLength(2);
    expect(results[0]?.name).toBe('nearest');
  });

  it('should support schema-validated updates with FieldValue.vector embeddings', async () => {
    const schemaRepo = FirestoreRepository.withSchema(
      db,
      'test_vectors_schema_update',
      vectorDocSchema,
    );
    const wrapped = withVectorSearch(schemaRepo);

    const created = await wrapped.create({
      name: 'before-update',
      embedding: FieldValue.vector([1, 0, 0]),
    });

    await wrapped.update(created.id, {
      embedding: FieldValue.vector([0.9, 0.1, 0]),
    });

    const fetched = await wrapped.getById(created.id);
    expect(fetched?.name).toBe('before-update');

    const schemaDocs = await schemaRepo.query().get();
    if (schemaDocs.length > 0) {
      await schemaRepo.bulkDelete(schemaDocs.map(doc => doc.id));
    }
  });

  it('should throw when get() is called before findNearest()', async () => {
    const wrapped = withVectorSearch(vectorRepo);
    await expect(wrapped.query().get()).rejects.toThrow(/requires findNearest\(\)/i);
  });

  it('should throw when findNearest() is called twice on the same builder', () => {
    const wrapped = withVectorSearch(vectorRepo);
    const builder = wrapped.query().findNearest({
      vectorField: 'embedding',
      queryVector: [1, 0, 0],
      limit: 1,
      distanceMeasure: 'EUCLIDEAN',
    });

    expect(() =>
      builder.findNearest({
        vectorField: 'embedding',
        queryVector: [1, 0, 0],
        limit: 1,
        distanceMeasure: 'EUCLIDEAN',
      }),
    ).toThrow(/only be called once/i);
  });

  it('should throw when stream() is called on a vector query builder', () => {
    const wrapped = withVectorSearch(vectorRepo);

    expect(() => wrapped.query().stream()).toThrow(
      /stream\(\) is not supported on vector queries/i,
    );

    const afterFindNearest = wrapped.query().findNearest({
      vectorField: 'embedding',
      queryVector: [1, 0, 0],
      limit: 1,
      distanceMeasure: 'EUCLIDEAN',
    });
    expect(() => afterFindNearest.stream()).toThrow(
      /stream\(\) is not supported on vector queries/i,
    );
  });

  it('should throw when orderBy() is called before findNearest()', () => {
    const wrapped = withVectorSearch(vectorRepo);
    expect(() => wrapped.query().orderBy()).toThrow(
      /orderBy\(\) is not supported on VectorQueryBuilder/i,
    );
  });

  it('should throw when select() is called after findNearest()', () => {
    const wrapped = withVectorSearch(vectorRepo);
    const builder = wrapped.query().findNearest({
      vectorField: 'embedding',
      queryVector: [1, 0, 0],
      limit: 1,
      distanceMeasure: 'EUCLIDEAN',
    });

    expect(() => builder.select('name')).toThrow(/cannot be called after findNearest/i);
  });

  it('should throw when where() is called after findNearest()', () => {
    const wrapped = withVectorSearch(vectorRepo);
    const builder = wrapped.query().findNearest({
      vectorField: 'embedding',
      queryVector: [1, 0, 0],
      limit: 1,
      distanceMeasure: 'EUCLIDEAN',
    });

    expect(() => builder.where('name', '==', 'nearest')).toThrow(
      /cannot be called after findNearest/i,
    );
  });

  it('should reject schema-validated creates with invalid embedding arrays', async () => {
    const schemaRepo = FirestoreRepository.withSchema(
      db,
      'test_vectors_schema_invalid_create',
      vectorDocSchema,
    );
    const wrapped = withVectorSearch(schemaRepo);

    await expect(
      wrapped.create({
        name: 'bad-embedding',
        embedding: [1, 2] as never,
      }),
    ).rejects.toThrow();

    const schemaDocs = await schemaRepo.query().get();
    if (schemaDocs.length > 0) {
      await schemaRepo.bulkDelete(schemaDocs.map(doc => doc.id));
    }
  });

  it('should reject invalid findNearest options through the builder', () => {
    const wrapped = withVectorSearch(vectorRepo);
    expect(() =>
      wrapped.query().findNearest({
        vectorField: 'embedding',
        queryVector: [],
        limit: 1,
        distanceMeasure: 'EUCLIDEAN',
      }),
    ).toThrow(/non-empty number array/i);
  });
});
