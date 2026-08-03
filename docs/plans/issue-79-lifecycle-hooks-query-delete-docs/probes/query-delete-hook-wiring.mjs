/**
 * Investigation probe for issue #79.
 *
 * Asks what `FirestoreQueryBuilder.delete()` actually does with lifecycle hooks against
 * the Firestore emulator: bulk hooks must fire; per-document delete hooks must not.
 *
 * Observational only. Existing integration coverage already pins parts of this contract
 * (`repository-hook-immutability`, `repository-write-outcomes`); this probe consolidates
 * both sides of the distinction the docs must state.
 */
import { strict as assert } from 'node:assert';
import { getApps, initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { FirestoreRepository } from '../../../../dist/index.js';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';

const projectId = 'demo-firestoreorm-test';
const app = getApps()[0] ?? initializeApp({ projectId });
const db = getFirestore(app);
const collectionName = `issue_79_probe_${Date.now()}`;

/** Schema-less repository matches the shared integration harness construction path. */
const repo = new FirestoreRepository(db, collectionName);
const fired = {
  beforeDelete: 0,
  afterDelete: 0,
  beforeBulkDelete: 0,
  afterBulkDelete: 0,
};

repo.on('beforeDelete', () => {
  fired.beforeDelete += 1;
});
repo.on('afterDelete', () => {
  fired.afterDelete += 1;
});
repo.on('beforeBulkDelete', () => {
  fired.beforeBulkDelete += 1;
});
repo.on('afterBulkDelete', () => {
  fired.afterBulkDelete += 1;
});

try {
  const a = await repo.create({ name: 'a', active: true });
  const b = await repo.create({ name: 'b', active: true });

  const deletedCount = await repo.query().where('active', '==', true).delete();
  assert.equal(deletedCount, 2, 'probe setup must delete both seeded docs');

  const report = {
    deletedCount,
    fired,
    bulkHooksFired: fired.beforeBulkDelete === 1 && fired.afterBulkDelete === 1,
    perDocumentHooksSkipped: fired.beforeDelete === 0 && fired.afterDelete === 0,
  };

  console.log(JSON.stringify(report, null, 2));

  assert.equal(report.bulkHooksFired, true, 'beforeBulkDelete/afterBulkDelete must fire');
  assert.equal(
    report.perDocumentHooksSkipped,
    true,
    'beforeDelete/afterDelete must not fire on query().delete()',
  );
} finally {
  const snapshot = await db.collection(collectionName).get();
  const batch = db.batch();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));
  if (snapshot.size > 0) {
    await batch.commit();
  }
  await deleteApp(app);
}
