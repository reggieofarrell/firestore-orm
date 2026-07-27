import type { ID } from './FirestoreRepository.js';

/**
 * A repository **read result**: the application/read data plus the authoritative, read-only document
 * `id`.
 *
 * `id` is repository-owned metadata sourced from the Firestore document name (`snapshot.id`) on every
 * read — never from the document's own fields. Schemas therefore describe the document's own data
 * (read/write/stored models) and must not declare a top-level `id` (see
 * {@link FirestoreRepository.withSchema}). The distributive `Omit` defends the invariant even for a
 * directly-typed (unvalidated) repository whose `ReadData` happens to carry an `id`: the authoritative
 * id always wins, and branch-specific keys survive on union read models (ADR-0028).
 *
 * The result is intentionally **flat** (`doc.id`, `doc.name`) rather than a `{ data, ref }` wrapper,
 * preserving the library's ergonomics.
 *
 * @template ReadData - the read (application) data shape (without `id`)
 */
export type FirestoreDocument<ReadData extends object> = ReadData extends unknown
  ? Omit<ReadData, 'id'> & { readonly id: ID }
  : never;

/**
 * The concrete object shape internal read paths build before narrowing to {@link FirestoreDocument}.
 *
 * Unlike {@link FirestoreDocument}, this is a plain intersection — not a deferred conditional — so
 * `{ ...(data as T), id: snapshot.id }` is assignable when `T` is still an unresolved generic. Every
 * concrete instantiation of {@link FirestoreDocument} matches this shape at runtime; the public type
 * is distributive so union read models narrow correctly in consumer code.
 */
export type ConstructedDocument<ReadData extends object> = Omit<ReadData, 'id'> & {
  readonly id: ID;
};

/**
 * Single documented cast from the constructed read shape to the public {@link FirestoreDocument}
 * type.
 *
 * {@link FirestoreDocument} is a deferred conditional (`ReadData extends unknown ? … : never`) for
 * unresolved generic `ReadData`, so the constructed `{ …data, id }` object is not directly assignable
 * even though every concrete instantiation is. Repository and query-builder read paths build
 * {@link ConstructedDocument} and call this helper once rather than scattering ad-hoc assertions.
 */
export const asFirestoreDocument = <ReadData extends object>(
  built: ConstructedDocument<ReadData>,
): FirestoreDocument<ReadData> => built as FirestoreDocument<ReadData>;

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
 * branch-specific field survives instead of collapsing to the members' common keys. The same
 * distributivity now applies to {@link FirestoreDocument} (ADR-0028).
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
