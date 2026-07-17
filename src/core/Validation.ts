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

/**
 * Input accepted by create-family operations (`create`, `bulkCreate`, `upsert`,
 * `createInTransaction`). The top-level `id` is optional because the repository sources the
 * document id itself (auto-generated on create, or the explicit `id` argument on `upsert`) and
 * strips any `id` from the payload — so callers never need to supply one.
 */
export type CreateInput<T> = WithFieldValue<Omit<T, 'id'>> & { id?: string };
export type UpdateInput<T> = PartialWithFieldValue<T>;

/**
 * Controls how FieldValue sentinels are validated against a schema on write.
 *
 * - `'permissive'` (default, backwards compatible): when Zod validation fails only at paths
 *   that hold a sentinel, the errors are waived and the raw input is written. Any sentinel is
 *   accepted on any field.
 * - `'strict'`: the sentinel escape hatch is disabled. Only sentinels that a field's schema
 *   explicitly permits (see {@link zNumberWrite}, {@link zArrayWrite}, {@link zDateWrite},
 *   {@link withDelete}, {@link zSentinel}) pass; every other Zod failure throws.
 */
export type SentinelPolicy = 'permissive' | 'strict';

/**
 * A classified Firestore write sentinel kind. `'unknown'` means the value is a sentinel we
 * could not classify (or is not a sentinel at all).
 */
export type FieldValueKind =
  'delete' | 'serverTimestamp' | 'arrayUnion' | 'arrayRemove' | 'increment' | 'vector' | 'unknown';

type PathSegment = string | number;
type Path = PathSegment[];

/**
 * Detects Firestore vector write values produced by `FieldValue.vector()`.
 * In current firebase-admin releases this is a `VectorValue` instance, not a `FieldValue`.
 *
 * NOTE: this is a structural heuristic — any object shaped like `{ _values: number[] }` is
 * treated as a vector sentinel and therefore bypasses schema validation on the permissive
 * escape-hatch path. This breadth is intentionally left in place to stay consistent with the
 * vector module's `isVectorFieldValue`. The precise way to model a vector field is
 * `vectorEmbeddingSchema(dims)` (from `@reggieofarrell/firestore-orm/vector`), which validates
 * on the happy path; under `sentinelPolicy: 'strict'` the escape hatch never runs at all.
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
 *
 * firestore-orm targets the firebase-admin SDK, so detection relies on the exported
 * `FieldValue` class identity (`instanceof`) plus a structural check for `VectorValue`
 * (which is a standalone class, not a `FieldValue` subclass). Web-SDK / dual-package
 * structural detection is intentionally out of scope.
 */
export function isFieldValueSentinel(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  if (isVectorWriteValue(value)) {
    return true;
  }

  return value instanceof FieldValue;
}

/**
 * Classifies a Firestore write sentinel into its {@link FieldValueKind}.
 *
 * Admin-native and minimal: every admin sentinel subclasses the exported `FieldValue` and
 * exposes a stable `methodName` getter (e.g. `"FieldValue.increment"`), so classification
 * reads that getter. `methodName` is preferred over `constructor.name` because it survives
 * minification and cleanly distinguishes `arrayUnion` from `arrayRemove`.
 */
