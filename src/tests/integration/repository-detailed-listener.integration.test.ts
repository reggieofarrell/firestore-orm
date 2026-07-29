/**
 * Strategy: emulator integration coverage for `onSnapshotDetailed` and `listenOneDetailed`
 * (issue #39, ADR-0033). Drive the emulator the way probe P2 does: subscribe, mutate with awaited
 * spacing, collect emissions, unsubscribe in `finally`, then assert.
 *
 * Verification points (plan §8 I-2):
 *  - Initial emission: every change is `added` with oldIndex -1 and ascending newIndex (P2a)
 *  - `docs` deep-equals a plain `get()` for the same query
 *  - In-place edit → one `modified` with oldIndex === newIndex (P2b)
 *  - Reordering edit → one `modified` with oldIndex !== newIndex (P2c)
 *  - Delete → `removed` with last-known doc + populated create/update times (T6 / P2d)
 *  - snapshot.readTime / size / empty agree with docs
 *  - `select().onSnapshotDetailed` rejects locally (T8)
 *  - Existing `onSnapshot` still delivers bare R[] (acceptance)
 *  - listenOneDetailed delivers wrappers; deletion / missing → NotFoundError via onError (D5)
 */
import { Timestamp } from 'firebase-admin/firestore';
import { NotFoundError } from '../../core/Errors.js';
import type { DetailedQuerySnapshot } from '../../index.js';
import { createUserRepoHarness } from './helpers/firestoreIntegrationHarness.js';

