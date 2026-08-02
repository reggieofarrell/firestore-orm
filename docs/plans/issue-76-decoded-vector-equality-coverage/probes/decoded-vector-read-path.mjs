/**
 * Investigation probe for issue #76.
 *
 * Runs against the Firestore emulator after `npm run build`. It reports whether vectors decoded
 * from stored documents share the constructor produced by `FieldValue.vector()`, whether the SDK's
 * public `isEqual()` agrees for equal/unequal values, and whether the ORM canonicalizer currently
 * produces the documented two-value distinct set.
 *
 * This is an observational probe, not the regression test. The implementation must promote the
 * public `query().distinctValues('embedding')` behavior to the integration suite.
 */
import { strict as assert } from 'node:assert';
import { getApps, initializeApp, deleteApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { FirestoreRepository } from '../../../../dist/index.js';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';

const projectId = 'demo-firestoreorm-test';
const app = getApps()[0] ?? initializeApp({ projectId });
const db = getFirestore(app);
const collectionName = `issue_76_probe_${Date.now()}`;
const collection = db.collection(collectionName);
const repo = new FirestoreRepository(db, collectionName);
const writeProbe = FieldValue.vector([0]);
const names = ['a-equal', 'b-equal', 'c-different'];

try {
  await Promise.all([
    collection.doc(names[0]).set({ name: names[0], embedding: FieldValue.vector([1, 2, 3]) }),
    collection.doc(names[1]).set({ name: names[1], embedding: FieldValue.vector([1, 2, 3]) }),
    collection
      .doc(names[2])
      .set({ name: names[2], embedding: FieldValue.vector([1, 2, 4]) }),
  ]);

  const snapshot = await collection.orderBy('__name__').get();
  const decoded = snapshot.docs.map(doc => doc.get('embedding'));
  assert.equal(decoded.length, 3, 'probe setup must read all three stored vectors');

  const distinct = await repo
    .query()
    .where('name', 'in', names)
    .orderBy('name', 'asc')
    .distinctValues('embedding');
  const report = {
    writeConstructor: writeProbe.constructor.name,
    decodedConstructors: decoded.map(value => value?.constructor?.name ?? null),
    decodedInstanceofWriteConstructor: decoded.map(value => value instanceof writeProbe.constructor),
    equalPairIsEqual: decoded[0].isEqual(decoded[1]),
    unequalPairIsEqual: decoded[0].isEqual(decoded[2]),
    decodedComponents: decoded.map(value => value.toArray()),
    distinctCount: distinct.length,
    distinctComponents: distinct.map(value => value.toArray()),
  };

  console.log(JSON.stringify(report, null, 2));
} finally {
  const snapshot = await collection.get();
  const batch = db.batch();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));
  if (snapshot.size > 0) {
    await batch.commit();
  }
  await deleteApp(app);
}
