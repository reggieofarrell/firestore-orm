/**
 * Type-level tests for the collection-group surface (issue #31), checked by `npm run test:types` via
 * tsc (NOT jest). This file is never executed.
 *
 * The contract this pins:
 *  - Group results carry FULL-PATH identity (`path` / `parentPath`) alongside `id`, and identity
 *    SHADOWS a same-named model field rather than being merged with it.
 *  - The destructive terminals (`update` / `delete`) and the leaf-id surface (`whereId` /
 *    `orderById` / `collectionCount`) are ABSENT FROM THE TYPE of a group builder — not present and
 *    throwing. That is the entire reason the builder hierarchy was split.
 *  - `wherePath` takes a full document path or a `DocumentReference`, never a bare id typed as
 *    something else, and its `in` / scalar overloads do not cross.
 *  - Field paths stay schema-typed at every depth, including inside `whereFilter`, and `select()`
 *    narrows the result while keeping path identity.
 *
 * Each `@ts-expect-error` FAILS the type-check if the line below it stops being an error; every
 * un-annotated call must type-check.
 */
import { FieldPath } from 'firebase-admin/firestore';
import type { DocumentReference } from 'firebase-admin/firestore';
import { z } from 'zod';
import { FirestoreRepository } from '../../index.js';
import type {
  CollectionGroupDocument,
  CollectionGroupFilterFactory,
  DataOf,
  StoredDataOf,
} from '../../index.js';

declare const db: FirebaseFirestore.Firestore;
declare const someRef: DocumentReference;

const postSchema = z.object({
  title: z.string(),
  status: z.string(),
  views: z.number(),
  author: z.object({ uid: z.string(), name: z.string().optional() }),
});
const posts = FirestoreRepository.withSchema(db, 'posts', postSchema);
const postGroup = posts.collectionGroup();

// ---------------------------------------------------------------------------
// Result identity
// ---------------------------------------------------------------------------

export async function groupResultsCarryFullPathIdentity() {
  const rows = await postGroup.query().get();
  const row = rows[0];
  const id: string = row.id;
  const path: string = row.path;
  const parentPath: string = row.parentPath;
  const title: string = row.title;
  return [id, path, parentPath, title];
}

export async function groupIdentityIsReadonly() {
  const row = (await postGroup.query().get())[0];
  // @ts-expect-error identity is repository-owned and read-only
  row.id = 'x';
  // @ts-expect-error identity is repository-owned and read-only
  row.path = 'x';
  // @ts-expect-error identity is repository-owned and read-only
  row.parentPath = 'x';
}

// A model field named `path` is SHADOWED by identity (it is `Omit`ted), exactly as `id` is on a
// normal read. The result's `path` is the identity string, never the model's own type.
type ShadowModel = { path: number; parentPath: boolean; id: number; keep: string };
declare const shadowRow: CollectionGroupDocument<ShadowModel>;
export function groupIdentityShadowsSameNamedModelFields() {
  const row = shadowRow;
  const path: string = row.path;
  const parentPath: string = row.parentPath;
  const id: string = row.id;
  const keep: string = row.keep;
  // @ts-expect-error the model's `path: number` is shadowed by the identity string
  const asNumber: number = row.path;
  return [path, parentPath, id, keep, asNumber];
}

// The `Omit` distributes over a union read model, so a branch-only field survives (issue #54 fixes
// the same defect on `FirestoreDocument`; this type is written correctly from the start).
type UnionModel = { kind: 'a'; onlyOnA: string } | { kind: 'b'; onlyOnB: number };
declare const unionRow: CollectionGroupDocument<UnionModel>;
export function groupDocumentOmitDistributesOverUnions() {
  const row = unionRow;
  if (row.kind === 'a') {
    const a: string = row.onlyOnA;
    return a;
  }
  const b: number = row.onlyOnB;
  return b;
}

// Composes with the repository extractors — the documented way to name a group row.
export type NamedGroupRow = CollectionGroupDocument<DataOf<typeof posts>>;
export function namedGroupRowHasIdentity(row: NamedGroupRow) {
  const p: string = row.path;
  const t: string = row.title;
  return [p, t];
}

// ---------------------------------------------------------------------------
// Absent surfaces — the reason the builder hierarchy is split
// ---------------------------------------------------------------------------

export function groupBuilderHasNoWriteTerminals() {
  // @ts-expect-error update() is not part of a collection-group builder (bulk hooks are id-keyed)
  postGroup.query().update({ status: 'x' });
  // @ts-expect-error delete() is not part of a collection-group builder (bulk hooks are id-keyed)
  postGroup.query().delete();
}

export function groupBuilderHasNoLeafIdSurface() {
  // @ts-expect-error a bare leaf id is meaningless across a group — use wherePath()
  postGroup.query().whereId('==', 'p1');
  // @ts-expect-error document-name ordering on a group is by full path — use orderByPath()
  postGroup.query().orderById();
  // @ts-expect-error a group is not a collection — use groupCount()
  postGroup.query().collectionCount();
}

// …and the collection builder keeps them, plus does NOT gain the group-only surface.
export function collectionBuilderIsUnchanged() {
  posts.query().whereId('==', 'p1');
  posts.query().orderById('desc');
  posts.query().collectionCount();
  posts.query().delete();
  // @ts-expect-error wherePath() is collection-group-only
  posts.query().wherePath('==', 'posts/p1');
  // @ts-expect-error orderByPath() is collection-group-only
  posts.query().orderByPath();
  // @ts-expect-error groupCount() is collection-group-only
  posts.query().groupCount();
}

// ---------------------------------------------------------------------------
// wherePath / orderByPath operand typing
// ---------------------------------------------------------------------------

