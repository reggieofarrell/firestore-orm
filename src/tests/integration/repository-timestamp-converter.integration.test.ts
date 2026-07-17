/**
 * Strategy: integration coverage for the documented "write Timestamp, read ms-number" recipe.
 * A field is written as `serverTimestamp()` / a `Date` (validated by `zDateWrite()`), stored as a
 * Firestore `Timestamp`, and read back as milliseconds-since-epoch via a small read converter.
 * Confirms the recipe works on both the create (add) and update (partial) write paths.
 */
import { FieldValue, FirestoreDataConverter } from 'firebase-admin/firestore';
import { z } from 'zod';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import { zDateWrite } from '../../core/Validation.js';
import { getIntegrationDb } from './helpers/firestoreIntegrationHarness.js';

interface EventDoc {
  id: string;
  name: string;
  happenedAt: number; // ms since epoch on read
}

// Write schema: happenedAt accepts a Date or serverTimestamp() (never a raw number).
const eventWriteSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  happenedAt: zDateWrite(),
});

// Read converter: turn the stored Timestamp into ms-since-epoch. Write side is pass-through —
// the Admin SDK stores Date/serverTimestamp as a Timestamp on all write paths. `id` is overlaid
// by the repository, so fromFirestore must not return it.
const eventConverter: FirestoreDataConverter<EventDoc> = {
  toFirestore: data => data as FirebaseFirestore.DocumentData,
  fromFirestore: (snapshot: FirebaseFirestore.QueryDocumentSnapshot) => {
    const data = snapshot.data();
    const happenedAt = data.happenedAt as { toMillis?: () => number } | number | undefined;
    return {
      name: data.name,
      happenedAt:
        happenedAt && typeof (happenedAt as { toMillis?: () => number }).toMillis === 'function'
          ? (happenedAt as { toMillis: () => number }).toMillis()
          : happenedAt,
    } as EventDoc;
  },
};

const COLLECTION = `test_events_timestamp_${Date.now()}`;

describe('Timestamp <-> millis read-converter pattern', () => {
  const db = getIntegrationDb();
  const repo = FirestoreRepository.withSchema<EventDoc>(
    db,
    COLLECTION,
    eventWriteSchema,
    eventConverter,
    { sentinelPolicy: 'strict' },
  );

  afterAll(async () => {
    const docs = await repo.query().get();
    if (docs.length > 0) {
      await repo.bulkDelete(docs.map(doc => doc.id));
    }
  });

  it('writes serverTimestamp on create and reads back an ms number', async () => {
    const before = Date.now();
    const created = await repo.create({
      name: 'launch',
      happenedAt: FieldValue.serverTimestamp() as unknown as number,
    } as EventDoc);

    const persisted = await repo.getById(created.id);
    expect(persisted).not.toBeNull();
    expect(typeof persisted?.happenedAt).toBe('number');
    // serverTimestamp resolves to roughly "now"
    expect(persisted!.happenedAt).toBeGreaterThanOrEqual(before - 60_000);
  });

  it('writes a Date on update and reads back its ms value', async () => {
    const created = await repo.create({
      name: 'scheduled',
      happenedAt: FieldValue.serverTimestamp() as unknown as number,
    } as EventDoc);

    const when = new Date('2020-01-02T03:04:05.000Z');
    await repo.update(created.id, { happenedAt: when as unknown as number });

    const persisted = await repo.getById(created.id);
    expect(typeof persisted?.happenedAt).toBe('number');
    expect(persisted!.happenedAt).toBe(when.getTime());
  });
});
