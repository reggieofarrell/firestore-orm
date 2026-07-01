import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { Firestore, getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { FirestoreRepository } from '../../../core/FirestoreRepository.js';

/**
 * Canonical project id used by local and CI emulator-backed integration tests.
 */
const TEST_PROJECT_ID = 'demo-firestoreorm-test';

/**
 * Shared user shape for repository integration coverage.
 */
export interface User {
  id: string;
  name: string;
  email?: string;
  address?: {
    street?: string;
    city?: string;
    zipCode?: string;
    country?: string;
  };
  profile?: {
    bio?: string;
    verified?: boolean;
    settings?: {
      theme?: string;
      notifications?: boolean;
      advanced?: {
        debugMode?: boolean;
      };
    };
  };
}

/**
 * Shape used by schema-validation and sentinel-focused integration tests.
 */
export interface HookValidatedUser {
  id: string;
  name: string;
  score: number;
  createdAt: string;
  tags?: string[];
  loginCount?: number;
}

/**
 * Shared Zod schema used for hook-first validation tests.
 */
export const hookValidatedUserSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  score: z.number().min(0),
  createdAt: z.string().datetime(),
  tags: z.array(z.string()).optional(),
  loginCount: z.number().int().min(0).optional(),
});

/**
 * Produces a unique collection name to prevent cross-test interference.
 */
function makeCollectionName(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Ensures integration tests target the local Firestore emulator.
 * Uses FIRESTORE_EMULATOR_HOST when provided, otherwise defaults to 127.0.0.1:8080.
 */
function assertFirestoreEmulatorConfigured(): void {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
}

/**
 * Returns a singleton admin app for integration tests.
 */
function getOrCreateTestApp() {
  const existingApps = getApps();
  if (existingApps.length > 0) {
    return getApp();
  }
  return initializeApp({ projectId: TEST_PROJECT_ID });
}

/**
 * Initializes a Firestore instance that targets the emulator.
 */
export function getIntegrationDb(): Firestore {
  assertFirestoreEmulatorConfigured();
  return getFirestore(getOrCreateTestApp());
}

/**
 * Creates an isolated repository and helper methods for common test workflows.
 */
export function createUserRepoHarness(prefix: string = 'test_users_integration') {
  const db = getIntegrationDb();
  const userRepo = new FirestoreRepository<User>(db, makeCollectionName(prefix));
  const trackedIds: string[] = [];

  /**
   * Tracks ids for per-test cleanup.
   */
  const trackUser = (userId: string): string => {
    trackedIds.push(userId);
    return userId;
  };

  /**
   * Fetches an existing user and fails loudly if missing.
   */
  const getUserOrFail = async (userId: string) => {
    const user = await userRepo.getById(userId);
    expect(user).not.toBeNull();
    return user as User & { id: string };
  };

  /**
   * Deletes all ids tracked during an individual test case.
   */
  const cleanupTrackedUsers = async () => {
    if (trackedIds.length > 0) {
      await userRepo.bulkDelete(trackedIds);
      trackedIds.length = 0;
    }
  };

  /**
   * Deletes all documents in the collection as an end-of-suite safety net.
   */
  const cleanupCollection = async () => {
    const allUsers = await userRepo.query().get();
    if (allUsers.length > 0) {
      await userRepo.bulkDelete(allUsers.map(user => user.id));
    }
  };

  return {
    db,
    userRepo,
    trackUser,
    getUserOrFail,
    cleanupTrackedUsers,
    cleanupCollection,
  };
}

/**
 * Builds an isolated schema-validated repository for hook/sentinel integration tests.
 */
export function createValidatedRepo(db: Firestore) {
  return FirestoreRepository.withSchema<HookValidatedUser>(
    db,
    makeCollectionName('test_users_hook_order'),
    hookValidatedUserSchema,
  );
}

/**
 * Removes all documents from a validated repository collection.
 */
export async function cleanupValidatedRepo(
  repo: FirestoreRepository<HookValidatedUser>,
): Promise<void> {
  const docs = await repo.query().get();
  if (docs.length > 0) {
    await repo.bulkDelete(docs.map(doc => doc.id));
  }
}