export function whichFieldValue(value: unknown): FieldValueKind {
  if (isVectorWriteValue(value)) {
    return 'vector';
  }

  if (!(value instanceof FieldValue)) {
    return 'unknown';
  }

  const methodName = (value as { methodName?: unknown }).methodName;
  if (typeof methodName === 'string') {
    if (methodName.includes('serverTimestamp')) return 'serverTimestamp';
    if (methodName.includes('arrayUnion')) return 'arrayUnion';
    if (methodName.includes('arrayRemove')) return 'arrayRemove';
    if (methodName.includes('increment')) return 'increment';
    if (methodName.includes('delete')) return 'delete';
  }

  return 'unknown';
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
 * Determines whether two paths refer to the exact same leaf.
 *
 * This is deliberately an exact match (not a shared-prefix/ancestor test): a sentinel only
 * waives the Zod error reported at its own path. A sentinel nested inside a field must not
 * suppress a type error reported at an ancestor path (e.g. a sentinel at `['a','b']` must not
 * excuse "expected string" at `['a']`).
 */
function pathsEqual(pathA: Path, pathB: Path): boolean {
  if (pathA.length !== pathB.length) {
    return false;
  }
  for (let index = 0; index < pathA.length; index += 1) {
    if (pathA[index] !== pathB[index]) {
      return false;
    }
  }
  return true;
}

/**
 * Returns true when every schema error sits exactly at a sentinel-backed path.
 * If any issue appears outside a sentinel path, validation should still fail.
 */
function hasOnlySentinelScopedIssues(issues: z.ZodIssue[], sentinelPaths: Path[]): boolean {
  return issues.every(issue => {
    const issuePath = issue.path as Path;
    return sentinelPaths.some(sentinelPath => pathsEqual(issuePath, sentinelPath));
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

/**
 * A Zod schema that matches any Firestore FieldValue sentinel. Used as the base for the
 * per-field write combinators below.
 */
const zFieldValueSentinel = z.custom<FieldValue>(isFieldValueSentinel, {
  message: 'Expected a Firestore FieldValue sentinel',
});

/**
 * A Zod schema matching a Firestore sentinel of one of the given {@link FieldValueKind}s.
 * Use it to widen a field schema so it also accepts specific approved sentinels, e.g.
 * `z.union([z.string(), zSentinel('serverTimestamp')])`.
 */
export function zSentinel(...kinds: FieldValueKind[]): z.ZodType<FieldValue> {
  return zFieldValueSentinel.refine(value => kinds.includes(whichFieldValue(value)), {
    message: `Expected a FieldValue sentinel of kind: ${kinds.join(' | ')}`,
  }) as z.ZodType<FieldValue>;
}

/**
 * Write schema for a number field that may also be written with `FieldValue.increment()`
 * (and optionally `FieldValue.delete()`).
 */
export function zNumberWrite(opts?: { allowDelete?: boolean }) {
  const kinds: FieldValueKind[] = opts?.allowDelete ? ['increment', 'delete'] : ['increment'];
  return z.union([z.number(), zSentinel(...kinds)]);
}

/**
 * Write schema for an array field that may also be written with `FieldValue.arrayUnion()` /
 * `FieldValue.arrayRemove()` (and optionally `FieldValue.delete()`).
 */
export function zArrayWrite<T extends z.ZodType>(elem: T, opts?: { allowDelete?: boolean }) {
  const kinds: FieldValueKind[] = opts?.allowDelete
    ? ['arrayUnion', 'arrayRemove', 'delete']
    : ['arrayUnion', 'arrayRemove'];
  return z.union([z.array(elem), zSentinel(...kinds)]);
}

/**
 * Write schema for a Date field that may also be written with `FieldValue.serverTimestamp()`
 * (and optionally `FieldValue.delete()`). For fields stored as ISO strings, compose the base
 * type with `zSentinel('serverTimestamp')` directly.
 */
export function zDateWrite(opts?: { allowDelete?: boolean }) {
  const kinds: FieldValueKind[] = opts?.allowDelete
    ? ['serverTimestamp', 'delete']
    : ['serverTimestamp'];
  return z.union([z.date(), zSentinel(...kinds)]);
}

/**
 * Widens any field schema so it additionally accepts `FieldValue.delete()` — useful for
 * updates / merges that clear a field.
 */
export function withDelete<T extends z.ZodType>(schema: T) {
  return z.union([schema, zSentinel('delete')]);
}

export function makeValidator<T extends z.ZodObject<any>>(
  readSchema: T,
  updateSchema?: z.ZodObject<any>,
  opts?: { sentinelPolicy?: SentinelPolicy },
): Validator<z.infer<T>> {
  const policy: SentinelPolicy = opts?.sentinelPolicy ?? 'permissive';
  const createWriteSchema = omitTopLevelId(readSchema);
  const updateWriteSchema = updateSchema
    ? omitTopLevelId(updateSchema)
    : createWriteSchema.partial();
  const schemas: RepositorySchemaSet = Object.freeze({
    read: readSchema,
    create: createWriteSchema,
    update: updateWriteSchema,
  });

  const runParse = <R>(schema: z.ZodObject<any>, input: unknown): R => {
    const result = schema.safeParse(input);
    if (result.success) {
      return result.data as R;
    }

    // In strict mode the sentinel escape hatch is disabled: only sentinels that a field's
    // schema explicitly permits (via the combinators above) survive, and every other failure
    // throws.
    if (policy === 'strict') {
      throw result.error;
    }

    const sentinelPaths = collectSentinelPaths(input);
    if (
      sentinelPaths.length > 0 &&
      hasOnlySentinelScopedIssues(result.error.issues, sentinelPaths)
    ) {
      return input as R;
    }

    throw result.error;
  };

  return {
    schemas,
    parseCreate: input => runParse<WithFieldValue<z.infer<T>>>(createWriteSchema, input),
    parseUpdate: input => runParse<PartialWithFieldValue<z.infer<T>>>(updateWriteSchema, input),
  };
}
