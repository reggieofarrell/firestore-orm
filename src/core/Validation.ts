import { z } from 'zod';
import { FieldValue, UpdateData, WithFieldValue } from 'firebase-admin/firestore';
import { isDotNotation, validateDotNotationPath } from '../utils/dotNotation.js';

export type RepositorySchemaSet = Readonly<{
  read: z.ZodObject<any>;
  create: z.ZodObject<any>;
  update: z.ZodObject<any>;
}>;

export type Validator<T> = {
  parseCreate(input: unknown): WithFieldValue<T>;
  parseUpdate(input: unknown): UpdateData<Omit<T, 'id'>>;
  schemas: RepositorySchemaSet;
};

/**
 * Input accepted by create-family operations (`create`, `bulkCreate`, `upsert`,
 * `createInTransaction`). The top-level `id` is optional because the repository sources the
 * document id itself (auto-generated on create, or the explicit `id` argument on `upsert`) and
 * strips any `id` from the payload — so callers never need to supply one.
 */
export type CreateInput<T> = WithFieldValue<Omit<T, 'id'>> & { id?: string };

/**
 * Input accepted by update-family operations (`update`, `patch`, `bulkUpdate`, `bulkPatch`,
 * `updateInTransaction`, `patchInTransaction`, `query().update()`).
 *
 * Reuses the Admin SDK's `UpdateData<T>`, which types Firestore dot-notation field paths (e.g.
 * `'address.city'`, `'profile.settings.theme'`) with the correct per-leaf value type and allows a
 * `FieldValue` sentinel at every level — so nested updates no longer need an `as any` cast. `id` is
 * omitted so it is never a writable top-level key (the repository sources the id from the document
 * ref / method argument and strips any `id` at runtime).
 */
export type UpdateInput<T> = UpdateData<Omit<T, 'id'>>;

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

/**
 * Peels wrapper schemas (`optional`, `nullable`, `default`, `readonly`, `catch`, `branded`,
 * effects/pipe) until it reaches the innermost non-wrapper schema (which may be a `ZodObject`,
 * `ZodRecord`, a scalar, etc.).
 *
 * Written defensively to work across the supported Zod range (`^3.25 || ^4`): it prefers the public
 * `.unwrap()` / `.removeDefault()` methods and falls back to reading the inner schema off the
 * internal def, tolerating both v3 (`_def.innerType` / `_def.schema`) and v4 (`_def.in`) shapes.
 */
function unwrapWrappers(schema: unknown): unknown {
  let current: any = schema;
  for (let depth = 0; depth < 12 && current && typeof current === 'object'; depth += 1) {
    if (current instanceof z.ZodObject) {
      return current;
    }
    if (typeof current.unwrap === 'function') {
      current = current.unwrap();
      continue;
    }
    if (typeof current.removeDefault === 'function') {
      current = current.removeDefault();
      continue;
    }
    const def = current._def ?? current._zod?.def;
    const inner = def?.innerType ?? def?.schema ?? def?.in ?? def?.out;
    if (inner && inner !== current) {
      current = inner;
      continue;
    }
    break;
  }
  return current;
}

/** Unwraps to the underlying `ZodObject`, or `undefined` if the schema is not (and does not wrap) one. */
function unwrapToObject(schema: unknown): z.ZodObject<any> | undefined {
  const unwrapped = unwrapWrappers(schema);
  return unwrapped instanceof z.ZodObject ? unwrapped : undefined;
}

/**
 * Normalized Zod kind, tolerant of v3 (`_def.typeName === 'ZodRecord'`) and v4
 * (`_def.type === 'record'`) — e.g. `'record'`, `'object'`, `'string'`, `'any'`, `'unknown'`.
 */
function normalizedKind(schema: unknown): string {
  const def = (schema as { _def?: any; _zod?: { def?: any } })?._def ?? (schema as any)?._zod?.def;
  const raw = String(def?.typeName ?? def?.type ?? '').toLowerCase();
  return raw.startsWith('zod') ? raw.slice(3) : raw;
}

/**
 * True when a schema accepts arbitrary string keys, so a deeper dotted path into it cannot be
 * validated against a fixed shape and is passed through: `z.record`, `z.map`, `z.any`, `z.unknown`.
 */
function isDynamicContainerSchema(schema: unknown): boolean {
  const kind = normalizedKind(unwrapWrappers(schema));
  return kind === 'record' || kind === 'map' || kind === 'any' || kind === 'unknown';
}

/**
 * True when a `ZodObject` accepts unknown keys — a passthrough object (`_def.unknownKeys` in v3) or
 * one with a non-`never` catchall (`z.looseObject()` / `.catchall(...)` in v3 and v4).
 */
function objectAllowsUnknownKeys(obj: z.ZodObject<any>): boolean {
  const def = (obj as { _def?: any; _zod?: { def?: any } })._def ?? (obj as any)._zod?.def;
  if (!def) {
    return false;
  }
  if (def.unknownKeys === 'passthrough') {
    return true;
  }
  const catchall = def.catchall;
  if (catchall) {
    const kind = normalizedKind(catchall);
    if (kind && kind !== 'never') {
      return true;
    }
  }
  return false;
}

