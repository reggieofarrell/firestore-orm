/**
 * Strategy: unit tests for the update-time `.default(...)` stripping in Validation.ts (issue #25).
 *
 * The update schema is `createWriteSchema.partial()`, and Zod's `.partial()` keeps the `ZodDefault`
 * wrapper — so `safeParse` fires defaults for keys the caller omitted. On a partial update that is
 * silent data loss: the injected default overwrites the stored value in Firestore. `parseUpdate`
 * must therefore write only the keys the caller actually provided (at every level), while `create`
 * must keep applying defaults (correct there).
 *
 * Verifies:
 * - an omitted top-level defaulted field (scalar + object-level `.default({})`) is not injected;
 * - a present nested object does not get its nested `.default(...)` leaves injected;
 * - explicitly-provided values (including a value equal to the default) survive unchanged;
 * - mixed dotted + non-dotted updates do not inject an omitted defaulted sibling;
 * - a FieldValue sentinel is preserved while omitted defaults are still stripped;
 * - `parseCreate` still applies every default (the fix must not touch create).
 *
 * Note: these run against the installed Zod (v4). The fix is a pure post-parse key-diff (no schema
 * internals), so it is version-agnostic across the supported `^3.25 || ^4` range.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { makeValidator, zNumberWrite } from '../../core/Validation.js';

// A schema whose read/create shape carries defaults at several shapes:
// - `status`  : a top-level scalar default
// - `prefs`   : a top-level object-level `.default({})`
// - `config`  : a required object with a nested leaf default (`count`)
// `address` (optional) exists for the mixed dotted-path case; `loginCount` for the sentinel case.
const schema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string().default('active'),
  prefs: z.object({ theme: z.string().optional() }).default({}),
  config: z.object({ count: z.number().default(0) }),
  address: z.object({ city: z.string(), zip: z.string().optional() }).optional(),
  loginCount: zNumberWrite().optional(),
});

describe('parseUpdate — Zod .default() is not injected on partial update (#25)', () => {
  const validator = makeValidator(schema);

  it('does not inject an omitted top-level defaulted field (scalar or object-level default)', () => {
    // The caller never mentioned `status` or `prefs`; neither may appear (they would clobber the
    // stored values). This is the headline data-loss bug.
    expect(validator.parseUpdate({ name: 'Alice' })).toEqual({ name: 'Alice' });
  });

  it('does not inject a nested default when the parent object is provided empty', () => {
    // `config.count` has a default; `update({ config: {} })` must write `{}`, not `{ count: 0 }`.
    expect(validator.parseUpdate({ config: {} })).toEqual({ config: {} });
    expect(validator.parseUpdate({ name: 'Bob', config: {} })).toEqual({
      name: 'Bob',
      config: {},
    });
  });

  it('preserves explicitly-provided nested values', () => {
    expect(validator.parseUpdate({ config: { count: 5 } })).toEqual({ config: { count: 5 } });
  });

  it('preserves a value the caller set equal to its default (present in input → kept)', () => {
    // Distinguishes "caller provided the default value" (kept) from "Zod injected it" (stripped).
    expect(validator.parseUpdate({ status: 'active' })).toEqual({ status: 'active' });
  });

  it('does not inject an omitted defaulted sibling on a mixed dotted + non-dotted update', () => {
    expect(validator.parseUpdate({ name: 'Carol', 'address.city': 'LA' })).toEqual({
      name: 'Carol',
      'address.city': 'LA',
    });
  });

  it('preserves a FieldValue sentinel while still stripping omitted defaults', () => {
    const inc = FieldValue.increment(1);
    const result = validator.parseUpdate({ loginCount: inc }) as Record<string, unknown>;
    // Only the caller-provided key survives; the sentinel is preserved by reference (not re-parsed).
    expect(Object.keys(result)).toEqual(['loginCount']);
    expect(result.loginCount).toBe(inc);
  });
});

describe('parseCreate — defaults are still applied on create (unchanged)', () => {
  const validator = makeValidator(schema);

  it('backfills every default on create', () => {
    // The fix targets only the update path; create must keep applying defaults.
    expect(validator.parseCreate({ name: 'Alice', config: {} })).toEqual({
      name: 'Alice',
      status: 'active',
      prefs: {},
      config: { count: 0 },
    });
  });
});
