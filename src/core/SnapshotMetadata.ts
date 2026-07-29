/**
 * Snapshot provenance metadata — the Firestore-owned facts about a document that are not part of
 * the document's own data: where it lives, when it was created/updated, and when it was read.
 *
 * Delivered as a **sibling** of the document ({@link WithMetadata}), never overlaid onto it. An
 * overlay would shadow a stored field of the same name and make it unreachable — the same collision
 * ADR-0018 avoids for `id` and ADR-0026 avoids for `updateTime`.
 *
 * `ref` is a live `DocumentReference`, so a `DocumentMetadata` is **not** JSON-serializable. The
 * document it accompanies still is: that is the point of keeping the two apart. Prefer `path` when
 * you only need identity, and rebuild a reference with `db.doc(path)` when you need one.
 */
export type DocumentMetadata = {
  /** Live reference to the document. Not JSON-serializable — prefer {@link DocumentMetadata.path}. */
  readonly ref: FirebaseFirestore.DocumentReference;
  /** Full document path, e.g. `users/u1/posts/p1`. */
  readonly path: string;
  /** Path of the collection containing the document, e.g. `users/u1/posts`. */
  readonly parentPath: string;
  /** Server time the document was created. Stable across later updates. */
  readonly createTime: FirebaseFirestore.Timestamp;
  /** Server time the document was last written, as of this snapshot. */
  readonly updateTime: FirebaseFirestore.Timestamp;
  /** Server time this snapshot was read. Uniform across one query page. */
  readonly readTime: FirebaseFirestore.Timestamp;
};

/**
 * A read result paired with its {@link DocumentMetadata}, returned by any read called with
 * `{ withMetadata: true }`.
 *
 * The document is under `doc`, unchanged from what the same read returns without the flag — so
 * `doc` keeps every property (including the repository-owned `id`) and stays JSON-serializable.
 *
 * @template D - the document shape the underlying read produces
 */
export type WithMetadata<D> = {
  readonly doc: D;
  readonly metadata: DocumentMetadata;
};

/**
 * One entry from a detailed listener's change set — the Admin SDK's `DocumentChange`, mapped
 * through the ORM's result shape.
 *
 * `oldIndex` is `-1` for `'added'`; `newIndex` is `-1` for `'removed'`.
 *
 * ⚠️ For a `'removed'` change, `doc` and `metadata` describe the document **as it last was** — the
 * underlying snapshot still reports `exists: true` and carries its final `createTime`/`updateTime`.
 * Branch on `type`, never on the document. `metadata.readTime` is the emission's read time, not a
 * deletion time; Firestore does not report one.
 *
 * @template R - the builder's result shape
 */
export type DetailedDocumentChange<R> = {
  readonly type: FirebaseFirestore.DocumentChangeType;
  readonly doc: R;
  readonly metadata: DocumentMetadata;
  readonly oldIndex: number;
  readonly newIndex: number;
};

/**
 * The payload delivered to a detailed query listener: the full mapped result set **plus** the
 * incremental change set for this emission.
 *
 * The first emission reports every matching document as an `'added'` change with `oldIndex: -1`.
 *
 * @template R - the builder's result shape
 */
export type DetailedQuerySnapshot<R> = {
  /** Every document currently matching the query, in query order. */
  readonly docs: readonly R[];
  /** What changed since the previous emission. */
  readonly changes: readonly DetailedDocumentChange<R>[];
  readonly size: number;
  readonly empty: boolean;
  /** Server time this emission was read. */
  readonly readTime: FirebaseFirestore.Timestamp;
};

/**
 * Build a {@link DocumentMetadata} from a snapshot.
 *
 * **Only call this for a snapshot that exists.** `createTime` / `updateTime` are optional in the
 * Admin SDK typings solely because they are absent for a NON-EXISTENT document (verified: plan #39
 * probe P1, rows P1b/P1d); every other read path — including field-masked reads, `select()`
 * projections and converter-applied snapshots — populates them. The non-null assertions are
 * therefore sound behind an existence guard, and unsound without one. This mirrors the identical
 * reasoning at `FirestoreRepository.getByIdWithUpdateTime`.
 *
 * Package-internal: not re-exported from the package entry.
 */
export function buildDocumentMetadata(
  snapshot: FirebaseFirestore.DocumentSnapshot,
): DocumentMetadata {
  return {
    ref: snapshot.ref,
    path: snapshot.ref.path,
    parentPath: snapshot.ref.parent.path,
    createTime: snapshot.createTime!,
    updateTime: snapshot.updateTime!,
    readTime: snapshot.readTime,
  };
}
