export { FirestoreRepository } from './core/FirestoreRepository.js';
export type {
  ID,
  HookEvent,
  UpdateOptions,
  ReadConverter,
  SafeResult,
} from './core/FirestoreRepository.js';
export { FirestoreQueryBuilder } from './core/QueryBuilder.js';
export type { PaginatedResult } from './core/QueryBuilder.js';

export {
  NotFoundError,
  ValidationError,
  ConflictError,
  FirestoreIndexError,
} from './core/Errors.js';

export { parseFirestoreError } from './core/ErrorParser.js';
// NOTE: `errorHandler` is intentionally NOT exported from the root — it lives in the optional
// `@reggieofarrell/firestore-orm/express` subpath so `express` types stay out of the core type
// graph. Import it as: `import { errorHandler } from '@reggieofarrell/firestore-orm/express'`.

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

export type { FieldPaths, PathValue, DeepPartial } from './utils/pathTypes.js';

export {
  convertTimestampToMillis,
  convertMillisToTimestamp,
  convertTimestampsToMillis,
  createMillisTimestampConverter,
} from './utils/timestamps.js';
