import { createSonarHookEslintConfig } from '@casadega-development/ts-repo-tooling/eslint';
import { loadSonarRuleSet } from '@casadega-development/ts-repo-tooling/sonar';
import { URL } from 'node:url';

/**
 * Generated server-aligned rule profile shared with the complete ESLint gate.
 * The hook helper selects only rules that do not require TypeScript type data,
 * preserving low-latency feedback after an agent edits a source file.
 */
const sonarRuleSet = loadSonarRuleSet(new URL('./scripts/sonar-rules/rules.json', import.meta.url));

export default createSonarHookEslintConfig({
  ruleSet: sonarRuleSet,
  ignores: [
    '**/*.test.ts',
    '**/*.spec.ts',
    '**/*.type-test.ts',
    '**/benchmarks/**',
    'src/tests/**',
    'scripts/**',
    'website/**',
    'docs/plans/**',
    'tmp/**',
  ],
});
