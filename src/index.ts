export { FirestoreRepository } from './core/FirestoreRepository.js';
export type { ID, HookEvent, UpdateOptions } from './core/FirestoreRepository.js';
export { FirestoreQueryBuilder } from './core/QueryBuilder.js';
export type { PaginatedResult } from './core/QueryBuilder.js';

export {
  NotFoundError,
  ValidationError,
  ConflictError,
  FirestoreIndexError,
} from './core/Errors.js';

export { parseFirestoreError } from './core/ErrorParser.js';
export { errorHandler } from './core/ErrorHandler.js';

export {
  makeValidator,
  whichFieldValue,
  isFieldValueSentinel,
  collectSentinelPaths,
  zSentinel,
  zNumberWrite,
  zArrayWrite,
  zDateWrite,
  withDelete,
} from './core/Validation.js';
export type {
  UpdateInput,
  CreateInput,
  Validator,
  RepositorySchemaSet,
  SentinelPolicy,
  FieldValueKind,
} from './core/Validation.js';

export {
  isDotNotation,
  hasDotNotationKeys,
  expandDotNotation,
  flattenToDotNotation,
  mergeDotNotationUpdate,
  validateDotNotationPath,
  getRootFields,
  getDotNotationDepth,
} from './utils/dotNotation.js';
