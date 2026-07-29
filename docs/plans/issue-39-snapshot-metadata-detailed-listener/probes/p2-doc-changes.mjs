/**
 * P2 — What does `QuerySnapshot.docChanges()` actually deliver on the emulator, and what metadata
 * survives on a 'removed' change?
 *
 * ASKS: the detailed listener must map `change.doc` through the ORM's `toResult`. For a 'removed'
 * change that is only sound if `change.doc.data()` still returns the last-known data and the
 * snapshot still carries `createTime`/`updateTime`. The typings promise a `QueryDocumentSnapshot`
 * but say nothing about a removed document's provenance. Also records index semantics and whether
 * `readTime` advances per emission.
 *
 * Run: firebase emulators:exec --project demo-firestoreorm-test --only firestore \
 *        "node docs/plans/issue-39-snapshot-metadata-detailed-listener/probes/p2-doc-changes.mjs"
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';

const app = initializeApp({ projectId: 'demo-firestoreorm-test' });
const db = getFirestore(app);
const col = db.collection(`p2-${Date.now()}`);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const emissions = [];

await col.doc('a').set({ name: 'a', n: 1 });
await col.doc('b').set({ name: 'b', n: 2 });

const unsub = col.orderBy('n').onSnapshot(snap => {
  emissions.push({
    size: snap.size,
    empty: snap.empty,
    readTime: snap.readTime ? snap.readTime.toMillis() : null,
    changes: snap.docChanges().map(c => ({
      type: c.type,
      id: c.doc.id,
      oldIndex: c.oldIndex,
      newIndex: c.newIndex,
      ctor: c.doc.constructor.name,
      exists: c.doc.exists,
      hasData: c.doc.data() !== undefined,
      dataName: c.doc.data()?.name ?? null,
      createTime: !!c.doc.createTime,
      updateTime: !!c.doc.updateTime,
      readTime: !!c.doc.readTime,
      path: c.doc.ref?.path?.split('/').slice(-1)[0] ?? null,
    })),
  });
});

await sleep(1200);
await col.doc('c').set({ name: 'c', n: 3 }); // added at tail
await sleep(600);
await col.doc('a').update({ name: 'a-modified' }); // modified in place
await sleep(600);
await col.doc('b').update({ n: 99 }); // modified + reordered (b moves to tail)
await sleep(600);
await col.doc('c').delete(); // removed
await sleep(900);
unsub();

emissions.forEach((e, i) => {
  console.log(`\n--- emission ${i} (size=${e.size} empty=${e.empty} readTime=${e.readTime}) ---`);
  e.changes.forEach(c =>
    console.log(
      `  ${c.type.padEnd(8)} id=${c.id.padEnd(3)} old=${String(c.oldIndex).padStart(2)} ` +
        `new=${String(c.newIndex).padStart(2)} ctor=${c.ctor.padEnd(21)} exists=${String(c.exists).padEnd(5)} ` +
        `hasData=${String(c.hasData).padEnd(5)} name=${String(c.dataName).padEnd(12)} ` +
        `cT=${c.createTime ? 'Y' : 'N'} uT=${c.updateTime ? 'Y' : 'N'} rT=${c.readTime ? 'Y' : 'N'} path=${c.path}`,
    ),
  );
});

const times = emissions.map(e => e.readTime);
console.log(`\nreadTime present on every emission: ${times.every(t => t !== null)}`);
console.log(`readTime strictly increasing:        ${times.every((t, i) => i === 0 || t > times[i - 1])}`);

// Does docChanges() return the same array identity on repeated calls? (memoization matters if the
// ORM maps it more than once.)
console.log('\n--- single-document listener (listenOne surface) ---');
const dRef = col.doc('d');
await dRef.set({ name: 'd' });
const docEmissions = [];
const unsub2 = dRef.onSnapshot(snap => {
  docEmissions.push({
    ctor: snap.constructor.name,
    exists: snap.exists,
    createTime: !!snap.createTime,
    updateTime: !!snap.updateTime,
    readTime: !!snap.readTime,
    path: snap.ref.path,
  });
});
await sleep(900);
await dRef.update({ name: 'd2' });
await sleep(600);
await dRef.delete();
await sleep(900);
unsub2();
docEmissions.forEach((e, i) =>
  console.log(
    `  emission ${i}: ctor=${e.ctor.padEnd(21)} exists=${String(e.exists).padEnd(5)} ` +
      `cT=${e.createTime ? 'Y' : 'N'} uT=${e.updateTime ? 'Y' : 'N'} rT=${e.readTime ? 'Y' : 'N'}`,
  ),
);

process.exit(0);
