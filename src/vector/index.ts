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
