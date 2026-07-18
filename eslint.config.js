import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
// import-x is the ESLint 10–compatible fork of eslint-plugin-import; same
// no-extraneous-dependencies rule the Starlight plan called for.
import importX from 'eslint-plugin-import-x';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rootDir = dirname(fileURLToPath(import.meta.url));
// Nested docs site only — do NOT also list the repo root here. Passing both
// would merge allowed deps from parent + child and defeat the boundary.
const websiteDir = join(rootDir, 'website');

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
      // Starlight / Astro generated + installed trees
      'website/dist/**',
      'website/.astro/**',
      'website/node_modules/**',
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
  // website/ may only import packages declared in website/package.json.
  // Parent (library) deps must be re-declared there to pass lint.
  {
    files: ['website/**/*.{js,mjs,cjs,ts,tsx,astro}'],
    plugins: { 'import-x': importX },
    rules: {
      'import-x/no-extraneous-dependencies': [
        'error',
        {
          packageDir: [websiteDir],
          // Astro/Starlight config + content tooling legitimately use
          // packages that may be listed as dependencies or devDependencies.
          devDependencies: ['website/*.{js,mjs,cjs,ts}', 'website/**/*.config.{js,mjs,cjs,ts}'],
        },
      ],
    },
  },
  // Disable rules that conflict with Prettier (must be last)
  prettierConfig,
];