export function wherePathOperandTyping() {
  postGroup.query().wherePath('==', 'users/u1/posts/p1');
  postGroup.query().wherePath('>', someRef);
  postGroup.query().wherePath('in', ['users/u1/posts/p1', 'users/u2/posts/p2']);
  postGroup.query().wherePath('not-in', [someRef]);
  postGroup.query().wherePath('in', ['users/u1/posts/p1', someRef]); // mixed operands
  postGroup.query().orderByPath();
  postGroup.query().orderByPath('desc');
}

export function wherePathOperandNegatives() {
  // @ts-expect-error scalar operators take a single path/reference, not an array
  postGroup.query().wherePath('==', ['users/u1/posts/p1']);
  // @ts-expect-error `in` takes an array, not a single path
  postGroup.query().wherePath('in', 'users/u1/posts/p1');
  // @ts-expect-error array-contains is not a document-name operator
  postGroup.query().wherePath('array-contains', 'users/u1/posts/p1');
  // @ts-expect-error a number is not a document path
  postGroup.query().wherePath('==', 42);
  // @ts-expect-error direction must be 'asc' | 'desc'
  postGroup.query().orderByPath('up');
}

// ---------------------------------------------------------------------------
// Field-path typing on the shared read surface
// ---------------------------------------------------------------------------

export function groupFieldPathPositives() {
  postGroup.query().where('status', '==', 'published');
  postGroup.query().where('author.uid', '==', 'u1'); // nested path
  postGroup.query().where(new FieldPath('author', 'uid'), '==', 'u1');
  postGroup.query().orderBy('author.name', 'desc');
  postGroup.query().select('title', 'author.uid');
  postGroup.query().sum('views');
  postGroup.query().average('views');
  postGroup.query().distinctValues('status');
}

export function groupFieldPathNegatives() {
  // @ts-expect-error typo in a nested path
  postGroup.query().where('author.uidd', '==', 'u1');
  // @ts-expect-error not a field of the schema
  postGroup.query().orderBy('nope');
  // @ts-expect-error `title` is not numeric
  postGroup.query().sum('title');
  // @ts-expect-error the synthetic id is not a stored field path
  postGroup.query().where('id', '==', 'p1');
}

// ---------------------------------------------------------------------------
// whereFilter: the group factory exposes wherePath, never whereId
// ---------------------------------------------------------------------------

export function groupCompositeFilterPositives() {
  postGroup
    .query()
    .whereFilter(f => f.or(f.where('status', '==', 'published'), f.where('views', '>', 100)));
  postGroup
    .query()
    .whereFilter(f =>
      f.and(f.where('author.uid', '==', 'u1'), f.wherePath('==', 'users/u1/posts/p1')),
    );
  postGroup.query().whereFilter(f => f.wherePath('in', [someRef]));
}

export function groupCompositeFilterNegatives() {
  // @ts-expect-error the group factory has no whereId — a bare id is meaningless across a group
  postGroup.query().whereFilter(f => f.whereId('==', 'p1'));
  // @ts-expect-error typo inside a nested group is still a compile error
  postGroup.query().whereFilter(f => f.or(f.where('statuss', '==', 'x')));
  // @ts-expect-error the collection factory has no wherePath
  posts.query().whereFilter(f => f.wherePath('==', 'posts/p1'));
}

// A reusable group predicate names its shape with `StoredDataOf<typeof repo>`, mirroring the
// collection factory. Invariance (`in out`) means the annotated shape must match exactly.
const publishedOrPinned = () => (f: CollectionGroupFilterFactory<StoredDataOf<typeof posts>>) =>
  f.or(f.where('status', '==', 'published'), f.where('views', '>', 1000));
export function groupFactoryPredicateIsReusable() {
  return postGroup.query().whereFilter(publishedOrPinned());
}

const otherSchema = z.object({ unrelated: z.string() });
const _otherRepo = FirestoreRepository.withSchema(db, 'other', otherSchema);
export function groupFactoryVarianceIsEnforced() {
  const foreign = (f: CollectionGroupFilterFactory<StoredDataOf<typeof _otherRepo>>) =>
    f.where('unrelated', '==', 'x');
  // @ts-expect-error a predicate typed for an unrelated repository must not be accepted
  postGroup.query().whereFilter(foreign);
}

// ---------------------------------------------------------------------------
// select() narrows the model but keeps path identity
// ---------------------------------------------------------------------------

export async function groupSelectNarrowsResultAndKeepsIdentity() {
  const rows = await postGroup.query().select('title', 'author.uid').get();
  const row = rows[0];
  // Identity is not projected away — it comes from the snapshot reference.
  const path: string = row.path;
  const parentPath: string = row.parentPath;
  const id: string = row.id;
  // Every data property is optional after a projection, at every depth.
  const title: string | undefined = row.title;
  const uid: string | undefined = row.author?.uid;
  // @ts-expect-error a projected-away field is not required-accessible
  const views: number = row.views;
  return [path, parentPath, id, title, uid, views];
}

export function groupSelectReturnsAGroupBuilder() {
  // The projected builder is still a group builder: no write terminals, group-only surface intact.
  postGroup.query().select('title').wherePath('==', 'users/u1/posts/p1');
  // @ts-expect-error still no update() after a projection
  postGroup.query().select('title').update({ status: 'x' });
}

// ---------------------------------------------------------------------------
// The handle itself
// ---------------------------------------------------------------------------

declare const snap: FirebaseFirestore.DocumentSnapshot;
export function collectionGroupHandleSurface() {
  const id: string = postGroup.collectionId;
  const doc = postGroup.fromSnapshot(snap);
  const path: string | undefined = doc?.path;
  // @ts-expect-error the handle is read-only — there is no create surface on a collection group
  postGroup.create({ title: 'x' });
  return [id, path];
}
