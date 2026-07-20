import {
  expandDotNotation,
  flattenToDotNotation,
  getDotNotationDepth,
  getRootFields,
  hasDotNotationKeys,
  isDotNotation,
  mergeDotNotationUpdate,
  validateDotNotationPath,
} from '../../utils/dotNotation.js';

describe('dotNotation utility unit tests', () => {
  it('should detect dot notation keys correctly', () => {
    expect(isDotNotation('address.city')).toBe(true);
    expect(isDotNotation('name')).toBe(false);
    expect(hasDotNotationKeys({ name: 'Alice', 'address.city': 'NYC' })).toBe(true);
    expect(hasDotNotationKeys({ name: 'Alice' })).toBe(false);
  });

  it('should expand flat dot notation objects into nested structures', () => {
    const expanded = expandDotNotation({
      'address.city': 'Los Angeles',
      'address.zipCode': '90001',
      name: 'John Doe',
    });

    expect(expanded).toEqual({
      name: 'John Doe',
      address: {
        city: 'Los Angeles',
        zipCode: '90001',
      },
    });
  });

  it('should flatten nested objects while preserving arrays and dates', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    const flattened = flattenToDotNotation({
      profile: {
        settings: {
          theme: 'dark',
        },
      },
      tags: ['alpha', 'beta'],
      createdAt: date,
    });

    expect(flattened).toEqual({
      'profile.settings.theme': 'dark',
      tags: ['alpha', 'beta'],
      createdAt: date,
    });
  });

  it('should merge dot notation updates into existing nested objects', () => {
    const merged = mergeDotNotationUpdate(
      {
        name: 'Alice',
        profile: {
          settings: {
            theme: 'light',
            notifications: false,
          },
        },
      },
      {
        'profile.settings.theme': 'dark',
        email: 'alice@example.com',
        'profile.settings.notifications': undefined,
      },
    );

    expect(merged).toEqual({
      name: 'Alice',
      email: 'alice@example.com',
      profile: {
        settings: {
          theme: 'dark',
          notifications: false,
        },
      },
    });
  });

  it('should validate valid paths and reject invalid paths', () => {
    expect(() => validateDotNotationPath('profile.settings.theme')).not.toThrow();
    expect(() => validateDotNotationPath('')).toThrow('cannot be empty');
    expect(() => validateDotNotationPath('.profile')).toThrow('cannot start or end with a dot');
    expect(() => validateDotNotationPath('profile..theme')).toThrow('Parts cannot be empty');
    expect(() => validateDotNotationPath('profile.theme.')).toThrow(
      'cannot start or end with a dot',
    );
  });

  it('should expose root field extraction and depth helpers', () => {
    expect(getRootFields(['address.city', 'address.zipCode', 'name']).sort()).toEqual([
      'address',
      'name',
    ]);
    expect(getDotNotationDepth('address.city')).toBe(2);
    expect(getDotNotationDepth('profile.settings.theme')).toBe(3);
    expect(getDotNotationDepth('name')).toBe(1);
  });
});

/**
 * Adversarial security + immutability tests for the exported object/path utilities. These helpers
 * are public exports that may be called directly with untrusted request bodies, so they must reject
 * prototype-pollution gadgets (CWE-1321) and must never mutate a caller-supplied nested object.
 */
describe('dotNotation security and immutability', () => {
  afterEach(() => {
    // Guard against a leaked pollution from any assertion below contaminating later tests.
    delete (Object.prototype as Record<string, unknown>).firestoreOrmPolluted;
  });

  it.each(['__proto__', 'prototype', 'constructor'])(
    'expandDotNotation rejects the dangerous segment "%s" without polluting Object.prototype',
    segment => {
      expect(() => expandDotNotation({ [`${segment}.firestoreOrmPolluted`]: true })).toThrow(
        /not allowed/,
      );
      expect(({} as Record<string, unknown>).firestoreOrmPolluted).toBeUndefined();
    },
  );

  it.each(['__proto__', 'prototype', 'constructor'])(
    'mergeDotNotationUpdate rejects the dangerous segment "%s" without polluting Object.prototype',
    segment => {
      expect(() =>
        mergeDotNotationUpdate({}, { [`${segment}.firestoreOrmPolluted`]: true }),
      ).toThrow(/not allowed/);
      expect(({} as Record<string, unknown>).firestoreOrmPolluted).toBeUndefined();
    },
  );

  it('validateDotNotationPath rejects dangerous segments anywhere in the path', () => {
    expect(() => validateDotNotationPath('__proto__.polluted')).toThrow(/not allowed/);
    expect(() => validateDotNotationPath('a.constructor.b')).toThrow(/not allowed/);
    expect(() => validateDotNotationPath('a.prototype')).toThrow(/not allowed/);
    expect(() => validateDotNotationPath('profile.settings.theme')).not.toThrow();
  });

  it('mergeDotNotationUpdate does not mutate the caller-supplied existing object', () => {
    const existing = {
      name: 'Alice',
      profile: { settings: { theme: 'light', notifications: false } },
    };
    const snapshot = structuredClone(existing);

    const merged = mergeDotNotationUpdate(existing, {
      'profile.settings.theme': 'dark',
      'profile.settings.count': 5,
    });

    // Input is deeply unchanged.
    expect(existing).toEqual(snapshot);
    expect(existing.profile.settings.theme).toBe('light');
    // Returned value carries the merged changes and preserves untouched siblings.
    expect(merged).toEqual({
      name: 'Alice',
      profile: { settings: { theme: 'dark', notifications: false, count: 5 } },
    });
    // The nested branch is a distinct reference (copy-on-write).
    expect(merged.profile).not.toBe(existing.profile);
    expect((merged.profile as { settings: unknown }).settings).not.toBe(existing.profile.settings);
  });

  // Unlike expand/merge (which reject dangerous path *segments*), flattenToDotNotation is a copy
  // builder that assigns arbitrary keys, so it must copy a dangerous own key *safely* rather than
  // let it control the output object's prototype.
  it('flattenToDotNotation does not let an own __proto__ key pollute Object.prototype', () => {
    // JSON.parse produces an OWN enumerable __proto__ key (unlike an object literal).
    const input = JSON.parse('{"__proto__":{"isAdmin":true},"name":"Alice"}');

    const flattened = flattenToDotNotation(input);

    // Global prototype is untouched...
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
    // ...and so is the returned object's prototype (not attacker-controlled).
    expect(Object.getPrototypeOf(flattened)).toBe(Object.prototype);
    expect((flattened as Record<string, unknown>).isAdmin).toBeUndefined();
    expect(flattened.name).toBe('Alice');
  });

  it('flattenToDotNotation copies a non-plain __proto__ value as an own property', () => {
    // A non-plain value under __proto__ takes the else-branch (result[fullKey] = value), which is the
    // path that would otherwise invoke the prototype setter.
    const input = JSON.parse('{"__proto__":[1,2,3]}');

    const flattened = flattenToDotNotation(input);

    expect(Object.getPrototypeOf(flattened)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(flattened, '__proto__')).toBe(true);
    expect((flattened as Record<string, unknown>).__proto__).toEqual([1, 2, 3]);
  });
});
