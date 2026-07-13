/**
 * Strategy: smoke test that the package entry re-exports public API surface.
 */
import * as orm from '../../index.js';

describe('package exports', () => {
  it('should export repository and query builder classes', () => {
    expect(orm.FirestoreRepository).toBeDefined();
    expect(orm.FirestoreQueryBuilder).toBeDefined();
  });

  it('should export error types and helpers', () => {
    expect(orm.NotFoundError).toBeDefined();
    expect(orm.ValidationError).toBeDefined();
    expect(orm.ConflictError).toBeDefined();
    expect(orm.FirestoreIndexError).toBeDefined();
    expect(orm.parseFirestoreError).toBeDefined();
    expect(orm.errorHandler).toBeDefined();
  });

  it('should export validation and dot-notation utilities', () => {
    expect(orm.makeValidator).toBeDefined();
    expect(orm.isDotNotation).toBeDefined();
    expect(orm.flattenToDotNotation).toBeDefined();
    expect(orm.mergeDotNotationUpdate).toBeDefined();
  });

  it('should not export vector extension symbols from the main entry', () => {
    expect((orm as Record<string, unknown>).withVectorSearch).toBeUndefined();
    expect((orm as Record<string, unknown>).vectorEmbeddingSchema).toBeUndefined();
  });
});
