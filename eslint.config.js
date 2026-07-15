import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default [
  // Ignore build output, dependencies, coverage, tests, and benchmarks
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/benchmarks/**',
      'scripts/**',
    ],
  },
  // Recommended JavaScript rules
  js.configs.recommended,
  // Recommended TypeScript rules (no type-aware/strict)
  ...tseslint.configs.recommended,
  // Allow explicit any; allow _-prefixed names to be unused (e.g. _ignoredId)
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  // Disable rules that conflict with Prettier (must be last)
  prettierConfig,
];
