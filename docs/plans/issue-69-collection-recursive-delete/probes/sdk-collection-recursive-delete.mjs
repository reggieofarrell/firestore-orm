/**
 * Issue #69 investigation probe: ask the installed Admin SDK and Firestore emulator how
 * Firestore.recursiveDelete(CollectionReference) scopes deletion and reports its result.
 *
 * Run from the repository root:
 *   npx firebase emulators:exec --project demo-firestoreorm-test --only firestore \
 *     "node docs/plans/issue-69-collection-recursive-delete/probes/sdk-collection-recursive-delete.mjs"
 */
import assert from 'node:assert/strict';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const app = initializeApp({ projectId: 'demo-firestoreorm-test' }, `issue69_probe_${suffix}`);
const db = getFirestore(app);

const target = db.collection(`issue69_target_${suffix}`);
const prefixSibling = db.collection(`issue69_target_${suffix}_prefix`);
const parent = db.collection(`issue69_parent_${suffix}`).doc('parent');
const nestedTarget = parent.collection('children');
const nestedPrefixSibling = parent.collection('children_prefix');

async function seedCollection(collection) {
  await collection.doc('a').set({ value: 'a' });
  await collection.doc('b').set({ value: 'b' });
  await collection.doc('a').collection('grandchildren').doc('g1').set({ value: 'g1' });
}

async function collectionState(collection) {
  const direct = await collection.get();
  const grandchild = await collection.doc('a').collection('grandchildren').doc('g1').get();
  return { direct: direct.size, grandchildExists: grandchild.exists };
}

try {
  await seedCollection(target);
  await seedCollection(prefixSibling);
  await parent.set({ survives: true });
  await seedCollection(nestedTarget);
  await seedCollection(nestedPrefixSibling);

  const topLevelResult = await db.recursiveDelete(target);
  const nestedResult = await db.recursiveDelete(nestedTarget);
  const emptyResult = await db.recursiveDelete(target);

  const observed = {
    topLevelResult,
    nestedResult,
    emptyResult,
    target: await collectionState(target),
    prefixSibling: await collectionState(prefixSibling),
    nestedTarget: await collectionState(nestedTarget),
    nestedPrefixSibling: await collectionState(nestedPrefixSibling),
    parentExists: (await parent.get()).exists,
  };

  assert.deepEqual(observed.target, { direct: 0, grandchildExists: false });
  assert.deepEqual(observed.nestedTarget, { direct: 0, grandchildExists: false });
  assert.deepEqual(observed.prefixSibling, { direct: 2, grandchildExists: true });
  assert.deepEqual(observed.nestedPrefixSibling, { direct: 2, grandchildExists: true });
  assert.equal(observed.parentExists, true);
  assert.equal(topLevelResult, undefined);
  assert.equal(nestedResult, undefined);
  assert.equal(emptyResult, undefined);

  console.log(JSON.stringify(observed, null, 2));
} finally {
  await Promise.allSettled([
    db.recursiveDelete(target),
    db.recursiveDelete(prefixSibling),
    db.recursiveDelete(parent),
  ]);
  await deleteApp(app);
}
