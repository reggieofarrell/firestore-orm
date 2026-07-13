/**
 * Strategy: smoke test that the /vector subpath exports the vector extension API.
 */
import { FieldValue } from 'firebase-admin/firestore';
import * as vector from '../../vector/index.js';

describe('vector package exports', () => {
  it('should export vector search extension symbols', () => {
    expect(vector.withVectorSearch).toBeDefined();
    expect(vector.VectorQueryBuilder).toBeDefined();
    expect(vector.vectorEmbeddingSchema).toBeDefined();
    expect(vector.validateFindNearestOptions).toBeDefined();
    expect(vector.isVectorFieldValue).toBeDefined();
    expect(vector.assertVectorSearchSupported).toBeDefined();
    expect(vector.VectorDistanceMeasure).toBeDefined();
    expect(vector.VECTOR_MAX_DIMENSIONS).toBe(2048);
    expect(vector.VECTOR_MAX_LIMIT).toBe(1000);
  });

  it('should expose callable validation helpers from the barrel', () => {
    expect(() =>
      vector.validateFindNearestOptions({
        vectorField: 'embedding',
        queryVector: [1, 0, 0],
        limit: 1,
        distanceMeasure: vector.VectorDistanceMeasure.EUCLIDEAN,
      }),
    ).not.toThrow();

    expect(vector.isVectorFieldValue(FieldValue.vector([1, 2, 3]))).toBe(true);
    expect(vector.vectorEmbeddingSchema(3).safeParse([1, 2, 3]).success).toBe(true);
  });
});
