import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { Firestore, getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { FirestoreRepository } from '../../../core/FirestoreRepository.js';
import type { FirestoreDocument } from '../../../core/DocumentId.js';
import { zArrayWrite, zNumberWrite, zSentinel } from '../../../core/Validation.js';

/**
 * Canonical project id used by local and CI emulator-backed integration tests.
 */
const TEST_PROJECT_ID = 'demo-firestoreorm-test';

/**
 * Shared user shape for repository integration coverage.
 */
export interface User {
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
  name: z.string().min(1),
  score: z.number().min(0),
  createdAt: z.string().datetime(),
  tags: z.array(z.string()).optional(),
  loginCount: z.number().int().min(0).optional(),
});

/**
 * Strict, combinator-based schema: each field declares exactly which sentinels it permits.
 * `score` is plain (no sentinel), `createdAt` accepts a string or serverTimestamp, `tags`
 * accepts an array or arrayUnion/arrayRemove, and `loginCount` accepts a number or increment.
 */
export const strictHookValidatedUserSchema = z.object({
  name: z.string().min(1),
  score: z.number().min(0),
  createdAt: z.union([z.string(), zSentinel('serverTimestamp')]),
  tags: zArrayWrite(z.string()).optional(),
  loginCount: zNumberWrite().optional(),
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
    return user as FirestoreDocument<User>;
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
 * Uses the v3 default `sentinelPolicy: 'strict'`.
 */
export function createValidatedRepo(db: Firestore) {
  return FirestoreRepository.withSchema(
    db,
    makeCollectionName('test_users_hook_order'),
    hookValidatedUserSchema,
  );
}

/**
 * Builds an isolated schema-validated repository that opts into the pre-v3
 * `sentinelPolicy: 'permissive'` escape hatch (bare sentinels waived on a plain schema). Used to
 * cover the still-supported permissive path now that `'strict'` is the default.
 */
export function createPermissiveRepo(db: Firestore) {
  return FirestoreRepository.withSchema(
    db,
    makeCollectionName('test_users_permissive'),
    hookValidatedUserSchema,
    { sentinelPolicy: 'permissive' },
  );
}

/**
 * Builds an isolated repository with `sentinelPolicy: 'strict'` and the combinator-based
 * write overlay, so only sentinels each field explicitly permits are accepted while reads stay
 * typed by the plain read schema.
 */
export function createStrictRepo(db: Firestore) {
  return FirestoreRepository.withSchema(
    db,
    makeCollectionName('test_users_strict'),
    hookValidatedUserSchema,
    { writeSchema: strictHookValidatedUserSchema, sentinelPolicy: 'strict' },
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

/**
 * Document shape for vector search integration tests.
 * Uses a top-level `embedding` field (recommended for emulator reliability).
 */
export interface VectorDoc {
  name: string;
  category?: string;
  status?: string;
}

const VECTOR_COLLECTION = 'test_vectors';
const VECTOR_PREFILTER_COLLECTION = 'test_vectors_prefilter';

/**
 * Creates repositories for vector search integration tests.
 * Collection names are fixed to align with firestore.indexes.json vector indexes.
 */
export function createVectorDocRepoHarness() {
  const db = getIntegrationDb();
  const vectorRepo = new FirestoreRepository<VectorDoc>(db, VECTOR_COLLECTION);
  const prefilterRepo = new FirestoreRepository<VectorDoc>(db, VECTOR_PREFILTER_COLLECTION);

  const cleanupVectorCollections = async () => {
    const [vectorDocs, prefilterDocs] = await Promise.all([
      vectorRepo.query().get(),
      prefilterRepo.query().get(),
    ]);

    if (vectorDocs.length > 0) {
      await vectorRepo.bulkDelete(vectorDocs.map(doc => doc.id));
    }

    if (prefilterDocs.length > 0) {
      await prefilterRepo.bulkDelete(prefilterDocs.map(doc => doc.id));
    }
  };

  return {
    db,
    vectorRepo,
    prefilterRepo,
    cleanupVectorCollections,
  };
}