/** Wait until `predicate` holds on the collected emissions, or reject on timeout. */
async function waitForEmission<R>(
  emissions: DetailedQuerySnapshot<R>[],
  predicate: (snap: DetailedQuerySnapshot<R>) => boolean,
  label: string,
  timeoutMs = 10000,
): Promise<DetailedQuerySnapshot<R>> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const match = emissions.find(predicate);
    if (match) return match;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for emission: ${label}`);
}

describe('detailed listeners (issue #39)', () => {
  const harness = createUserRepoHarness('test_users_detailed_listener');
  const { userRepo, trackUser, cleanupTrackedUsers, cleanupCollection } = harness;

  afterEach(async () => {
    await cleanupTrackedUsers();
  });

  afterAll(async () => {
    await cleanupCollection();
  });

  it('I-2#1–7: onSnapshotDetailed delivers incremental docChanges with metadata', async () => {
    const low = await userRepo.create({ name: 'DL Low', email: 'dl@example.com' } as never);
    const mid = await userRepo.create({ name: 'DL Mid', email: 'dl@example.com' } as never);
    const high = await userRepo.create({ name: 'DL High', email: 'dl@example.com' } as never);
    trackUser(low.id);
    trackUser(mid.id);
    trackUser(high.id);

    // Distinct sort keys so reordering is observable.
    await userRepo.update(low.id, { name: 'A-low' });
    await userRepo.update(mid.id, { name: 'B-mid' });
    await userRepo.update(high.id, { name: 'C-high' });

    const emissions: DetailedQuerySnapshot<typeof low>[] = [];
    let unsubscribe: (() => void) | undefined;

    try {
      unsubscribe = await userRepo
        .query()
        .where('email', '==', 'dl@example.com')
        .orderBy('name', 'asc')
        .onSnapshotDetailed(snap => {
          emissions.push(snap);
        });

      const initial = await waitForEmission(
        emissions,
        snap => snap.docs.length === 3 && snap.changes.every(c => c.type === 'added'),
        'initial added emission',
      );

      expect(initial.changes.every(c => c.type === 'added')).toBe(true);
      expect(initial.changes.every(c => c.oldIndex === -1)).toBe(true);
      expect(initial.changes.map(c => c.newIndex)).toEqual([0, 1, 2]);

      // M2: present documents must share one mapped instance between `docs` and `changes` so a
      // non-memoized readConverter runs once per document and `docs.indexOf(change.doc)` works.
      expect(initial.changes.find(c => c.doc === initial.docs[0])).toBeDefined();
      expect(initial.docs.indexOf(initial.changes[0]!.doc)).not.toBe(-1);

      const plain = await userRepo
        .query()
        .where('email', '==', 'dl@example.com')
        .orderBy('name', 'asc')
        .get();
      expect(initial.docs).toEqual(plain);

      expect(initial.readTime).toBeInstanceOf(Timestamp);
      expect(initial.size).toBe(initial.docs.length);
      expect(initial.empty).toBe(initial.docs.length === 0);

      const beforeInPlace = emissions.length;
      await userRepo.update(mid.id, { name: 'B-mid-edited' });
      // Keep alphabetical position between A and C so this is an in-place modify.
      const inPlace = await waitForEmission(
        emissions,
        snap =>
          emissions.indexOf(snap) >= beforeInPlace &&
          snap.changes.some(c => c.type === 'modified' && c.oldIndex === c.newIndex),
        'in-place modified',
      );
      const inPlaceChange = inPlace.changes.find(c => c.type === 'modified')!;
      expect(inPlaceChange.oldIndex).toBe(inPlaceChange.newIndex);
      expect(inPlaceChange.doc.name).toBe('B-mid-edited');

      const beforeReorder = emissions.length;
      // Rename mid so it sorts after C — oldIndex !== newIndex.
      await userRepo.update(mid.id, { name: 'D-mid-moved' });
      const reorder = await waitForEmission(
        emissions,
        snap =>
          emissions.indexOf(snap) >= beforeReorder &&
          snap.changes.some(c => c.type === 'modified' && c.oldIndex !== c.newIndex),
        'reordering modified',
      );
      const reorderChange = reorder.changes.find(c => c.type === 'modified')!;
      expect(reorderChange.oldIndex).not.toBe(reorderChange.newIndex);

      const beforeRemove = emissions.length;
      const removedName = high.name; // last-known value before delete — but we renamed earlier
      // Re-read last-known name from the latest emission docs.
      const lastKnownHigh = emissions[emissions.length - 1].docs.find(d => d.id === high.id);
      expect(lastKnownHigh).toBeDefined();
      await userRepo.delete(high.id);
      const removal = await waitForEmission(
        emissions,
        snap =>
          emissions.indexOf(snap) >= beforeRemove &&
          snap.changes.some(c => c.type === 'removed' && (c.doc as { id: string }).id === high.id),
        'removed change',
      );
      const removed = removal.changes.find(
        c => c.type === 'removed' && (c.doc as { id: string }).id === high.id,
      )!;
      expect(removed.newIndex).toBe(-1);
      expect(removed.doc.name).toBe(lastKnownHigh!.name);
      expect(removed.metadata.createTime).toBeInstanceOf(Timestamp);
      expect(removed.metadata.updateTime).toBeInstanceOf(Timestamp);
      void removedName;
    } finally {
      unsubscribe?.();
    }
  });

  it('I-2#8: onSnapshotDetailed after select() rejects locally (T8)', async () => {
    await expect(
      userRepo
        .query()
        .select('name')
        .onSnapshotDetailed(() => {}),
    ).rejects.toThrow(/not supported after select\(\)/);
  });

  it('I-2#9: onSnapshot still delivers bare R[]', async () => {
    const created = await userRepo.create({ name: 'Bare Snap', email: 'bare-snap@example.com' });
    trackUser(created.id);

    const emissions: unknown[] = [];
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = await userRepo
        .query()
        .where('email', '==', 'bare-snap@example.com')
        .onSnapshot(items => {
          emissions.push(items);
        });

      await new Promise(resolve => setTimeout(resolve, 500));
      expect(emissions.length).toBeGreaterThanOrEqual(1);
      const latest = emissions[emissions.length - 1] as Array<{ id: string; name: string }>;
      expect(latest.some(item => item.id === created.id && item.name === 'Bare Snap')).toBe(true);
      expect((latest[0] as { doc?: unknown }).doc).toBeUndefined();
    } finally {
      unsubscribe?.();
    }
  });

  it('I-2#10: listenOneDetailed delivers { doc, metadata } while the document exists', async () => {
    const created = await userRepo.create({ name: 'Listen Detailed' });
    trackUser(created.id);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error('listenOneDetailed timed out'));
      }, 10000);

      const unsubscribe = userRepo.listenOneDetailed(
        created.id,
        ({ doc, metadata }) => {
          try {
            expect(doc.id).toBe(created.id);
            expect(doc.name).toBe('Listen Detailed');
            expect(metadata.createTime).toBeInstanceOf(Timestamp);
            expect(metadata.updateTime).toBeInstanceOf(Timestamp);
            expect(metadata.readTime).toBeInstanceOf(Timestamp);
            clearTimeout(timeout);
            unsubscribe();
            resolve();
          } catch (err) {
            clearTimeout(timeout);
            unsubscribe();
            reject(err);
          }
        },
        error => {
          clearTimeout(timeout);
          unsubscribe();
          reject(error);
        },
      );
    });
  });

  it('I-2#11: listenOneDetailed routes deletion to onError NotFoundError (D5)', async () => {
    const created = await userRepo.create({ name: 'Listen Delete' });
    trackUser(created.id);

    await new Promise<void>((resolve, reject) => {
      let sawDoc = false;
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error('listenOneDetailed deletion did not call onError'));
      }, 10000);

      const unsubscribe = userRepo.listenOneDetailed(
        created.id,
        () => {
          if (!sawDoc) {
            sawDoc = true;
            void userRepo.delete(created.id).catch(reject);
            return;
          }
          clearTimeout(timeout);
          unsubscribe();
          reject(new Error('callback must not run again after deletion'));
        },
        error => {
          clearTimeout(timeout);
          unsubscribe();
          try {
            expect(error).toBeInstanceOf(NotFoundError);
            resolve();
          } catch (assertionError) {
            reject(assertionError);
          }
        },
      );
    });
  });

  it('I-2#12: listenOneDetailed missing id calls onError with NotFoundError', async () => {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error('listenOneDetailed missing-doc path did not trigger onError'));
      }, 10000);

      const unsubscribe = userRepo.listenOneDetailed(
        'listen-detailed-missing-doc',
        () => {
          clearTimeout(timeout);
          unsubscribe();
          reject(new Error('callback should not run for missing documents'));
        },
        error => {
          clearTimeout(timeout);
          unsubscribe();
          try {
            expect(error).toBeInstanceOf(NotFoundError);
            resolve();
          } catch (assertionError) {
            reject(assertionError);
          }
        },
      );
    });
  });
});
