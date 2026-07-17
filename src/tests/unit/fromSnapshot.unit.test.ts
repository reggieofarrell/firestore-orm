/**
 * Strategy: unit tests for FirestoreRepository.fromSnapshot() — the read-mapper used to reconstruct
 * the read-typed document from a raw Firestore snapshot (e.g. a trigger cloud function payload).
 * fromSnapshot does no Firestore I/O, so these drive it with hand-rolled snapshot stubs
 * ({ exists, id, data() }) and assert the four contracts:
 *   1. with a converter configured, the converter's fromFirestore transform is applied;
 *   2. without a converter, snapshot.data() passes through unchanged;
 *   3. a non-existent snapshot resolves to null;
 *   4. the overlaid `id` (from snapshot.id) wins over any `id` present in the raw data.
 * Coverage of FirestoreRepository.ts is enforced by the integration gate; the emulator-backed
 * round-trip lives in the integration suite (repository-from-snapshot.integration.test.ts).
 */
import { Timestamp } from 'firebase-admin/firestore';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import { createMillisTimestampConverter } from '../../utils/timestamps.js';

const MS = Date.parse('2020-01-02T03:04:05.000Z');

/** Builds a DocumentSnapshot-like stub for fromSnapshot (no Firestore I/O is performed). */
function snapshotStub(args: {
  id: string;
  exists?: boolean;
  data?: Record<string, unknown> | undefined;
}): FirebaseFirestore.DocumentSnapshot {
  return {
    id: args.id,
    exists: args.exists ?? true,
    data: () => args.data,
  } as unknown as FirebaseFirestore.DocumentSnapshot;
}

// fromSnapshot never touches the db, so a bare stub is sufficient and honest.
const db = {} as any;

describe('FirestoreRepository.fromSnapshot', () => {
  it('applies the configured converter fromFirestore and overlays the id', () => {
    type EventDoc = { id: string; name: string; happenedAt: number };
    const repo = new FirestoreRepository<EventDoc>(
      db,
      'events',
      undefined,
      undefined,
      createMillisTimestampConverter<EventDoc>(),
    );

    const snap = snapshotStub({
      id: 'evt-1',
      data: { name: 'launch', happenedAt: Timestamp.fromMillis(MS) },
    });

    const result = repo.fromSnapshot(snap);

    // Converter ran: the stored Timestamp is now an ms number, and id is overlaid.
    expect(result).toEqual({ name: 'launch', happenedAt: MS, id: 'evt-1' });
    expect(typeof result?.happenedAt).toBe('number');
  });

  it('passes raw data through unchanged when no converter is configured', () => {
    const repo = new FirestoreRepository<{ id: string; name: string }>(db, 'users');

    const result = repo.fromSnapshot(snapshotStub({ id: 'u1', data: { name: 'Alice' } }));

    expect(result).toEqual({ name: 'Alice', id: 'u1' });
  });

  it('returns null for a non-existent snapshot', () => {
    const repo = new FirestoreRepository<{ id: string; name: string }>(db, 'users');

    expect(
      repo.fromSnapshot(snapshotStub({ id: 'gone', exists: false, data: undefined })),
    ).toBeNull();
  });

  it('overlays snapshot.id over any id present in the document data', () => {
    const repo = new FirestoreRepository<{ id: string; name: string }>(db, 'users');

    const result = repo.fromSnapshot(
      snapshotStub({ id: 'authoritative', data: { id: 'stale', name: 'Bob' } }),
    );

    expect(result?.id).toBe('authoritative');
    expect(result).toEqual({ name: 'Bob', id: 'authoritative' });
  });
});
