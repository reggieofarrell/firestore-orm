export {
  VectorDistanceMeasure,
  VECTOR_MAX_DIMENSIONS,
  VECTOR_MAX_LIMIT,
  assertVectorSearchSupported,
  isVectorFieldValue,
  validateFindNearestOptions,
} from './VectorSearch.js';
export type {
  FindNearestOptions,
  VectorDistanceMeasureValue,
  VectorSearchResult,
} from './VectorSearch.js';

export { vectorEmbeddingSchema } from './vectorEmbeddingSchema.js';
export { VectorQueryBuilder } from './VectorQueryBuilder.js';
export { withVectorSearch } from './withVectorSearch.js';
export type { VectorEnabledRepository } from './withVectorSearch.js';
// The value type of `vectorEmbeddingSchema` — re-exported so consumers can name it through the
// public `/vector` specifier (its source module `utils/pathTypes` has no export-map subpath) (T5).
export type { VectorValueLike } from '../utils/pathTypes.js';
