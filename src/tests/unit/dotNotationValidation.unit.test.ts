/**
 * Strategy: unit tests for dot-notation-aware update validation in Validation.ts.
 *
 * Verifies:
 * - `resolveSchemaAtPath` walks nested object shapes (through optional/nullable/default wrappers),
 *   reports `unknown` for typos and for descents into a scalar/array (no addressable subfields), and
 *   `passthrough` for dynamic containers (`z.record`, loose/`catchall` objects) it cannot descend.
 * - `makeValidator().parseUpdate` preserves and validates explicit dot-notation keys instead of
 *   stripping them (the v2 silent-drop bug), filters `undefined`, fails loud on unknown/malformed
 *   paths, and honors the sentinel escape hatch per-leaf under both `permissive` and `strict`.
 *
 * Note: these run against the supported Zod (`^4`). `resolveSchemaAtPath`/`unwrapWrappers` read the
 * v4 wrapper/def internals; zod v3 is no longer a supported peer.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { makeValidator, resolveSchemaAtPath, zNumberWrite } from '../../core/Validation.js';

// Schema exercising the wrapper/container variety for path resolution
// (defaults/nullable/record/array/scalar/loose-object).
const wrapperSchema = z.object({
  name: z.string(),
  address: z.object({ city: z.string(), zip: z.string().optional() }).optional(),
  profile: z.object({ settings: z.object({ theme: z.string() }) }),
  config: z.object({ count: z.number().default(0), note: z.string().nullable() }),
  nested: z.object({ inner: z.object({ value: z.string() }) }).default({ inner: { value: 'x' } }),
  meta: z.record(z.string(), z.any()),
  attrs: z.object({ known: z.string() }).catchall(z.any()),
  tags: z.array(z.string()),
});

// Default-free schema for parseUpdate equality assertions (defaults would inject keys on parse).
const schema = z.object({
  name: z.string(),
  loginCount: z.number().optional(),
  address: z.object({ city: z.string(), zip: z.string().optional() }).optional(),
  profile: z.object({ settings: z.object({ theme: z.string() }) }),
  stats: z.object({ count: z.number() }),
  meta: z.record(z.string(), z.any()),
  tags: z.array(z.string()),
});

describe('resolveSchemaAtPath', () => {
  it('resolves top-level and nested paths to a leaf schema', () => {
    expect(resolveSchemaAtPath(wrapperSchema, ['name']).kind).toBe('leaf');
    expect(resolveSchemaAtPath(wrapperSchema, ['address', 'city']).kind).toBe('leaf');
    expect(resolveSchemaAtPath(wrapperSchema, ['profile', 'settings', 'theme']).kind).toBe('leaf');
  });

  it('descends through optional / nullable / default wrappers', () => {
    // `address` is optional, `config.count` has a default, `config.note` is nullable,
    // `nested` (object) has a default and must still be walked into.
    expect(resolveSchemaAtPath(wrapperSchema, ['address', 'zip']).kind).toBe('leaf');
    expect(resolveSchemaAtPath(wrapperSchema, ['config', 'count']).kind).toBe('leaf');
    expect(resolveSchemaAtPath(wrapperSchema, ['config', 'note']).kind).toBe('leaf');
    expect(resolveSchemaAtPath(wrapperSchema, ['nested', 'inner', 'value']).kind).toBe('leaf');
  });

  it('reports unknown for paths absent from a known object shape', () => {
    expect(resolveSchemaAtPath(wrapperSchema, ['nope']).kind).toBe('unknown');
    expect(resolveSchemaAtPath(wrapperSchema, ['address', 'nope']).kind).toBe('unknown');
    expect(resolveSchemaAtPath(wrapperSchema, ['profile', 'settings', 'nope']).kind).toBe(
      'unknown',
    );
  });

  it('reports unknown for a descent into a scalar or array (no addressable subfields)', () => {
    // `name` is a string and `tags` is an array — neither has a subfield `foo`/`0`, so these are
    // invalid paths, not dynamic containers.
    expect(resolveSchemaAtPath(wrapperSchema, ['name', 'foo']).kind).toBe('unknown');
    expect(resolveSchemaAtPath(wrapperSchema, ['tags', '0']).kind).toBe('unknown');
  });

  it('reports passthrough for dynamic containers it cannot descend', () => {
    // `meta` is a record and `attrs` is a catchall object — both accept arbitrary keys.
    expect(resolveSchemaAtPath(wrapperSchema, ['meta', 'anything']).kind).toBe('passthrough');
    expect(resolveSchemaAtPath(wrapperSchema, ['attrs', 'known']).kind).toBe('leaf');
    expect(resolveSchemaAtPath(wrapperSchema, ['attrs', 'dynamic']).kind).toBe('passthrough');
  });
});

describe('parseUpdate — dot-notation awareness (permissive)', () => {
  const validator = makeValidator(schema, undefined, { sentinelPolicy: 'permissive' });

  it('preserves and validates explicit dot-notation keys (no silent drop)', () => {
    expect(validator.parseUpdate({ 'address.city': 'LA' })).toEqual({ 'address.city': 'LA' });
    expect(validator.parseUpdate({ 'profile.settings.theme': 'dark' })).toEqual({
      'profile.settings.theme': 'dark',
    });
  });

  it('validates dotted leaf values against the resolved schema', () => {
    expect(() => validator.parseUpdate({ 'address.city': 999 })).toThrow();
  });

  it('fails loud on an unknown dotted path instead of dropping it', () => {
    expect(() => validator.parseUpdate({ 'no.such.path': 1 })).toThrow();
    expect(() => validator.parseUpdate({ 'address.nope': 'x' })).toThrow();
  });

  it('rejects malformed dot-notation paths', () => {
    expect(() => validator.parseUpdate({ 'address..city': 'x' })).toThrow();
    expect(() => validator.parseUpdate({ '.address': 'x' })).toThrow();
    expect(() => validator.parseUpdate({ 'address.': 'x' })).toThrow();
  });

  it('handles mixed regular and dotted keys', () => {
    expect(validator.parseUpdate({ name: 'Alice', 'address.city': 'NYC' })).toEqual({
      name: 'Alice',
      'address.city': 'NYC',
    });
  });

  it('still strips unknown non-dotted top-level keys (unchanged behavior)', () => {
    expect(validator.parseUpdate({ name: 'Bob', bogus: 1 })).toEqual({ name: 'Bob' });
  });

  it('passes record-container dotted keys through unvalidated', () => {
    expect(validator.parseUpdate({ 'meta.anything': { deep: true } })).toEqual({
      'meta.anything': { deep: true },
    });
  });

  it('fails loud when a dotted path descends into a scalar field', () => {
    // `name` is a string, so `name.foo` is not a valid path — must throw, not pass through.
    expect(() => validator.parseUpdate({ 'name.foo': 'bar' })).toThrow();
  });

  it('filters undefined-valued dotted entries instead of throwing on a required leaf', () => {
    // `stats.count` is a required number leaf; setting it to undefined is filtered (no-op), matching
    // the documented "undefined filtered out, existing value preserved" contract.
    expect(validator.parseUpdate({ 'stats.count': undefined })).toEqual({});
    expect(validator.parseUpdate({ name: 'Keep', 'stats.count': undefined })).toEqual({
      name: 'Keep',
    });
  });

  it('honors the sentinel escape hatch on a dotted leaf', () => {
    const inc = FieldValue.increment(1);
    // `stats.count` is a plain number leaf reached via a dot path; under permissive, an increment
    // sentinel is waived at the leaf (root-path) safeParse failure.
    expect(validator.parseUpdate({ 'stats.count': inc })).toEqual({ 'stats.count': inc });
  });
});

describe('parseUpdate — strict sentinel policy on dotted leaves', () => {
  const strictSchema = z.object({
    stats: z.object({ visits: zNumberWrite() }),
  });
  const strictValidator = makeValidator(strictSchema, undefined, { sentinelPolicy: 'strict' });

  it('accepts a sentinel the leaf combinator permits', () => {
    const inc = FieldValue.increment(1);
    expect(strictValidator.parseUpdate({ 'stats.visits': inc })).toEqual({ 'stats.visits': inc });
  });

  it('rejects a sentinel the leaf combinator does not permit', () => {
    expect(() =>
      strictValidator.parseUpdate({ 'stats.visits': FieldValue.serverTimestamp() }),
    ).toThrow();
  });
});
