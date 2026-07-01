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
