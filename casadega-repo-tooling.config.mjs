import { defineConfig } from '@casadega-development/ts-repo-tooling';

/**
 * Bind Casadega's shared repository tooling to FlintFire's intentionally
 * npm-based, published-library layout.
 *
 * The package's runtime and package-baseline commands are not enabled as gates
 * here. FlintFire deliberately supports Node.js 22 consumers even though its
 * development and release environment uses Node.js 24, and its public-package
 * manifest has different constraints from a private application monorepo.
 */
export default defineConfig({
  defaultBranch: 'main',
  packageManager: 'npm',
  sonar: {
    baseRef: 'origin/main',
    propertiesFile: 'sonar-project.properties',
    // Preserve the established generated-file location so existing reviews and
    // agent instructions continue to point at one stable artifact.
    rulesFile: 'scripts/sonar-rules/rules.json',
  },
});
