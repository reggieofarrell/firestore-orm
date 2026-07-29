/**
 * P1 — Which snapshot metadata fields are actually populated on each read path the ORM uses?
 *
 * ASKS (investigation probe, not an assertion): the ORM's read paths produce four different
 * snapshot provenances — `DocumentReference.get()` (getById), `db.getAll()` (getMany/bulkDelete),
 * `Query.get()` (query terminals), and `Query.stream()` (stream()). The typings say
 * `DocumentSnapshot.createTime`/`updateTime` are optional and `readTime` is required, but typings
 * describe the union of all providers, not what the emulator returns per path.
 *
 * Run: firebase emulators:exec --project demo-firestoreorm-test --only firestore \
 *        "node docs/plans/issue-39-snapshot-metadata-detailed-listener/probes/p1-snapshot-metadata.mjs"
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';

const app = initializeApp({ projectId: 'demo-firestoreorm-test' });
const db = getFirestore(app);
const col = db.collection(`p1-${Date.now()}`);

const describe = (label, snap) => {
  console.log(
    `${label.padEnd(34)} ctor=${snap.constructor.name.padEnd(22)} exists=${String(snap.exists).padEnd(5)} ` +
      `createTime=${snap.createTime ? 'Y' : 'N'} updateTime=${snap.updateTime ? 'Y' : 'N'} ` +
      `readTime=${snap.readTime ? 'Y' : 'N'} ref=${snap.ref ? 'Y' : 'N'} path=${snap.ref?.path ?? '-'}`,
  );
};

const aRef = col.doc('a');
await aRef.set({ name: 'a', n: 1 });
await col.doc('b').set({ name: 'b', n: 2 });

console.log('--- read paths ---');
describe('DocumentReference.get() [exists]', await aRef.get());
describe('DocumentReference.get() [missing]', await col.doc('ghost').get());

const [gotA, gotGhost] = await db.getAll(aRef, col.doc('ghost'));
describe('db.getAll() [exists]', gotA);
describe('db.getAll() [missing]', gotGhost);

const qsnap = await col.orderBy('n').get();
describe('Query.get() docs[0]', qsnap.docs[0]);
console.log(`Query.get() snapshot.readTime      = ${qsnap.readTime ? 'Y' : 'N'}`);

for await (const doc of col.orderBy('n').stream()) {
  describe('Query.stream() first doc', doc);
  break;
}

// Field-mask projection (getMany's fieldMask branch) — does masking strip metadata?
const [masked] = await db.getAll(aRef, { fieldMask: ['name'] });
describe('db.getAll({fieldMask}) [exists]', masked);

// select() projection on a query (QueryBuilder.select)
const selSnap = await col.select('name').get();
describe('Query.select().get() docs[0]', selSnap.docs[0]);

// withConverter — does a converter-applied snapshot keep metadata?
const conv = col.withConverter({
  toFirestore: d => d,
  fromFirestore: s => ({ ...s.data(), converted: true }),
});
describe('withConverter().get() docs[0]', (await conv.orderBy('n').get()).docs[0]);

// Transaction read (out of scope for #39 but recorded as a bound)
await db.runTransaction(async tx => {
  describe('tx.get(ref)', await tx.get(aRef));
  const [txGot] = await tx.getAll(aRef);
  describe('tx.getAll(ref)', txGot);
});

// Are createTime/updateTime equal on a never-updated doc, and does updateTime move on update?
const before = await aRef.get();
await aRef.update({ n: 99 });
const after = await aRef.get();
console.log('--- create/update time movement ---');
console.log(`createTime stable across update: ${before.createTime.isEqual(after.createTime)}`);
console.log(`updateTime advanced on update:   ${after.updateTime.toMillis() > before.updateTime.toMillis()}`);
console.log(`readTime differs between reads:  ${!before.readTime.isEqual(after.readTime)}`);

// Is a Query.get() snapshot's per-doc readTime the same object/value as the QuerySnapshot readTime?
const q2 = await col.orderBy('n').get();
console.log(
  `per-doc readTime === snapshot readTime: ${q2.docs.every(d => d.readTime.isEqual(q2.readTime))}`,
);

process.exit(0);
