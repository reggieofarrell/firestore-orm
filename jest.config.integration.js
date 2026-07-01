import { baseConfig } from './jest.config.base.js';

/** @type {import('jest').Config} */
export default {
  ...baseConfig,
  displayName: 'integration',
  testMatch: ['**/src/tests/integration/**/*.test.ts'],
  testTimeout: 30_000,
  coverageDirectory: 'coverage/integration',
};
