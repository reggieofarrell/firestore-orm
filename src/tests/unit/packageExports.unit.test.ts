/**
 * Strategy: smoke test that the package entry re-exports public API surface, and that the Express
 * adapter lives on the optional `./express` subpath rather than the root (so express stays out of
 * the core type graph).
 */
import * as orm from '../../index.js';
import { WriteOutcomeError as CoreWriteOutcomeError } from '../../core/Errors.js';
import { errorHandler } from '../../express/index.js';

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
    expect(orm.PreconditionFailedError).toBeDefined();
    expect(orm.WriteOutcomeError).toBeDefined();
    // Runtime export is the same constructor as the core class (U4).
    expect(orm.WriteOutcomeError).toBe(CoreWriteOutcomeError);
    expect(orm.parseFirestoreError).toBeDefined();
  });

  it('should NOT export the Express errorHandler from the root entry', () => {
    // errorHandler moved to the `./express` subpath to keep express out of the core type graph.
    expect((orm as Record<string, unknown>).errorHandler).toBeUndefined();
  });

  it('should export errorHandler from the ./express subpath', () => {
    expect(errorHandler).toBeDefined();
    expect(typeof errorHandler).toBe('function');
  });

  it('should export validation and dot-notation utilities', () => {
    expect(orm.makeValidator).toBeDefined();
    expect(orm.isDotNotation).toBeDefined();
    expect(orm.flattenToDotNotation).toBeDefined();
    expect(orm.mergeDotNotationUpdate).toBeDefined();
  });

  it('should export sentinel detection and per-field write combinators', () => {
    expect(orm.whichFieldValue).toBeDefined();
    expect(orm.isFieldValueSentinel).toBeDefined();
    expect(orm.collectSentinelPaths).toBeDefined();
    expect(orm.zSentinel).toBeDefined();
    expect(orm.zNumberWrite).toBeDefined();
    expect(orm.zArrayWrite).toBeDefined();
    expect(orm.zDateWrite).toBeDefined();
    expect(orm.withDelete).toBeDefined();
  });

  it('should export timestamp <-> millis converter helpers', () => {
    expect(orm.convertTimestampToMillis).toBeDefined();
    expect(orm.convertMillisToTimestamp).toBeDefined();
    expect(orm.convertTimestampsToMillis).toBeDefined();
    expect(orm.createMillisTimestampConverter).toBeDefined();
  });

  it('should not export vector extension symbols from the main entry', () => {
    expect((orm as Record<string, unknown>).withVectorSearch).toBeUndefined();
    expect((orm as Record<string, unknown>).vectorEmbeddingSchema).toBeUndefined();
  });

  it('documents that WriteMetadata types are type-only root exports (issue #72)', () => {
    // WriteMetadata / WriteResultWithMetadata are type aliases — they erase at runtime. Compile-time
    // root-import coverage lives in src/tests/types/write-metadata.type-test.ts (T-4). Assert they
    // are not accidentally emitted as runtime values on the package entry.
    expect((orm as Record<string, unknown>).WriteMetadata).toBeUndefined();
    expect((orm as Record<string, unknown>).WriteResultWithMetadata).toBeUndefined();
  });
});
