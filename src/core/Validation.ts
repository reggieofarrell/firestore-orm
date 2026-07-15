import { z } from 'zod';
import { FieldValue, PartialWithFieldValue, WithFieldValue } from 'firebase-admin/firestore';

export type RepositorySchemaSet = Readonly<{
  read: z.ZodObject<any>;
  create: z.ZodObject<any>;
  update: z.ZodObject<any>;
}>;

export type Validator<T> = {
  parseCreate(input: unknown): WithFieldValue<T>;
  parseUpdate(input: unknown): PartialWithFieldValue<T>;
  schemas: RepositorySchemaSet;
};

export type CreateInput<T> = WithFieldValue<T>;
export type UpdateInput<T> = PartialWithFieldValue<T>;

type PathSegment = string | number;
type Path = PathSegment[];

/**
 * Detects Firestore vector write values produced by `FieldValue.vector()`.
 * In current firebase-admin releases this is a `VectorValue` instance, not a `FieldValue`.
 */
function isVectorWriteValue(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const vectorValue = value as { _values?: unknown };
  return (
    Array.isArray(vectorValue._values) &&
    vectorValue._values.length > 0 &&
    vectorValue._values.every(entry => typeof entry === 'number' && !Number.isNaN(entry))
  );
}

/**
 * Checks whether a value is a Firestore FieldValue sentinel instance.
 * Uses the exported FieldValue class first and a structural fallback for edge cases.
 */
export function isFieldValueSentinel(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  if (isVectorWriteValue(value)) {
    return true;
  }

  if (value instanceof FieldValue) {
    return true;
  }

  const sentinel = value as { isEqual?: unknown; toString?: unknown };
  if (
    typeof sentinel.isEqual === 'function' &&
    typeof sentinel.toString === 'function' &&
    String(sentinel.toString()).includes('FieldValue')
  ) {
    return true;
  }

  return false;
}

/**
 * Recursively collects all object paths where a FieldValue sentinel is present.
 */
export function collectSentinelPaths(input: unknown, basePath: Path = []): Path[] {
  if (isFieldValueSentinel(input)) {
    return [basePath];
  }

  if (Array.isArray(input)) {
    return input.flatMap((item, index) => collectSentinelPaths(item, [...basePath, index]));
  }

  if (!input || typeof input !== 'object') {
    return [];
  }

  return Object.entries(input as Record<string, unknown>).flatMap(([key, value]) =>
    collectSentinelPaths(value, [...basePath, key]),
  );
}

/**
 * Determines whether two paths overlap as ancestor/descendant.
 * This handles cases where Zod reports an issue at a parent path of a sentinel leaf.
 */
function pathsOverlap(pathA: Path, pathB: Path): boolean {
  const minLength = Math.min(pathA.length, pathB.length);
  for (let index = 0; index < minLength; index += 1) {
    if (pathA[index] !== pathB[index]) {
      return false;
    }
  }
  return true;
}

/**
 * Returns true when all schema errors are scoped to sentinel-backed paths.
 * If any issue appears outside sentinel paths, validation should still fail.
 */
function hasOnlySentinelScopedIssues(issues: z.ZodIssue[], sentinelPaths: Path[]): boolean {
  return issues.every(issue => {
    const issuePath = issue.path as Path;
    return sentinelPaths.some(sentinelPath => pathsOverlap(issuePath, sentinelPath));
  });
}

/**
 * Creates a write-safe schema by omitting the top-level `id` field when present.
 * This preserves backwards compatibility for schemas that already omit `id`,
 * while still enforcing the non-writable id contract when `id` exists.
 */
function omitTopLevelId(schema: z.ZodObject<any>): z.ZodObject<any> {
  if (!Object.prototype.hasOwnProperty.call(schema.shape, 'id')) {
    return schema;
  }

  return schema.omit({ id: true });
}

export function makeValidator<T extends z.ZodObject<any>>(
  readSchema: T,
  updateSchema?: z.ZodObject<any>,
): Validator<z.infer<T>> {
  const createWriteSchema = omitTopLevelId(readSchema);
  const updateWriteSchema = updateSchema
    ? omitTopLevelId(updateSchema)
    : createWriteSchema.partial();
  const schemas: RepositorySchemaSet = Object.freeze({
    read: readSchema,
    create: createWriteSchema,
    update: updateWriteSchema,
  });

  return {
    schemas,
    parseCreate: input => {
      const result = createWriteSchema.safeParse(input);
      if (result.success) {
        return result.data as WithFieldValue<z.infer<T>>;
      }

      const sentinelPaths = collectSentinelPaths(input);
      if (
        sentinelPaths.length > 0 &&
        hasOnlySentinelScopedIssues(result.error.issues, sentinelPaths)
      ) {
        return input as WithFieldValue<z.infer<T>>;
      }

      throw result.error;
    },
    parseUpdate: input => {
      const result = updateWriteSchema.safeParse(input);
      if (result.success) {
        return result.data as PartialWithFieldValue<z.infer<T>>;
      }

      const sentinelPaths = collectSentinelPaths(input);
      if (
        sentinelPaths.length > 0 &&
        hasOnlySentinelScopedIssues(result.error.issues, sentinelPaths)
      ) {
        return input as PartialWithFieldValue<z.infer<T>>;
      }

      throw result.error;
    },
  };
}
