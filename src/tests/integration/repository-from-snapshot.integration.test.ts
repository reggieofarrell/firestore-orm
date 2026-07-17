/**
 * Strategy: emulator-backed integration coverage for FirestoreRepository.fromSnapshot() — the
 * read-mapper for raw snapshots (as delivered to trigger cloud functions). Snapshots are fetched
 * from the RAW, un-converter-wrapped db (never via the repo) to faithfully reproduce a trigger
 * payload, then mapped with repo.fromSnapshot(). Verifies:
 *   1. with a converter (createMillisTimestampConverter), the raw snapshot's stored Timestamp is
 *      still a Timestamp, and fromSnapshot applies fromFirestore (-> ms number) and overlays id;
 *   2. a non-existent snapshot maps to null;
 *   3. without a converter, raw data passes through and id is overlaid.
 * FirestoreRepository.ts is owned by the integration coverage gate, so this is the load-bearing
 * suite for the new method.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import { zDateWrite } from '../../core/Validation.js';
import { createMillisTimestampConverter } from '../../utils/timestamps.js';
import { getIntegrationDb } from './helpers/firestoreIntegrationHarness.js';

interface EventDoc {
  id: string;
  name: string;
  happenedAt: number; // ms since epoch on read
}

const eventWriteSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  happenedAt: zDateWrite(),
});

const CONVERTER_COLLECTION = `test_from_snapshot_converter_${Date.now()}`;
const PLAIN_COLLECTION = `test_from_snapshot_plain_${Date.now()}`;

describe('FirestoreRepository.fromSnapshot (integration)', () => {
  const db = getIntegrationDb();

  const converterRepo = FirestoreRepository.withSchema<EventDoc>(
    db,
    CONVERTER_COLLECTION,
    eventWriteSchema,
    createMillisTimestampConverter<EventDoc>(),
    { sentinelPolicy: 'strict' },
  );

  interface PlainDoc {
    id: string;
    name: string;
  }
  const plainRepo = new FirestoreRepository<PlainDoc>(db, PLAIN_COLLECTION);

  afterAll(async () => {
    for (const collection of [CONVERTER_COLLECTION, PLAIN_COLLECTION]) {
      const snap = await db.collection(collection).get();
      await Promise.all(snap.docs.map(doc => doc.ref.delete()));
    }
  });

  it('applies the converter and overlays id on a raw (trigger-style) snapshot', async () => {
    const when = new Date('2020-01-02T03:04:05.000Z');
    const created = await converterRepo.create({
      name: 'launch',
      happenedAt: when as unknown as number,
    } as EventDoc);

    // Fetch from the raw db — as a trigger would receive it: NOT converter-applied.
    const rawSnap = await db.collection(CONVERTER_COLLECTION).doc(created.id).get();
    // Proof the raw snapshot is un-converted: the field is still a Firestore Timestamp.
    expect(rawSnap.data()?.happenedAt).toBeInstanceOf(Timestamp);

    const mapped = converterRepo.fromSnapshot(rawSnap);
    expect(mapped?.id).toBe(created.id);
    expect(typeof mapped?.happenedAt).toBe('number');
    expect(mapped?.happenedAt).toBe(when.getTime());
    expect(mapped?.name).toBe('launch');
  });

  it('returns null for a non-existent snapshot', async () => {
    const missing = await db.collection(CONVERTER_COLLECTION).doc('does-not-exist').get();
    expect(converterRepo.fromSnapshot(missing)).toBeNull();
  });

  it('passes raw data through and overlays id when no converter is configured', async () => {
    const created = await plainRepo.create({ name: 'raw' });

    const rawSnap = await db.collection(PLAIN_COLLECTION).doc(created.id).get();
    const mapped = plainRepo.fromSnapshot(rawSnap);

    expect(mapped).toEqual({ name: 'raw', id: created.id });
  });
});
