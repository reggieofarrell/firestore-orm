import type { User } from '../../integration/helpers/firestoreIntegrationHarness.js';
import type { FirestoreDocument } from '../../../core/DocumentId.js';
import { nextUserCounter } from './counters.js';

/**
 * Builds a create payload for integration tests. `User` is the read/write model (no top-level `id`);
 * the document id is assigned by Firestore.
 */
export function createTestUserInput(overrides: Partial<User> = {}): User {
  const n = nextUserCounter();
  return {
    name: `Test User ${n}`,
    email: `user-${n}@example.com`,
    ...overrides,
  };
}

/**
 * Builds a full document shape including `id` for hook/assertion fixtures — a `FirestoreDocument<User>`
 * (the read data plus the authoritative read-only document id).
 */
export function createTestUser(
  overrides: Partial<FirestoreDocument<User>> = {},
): FirestoreDocument<User> {
  const n = nextUserCounter();
  return {
    id: `user-${n}`,
    name: `Test User ${n}`,
    email: `user-${n}@example.com`,
    ...overrides,
  };
}
