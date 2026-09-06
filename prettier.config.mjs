import sharedPrettierConfig from '@casadega-development/ts-repo-tooling/prettier';

/**
 * Extend the shared TypeScript formatting baseline while preserving the
 * established FlintFire style. Keeping repository-specific presentation
 * choices here avoids a whole-repository formatting rewrite during tooling
 * adoption while still centralizing common defaults.
 */
export default {
  ...sharedPrettierConfig,
  arrowParens: 'avoid',
  bracketSpacing: true,
  bracketSameLine: false,
  embeddedLanguageFormatting: 'auto',
  endOfLine: 'lf',
  htmlWhitespaceSensitivity: 'css',
  insertPragma: false,
  jsxSingleQuote: false,
  printWidth: 100,
  proseWrap: 'always',
  quoteProps: 'as-needed',
  requirePragma: false,
  singleQuote: true,
  tabWidth: 2,
  useTabs: false,
};
