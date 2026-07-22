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
