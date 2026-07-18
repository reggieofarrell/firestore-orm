/** @type {import('jest').Config} */
export const baseConfig = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          module: 'ES2022',
          target: 'ES2022',
          moduleResolution: 'node',
          esModuleInterop: true,
          isolatedModules: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
    '!src/benchmarks/**',
    '!src/tests/**',
    // Types-only modules emit no runtime code; the V8 provider would otherwise report every line
    // as uncovered and skew the src/utils gate. Their contracts are enforced by *.type-test.ts.
    '!src/utils/pathTypes.ts',
  ],
  coverageReporters: ['lcov', 'text-summary'],
  coverageProvider: 'v8',
  // Path-specific thresholds are enforced per suite by scripts/check-coverage-gates.mjs.
  // Jest coverageThreshold is not used — a single config cannot express dual gate ownership.
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  modulePathIgnorePatterns: ['<rootDir>/package/', '<rootDir>/dist/'],
  testPathIgnorePatterns: ['/node_modules/', '/package/', '/dist/'],
  watchman: false,
};
