/**
 * Probe: observable baseline outcomes when before/after hooks throw and when the second fixed-batch
 * chunk fails.
 *
 * This asks what the current implementation does; it is not a future-contract assertion.
 *
 * Run from the repository root after `npm run build`:
 *   firebase emulators:exec --project demo-firestoreorm-test --only firestore \
 *     "node docs/plans/issue-46-hook-delivery-error-model/probes/N-hook-write-outcomes.mjs"
 */
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { FirestoreRepository } from '../../../../dist/index.js';

const app = initializeApp({ projectId: 'demo-firestoreorm-test' }, `issue-46-outcomes-${Date.now()}`);
const db = getFirestore(app);
const prefix = `issue_46_outcomes_${Date.now()}`;

async function count(path) {
  return (await db.collection(path).count().get()).data().count;
}

async function deleteCollection(path) {
  const snapshot = await db.collection(path).get();
  for (let offset = 0; offset < snapshot.size; offset += 500) {
    const batch = db.batch();
    snapshot.docs.slice(offset, offset + 500).forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }
}

const beforePath = `${prefix}_before`;
const beforeRepo = new FirestoreRepository(db, beforePath);
const beforeMarker = new Error('before marker');
beforeRepo.on('beforeCreate', () => {
  throw beforeMarker;
});
let beforeCaught;
try {
  await beforeRepo.create({ value: 1 });
} catch (error) {
  beforeCaught = error;
}

const afterPath = `${prefix}_after`;
const afterRepo = new FirestoreRepository(db, afterPath);
const afterMarker = new Error('after marker');
let secondAfterHookCalls = 0;
afterRepo.on('afterCreate', () => {
  throw afterMarker;
});
afterRepo.on('afterCreate', () => {
  secondAfterHookCalls += 1;
});
let afterCaught;
try {
  await afterRepo.create({ value: 1 });
} catch (error) {
  afterCaught = error;
}

const readbackPath = `${prefix}_readback`;
const readbackMarker = new Error('readback marker');
const readbackRepo = new FirestoreRepository(
  db,
  readbackPath,
  undefined,
  undefined,
  () => {
    throw readbackMarker;
  },
);
let readbackCaught;
try {
  await readbackRepo.create({ value: 1 }, { returnDoc: true });
} catch (error) {
  readbackCaught = error;
}

const partialPath = `${prefix}_partial`;
const partialRepo = new FirestoreRepository(db, partialPath);
const entries = Array.from({ length: 501 }, (_, index) => ({
  id: `row-${String(index).padStart(3, '0')}`,
  data: { value: index },
}));
await db.collection(partialPath).doc(entries[500].id).create({ value: -1 });
let afterBulkCreateCalls = 0;
partialRepo.on('afterBulkCreate', () => {
  afterBulkCreateCalls += 1;
});
let partialCaught;
try {
  await partialRepo.bulkCreateWithIds(entries);
} catch (error) {
  partialCaught = error;
}

const output = {
  before_hook: {
    same_error_identity: beforeCaught === beforeMarker,
    error_name: beforeCaught?.name,
    message: beforeCaught?.message,
    stored_documents: await count(beforePath),
  },
  after_hook: {
    same_error_identity: afterCaught === afterMarker,
    error_name: afterCaught?.name,
    message: afterCaught?.message,
    stored_documents: await count(afterPath),
    later_hook_calls: secondAfterHookCalls,
  },
  readback_after_commit: {
    same_error_identity: readbackCaught === readbackMarker,
    error_name: readbackCaught?.name,
    message: readbackCaught?.message,
    stored_documents: await count(readbackPath),
  },
  later_chunk_failure: {
    error_name: partialCaught?.name,
    message: partialCaught?.message,
    stored_documents_including_seeded_collision: await count(partialPath),
    newly_committed_documents: (await count(partialPath)) - 1,
    after_bulk_create_calls: afterBulkCreateCalls,
  },
};

console.log(JSON.stringify(output, null, 2));

await Promise.all([
  deleteCollection(beforePath),
  deleteCollection(afterPath),
  deleteCollection(readbackPath),
  deleteCollection(partialPath),
]);
await deleteApp(app);
