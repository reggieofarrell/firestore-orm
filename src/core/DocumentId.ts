import type { ID } from './FirestoreRepository.js';

/**
 * A repository **read result**: the application/read data plus the authoritative, read-only document
 * `id`.
 *
 * `id` is repository-owned metadata sourced from the Firestore document name (`snapshot.id`) on every
 * read — never from the document's own fields. Schemas therefore describe the document's own data
 * (read/write/stored models) and must not declare a top-level `id` (see
 * {@link FirestoreRepository.withSchema}). `Omit<ReadData, 'id'>` defends the invariant even for a
 * directly-typed (unvalidated) repository whose `ReadData` happens to carry an `id`: the
 * authoritative id always wins.
 *
 * The result is intentionally **flat** (`doc.id`, `doc.name`) rather than a `{ data, ref }` wrapper,
 * preserving the library's ergonomics.
 *
 * @template ReadData - the read (application) data shape (without `id`)
 */
export type FirestoreDocument<ReadData extends object> = Omit<ReadData, 'id'> & {
  readonly id: ID;
};

/**
 * A **collection-group** read result: the application/read data plus full-path identity.
 *
 * A collection-group query spans every collection with the same id at any depth, so `id` (the leaf
 * document name) is **not unique** across the result set — two documents at `users/u1/posts/p1` and
 * `users/u2/posts/p1` both report `id: 'p1'`. The full document `path` is the stable identity, and
 * `parentPath` names the concrete collection the document actually lives in (the Admin SDK's
 * `snapshot.ref.parent.path`), which is what tells you *which* parent it belongs to.
 *
 * All three are plain strings, so a result stays JSON-serializable. To act on a document, rebuild a
 * reference from the path with the `Firestore` instance you own: `db.doc(doc.path)`.
 *
 * As with {@link FirestoreDocument} and `id`, the identity keys are overlaid **after** the document
 * data, so a stored field of the same name is shadowed. `FirestoreRepository.collectionGroup()`
 * rejects a schema-validated repository whose **read or stored** schema declares a top-level
 * `path` or `parentPath` for exactly that reason — the stored model matters too because query
 * field paths derive from it.
 *
 * Distribution: `ReadData extends unknown` makes the `Omit` distribute over a union read model, so a
 * branch-specific field survives instead of collapsing to the members' common keys. See
 * https://github.com/reggieofarrell/firestore-orm/issues/54 — {@link FirestoreDocument} has the same
 * defect and is fixed there; this type is written correctly from the start rather than adding to it.
 *
 * @template ReadData - the read (application) data shape (without `id`)
 */
export type CollectionGroupDocument<ReadData extends object> = ReadData extends unknown
  ? Omit<ReadData, 'id' | 'path' | 'parentPath'> & {
      readonly id: ID;
      /** Full document path, e.g. `users/u1/posts/p1`. Unique across the collection group. */
      readonly path: string;
      /** Path of the collection containing the document, e.g. `users/u1/posts`. */
      readonly parentPath: string;
    }
  : never;
