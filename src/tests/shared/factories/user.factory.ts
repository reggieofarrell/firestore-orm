import type { User } from '../../integration/helpers/firestoreIntegrationHarness.js';
import { nextUserCounter } from './counters.js';

/**
 * Builds a create payload for integration tests (no Firestore-assigned id).
 */
export function createTestUserInput(overrides: Partial<Omit<User, 'id'>> = {}): Omit<User, 'id'> {
  const n = nextUserCounter();
  return {
    name: `Test User ${n}`,
    email: `user-${n}@example.com`,
    ...overrides,
  };
}

/**
 * Builds a full user shape including id for hook/assertion fixtures.
 */
export function createTestUser(overrides: Partial<User> = {}): User {
  const n = nextUserCounter();
  return {
    id: `user-${n}`,
    name: `Test User ${n}`,
    email: `user-${n}@example.com`,
    ...overrides,
  };
}
