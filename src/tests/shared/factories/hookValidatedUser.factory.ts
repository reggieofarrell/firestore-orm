import type { HookValidatedUser } from '../../integration/helpers/firestoreIntegrationHarness.js';
import { nextHookValidatedUserCounter } from './counters.js';

/**
 * Builds a create payload for schema-validated hook integration tests.
 */
export function createHookValidatedUserInput(
  overrides: Partial<Omit<HookValidatedUser, 'id'>> = {},
): Omit<HookValidatedUser, 'id'> {
  const n = nextHookValidatedUserCounter();
  return {
    name: `Hook User ${n}`,
    score: n,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}
