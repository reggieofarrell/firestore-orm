import {
  createSonarEslintConfig,
  eslintPrettierConfig,
} from '@casadega-development/ts-repo-tooling/eslint';
import { loadSonarRuleSet } from '@casadega-development/ts-repo-tooling/sonar';
import js from '@eslint/js';
// import-x is the ESLint 10-compatible fork of eslint-plugin-import. FlintFire
// keeps its website-specific dependency boundary local because that policy is
// unique to the nested Starlight application.
import importX from 'eslint-plugin-import-x';
import { dirname, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import tseslint from 'typescript-eslint';

/** Absolute repository root used by the type-aware Sonar configuration. */
const rootDir = dirname(fileURLToPath(import.meta.url));

/**
 * Nested documentation application root.
 *
 * Only this directory is supplied to the website dependency boundary. Adding
 * the repository root would allow the site to import undeclared dependencies
 * from FlintFire's library manifest and silently weaken workspace isolation.
 */
const websiteDir = join(rootDir, 'website');

/**
 * Generated intersection of the server's active quality profile and the rules
 * implemented by the SonarJS version owned by shared repository tooling.
 */
const sonarRuleSet = loadSonarRuleSet(new URL('./scripts/sonar-rules/rules.json', import.meta.url));

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/benchmarks/**',
      'scripts/**',
      '.versionrc.cjs',
      '**/*.astro',
      'tmp/**',
      'eslint.sonar-hook.config.mjs',
      'docs/plans/**',
      'website/dist/**',
      'website/.astro/**',
      'website/node_modules/**',
      // Agent-created worktrees are separate checkouts with their own config
      // and must never be traversed by the parent repository's lint command.
      '.claude/worktrees/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
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
  {
    files: ['website/**/*.{js,mjs,cjs,ts,tsx,astro}'],
    plugins: { 'import-x': importX },
    rules: {
      'import-x/no-extraneous-dependencies': [
        'error',
        {
          packageDir: [websiteDir],
          devDependencies: ['website/*.{js,mjs,cjs,ts}', 'website/**/*.config.{js,mjs,cjs,ts}'],
        },
      ],
    },
  },
  ...createSonarEslintConfig({
    files: ['src/**/*.ts'],
    ruleSet: sonarRuleSet,
  }).map(config => ({
    ...config,
    ignores: [
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/*.type-test.ts',
      'src/tests/**',
      'src/benchmarks/**',
    ],
    languageOptions: {
      ...config.languageOptions,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: rootDir,
      },
    },
  })),
  // Formatting belongs to Prettier; this compatibility entry must remain last.
  eslintPrettierConfig,
];
