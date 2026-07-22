/**
 * Strategy: emulator-backed integration coverage for FirestoreRepository.validate() —
 * the explicit read-boundary validator. Writes a real document via the repo, reads it
 * back, and asserts validate() accepts the round-tripped shape. Also writes a raw
 * document that violates the schema and asserts validate() throws ValidationError.
 * FirestoreRepository.ts is owned by the integration coverage gate.
 */
import { z } from 'zod';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import { ValidationError } from '../../core/Errors.js';
import { getIntegrationDb } from './helpers/firestoreIntegrationHarness.js';
import { createTestUserInput } from '../shared/factories/user.factory.js';
import { resetTestFactoryCounters } from '../shared/factories/counters.js';

interface User {
  id: string;
  name: string;
  email?: string;
}

const userSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
});

const COLLECTION = `test_validate_${Date.now()}`;

describe('FirestoreRepository.validate (integration)', () => {
  const db = getIntegrationDb();
  const repo = FirestoreRepository.withSchema(db, COLLECTION, userSchema);
  const trackedIds: string[] = [];

  beforeEach(() => {
    resetTestFactoryCounters();
  });

  afterAll(async () => {
    // Best-effort cleanup of documents created by this suite.
    await Promise.all(trackedIds.map(id => db.collection(COLLECTION).doc(id).delete()));
  });

  it('accepts a document round-tripped through create + getById', async () => {
    const created = await repo.create(createTestUserInput({ name: 'Validated User' }));
    trackedIds.push(created.id);

    const read = await repo.getByIdOrThrow(created.id);
    const validated = repo.validate(read);

    expect(validated).toEqual(read);
    expect(validated.id).toBe(created.id);
    expect(validated.name).toBe('Validated User');
  });

  it('throws ValidationError when a raw stored document no longer matches the schema', async () => {
    // Bypass the repo write path so we can store a shape that violates name.min(1).
    const docRef = db.collection(COLLECTION).doc();
    await docRef.set({ name: '', email: 'bad@example.com' });
    trackedIds.push(docRef.id);

    const read = await repo.getByIdOrThrow(docRef.id);
    // The cast read succeeds (reads are not validated), but the explicit boundary fails.
    expect(read.name).toBe('');
    expect(() => repo.validate(read)).toThrow(ValidationError);
  });

  it('safeValidate returns per-item results for a mixed getAll list', async () => {
    const good = await repo.create(createTestUserInput({ name: 'Good User' }));
    trackedIds.push(good.id);

    const badRef = db.collection(COLLECTION).doc();
    await badRef.set({ name: '' });
    trackedIds.push(badRef.id);

    const all = await repo.getAll();
    const results = repo.safeValidate(all);

    expect(results.length).toBeGreaterThanOrEqual(2);
    const successes = results.filter(r => r.success);
    const failures = results.filter(r => !r.success);
    expect(successes.some(r => r.success && r.data.id === good.id)).toBe(true);
    expect(failures.length).toBeGreaterThanOrEqual(1);
    expect(failures.every(r => !r.success && r.error instanceof ValidationError)).toBe(true);
  });
});