/**
 * The outcome of resolving a dot-notation path against a schema:
 * - `leaf`: the path resolves to a concrete field schema — validate the value against it.
 * - `passthrough`: the path descends into a dynamic container (`z.record` / `z.map` / `z.any` /
 *   `z.unknown`, or a loose/`catchall` object) that accepts arbitrary keys, so it cannot be
 *   validated against a fixed shape and is written as-is.
 * - `unknown`: a segment is definitively absent from a known object shape, or descends into a scalar
 *   or array that has no addressable subfields — the path is invalid, so the write must fail loud.
 */
export type PathResolution =
  { kind: 'leaf'; schema: z.ZodType<any> } | { kind: 'passthrough' } | { kind: 'unknown' };

/**
 * Resolves the Zod schema governing a dot-notation field path (e.g. `['address', 'city']`) by
 * walking nested object shapes. See {@link PathResolution} for the outcomes.
 */
export function resolveSchemaAtPath(root: z.ZodType<any>, segments: string[]): PathResolution {
  let currentObject = unwrapToObject(root);
  if (!currentObject) {
    // The root is normally the update ZodObject; a non-object root is unexpected, so pass through
    // rather than reject.
    return { kind: 'passthrough' };
  }

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const shape = currentObject.shape as Record<string, z.ZodType<any>>;

    if (!Object.prototype.hasOwnProperty.call(shape, segment)) {
      // Not a declared key. A loose / catchall object accepts arbitrary keys → passthrough;
      // a strict / strip object does not → the path is a typo, fail loud.
      return objectAllowsUnknownKeys(currentObject) ? { kind: 'passthrough' } : { kind: 'unknown' };
    }

    const fieldSchema = shape[segment];
    if (index === segments.length - 1) {
      return { kind: 'leaf', schema: fieldSchema };
    }

    const nextObject = unwrapToObject(fieldSchema);
    if (nextObject) {
      currentObject = nextObject;
      continue;
    }

    // A non-final segment descends into a non-object. A dynamic container (record / map / any /
    // unknown) accepts deeper paths → passthrough; a scalar or array leaf has no addressable
    // subfields → the path is invalid, fail loud.
    return isDynamicContainerSchema(fieldSchema) ? { kind: 'passthrough' } : { kind: 'unknown' };
  }

  return { kind: 'passthrough' };
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

  const runParse = <R>(schema: z.ZodType<any>, input: unknown): R => {
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

  /**
   * Validates an update payload with dot-notation awareness. `undefined` values are filtered out
   * first (Firestore rejects `undefined`; the documented contract is "filtered, existing value
   * preserved"), so a required leaf is not spuriously rejected. Non-dotted keys are then validated
   * against the top-level update schema as before. Each explicit dot-notation key (e.g.
   * `'address.city'`) is structurally checked, resolved to its leaf schema, and validated in place —
   * its value is validated but the dotted key is preserved (never stripped), so field-path merges
   * actually persist. A dotted key that is definitively absent from the schema throws (fail loud)
   * instead of silently disappearing.
   */
  const parseUpdate = (input: unknown): UpdateData<Omit<z.infer<T>, 'id'>> => {
    type Result = UpdateData<Omit<z.infer<T>, 'id'>>;

    if (input === null || typeof input !== 'object') {
      return runParse<Result>(updateWriteSchema, input);
    }

    // Drop undefined values before validating so a required (dotted or top-level) leaf set to
    // `undefined` is filtered rather than throwing — matching the documented behavior and the
    // optional/required symmetry.
    const entries = Object.entries(input as Record<string, unknown>).filter(
      ([, value]) => value !== undefined,
    );
    const dottedEntries = entries.filter(([key]) => isDotNotation(key));

    // Fast path: no dot-notation keys — behave exactly as before.
    if (dottedEntries.length === 0) {
      return runParse<Result>(updateWriteSchema, Object.fromEntries(entries));
    }

    const nonDotted = Object.fromEntries(entries.filter(([key]) => !isDotNotation(key)));
    const validatedNonDotted =
      Object.keys(nonDotted).length > 0
        ? (runParse(updateWriteSchema, nonDotted) as Record<string, unknown>)
        : {};

    const validatedDotted: Record<string, unknown> = {};
    for (const [key, value] of dottedEntries) {
      validateDotNotationPath(key);
      const segments = key.split('.');
      const resolution = resolveSchemaAtPath(updateWriteSchema, segments);

      if (resolution.kind === 'unknown') {
        throw new z.ZodError([
          {
            code: 'custom',
            path: segments,
            message: `Unknown field path "${key}" for this schema`,
          } as z.core.$ZodIssue,
        ]);
      }

      validatedDotted[key] =
        resolution.kind === 'leaf' ? runParse(resolution.schema, value) : value;
    }

    return { ...validatedNonDotted, ...validatedDotted } as UpdateData<Omit<z.infer<T>, 'id'>>;
  };

  return {
    schemas,
    parseCreate: input => runParse<WithFieldValue<z.infer<T>>>(createWriteSchema, input),
    parseUpdate,
  };
}
