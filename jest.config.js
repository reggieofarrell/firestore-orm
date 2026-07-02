/**
 * Default Jest entry point — runs unit tests for backward compatibility.
 * Use jest.config.unit.js or jest.config.integration.js explicitly in npm scripts.
 *
 * Coverage gates: scripts/check-coverage-gates.mjs (dual per-suite, not merged LCOV).
 */
export { default } from './jest.config.unit.js';
