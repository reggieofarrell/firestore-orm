import {
  CollectionReference,
  FieldPath,
  Firestore,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { DeepPartial, FieldPaths, OmitId } from '../utils/pathTypes.js';
import {
  collectDeleteSentinelPaths,
  CreateInput,
  CreateOutput,
  makeValidator,
  RepositorySchemaSet,
  SentinelPolicy,
  UpdateInput,
  Validator,
} from './Validation.js';
import { z } from 'zod';
import { ConflictError, NotFoundError, ValidationError, WriteOutcomeError } from './Errors.js';
import { buildHookContext, type HookContext, type HookEvent, type HookExecution } from './Hooks.js';
import { FirestoreQueryBuilder } from './QueryBuilder.js';
import { parseFirestoreError } from './ErrorParser.js';
import { flattenToDotNotation, hasDotNotationKeys, isDotNotation } from '../utils/dotNotation.js';
import { deepFreeze } from '../utils/safeObject.js';
import { FirestoreCollectionGroup } from './CollectionGroup.js';
import type { FirestoreDocument } from './DocumentId.js';
import { asFirestoreDocument } from './DocumentId.js';
import { buildDocumentMetadata, type WithMetadata } from './SnapshotMetadata.js';
import {
  validateCollectionPath,
  validateCollectionSegment,
  validateDocumentId,
} from '../utils/documentId.js';

export type ID = string;

/**
 * Commit metadata returned only by a **non-transactional** write called with `{ withMetadata: true }`.
 *
 * `writeTime` is the Admin SDK {@link FirebaseFirestore.WriteResult.writeTime} for that successful
 * commit — a receipt from the write RPC, **not** {@link DocumentMetadata.updateTime} (snapshot
 * provenance) and **not** a JSON-serialized server field on the document body.
 *
 * Transactional helpers never expose this type: `Transaction.set` / `update` / `delete` return the
 * transaction object, not a {@link FirebaseFirestore.WriteResult}.
 */
export type WriteMetadata = { readonly writeTime: FirebaseFirestore.Timestamp };

/**
 * A write's ordinary result paired with its commit metadata.
 *
 * For id-returning single writes and fixed batches this is `{ id, writeTime }`. Prefer this
 * intersection over inventing a universal `{ result, metadata }` wrapper so default callers keep
 * reading `.id` without unwrapping.
 */
export type WriteResultWithMetadata<R> = R & WriteMetadata;

/**
 * Options bag for direct update/patch writes. `returnDoc` and `withMetadata` are mutually
 * exclusive — typed overloads reject the combination, and runtime validation rejects it for
 * JavaScript callers before any I/O.
 */
export type UpdateOptions = {
  merge?: boolean;
  returnDoc?: boolean;
  /**
   * When `true`, the write resolves to {@link WriteResultWithMetadata} carrying the commit
   * `writeTime`. Incompatible with `returnDoc: true` (a read-back document is not a commit receipt).
   * Absent from every `*InTransaction` helper — the Admin SDK does not expose per-op write results
   * inside a transaction.
   */
  withMetadata?: boolean;
  /**
   * Optimistic-concurrency precondition. When supplied, the write is applied **only** if the
   * document's current `updateTime` is exactly this timestamp; otherwise Firestore rejects it and the
   * repository raises {@link PreconditionFailedError} with the stored document untouched.
   *
   * Read the token with {@link FirestoreRepository.getByIdWithUpdateTime}. It must be a
   * `FirebaseFirestore.Timestamp` instance — the Admin SDK rejects a `Date`/number client-side.
   *
   * Note this changes the missing-document outcome: a plain `update` on a deleted document raises
   * `NotFoundError` (gRPC 5), while a precondition-guarded one raises `PreconditionFailedError`
   * (Firestore reports the absent document as stored version 0, gRPC 9).
   */
  lastUpdateTime?: FirebaseFirestore.Timestamp;
};

/** Opt-in write-receipt options: `withMetadata: true` and never paired with `returnDoc: true`. */
type WriteMetadataOptions = { withMetadata: true; returnDoc?: false };
/** Default / explicit-false write options: no commit receipt on the result. */
type NoWriteMetadataOptions = { withMetadata?: false };

/**
 * The write verbs accepted by {@link FirestoreRepository.bulkWrite}.
 *
 * Each maps 1:1 onto a fixed-batch helper: `create` → {@link FirestoreRepository.bulkCreate} (or
 * {@link FirestoreRepository.bulkCreateWithIds} when `id` is supplied), `set` → the create branch of
 * {@link FirestoreRepository.upsert} minus its existence pre-read, `update` →
 * {@link FirestoreRepository.bulkUpdate}, `patch` → {@link FirestoreRepository.bulkPatch}, `delete` →
 * {@link FirestoreRepository.bulkDelete}.
 */
export type BulkWriteOperationKind = 'create' | 'set' | 'update' | 'patch' | 'delete';

/**
 * One entry in a {@link FirestoreRepository.bulkWrite} operation list.
 *
 * Discriminated on `op`, so each verb carries exactly the fields it supports: only `create` may omit
 * `id` (one is generated), and only the update/delete verbs accept a `lastUpdateTime` precondition.
 */
export type BulkWriteOperation<W extends object> =
  | { op: 'create'; id?: ID; data: CreateInput<W> }
  | { op: 'set'; id: ID; data: CreateInput<W> }
  | {
      op: 'update';
      id: ID;
      data: UpdateInput<W>;
      lastUpdateTime?: FirebaseFirestore.Timestamp;
    }
  | {
      op: 'patch';
      id: ID;
      data: UpdateInput<W>;
      lastUpdateTime?: FirebaseFirestore.Timestamp;
    }
  | { op: 'delete'; id: ID; lastUpdateTime?: FirebaseFirestore.Timestamp };

/**
 * Per-operation outcome from {@link FirestoreRepository.bulkWrite}, positional: `results[i]`
 * describes `operations[i]`, and `index` repeats that position so a filtered subset stays traceable.
 *
 * Discriminate on `ok`. A `BulkWriter` batch is **not** atomic, so a mixed array of successes and
 * failures is the normal outcome — never infer from one entry what happened to its siblings.
 */
export type BulkWriteResult =
  | {
      index: number;
      id: ID;
      op: BulkWriteOperationKind;
      ok: true;
      writeTime: FirebaseFirestore.Timestamp;
    }
  | {
      index: number;
      id: ID;
      op: BulkWriteOperationKind;
      ok: false;
      /**
       * Normalized library error — `ValidationError` for a schema/payload rejection,
       * `InvalidDocumentIdError` for a malformed id, and the usual
       * `NotFoundError` / `ConflictError` / `PreconditionFailedError` mapping for a backend refusal
       * (gRPC 5 / 6 / 9). Anything unclassified is preserved as-is.
       */
      error: Error;
      /**
       * How many times the SDK attempted this write before giving up. Present only for a failure the
       * backend reported (absent for a validation/id rejection, where no write was attempted).
       */
      failedAttempts?: number;
    };

/**
 * Options for {@link FirestoreRepository.bulkWrite}.
 */
export type BulkWriteOptions = {
  /**
   * Acknowledge that this path runs **no lifecycle hooks**. Required when the repository has any
   * bulk hook registered — without it `bulkWrite` throws rather than silently skipping them.
   */
  skipHooks?: boolean;
  /**
   * Forwarded verbatim to `db.bulkWriter({ throttling })`. Omit for the SDK default (ramping 500
   * ops/second); `false` disables throttling.
   */
  throttling?: FirebaseFirestore.BulkWriterOptions['throttling'];
};

/**
 * Result of a non-throwing read-boundary validation via {@link FirestoreRepository.safeValidate}.
 *
 * Mirrors Zod's `safeParse` shape, but normalizes failures to the library's {@link ValidationError}
 * (never a raw `ZodError`) so callers have one error type across write and read validation.
 */
export type SafeResult<T extends object> =
  { success: true; data: FirestoreDocument<T> } | { success: false; error: ValidationError };

/**
 * Type-level surface for read-only / PITR transaction callbacks.
 *
 * Membership rule: a member belongs here iff it is **pure** or **transaction-scoped**. Anything that
 * performs I/O outside the transaction (`getById`, `getMany`, `getAll`, `query`, every write helper)
 * is excluded — on a full {@link FirestoreRepository} those silently bypass both the transaction and
 * any `readTime` snapshot. The narrowed callback type makes that footgun unrepresentable for
 * `{ readOnly: true }` / {@link FirestoreRepository.runReadOnlyAt} callers.
 *
 * At runtime the callback still receives a full cloned repository (write helpers exist and the SDK
 * rejects them client-side); the absence is compile-time only, matching the collection-group
 * "absent from the type" pattern (ADR-0024).
 *
 * The optional second type parameter `S` is the **stored** model used to type field-mask paths on
 * {@link getManyInTransaction} (mirroring `select()` / `where()`). It defaults to `T` so existing
 * single-argument uses of this exported type keep compiling.
 *
 * @see FirestoreRepository.runInTransaction
 * @see FirestoreRepository.runReadOnlyAt
 */
export interface ReadOnlyTransactionalRepository<T extends object, S extends object = T> {
  /**
   * Batched multi-document read inside a transaction via `tx.getAll`.
   *
   * In a **read-write** transaction this takes pessimistic locks on **all** requested ids (one
   * round trip). In a **read-only** / PITR transaction it is lock-free. Results are positional:
   * `null` marks a missing document at `ids[i]`. See {@link FirestoreRepository.getMany} for the
   * full contract (order, duplicates, field mask, empty input).
   *
   * The `S = T` default keeps single-argument uses of this interface compiling; when `S !== T`,
   * `fieldMask` paths are typed against the stored model.
   */
  getManyInTransaction(
    tx: FirebaseFirestore.Transaction,
    ids: ID[],
    options: { fieldMask: (FieldPaths<OmitId<S>> | FieldPath)[] },
  ): Promise<(FirestoreDocument<DeepPartial<T>> | null)[]>;
  getManyInTransaction(
    tx: FirebaseFirestore.Transaction,
    ids: ID[],
    options?: { fieldMask?: undefined },
  ): Promise<(FirestoreDocument<T> | null)[]>;

  /**
   * Transaction-scoped document read. Takes a pessimistic lock in a read-write transaction; lock-free
   * in a read-only one. Renamed from `getForUpdateInTransaction` — locking is a property of the
   * transaction mode, not of this method.
   */
  getInTransaction(tx: FirebaseFirestore.Transaction, id: ID): Promise<FirestoreDocument<T> | null>;

  /**
   * Mapping helper — the only route from a `tx.get(query)` snapshot back into the read model.
   * Required so query-shaped PITR reads satisfy the issue #32 acceptance criterion ("ORM mapping
   * helpers work for PITR reads").
   */
  fromSnapshot(snapshot: FirebaseFirestore.DocumentSnapshot): FirestoreDocument<T> | null;

  /**
   * Pure read-boundary validator. Both overloads must be declared so a full repository satisfies
   * this interface structurally.
   */
  validate(data: FirestoreDocument<T>): FirestoreDocument<T>;
  validate(data: FirestoreDocument<T>[]): FirestoreDocument<T>[];

  /** Pure id boundary — needed to build an argument for {@link getInTransaction}. */
  id(raw: string): ID;
  /** Pure auto-id generator (no write). */
  newId(): ID;

  /**
   * Pure collection-path accessor. Required so the documented `tx.get(query)` escape hatch can
   * build a collection reference from the callback repo without hardcoding a path string or
   * reaching for an outer repository that may not be in scope.
   */
  getCollectionPath(): string;

  /** Read-side schema accessors (getters on the repo; pure). */
  readonly readSchema: z.ZodObject<any> | undefined;
  readonly schemas: RepositorySchemaSet | undefined;
}

/**
 * A read-only converter: just the `fromFirestore` half of a Firestore `FirestoreDataConverter`.
 *
 * Given a raw `QueryDocumentSnapshot`, return the read-model shape (without `id` — the repository
 * overlays the document id afterward). The repository builds the full `FirestoreDataConverter`
 * internally (pairing this with a pass-through `toFirestore`) and applies it only to read
 * references, so `toFirestore` is never invoked on any write path.
 *
 * Because it runs on every read, the converter is also the seam for normalizing documents into the
 * current schema shape across schema changes — e.g. backfilling a default for a field added in a
 * later schema version — so reads stay current-shape without a data migration. See the "Normalizing
 * across schema changes" section of the Core Concepts guide.
 */
export type ReadConverter<T> = (snapshot: QueryDocumentSnapshot) => T;

export type { HookEvent } from './Hooks.js';

// Hooks are typed by the model they actually observe at runtime (review D9): "before" create/update
// hooks by the write INPUT `W`, "after" create hooks by the parsed write OUTPUT `WO` (transforms/
// coercions/defaults applied — review A6), delete hooks by the read model `T` (a `FirestoreDocument<T>`).
// Identity is repository-owned: every `id` / `ids` / event array is `readonly` so a hook can mutate
// documented DATA fields but cannot repoint identity, membership, ordering, or accounting (review A1;
// the runtime additionally builds a stable pre-hook work list and never trusts the handed value).
// Every callback may accept an optional second {@link HookContext} argument correlated to the event.
type BeforeCreateHookFn<W> = (
  data: CreateInput<W> & { readonly id?: ID },
  context: HookContext<'beforeCreate'>,
) => Promise<void> | void;
type AfterCreateHookFn<WO extends object> = (
  data: CreateOutput<WO> & { readonly id: ID },
  context: HookContext<'afterCreate'>,
) => Promise<void> | void;
type BeforeUpdateHookFn<W> = (
  data: UpdateInput<W> & { readonly id: ID },
  context: HookContext<'beforeUpdate'>,
) => Promise<void> | void;
type AfterUpdateHookFn = (
  data: { readonly id: ID },
  context: HookContext<'afterUpdate'>,
) => Promise<void> | void;
type BeforeDeleteHookFn<T extends object> = (
  data: FirestoreDocument<T>,
  context: HookContext<'beforeDelete'>,
) => Promise<void> | void;
type AfterDeleteHookFn<T extends object> = (
  data: FirestoreDocument<T>,
  context: HookContext<'afterDelete'>,
) => Promise<void> | void;
type BeforeBulkCreateHookFn<W> = (
  data: readonly (CreateInput<W> & { readonly id: ID })[],
  context: HookContext<'beforeBulkCreate'>,
) => Promise<void> | void;
type AfterBulkCreateHookFn<WO extends object> = (
  data: readonly (CreateOutput<WO> & { readonly id: ID })[],
  context: HookContext<'afterBulkCreate'>,
) => Promise<void> | void;
type BeforeBulkUpdateHookFn<W> = (
  // `data` is readonly: a hook may mutate FIELDS of the update payload in place (`entry.data.x = …`)
  // but may NOT replace the whole `data` object — replacement is silently dropped by the write on the
  // repository bulk path, so it is rejected on both surfaces for a consistent contract (review S3).
  data: readonly { readonly id: ID; readonly data: UpdateInput<W> }[],
  context: HookContext<'beforeBulkUpdate'>,
) => Promise<void> | void;
type AfterBulkUpdateHookFn = (
  data: { readonly ids: readonly ID[] },
  context: HookContext<'afterBulkUpdate'>,
) => Promise<void> | void;
type BeforeBulkDeleteHookFn<T extends object> = (
  data: {
    readonly ids: readonly ID[];
    readonly documents: readonly FirestoreDocument<T>[];
  },
  context: HookContext<'beforeBulkDelete'>,
) => Promise<void> | void;
type AfterBulkDeleteHookFn<T extends object> = (
  data: {
    readonly ids: readonly ID[];
    readonly documents: readonly FirestoreDocument<T>[];
  },
  context: HookContext<'afterBulkDelete'>,
) => Promise<void> | void;

/** Event-to-callback map for correlated hook typing and the typed dispatcher. */
type HookFnMap<T extends object, W extends object, WO extends object> = {
  beforeCreate: BeforeCreateHookFn<W>;
  afterCreate: AfterCreateHookFn<WO>;
  beforeUpdate: BeforeUpdateHookFn<W>;
  afterUpdate: AfterUpdateHookFn;
  beforeDelete: BeforeDeleteHookFn<T>;
  afterDelete: AfterDeleteHookFn<T>;
  beforeBulkCreate: BeforeBulkCreateHookFn<W>;
  afterBulkCreate: AfterBulkCreateHookFn<WO>;
  beforeBulkUpdate: BeforeBulkUpdateHookFn<W>;
  afterBulkUpdate: AfterBulkUpdateHookFn;
  beforeBulkDelete: BeforeBulkDeleteHookFn<T>;
  afterBulkDelete: AfterBulkDeleteHookFn<T>;
};

/**
 * Payload type for hook event `E`, derived from the registered callback's first parameter.
 *
 * Exported so {@link FirestoreQueryBuilder}'s bound `RunHook` stays event-correlated with the
 * repository dispatcher (review N1). Not part of the public package barrel — deep-import only.
 */
export type HookDataFor<
  E extends HookEvent,
  T extends object,
  W extends object = T,
  WO extends object = W,
> = Parameters<HookFnMap<T, W, WO>[E]>[0];

type AnyHookFn<T extends object, W extends object, WO extends object> = HookFnMap<
  T,
  W,
  WO
>[HookEvent];

/**
 * Type-safe Firestore repository with validation and lifecycle hooks.
 * Provides a clean API for common database operations with built-in error handling.
 *
 * Four data models are distinguished (see ADR-0018):
 * @template T - **read data** — the application/read shape (after any `readConverter`). `id` is NOT a
 *   member; reads return {@link FirestoreDocument}`<T>` with the authoritative document id overlaid.
 * @template W - **write input** — what create/update accept (from `z.input<writeSchema>`). Defaults to `T`.
 * @template S - **stored data** — the at-rest Firestore shape; the source of query field paths.
 *   Defaults to `T`. Differs from `T` only when a `readConverter` changes the field structure.
 * @template WO - **parsed write output** — the validated write payload (from `z.output<writeSchema>`,
 *   transforms/coercions/defaults applied) that `afterCreate`/`afterBulkCreate` observe. Defaults to `W`.
 *
 * @example
 * // Basic usage without validation
 * const userRepo = new FirestoreRepository<User>(db, 'users');
 *
 * @example
 * // With Zod schema validation (read type inferred from the schema value)
 * const userRepo = FirestoreRepository.withSchema(db, 'users', userSchema);
 *
 * @example
 * // With lifecycle hooks
 * const orderRepo = new FirestoreRepository<Order>(db, 'orders');
 * orderRepo.on('afterCreate', async (order) => {
 *   await sendOrderConfirmation(order);
 * });
 */
/** True only when `A` and `B` are mutually assignable (the same type). */
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Constructor argument tuple. The `validator` (a parser) is the ONLY thing that can produce a parsed
 * write output (`WO`) that differs from the write input (`W`). So it is **required** whenever `WO`
 * diverges from `W`, and optional when they match (the default and every schema-less repository).
 * This prevents a schema-less instance from promising a parsed output no parser produces (review S1).
 */
type RepositoryConstructorArgs<T extends object, W extends object, WO extends object> =
  MutuallyAssignable<W, WO> extends true
    ? [
        db: Firestore,
        collectionPath: string,
        validator?: Validator<W, WO>,
        parentPath?: string,
        readConverter?: ReadConverter<T>,
        schemas?: RepositorySchemaSet,
        allowLegacyDatastoreIds?: boolean,
      ]
    : [
        db: Firestore,
        collectionPath: string,
        validator: Validator<W, WO>,
        parentPath?: string,
        readConverter?: ReadConverter<T>,
        schemas?: RepositorySchemaSet,
        allowLegacyDatastoreIds?: boolean,
      ];

export class FirestoreRepository<
  T extends object,
  W extends object = T,
  S extends object = T,
  WO extends object = W,
> {
  private hooks: { [K in HookEvent]?: AnyHookFn<T, W, WO>[] } = {};
  /**
   * 1-based count of how many times the enclosing `runInTransaction` wrapper has entered the Admin
   * SDK callback for this per-invocation clone, or unset on repositories outside that wrapper.
   * Diagnostic only — not an idempotency key. Public `*InTransaction` helpers on a repo without this
   * field pass `attempt: null` to before-hooks.
   */
  private transactionAttempt?: number | null;
  private db: Firestore;
  private collectionPath: string;
  private validator?: Validator<W, WO>;
  private parentPath?: string;
  private readConverter?: ReadConverter<T>;
  private schemasInternal?: RepositorySchemaSet;
  private allowLegacyDatastoreIds: boolean;

  constructor(...args: RepositoryConstructorArgs<T, W, WO>) {
    const [
      db,
      collectionPath,
      validator,
      parentPath,
      readConverter,
      schemas,
      allowLegacyDatastoreIds = false,
    ] = args as [
      Firestore,
      string,
      Validator<W, WO>?,
      string?,
      ReadConverter<T>?,
      RepositorySchemaSet?,
      boolean?,
    ];
    this.db = db;
    this.collectionPath = collectionPath;
    this.validator = validator;
    this.allowLegacyDatastoreIds = allowLegacyDatastoreIds;
    // Validate the collection path once, at construction, so an illegal base path (empty, even
    // segment count, or a segment that is not a legal Firestore path segment) fails fast rather than
    // deep inside a later read/write. See src/utils/documentId.ts.
    validateCollectionPath(collectionPath, { allowLegacyDatastoreIds });
    this.parentPath = parentPath;
    this.readConverter = readConverter;
    this.schemasInternal = schemas ?? validator?.schemas;
    // Centralize the no-top-level-`id` schema invariant across EVERY effective schema member (review
    // A8/R3). `makeValidator` derives id-free create/update schemas, but `Validator` and
    // `RepositorySchemaSet` are exported: a hand-rolled validator/schema set passed to this public
    // constructor could carry a top-level `id` in create/update even with an id-free read schema. The
    // factory checks (withSchema/subcollection) give richer messages; this is the low-level backstop.
    if (this.schemasInternal) {
      FirestoreRepository.assertSchemaHasNoTopLevelId(
        this.schemasInternal.read,
        'FirestoreRepository (read schema)',
      );
      FirestoreRepository.assertSchemaHasNoTopLevelId(
        this.schemasInternal.create,
        'FirestoreRepository (create schema)',
      );
      FirestoreRepository.assertSchemaHasNoTopLevelId(
        this.schemasInternal.update,
        'FirestoreRepository (update schema)',
      );
      if (this.schemasInternal.stored) {
        FirestoreRepository.assertSchemaHasNoTopLevelId(
          this.schemasInternal.stored,
          'FirestoreRepository (stored schema)',
        );
      }
    }
  }

  /**
   * Validates a caller-supplied document id against Firestore's id rules, honoring this repository's
   * `allowLegacyDatastoreIds` setting. Throws {@link InvalidDocumentIdError} before any I/O (review B1).
   */
  private validateId(id: ID, label = 'document id'): ID {
    return validateDocumentId(id, label, {
      allowLegacyDatastoreIds: this.allowLegacyDatastoreIds,
    });
  }

  /**
   * Rejects a schema that declares a top-level `id` field (ADR-0018). `id` is repository-owned
   * metadata sourced from the Firestore document name (`snapshot.id`) and overlaid on reads as a
   * read-only `id`; schemas describe the document's own fields (read/write/stored models), which
   * must not compete with that identity.
   *
   * This replaces the old required-`id` probe (which parsed a hard-coded literal and wrongly rejected
   * refined id schemas — UUID/regex/branded — review B6). No probe value is parsed here; native ids
   * are validated at the `repo.id`/create/read boundaries against Firestore's actual rules. Nested
   * fields named `id` (e.g. `author.id`) are unaffected — only the top level is checked.
   */
  private static assertSchemaHasNoTopLevelId(schema: z.ZodObject<any>, context: string): void {
    if (Object.prototype.hasOwnProperty.call(schema.shape, 'id')) {
      throw new Error(
        `${context}: schema must not declare a top-level "id" field. The repository sources the ` +
          'document id from the Firestore document name and returns it as a read-only "id" on every ' +
          'read — remove "id" from the schema. If your documents physically store an "id" mirror, ' +
          'see the v3 migration guide: a redundant mirror can be dropped, but a consumed mirror ' +
          '(used by rules/indexes/other writers) requires a downstream migration first.',
      );
    }
  }

  /**
   * Rejects a schema that declares a top-level `path` or `parentPath` when a **collection group**
   * query is requested (ADR-0024). A group result overlays full-path identity on top of the document
   * data, exactly as `id` is overlaid on every read, so a same-named field would be silently
   * replaced — and `CollectionGroupDocument<T>` `Omit`s it from the type, making the caller's own
   * field unreachable.
   *
   * Both the **read** and the **stored** models are checked, because they fail differently and both
   * fail silently (review H1):
   * - a read-model `path` is replaced at materialization — the caller's value never survives;
   * - a stored-model `path` is what `where('path', …)` targets (query field paths derive from `S`),
   *   so a filter can match on a value the result can never expose. With a `readConverter` there is
   *   no replacement — the converter drops the stored field — but the filter/result mismatch
   *   remains, so this rejects unconditionally.
   *
   * This mirrors the top-level-`id` invariant, which `withSchema` already enforces on the
   * `storedSchema` as well. Checked at `collectionGroup()` rather than at construction: the collision
   * only exists on the group surface, so an ordinary repository with a stored `path` field stays
   * perfectly usable. Unvalidated (raw) repositories have no schema to inspect — same limitation as
   * the `id` check, and the `Omit` in the result type is what surfaces it there.
   */
  private static assertSchemaHasNoGroupIdentityFields(
    schemas: RepositorySchemaSet | undefined,
  ): void {
    if (!schemas) return;
    const models: [label: string, schema: z.ZodObject<any> | undefined][] = [
      ['read schema', schemas.read],
      ['stored schema', schemas.stored],
    ];
    for (const [label, schema] of models) {
      if (!schema) continue;
      for (const field of ['path', 'parentPath'] as const) {
        if (Object.prototype.hasOwnProperty.call(schema.shape, field)) {
          throw new Error(
            `FirestoreRepository.collectionGroup(): the ${label} declares a top-level "${field}" ` +
              'field, which collides with collection-group identity. A collection-group result ' +
              'carries the full document "path" and its "parentPath" because document ids are not ' +
              'unique across a group, and that identity is overlaid on top of the document data — ' +
              `your "${field}" would be unreachable on the result (and, on the read model, ` +
              'silently replaced). Rename the field, or query the collection directly with query() ' +
              'instead of collectionGroup().',
          );
        }
      }
    }
  }

  /**
   * Enforces, on the **schema factories** (`withSchema`/`subcollection`), the ADR-0018 invariant that
   * a `readConverter` requires a `storedSchema` at RUNTIME, not only via the TypeScript overloads
   * (review R6). The overloads block the typed path, but a JavaScript caller of a factory — or a
   * TypeScript call crossing an `any` boundary — could otherwise construct a structurally-unsound
   * repository whose stored/query shape silently defaults to the read schema.
   *
   * This applies to the schema-inferred factories only. The unvalidated escape hatches (the raw
   * positional constructor and {@link FirestoreRepository.raw}) run no Zod validation and infer no
   * types from schemas, so there is no `storedSchema` to require — the caller owns the `StoredData`
   * generic directly and is responsible for setting it to the physical shape when a converter
   * restructures fields.
   */
  private static assertConverterHasStoredSchema(
    options: { readConverter?: unknown; storedSchema?: unknown } | undefined,
    context: string,
  ): void {
    if (options?.readConverter && !options.storedSchema) {
      throw new Error(
        `${context}: a readConverter requires a storedSchema. A converter can change the at-rest ` +
          'field structure, so the stored/query shape cannot be inferred from the read schema — pass ' +
          'options.storedSchema describing the physical document (ADR-0018).',
      );
    }
  }

  /**
   * Defines the repository-owned `id` as a non-writable, non-configurable property on a before-hook
   * payload, so a hook can still mutate documented DATA fields but cannot repoint identity or forge
   * the id a later hook (or the after-event) observes (review R2/ADR-0018 Decision 7). Returns the
   * same object. The write target is always taken from a separately-captured id/ref, never from this
   * payload — this hardens lifecycle-accounting/audit integrity on top of that.
   */
  private static withReadonlyId<O extends Record<string, any>>(obj: O, id: ID): O {
    Object.defineProperty(obj, 'id', {
      value: id,
      writable: false,
      configurable: false,
      enumerable: true,
    });
    return obj;
  }

  /**
   * Exposes repository schemas in a read-only bundle.
   * - `read`: the consumer-provided canonical schema
   * - `create`: write schema derived by omitting `id`
   * - `update`: update schema derived from the create write schema
   */
  get schemas(): RepositorySchemaSet | undefined {
    return this.schemasInternal;
  }

  /**
   * Convenience getter for the canonical read schema, when validation is enabled.
   */
  get readSchema(): z.ZodObject<any> | undefined {
    return this.schemasInternal?.read;
  }

  /**
   * Convenience getter for the create write schema, when validation is enabled.
   */
  get createSchema(): z.ZodObject<any> | undefined {
    return this.schemasInternal?.create;
  }

  /**
   * Convenience getter for the update write schema, when validation is enabled.
   */
  get updateSchema(): z.ZodObject<any> | undefined {
    return this.schemasInternal?.update;
  }

  /**
   * Create a repository instance with Zod schema validation.
   * Automatically validates all create and update operations.
   *
   * Schemas must NOT declare a top-level `id` (ADR-0018) — the repository sources the document id
   * from the Firestore document name and returns it as a read-only `id` on every read
   * ({@link FirestoreDocument}). Types are inferred from schema values:
   * - The **read type** is `z.output<readSchema>`; reads return `FirestoreDocument<readType>`.
   * - The **write input** is `z.input<writeSchema>` when a `writeSchema` overlay is supplied,
   *   otherwise it is `z.input<readSchema>`. Build the overlay from the write combinators
   *   (`zNumberWrite`/`zArrayWrite`/`zDateWrite`/`withDelete`/`zSentinel`) to accept native values
   *   and `FieldValue` sentinels on `create`/`update` with no cast.
   *
   * @param db - Firestore database instance
   * @param collection - Collection path
   * @param readSchema - Canonical read schema describing the **read model** (no top-level `id`)
   * @param options - Optional settings:
   *   - `writeSchema`: write-side overlay schema (write input = `z.input<writeSchema>`).
   *   - `storedSchema`: the at-rest/physical shape that query field paths derive from. Optional
   *     without a `readConverter` (defaults to the read schema). **Required whenever a `readConverter`
   *     is configured** — a converter can make the read model diverge from what is physically stored,
   *     and the compiler cannot tell whether it does, so the at-rest query shape must be given
   *     explicitly (enforced by the overloads and at runtime).
   *   - `readConverter`: a read-only converter — the `fromFirestore(snapshot) => T` half only (returns
   *     read data without `id`; the repository overlays the document id). For write-time
   *     normalization use a `before*` hook.
   *   - `sentinelPolicy`: defaults to `'strict'` (v3), which only accepts sentinels a field's schema
   *     explicitly permits and always returns the parsed Zod output. Set `'permissive'` to opt into
   *     the pre-v3 escape hatch that writes the raw input verbatim when parsing fails only at
   *     sentinel paths (discards sibling coercions/defaults/transforms).
   * @returns Repository instance with validation enabled
   *
   * @example
   * const userSchema = z.object({
   *   name: z.string().min(1),
   *   email: z.string().email(),
   *   age: z.number().int().positive().optional(),
   * });
   *
   * // reads return DocumentOf<typeof userRepo> = z.output<userSchema> & { id }
   * const userRepo = FirestoreRepository.withSchema(db, 'users', userSchema);
   *
   * @example
   * // Cast-free combinator writes via a write overlay
   * const eventRead = z.object({ name: z.string(), happenedAt: z.date() });
   * const eventWrite = z.object({ name: z.string(), happenedAt: zDateWrite() });
   * const events = FirestoreRepository.withSchema(db, 'events', eventRead, { writeSchema: eventWrite });
   * await events.update('id', { happenedAt: FieldValue.serverTimestamp() }); // no cast
   *
   * @example
   * // Validation errors are thrown automatically
   * try {
   *   await userRepo.create({ name: '', email: 'invalid' });
   * } catch (error) {
   *   if (error instanceof ValidationError) {
   *     console.log(error.issues); // Zod validation errors
   *   }
   * }
   */
  // Overload 1 — no `readConverter`: `storedSchema` is optional (stored shape defaults to the read
  // schema, since without a converter the at-rest shape equals the read shape).
  static withSchema<
    RS extends z.ZodObject<any>,
    WS extends z.ZodObject<any> = RS,
    SS extends z.ZodObject<any> = RS,
  >(
    db: Firestore,
    collection: string,
    readSchema: RS,
    options?: {
      writeSchema?: WS;
      storedSchema?: SS;
      sentinelPolicy?: SentinelPolicy;
      allowLegacyDatastoreIds?: boolean;
      readConverter?: undefined;
    },
  ): FirestoreRepository<z.output<RS>, z.input<WS>, z.output<SS>, z.output<WS>>;
  // Overload 2 — `readConverter` present: `storedSchema` is REQUIRED (review A3 / ADR-0018). A
  // converter can change the field structure vs the read model, so the at-rest query shape cannot be
  // inferred from the read schema and must be given explicitly.
  static withSchema<
    RS extends z.ZodObject<any>,
    SS extends z.ZodObject<any>,
    WS extends z.ZodObject<any> = RS,
  >(
    db: Firestore,
    collection: string,
    readSchema: RS,
    options: {
      readConverter: ReadConverter<z.output<RS>>;
      storedSchema: SS;
      writeSchema?: WS;
      sentinelPolicy?: SentinelPolicy;
      allowLegacyDatastoreIds?: boolean;
    },
  ): FirestoreRepository<z.output<RS>, z.input<WS>, z.output<SS>, z.output<WS>>;
  static withSchema(
    db: Firestore,
    collection: string,
    readSchema: z.ZodObject<any>,
    options?: {
      writeSchema?: z.ZodObject<any>;
      storedSchema?: z.ZodObject<any>;
      readConverter?: ReadConverter<any>;
      sentinelPolicy?: SentinelPolicy;
      allowLegacyDatastoreIds?: boolean;
    },
  ): FirestoreRepository<any, any, any, any> {
    FirestoreRepository.assertSchemaHasNoTopLevelId(readSchema, 'FirestoreRepository.withSchema');
    if (options?.writeSchema) {
      FirestoreRepository.assertSchemaHasNoTopLevelId(
        options.writeSchema,
        'FirestoreRepository.withSchema (writeSchema)',
      );
    }
    if (options?.storedSchema) {
      FirestoreRepository.assertSchemaHasNoTopLevelId(
        options.storedSchema,
        'FirestoreRepository.withSchema (storedSchema)',
      );
    }
    FirestoreRepository.assertConverterHasStoredSchema(options, 'FirestoreRepository.withSchema');
    const writeBase = options?.writeSchema ?? readSchema;
    const validator = makeValidator(writeBase, undefined, {
      sentinelPolicy: options?.sentinelPolicy,
    });
    // Validate writes against `writeBase`, but expose the plain `readSchema` as `schemas.read`.
    // `stored` retains the EFFECTIVE at-rest shape (the read schema when none was supplied, per
    // ADR-0018) so `collectionGroup()` can reject a stored shape that collides with group identity.
    const schemas = Object.freeze({
      read: readSchema,
      create: validator.schemas.create,
      update: validator.schemas.update,
      stored: options?.storedSchema ?? readSchema,
    });
    return new FirestoreRepository<any, any, any, any>(
      db,
      collection,
      validator,
      undefined,
      options?.readConverter,
      schemas,
      options?.allowLegacyDatastoreIds,
    );
  }

  /**
   * Named entry point for an **unvalidated** (schema-less) repository. Prefer this over the positional
   * constructor when you need a raw repository with options — it makes a security-relevant flag like
   * `allowLegacyDatastoreIds` discoverable and hard to misplace, instead of a trailing positional
   * boolean after several `undefined`s (review R7). Types come from the explicit generic `T`; no Zod
   * validation runs (use {@link FirestoreRepository.withSchema} for that).
   *
   * @param db - Firestore database instance
   * @param collection - Collection path
   * @param options - Optional settings:
   *   - `readConverter`: a read-only `fromFirestore(snapshot) => T` mapper (the repository overlays the
   *     document id). Because this path runs no schema validation, there is no `storedSchema` to
   *     require: if the converter RESTRUCTURES fields, supply the physical shape as the `StoredData`
   *     generic yourself (`FirestoreRepository.raw<Read, Write, Stored>(…)`) so query field paths are
   *     correct — unlike {@link FirestoreRepository.withSchema}, this factory cannot infer it.
   *   - `allowLegacyDatastoreIds`: opt in to the documented `__id[0-9]+__` Cloud Datastore-import
   *     document-name form (document segments only; off by default). See ADR-0018 §6.
   *
   * @example
   * // A raw repository that can address imported Datastore numeric ids:
   * const repo = FirestoreRepository.raw<User>(db, 'users', { allowLegacyDatastoreIds: true });
   */
  static raw<T extends object, W extends object = T, S extends object = T>(
    db: Firestore,
    collection: string,
    options?: { readConverter?: ReadConverter<T>; allowLegacyDatastoreIds?: boolean },
  ): FirestoreRepository<T, W, S, W> {
    // No independent parsed-output generic: this path runs no parser, so the parsed write output
    // cannot diverge from the write input `W`. Pinning `WO = W` keeps the schema-less contract sound
    // (a hook can never be promised a parsed type nothing produces — review S1). The args cast is
    // because `RepositoryConstructorArgs<T, W, W>` is a deferred conditional under a generic `W`; the
    // optional-validator branch is the correct one here (WO === W).
    const args = [
      db,
      collection,
      undefined,
      undefined,
      options?.readConverter,
      undefined,
      options?.allowLegacyDatastoreIds,
    ] as unknown as RepositoryConstructorArgs<T, W, W>;
    return new FirestoreRepository<T, W, S, W>(...args);
  }

  /**
   * Access a subcollection under a specific parent document.
   *
   * Mirrors {@link FirestoreRepository.withSchema}: read/write types are inferred from schema values,
   * the `readSchema` describes the read model (no top-level `id`), and an optional `writeSchema`
   * overlay drives cast-free combinator writes. Read converters are read-only (a `fromFirestore(snapshot) => T`
   * mapper), explicit per repository instance, and never inherited from parent repositories — pass one
   * in `options.readConverter` when needed. The `parentId` and `subcollectionName` are validated as
   * single path segments (no slashes / reserved values).
   *
   * For an unvalidated subcollection, construct a repository directly against the full path, e.g.
   * `new FirestoreRepository<Order>(db, `${parentPath}/${parentId}/orders`)`.
   *
   * @param parentId - Parent document id (a single, valid path segment)
   * @param subcollectionName - Subcollection name (a single, valid collection segment)
   * @param readSchema - Canonical read schema describing the **read model** (no top-level `id`)
   * @param options - Optional `writeSchema` overlay, `storedSchema` (required with a `readConverter`),
   *   `readConverter`, and `sentinelPolicy` (see {@link FirestoreRepository.withSchema})
   *
   * @example
   * // Access orders for a specific user
   * const orderSchema = z.object({ product: z.string(), price: z.number() });
   * const userOrders = userRepo.subcollection('user-123', 'orders', orderSchema);
   * await userOrders.create({ product: 'Widget', price: 99 });
   *
   * @example
   * // With a write overlay (cast-free combinator writes) and a read-only converter. A `readConverter`
   * // requires a `storedSchema` describing the at-rest/physical document (ADR-0018).
   * const orderWrite = z.object({ product: z.string(), price: zNumberWrite() });
   * const orderStored = z.object({ product: z.string(), priceCents: z.number() });
   * const userOrders = userRepo.subcollection('user-123', 'orders', orderSchema, {
   *   writeSchema: orderWrite,
   *   readConverter: orderConverter,
   *   storedSchema: orderStored,
   * });
   * await userOrders.update('o1', { price: FieldValue.increment(5) }); // no cast
   *
   * @example
   * // Nested subcollections
   * const comments = postRepo
   *   .subcollection('post-123', 'comments', commentSchema)
   *   .subcollection('comment-456', 'replies', replySchema);
   */
  // Overload 1 — no `readConverter`: `storedSchema` optional (see withSchema).
  subcollection<
    RS extends z.ZodObject<any>,
    WS extends z.ZodObject<any> = RS,
    SS extends z.ZodObject<any> = RS,
  >(
    parentId: ID,
    subcollectionName: string,
    readSchema: RS,
    options?: {
      writeSchema?: WS;
      storedSchema?: SS;
      sentinelPolicy?: SentinelPolicy;
      allowLegacyDatastoreIds?: boolean;
      readConverter?: undefined;
    },
  ): FirestoreRepository<z.output<RS>, z.input<WS>, z.output<SS>, z.output<WS>>;
  // Overload 2 — `readConverter` present: `storedSchema` REQUIRED (review A3 / ADR-0018).
  subcollection<
    RS extends z.ZodObject<any>,
    SS extends z.ZodObject<any>,
    WS extends z.ZodObject<any> = RS,
  >(
    parentId: ID,
    subcollectionName: string,
    readSchema: RS,
    options: {
      readConverter: ReadConverter<z.output<RS>>;
      storedSchema: SS;
      writeSchema?: WS;
      sentinelPolicy?: SentinelPolicy;
      allowLegacyDatastoreIds?: boolean;
    },
  ): FirestoreRepository<z.output<RS>, z.input<WS>, z.output<SS>, z.output<WS>>;
  subcollection(
    parentId: ID,
    subcollectionName: string,
    readSchema: z.ZodObject<any>,
    options?: {
      writeSchema?: z.ZodObject<any>;
      storedSchema?: z.ZodObject<any>;
      readConverter?: ReadConverter<any>;
      sentinelPolicy?: SentinelPolicy;
      allowLegacyDatastoreIds?: boolean;
    },
  ): FirestoreRepository<any, any, any, any> {
    // Validate the parent id and subcollection name as single path segments before composing the
    // path (review B1): a slash-bearing parentId/name would otherwise traverse to an arbitrary
    // nested collection.
    this.validateId(parentId, 'subcollection parent id');
    validateCollectionSegment(subcollectionName, 'subcollection name');
    const newPath = `${this.collectionPath}/${parentId}/${subcollectionName}`;
    FirestoreRepository.assertSchemaHasNoTopLevelId(
      readSchema,
      'FirestoreRepository.subcollection(..., readSchema, ...)',
    );
    if (options?.writeSchema) {
      FirestoreRepository.assertSchemaHasNoTopLevelId(
        options.writeSchema,
        'FirestoreRepository.subcollection (writeSchema)',
      );
    }
    if (options?.storedSchema) {
      FirestoreRepository.assertSchemaHasNoTopLevelId(
        options.storedSchema,
        'FirestoreRepository.subcollection (storedSchema)',
      );
    }
    FirestoreRepository.assertConverterHasStoredSchema(
      options,
      'FirestoreRepository.subcollection',
    );
    const writeBase = options?.writeSchema ?? readSchema;
    const validator = makeValidator(writeBase, undefined, {
      sentinelPolicy: options?.sentinelPolicy,
    });
    // Validate writes against `writeBase`, but expose the plain `readSchema` as `schemas.read`.
    // `stored` retains the EFFECTIVE at-rest shape — see withSchema.
    const schemas = Object.freeze({
      read: readSchema,
      create: validator.schemas.create,
      update: validator.schemas.update,
      stored: options?.storedSchema ?? readSchema,
    });
    return new FirestoreRepository<any, any, any, any>(
      this.db,
      newPath,
      validator,
      newPath, // for tracking parent path for reference
      options?.readConverter,
      schemas,
      options?.allowLegacyDatastoreIds ?? this.allowLegacyDatastoreIds,
    );
  }

  /**
   * Get the parent document ID if this is a subcollection.
   * Returns null for top-level collections.
   *
   * @returns Parent document ID or null
   *
   * @example
   * const userOrders = userRepo.subcollection('user-123', 'orders');
   * console.log(userOrders.getParentId()); // 'user-123'
   *
   * @example
   * const topLevel = new FirestoreRepository(db, 'users');
   * console.log(topLevel.getParentId()); // null
   */
  getParentId(): ID | null {
    if (!this.parentPath) return null;
    // extract parent ID
    const parts = this.collectionPath.split('/');
    if (parts.length < 2) return null;
    return parts[parts.length - 2];
  }

  /**
   * Get the full Firestore path for this collection.
   *
   * @returns The collection path string
   *
   * @example
   * const repo = new FirestoreRepository(db, 'users');
   * console.log(repo.getCollectionPath()); // 'users'
   *
   * @example
   * const orders = userRepo.subcollection('user-123', 'orders');
   * console.log(orders.getCollectionPath()); // 'users/user-123/orders'
   */
  getCollectionPath(): string {
    return this.collectionPath;
  }

  /**
   * Check if this repository represents a subcollection.
   *
   * @returns True if this is a subcollection, false if top-level
   *
   * @example
   * const users = new FirestoreRepository(db, 'users');
   * console.log(users.isSubcollection()); // false
   *
   * @example
   * const orders = users.subcollection('user-123', 'orders');
   * console.log(orders.isSubcollection()); // true
   */
  isSubcollection(): boolean {
    return this.collectionPath.includes('/');
  }

  /**
   * Register a lifecycle hook to run before or after operations.
   * Hooks allow you to add custom logic like logging, validation, or side effects.
   *
   * @param event - The lifecycle event to hook into
   * @param fn - Async or sync function to execute
   *
   * @example
   * // Log all creates
   * userRepo.on('afterCreate', (user) => {
   *   console.log(`User created: ${user.id}`);
   * });
   *
   * @example
   * // Send email on user creation
   * userRepo.on('afterCreate', async (user) => {
   *   await sendWelcomeEmail(user.email);
   * });
   *
   * @example
   * // Validate business logic before update
   * orderRepo.on('beforeUpdate', (data) => {
   *   if (data.status === 'shipped' && !data.trackingNumber) {
   *     throw new Error('Tracking number required for shipped orders');
   *   }
   * });
   *
   * @example
   * // Bulk operation hooks
   * userRepo.on('afterBulkDelete', async ({ ids, documents }) => {
   *   await auditLog.record('users_deleted', { count: ids.length });
   * });
   */
  on(event: 'beforeCreate', fn: BeforeCreateHookFn<W>): void;
  on(event: 'afterCreate', fn: AfterCreateHookFn<WO>): void;
  on(event: 'beforeUpdate', fn: BeforeUpdateHookFn<W>): void;
  on(event: 'afterUpdate', fn: AfterUpdateHookFn): void;
  on(event: 'beforeDelete', fn: BeforeDeleteHookFn<T>): void;
  on(event: 'afterDelete', fn: AfterDeleteHookFn<T>): void;
  on(event: 'beforeBulkCreate', fn: BeforeBulkCreateHookFn<W>): void;
  on(event: 'afterBulkCreate', fn: AfterBulkCreateHookFn<WO>): void;
  on(event: 'beforeBulkUpdate', fn: BeforeBulkUpdateHookFn<W>): void;
  on(event: 'afterBulkUpdate', fn: AfterBulkUpdateHookFn): void;
  on(event: 'beforeBulkDelete', fn: BeforeBulkDeleteHookFn<T>): void;
  on(event: 'afterBulkDelete', fn: AfterBulkDeleteHookFn<T>): void;
  on(event: HookEvent, fn: AnyHookFn<T, W, WO>): void {
    if (!this.hooks[event]) this.hooks[event] = [];
    this.hooks[event]!.push(fn);
  }

  /**
   * Sequential, fail-fast hook dispatcher. Builds an event-correlated {@link HookContext} and wraps
   * hook failures as {@link WriteOutcomeError} with before/after outcome metadata owned by **this**
   * call's control-flow phase. A nested {@link WriteOutcomeError} from another repository call is
   * never returned as-is — it becomes `cause` of the outer phase outcome (review B1 / trap T2).
   */
  private async runHooks<E extends HookEvent>(
    event: E,
    data: HookDataFor<E, T, W, WO>,
    execution: HookExecution = { kind: 'direct' },
  ): Promise<void> {
    const context = buildHookContext(event, execution);

    try {
      const hooks = (this.hooks[event] ?? []) as HookFnMap<T, W, WO>[E][];
      for (const hook of hooks) {
        // TypeScript cannot prove HookFnMap[E] accepts HookDataFor<E,…> when E is an *open*
        // type parameter (it widens the callback parameter to an intersection of every event's
        // payload). The cast restores the correlated pair that HookDataFor already enforced at
        // each concrete emit site (review N1).
        await (
          hook as (payload: HookDataFor<E, T, W, WO>, ctx: HookContext<E>) => Promise<void> | void
        )(data, context);
      }
    } catch (error) {
      throw this.writeOutcomeFromHookFailure(event, context, error);
    }
  }

  /**
   * Classify a hook failure by **this** call's control-flow position (before vs after), not by the
   * cause's class. Nested {@link WriteOutcomeError} instances are preserved as `cause` via
   * {@link parseFirestoreError} so the outer outcome still describes the outer write.
   */
  private writeOutcomeFromHookFailure<E extends HookEvent>(
    event: E,
    context: HookContext<E>,
    error: unknown,
  ): WriteOutcomeError {
    // Always allocate the outer phase outcome. parseFirestoreError preserves an existing
    // WriteOutcomeError as the cause identity — returning that nested error unchanged would lie
    // about whether THIS write committed (review B1).
    const cause = parseFirestoreError(error);
    const isBefore = event.startsWith('before');
    return new WriteOutcomeError(
      isBefore
        ? { state: 'not-committed', phase: 'before-hook', hook: context }
        : { state: 'committed', phase: 'after-hook', hook: context },
      cause,
    );
  }

  /**
   * Postcommit read-back for `{ returnDoc: true }` paths. The write has already committed; only the
   * converter/read model can fail here. Nested {@link WriteOutcomeError} values are re-wrapped so
   * the outer outcome stays `committed` / `read-back` (review B1).
   */
  private async readAfterCommit<R>(read: () => Promise<R>): Promise<R> {
    try {
      return await read();
    } catch (error) {
      // Same rule as writeOutcomeFromHookFailure: phase ownership wins over cause class.
      throw new WriteOutcomeError(
        { state: 'committed', phase: 'read-back' },
        parseFirestoreError(error),
      );
    }
  }

  // Typed after-create emitters (review R4). Dispatching through these — instead of calling the
  // untyped `runHooks` directly with an `as Record<string, any>` payload — makes the compiler verify
  // that the event carries the exact parsed create OUTPUT (`CreateOutput<WO>`): an accidentally
  // input-shaped value fails to compile at the call. The emitter owns freezing the envelope so an
  // after-hook cannot mutate identity/accounting (review R2); the `id` is added here so the frozen
  // payload never round-trips a generic `Omit` through a spread at the call site.
  private async emitAfterCreate(data: CreateOutput<WO>, id: ID): Promise<void> {
    // Object.freeze widens to Readonly<…>, which is not assignable to CreateOutput<WO> under
    // generic WO; the runtime shape matches AfterCreateHookFn (review N1 / R2).
    await this.runHooks(
      'afterCreate',
      Object.freeze({ ...data, id }) as HookDataFor<'afterCreate', T, W, WO>,
    );
  }

  private async emitAfterBulkCreate(
    data: readonly (CreateOutput<WO> & { id: ID })[],
  ): Promise<void> {
    await this.runHooks(
      'afterBulkCreate',
      Object.freeze(data.map(doc => Object.freeze(doc))) as HookDataFor<
        'afterBulkCreate',
        T,
        W,
        WO
      >,
    );
  }

  /**
   * Collection reference used by every **read** path.
   *
   * When a `readConverter` is configured, the repository builds a full
   * `FirestoreDataConverter` internally — the user-supplied `fromFirestore` half plus a pass-through
   * `toFirestore` — and applies it here so `fromFirestore` runs on reads. Because that converter is
   * only ever attached to the read ref, its `toFirestore` is never invoked (see
   * {@link FirestoreRepository.writeCol}). Subcollections do not inherit parent converters
   * automatically.
   */
  private readCol(): CollectionReference<any> {
    const collectionRef = this.db.collection(this.collectionPath);
    if (!this.readConverter) return collectionRef;
    const fromFirestore = this.readConverter;
    return collectionRef.withConverter({
      // Never invoked — this converter is only attached to the read ref; writes use writeCol().
      // The Admin SDK's withConverter still requires a toFirestore to build the ref.
      toFirestore: model => model as FirebaseFirestore.DocumentData,
      fromFirestore,
    });
  }

  /**
   * Collection reference used by every **write** path.
   *
   * Deliberately raw (never `.withConverter(...)`) so a converter's
   * `toFirestore` is **never** invoked. The Admin SDK skips `toFirestore` on
   * `update`/`batch.update`/`tx.update` anyway, so routing all writes through the
   * raw ref removes that asymmetry — converters are strictly read-only. Use a
   * `before*` hook for write-time normalization.
   */
  private writeCol(): CollectionReference<any> {
    return this.db.collection(this.collectionPath);
  }

  /**
   * Removes top-level undefined keys from update payloads.
   * This preserves prior behavior where undefined update values were ignored.
   */
  private sanitizeUpdateData(data: UpdateInput<W>): UpdateInput<W> {
    const entries = Object.entries(data as Record<string, any>).filter(
      ([, value]) => value !== undefined,
    );
    return Object.fromEntries(entries) as UpdateInput<W>;
  }

  /**
   * Rejects an update whose write payload is empty after validation/sanitization. An empty patch
   * previously skipped the Firestore write entirely, which meant a nonexistent document was reported
   * as successfully updated (the missing-doc NotFoundError comes from Firestore's own update()).
   * Rejecting keeps the documented "update throws for a missing document" contract intact and makes
   * every update surface behave identically.
   */
  private assertNonEmptyUpdatePayload(payload: Record<string, any>): void {
    if (Object.keys(payload).length === 0) {
      throw new ValidationError([
        {
          code: 'custom',
          path: [],
          message:
            'Update payload is empty — no fields to write after validation. Provide at least one ' +
            'field to update (use delete() to remove a document).',
        } as z.core.$ZodIssue,
      ]);
    }
  }

  /**
   * Builds the Admin SDK `Precondition` for an optional `lastUpdateTime`, or `undefined` when the
   * caller supplied none.
   *
   * HAZARD this exists to make unmissable: an explicit `undefined` must NEVER reach `update()`.
   * `DocumentReference.update` / `WriteBatch.update` / `Transaction.update` also accept an
   * alternating field/value overload, so `update(payload, undefined)` is parsed as a *field*
   * argument and throws "Input is not an object" — it is not treated as an omitted precondition.
   * (`delete(undefined)` happens to be tolerated, but every delete call site branches the same way
   * for one consistent rule.) An empty `{}` is also not a substitute: it is a valid no-op
   * precondition, so relying on it would quietly widen the SDK surface every write touches.
   *
   * Therefore every call site MUST branch on the result of this helper and call the one-argument
   * form when it is `undefined` — never forward it positionally. A unit test asserts that a
   * precondition-free `update` reaches the SDK with exactly one argument.
   */
  private toPrecondition(
    lastUpdateTime: FirebaseFirestore.Timestamp | undefined,
  ): FirebaseFirestore.Precondition | undefined {
    return lastUpdateTime ? { lastUpdateTime } : undefined;
  }

  /**
   * Rejects duplicate document ids in a bulk operation. Two actions targeting the same document in
   * one batch are ambiguous (for updates, which payload wins?) and inflate result counts, so require
   * the caller to deduplicate first rather than guessing intent.
   */
  private assertNoDuplicateIds(ids: ID[], operation: string): void {
    const seen = new Set<ID>();
    const duplicates = new Set<ID>();
    for (const id of ids) {
      if (seen.has(id)) {
        duplicates.add(id);
      }
      seen.add(id);
    }
    if (duplicates.size > 0) {
      throw new Error(
        `${operation}() received duplicate document id(s): ${[...duplicates].join(', ')}. ` +
          'Deduplicate ids before calling — multiple actions on the same document in one bulk ' +
          'operation are ambiguous.',
      );
    }
  }

  /**
   * Normalize update payloads into dot-notation form for merge-style updates.
   * This keeps nested-object updates explicit at field-path level while allowing
   * callers to mix regular nested objects and pre-defined dot-notation keys.
   *
   * Precedence rule: explicit dot-notation keys always win over values derived
   * from flattening regular nested objects (e.g. profile.name overrides profile.name
   * generated from profile: { name: ... }).
   */
  private normalizeUpdateDataForMerge(data: UpdateInput<W>): UpdateInput<W> {
    const updateObject = data as Record<string, any>;
    const regularObjectEntries: [string, any][] = [];
    const explicitDotNotationEntries: [string, any][] = [];

    for (const [key, value] of Object.entries(updateObject)) {
      if (isDotNotation(key)) {
        explicitDotNotationEntries.push([key, value]);
      } else {
        regularObjectEntries.push([key, value]);
      }
    }

    const flattenedRegularObject = flattenToDotNotation(
      Object.fromEntries(regularObjectEntries) as Record<string, any>,
    );
    const explicitDotNotationObject = Object.fromEntries(explicitDotNotationEntries);

    const merged: Record<string, any> = {
      ...flattenedRegularObject,
      ...explicitDotNotationObject,
    };

    // Drop undefined leaves so a nested `{ a: { b: undefined } }` behaves identically to an explicit
    // `{ 'a.b': undefined }` — both are omitted (the existing value is preserved) instead of the
    // flattened form leaking an undefined path that Firestore rejects.
    for (const key of Object.keys(merged)) {
      if (merged[key] === undefined) {
        delete merged[key];
      }
    }

    return merged as UpdateInput<W>;
  }

  /**
   * Validate create payloads using configured schema when available.
   * Falls back to returning the original payload when validation is disabled.
   */
  private validateCreateData(data: CreateInput<W>): CreateOutput<WO> {
    const createPayload = this.stripTopLevelId(data as Record<string, any>) as CreateInput<W>;
    // Firestore only interprets dot-notation as a field path on update(); set()/add() would create a
    // field whose *name* literally contains a dot. The types already forbid dotted keys on create,
    // so this guards the `as any` bypass with a clear error instead of a silent mis-named field.
    if (hasDotNotationKeys(createPayload as Record<string, any>)) {
      throw new Error(
        'Dot-notation keys are not supported on create/set/upsert-new payloads (Firestore treats ' +
          'them as literal field names). Use a nested object, or update() for field-path merges.',
      );
    }
    // parseCreate returns the exact parsed create OUTPUT (CreateOutput<WO>) — that is what gets
    // written and what after-create hooks observe. The unvalidated branch is the one honest cast:
    // with no parser, WO defaults to W and the raw (possibly sentinel-bearing) input IS the output.
    const validData = this.validator
      ? this.validator.parseCreate(createPayload)
      : (createPayload as unknown as CreateOutput<WO>);
    // Scan the PARSED OUTPUT — not the raw input — for delete sentinels. A schema transform or
    // default is part of the supported write model and can inject FieldValue.delete() during
    // parsing; the output is the value actually sent to Firestore, so scanning the input would miss
    // a transform-produced delete and let it fail only at commit (review T1 / ADR-0019).
    this.assertNoDeleteSentinel(validData as Record<string, any>);
    return validData;
  }

  /**
   * Validate update payloads using configured schema when available.
   * Falls back to returning the original payload when validation is disabled.
   */
  private validateUpdateData(data: UpdateInput<W>): UpdateInput<W> {
    const updatePayload = this.stripTopLevelId(data as Record<string, any>) as UpdateInput<W>;
    return (
      this.validator ? this.validator.parseUpdate(updatePayload) : updatePayload
    ) as UpdateInput<W>;
  }

  /**
   * Removes top-level `id` from write payloads so document IDs are sourced exclusively
   * from Firestore document references and method parameters.
   */
  private stripTopLevelId<TInput extends Record<string, any>>(data: TInput): Omit<TInput, 'id'> {
    const { id: _ignoredId, ...payload } = data;
    return payload as Omit<TInput, 'id'>;
  }

  /**
   * Rejects a `FieldValue.delete()` sentinel anywhere in a write payload, before any I/O.
   *
   * Firestore only honors a delete sentinel on update-like writes (`update()`, or
   * `set(..., { merge: true })`), so a delete on a plain `create`/`set` fails at commit. This is
   * called on the **final parsed output** (not the raw input) of every create chokepoint — `create`,
   * `bulkCreate`, `createInTransaction`, and the `upsert` create branch (all via
   * {@link validateCreateData}) — so a delete introduced by a schema transform/default is caught too
   * (review T1). `upsert` additionally rejects a delete on its **update** branch (and up front on the
   * raw input), so the same input is rejected whether or not the document already exists — the
   * existence-independent contract ADR-0019 requires. A direct `update()`/`patch()` still permits
   * delete. Other sentinel kinds (`increment`/`arrayUnion`/`arrayRemove`/`serverTimestamp`) are
   * backend-valid on create and pass through untouched.
   */
  private assertNoDeleteSentinel(payload: Record<string, any>): void {
    const deletePaths = collectDeleteSentinelPaths(payload);
    if (deletePaths.length === 0) {
      return;
    }
    throw new ValidationError(
      deletePaths.map(path => ({
        code: 'custom',
        path,
        message:
          'FieldValue.delete() is not valid on create/set/upsert — Firestore only honors it on ' +
          'update-like writes. Use update() or patch() to clear a field.',
      })) as z.core.$ZodIssue[],
    );
  }

  /**
   * Create a new document in the collection.
   * Runs validation if schema is configured.
   *
   * By default returns only `{ id }` (the generated document id) — the write path validates the
   * write model but does not read the document back, so it cannot honestly return the read model
   * `T` (which may differ when a `writeSchema` overlay or `readConverter` is configured). Pass
   * `{ returnDoc: true }` to read the created document back through the `readConverter` and return
   * the converted read model. Pass `{ withMetadata: true }` to keep `{ id }` and add the commit
   * receipt `writeTime` (Admin SDK {@link FirebaseFirestore.WriteResult.writeTime}). `returnDoc` and
   * `withMetadata` are mutually exclusive. Not available on transactional create helpers — the
   * Admin SDK exposes no per-op write receipt inside a transaction.
   *
   * Auto-id creation uses `CollectionReference.doc().set(...)` (not `add()`) so a
   * {@link FirebaseFirestore.WriteResult} is always available when metadata is requested; the id is
   * still client-generated before the write.
   *
   * @param data - Document data (without ID)
   * @param options - `{ returnDoc: true }` for the converted read model, or `{ withMetadata: true }`
   *   for `{ id, writeTime }`
   * @returns `{ id }` by default; `FirestoreDocument<T>` when `returnDoc` is true; `{ id, writeTime }`
   *   when `withMetadata` is true
   * @throws {ValidationError} If schema validation fails
   *
   * @example
   * // Default: returns { id }
   * const { id } = await userRepo.create({ name: 'John Doe', email: 'john@example.com' });
   *
   * @example
   * // Return the converted read model
   * const user = await userRepo.create(
   *   { name: 'John Doe', email: 'john@example.com' },
   *   { returnDoc: true },
   * );
   * console.log(user.name);
   *
   * @example
   * // Opt-in commit receipt
   * const { id, writeTime } = await userRepo.create(
   *   { name: 'John Doe', email: 'john@example.com' },
   *   { withMetadata: true },
   * );
   */
  async create(
    data: CreateInput<W>,
    options: { returnDoc: true } & NoWriteMetadataOptions,
  ): Promise<FirestoreDocument<T>>;
  async create(
    data: CreateInput<W>,
    options: WriteMetadataOptions,
  ): Promise<WriteResultWithMetadata<{ id: ID }>>;
  async create(
    data: CreateInput<W>,
    options?: { returnDoc?: false } & NoWriteMetadataOptions,
  ): Promise<{ id: ID }>;
  async create(
    data: CreateInput<W>,
    options?: { returnDoc?: boolean; withMetadata?: boolean },
  ): Promise<{ id: ID } | FirestoreDocument<T> | WriteResultWithMetadata<{ id: ID }>> {
    // Guard JS callers before any I/O so an ambiguous combined shape is never invented (T4).
    this.assertExclusiveWriteResultOptions(options);
    try {
      const docToCreate = { ...(data as Record<string, any>) } as Record<string, any>;
      await this.runHooks('beforeCreate', docToCreate as HookDataFor<'beforeCreate', T, W, WO>);
      const validData = this.validateCreateData(docToCreate as CreateInput<W>);

      // Client-side auto id + set() yields a WriteResult (add() only yields a DocumentReference) —
      // required for withMetadata and harmless for the default path (T1).
      const docRef = this.writeCol().doc();
      const writeResult = await docRef.set(validData as any);

      // After-create hooks receive the parsed write OUTPUT plus the generated id, in a frozen
      // envelope (review R4/R2): the type is verified by emitAfterCreate and the identity/accounting
      // cannot be mutated by a hook.
      await this.emitAfterCreate(validData, docRef.id);

      if (options?.returnDoc === true) {
        return await this.readAfterCommit(() => this.getByIdOrThrow(docRef.id));
      }
      if (options?.withMetadata === true) {
        return { id: docRef.id, writeTime: writeResult.writeTime };
      }
      return { id: docRef.id };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        throw new ValidationError(err.issues);
      }
      throw parseFirestoreError(err);
    }
  }

  /**
   * Create a document under a **caller-supplied id**, failing if that id is already taken.
   *
   * This is Firestore `DocumentReference.create()` semantics — a create-only write, not an
   * overwrite. It is the counterpart to {@link upsert}, which writes regardless of existence:
   * - `createWithId` → the document must NOT exist; a collision raises {@link ConflictError}.
   * - `upsert` → creates or updates, never conflicts.
   *
   * The check is performed by the backend as part of the write, so it is atomic: two concurrent
   * `createWithId` calls on the same id cannot both succeed — exactly one wins and the loser gets a
   * `ConflictError`. That is why this is the correct primitive for claiming an externally-derived
   * identifier (an email hash, an idempotency key, an upstream record id), where a
   * read-then-`upsert` would leave a race window open.
   *
   * Everything else matches {@link create}: `beforeCreate` / `afterCreate` fire with the caller's id,
   * the payload goes through the same create validation (dotted keys and `FieldValue.delete()`
   * sentinels are rejected), and the return contract is `{ id }` unless `{ returnDoc: true }` asks
   * for a read-back through the `readConverter`.
   *
   * @param id - Document ID to claim
   * @param data - Document data (without ID)
   * @param options - `{ returnDoc: true }` for the converted read model, or `{ withMetadata: true }`
   *   for `{ id, writeTime }`. The two flags are mutually exclusive. Not available on
   *   `createWithIdInTransaction`.
   * @returns `{ id }` by default, or the created document (`FirestoreDocument<T>`) when `returnDoc` is true,
   *   or `{ id, writeTime }` when `withMetadata` is true
   * @throws {InvalidDocumentIdError} If the id is not a single valid Firestore path segment
   * @throws {ValidationError} If schema validation fails, or the payload carries a delete sentinel
   * @throws {ConflictError} If a document already exists at that id
   *
   * @example
   * // Claim an externally-derived id exactly once
   * try {
   *   await userRepo.createWithId('external-id-123', { name: 'John Doe' });
   * } catch (error) {
   *   if (error instanceof ConflictError) {
   *     console.log('That id is already taken');
   *   }
   * }
   *
   * @example
   * // Return the converted read model
   * const user = await userRepo.createWithId('user-123', { name: 'Ada' }, { returnDoc: true });
   *
   * @example
   * // Opt-in commit receipt
   * const { id, writeTime } = await userRepo.createWithId(
   *   'user-123',
   *   { name: 'Ada' },
   *   { withMetadata: true },
   * );
   */
  async createWithId(
    id: ID,
    data: CreateInput<W>,
    options: { returnDoc: true } & NoWriteMetadataOptions,
  ): Promise<FirestoreDocument<T>>;
  async createWithId(
    id: ID,
    data: CreateInput<W>,
    options: WriteMetadataOptions,
  ): Promise<WriteResultWithMetadata<{ id: ID }>>;
  async createWithId(
    id: ID,
    data: CreateInput<W>,
    options?: { returnDoc?: false } & NoWriteMetadataOptions,
  ): Promise<{ id: ID }>;
  async createWithId(
    id: ID,
    data: CreateInput<W>,
    options?: { returnDoc?: boolean; withMetadata?: boolean },
  ): Promise<{ id: ID } | FirestoreDocument<T> | WriteResultWithMetadata<{ id: ID }>> {
    // Security boundary (review B1): a caller-supplied id is validated BEFORE any hook runs or any
    // I/O happens, because `CollectionReference.doc()` accepts a slash-separated path and would
    // otherwise let a malformed id address a document outside this collection.
    this.validateId(id);
    this.assertExclusiveWriteResultOptions(options);
    try {
      // The `id` is non-writable on the before-hook payload (review R2): a hook may mutate data
      // fields but cannot repoint identity. The write target is built from the captured `id`
      // argument, never from this payload.
      const docToCreate = FirestoreRepository.withReadonlyId(
        { ...(data as Record<string, any>) },
        id,
      );
      await this.runHooks('beforeCreate', docToCreate as HookDataFor<'beforeCreate', T, W, WO>);
      // No standalone dot-notation guard here (unlike `upsert`): that guard exists only because
      // upsert's behavior is existence-dependent. `createWithId` is always a create, so
      // validateCreateData's own dotted-key rejection is both sufficient and correct.
      const validData = this.validateCreateData(docToCreate as CreateInput<W>);

      // `create()` — NOT `set()`. The backend rejects the write when the document already exists,
      // which parseFirestoreError normalizes (gRPC 6 ALREADY_EXISTS) into ConflictError.
      const docRef = this.writeCol().doc(id);
      const writeResult = await docRef.create(validData as any);

      // After-create hooks observe the parsed write OUTPUT plus the caller's id in a frozen envelope
      // (review R4/R2) — identical to create()/upsert().
      await this.emitAfterCreate(validData, id);

      if (options?.returnDoc === true) {
        return await this.readAfterCommit(() => this.getByIdOrThrow(id));
      }
      if (options?.withMetadata === true) {
        return { id, writeTime: writeResult.writeTime };
      }
      return { id };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        throw new ValidationError(err.issues);
      }
      throw parseFirestoreError(err);
    }
  }

  /**
   * Create multiple documents in a single batched operation.
   * More efficient than calling create() in a loop. Uses Firestore batches (500 ops per batch).
   *
   * By default returns `{ id }[]` (one generated id per input, in order). Pass
   * `{ returnDoc: true }` to read every created document back through the `readConverter` and return
   * the converted read models — matching the single {@link create} contract. Pass
   * `{ withMetadata: true }` for positional `{ id, writeTime }[]` aligned to the input order across
   * 500-op chunk boundaries. `returnDoc` and `withMetadata` are mutually exclusive.
   *
   * @param dataArray - Array of documents to create
   * @param options - `{ returnDoc: true }` for converted read models, or `{ withMetadata: true }` for
   *   commit receipts
   * @returns `{ id }[]` by default, `(FirestoreDocument<T>)[]` when `returnDoc` is true, or
   *   `{ id, writeTime }[]` when `withMetadata` is true
   * @throws {ValidationError} If any document fails validation
   *
   * @example
   * // Default: returns [{ id }, ...]
   * const ids = await userRepo.bulkCreate([
   *   { name: 'Alice', email: 'alice@example.com' },
   *   { name: 'Bob', email: 'bob@example.com' },
   * ]);
   *
   * @example
   * // Return the converted read models
   * const users = await userRepo.bulkCreate(rows, { returnDoc: true });
   *
   * @example
   * // Positional commit receipts
   * const receipts = await userRepo.bulkCreate(rows, { withMetadata: true });
   */
  async bulkCreate(
    dataArray: CreateInput<W>[],
    options: { returnDoc: true } & NoWriteMetadataOptions,
  ): Promise<FirestoreDocument<T>[]>;
  async bulkCreate(
    dataArray: CreateInput<W>[],
    options: WriteMetadataOptions,
  ): Promise<WriteResultWithMetadata<{ id: ID }>[]>;
  async bulkCreate(
    dataArray: CreateInput<W>[],
    options?: { returnDoc?: false } & NoWriteMetadataOptions,
  ): Promise<{ id: ID }[]>;
  async bulkCreate(
    dataArray: CreateInput<W>[],
    options?: { returnDoc?: boolean; withMetadata?: boolean },
  ): Promise<{ id: ID }[] | FirestoreDocument<T>[] | WriteResultWithMetadata<{ id: ID }>[]> {
    this.assertExclusiveWriteResultOptions(options);
    try {
      const colRef = this.writeCol();

      // Draft docs: raw input + a pre-assigned auto id. This is what `beforeBulkCreate` sees and may
      // mutate before validation. Capture the assigned ids up front (review B2) so a hook that mutates
      // a draft's `id` cannot redirect the write target — the write ref and the returned id come from
      // the captured id, while the (possibly hook-mutated) draft data is still what gets validated.
      const capturedIds = dataArray.map(() => colRef.doc().id);
      const drafts: (CreateInput<W> & { id: ID })[] = dataArray.map(
        (data, index) =>
          FirestoreRepository.withReadonlyId(
            { ...(data as Record<string, any>) },
            capturedIds[index],
          ) as unknown as CreateInput<W> & { id: ID },
      );
      // Stable pre-hook work list (review A1): each captured id is paired with its draft OBJECT
      // before the hook runs. A `beforeBulkCreate` hook may mutate a draft's DATA fields in place, but
      // reordering, splicing, or replacing entries in the array it receives cannot change which id
      // gets which data — the write loop iterates THIS list, not the hook-handed `drafts` array.
      const work = drafts.map((draft, index) => ({ id: capturedIds[index], draft }));

      // Freeze the array the hook sees (review R2): membership/order/length are immutable and each
      // draft's `id` is already non-writable, while `data` fields stay mutable (shared with `work`),
      // so documented in-place data mutation still reaches the write.
      Object.freeze(drafts);
      await this.runHooks('beforeBulkCreate', drafts);

      const actions: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];
      // Result/hook payload is built from the VALIDATED create OUTPUT (never the raw draft), so any
      // key Zod strips is absent from both the return value and the afterBulkCreate payload, and the
      // element type is the exact parsed output (review R4).
      const validatedDocs: (CreateOutput<WO> & { id: ID })[] = [];

      for (const { id, draft } of work) {
        const docRef = colRef.doc(id);
        const validData = this.validateCreateData(draft as CreateInput<W>);

        actions.push(batch => batch.set(docRef, validData as any));
        validatedDocs.push({
          ...validData,
          id,
        });
      }

      // Capture receipts in enqueue order across 500-op chunks so withMetadata stays positional (T2).
      const writeResults = await this.commitInChunks(actions);
      // emitAfterBulkCreate freezes the array and each doc so the hook cannot mutate the accounting.
      await this.emitAfterBulkCreate(validatedDocs);

      if (options?.returnDoc === true) {
        return await Promise.all(
          validatedDocs.map(doc => this.readAfterCommit(() => this.getByIdOrThrow(doc.id))),
        );
      }
      if (options?.withMetadata === true) {
        return validatedDocs.map((doc, index) => ({
          id: doc.id,
          writeTime: writeResults[index]!.writeTime,
        }));
      }
      return validatedDocs.map(doc => ({ id: doc.id }));
    } catch (error: any) {
      if (error instanceof z.ZodError) throw new ValidationError(error.issues);
      throw parseFirestoreError(error);
    }
  }

  /**
   * Create multiple documents under **caller-supplied ids** in a single batched operation, failing
   * if any of those ids is already taken.
   *
   * The bulk counterpart to {@link createWithId}: every write uses Firestore's create-only
   * semantics, so a single pre-existing id rejects the whole call with {@link ConflictError}. At or
   * below 500 entries the batch is atomic — when one create collides, **no** sibling in the batch
   * lands. Above 500 entries the existing chunked-commit caveat applies (earlier 500-op chunks stay
   * committed); use a transaction if you need all-or-nothing beyond that.
   *
   * Duplicate ids **within the input** are rejected up front, before any I/O. Firestore's own
   * insert-then-insert diagnostic for that case is an opaque `INVALID_ARGUMENT`, so catching it
   * locally is what produces an actionable message.
   *
   * @param entries - Array of `{ id, data }` pairs to create
   * @param options - `{ returnDoc: true }` for converted read models, or `{ withMetadata: true }` for
   *   positional `{ id, writeTime }[]`
   * @returns `{ id }[]` by default, or the created documents when `returnDoc` is true, or
   *   `{ id, writeTime }[]` when `withMetadata` is true
   * @throws {InvalidDocumentIdError} If any id is not a single valid Firestore path segment
   * @throws {Error} If the input contains duplicate ids
   * @throws {ValidationError} If any document fails validation
   * @throws {ConflictError} If any id already exists (nothing in the batch is written)
   *
   * @example
   * await userRepo.bulkCreateWithIds([
   *   { id: 'user-1', data: { name: 'Alice' } },
   *   { id: 'user-2', data: { name: 'Bob' } },
   * ]);
   */
  async bulkCreateWithIds(
    entries: { id: ID; data: CreateInput<W> }[],
    options: { returnDoc: true } & NoWriteMetadataOptions,
  ): Promise<FirestoreDocument<T>[]>;
  async bulkCreateWithIds(
    entries: { id: ID; data: CreateInput<W> }[],
    options: WriteMetadataOptions,
  ): Promise<WriteResultWithMetadata<{ id: ID }>[]>;
  async bulkCreateWithIds(
    entries: { id: ID; data: CreateInput<W> }[],
    options?: { returnDoc?: false } & NoWriteMetadataOptions,
  ): Promise<{ id: ID }[]>;
  async bulkCreateWithIds(
    entries: { id: ID; data: CreateInput<W> }[],
    options?: { returnDoc?: boolean; withMetadata?: boolean },
  ): Promise<{ id: ID }[] | FirestoreDocument<T>[] | WriteResultWithMetadata<{ id: ID }>[]> {
    // Security boundary + input contract, both BEFORE any hook or I/O: every caller-supplied id is
    // validated (review B1), then duplicates are rejected because two creates on the same document
    // in one batch are ambiguous and inflate the result count.
    const requestedIds = entries.map(entry => entry.id);
    requestedIds.forEach(id => this.validateId(id));
    this.assertNoDuplicateIds(requestedIds, 'bulkCreateWithIds');
    this.assertExclusiveWriteResultOptions(options);
    try {
      const colRef = this.writeCol();

      // Capture the ids up front (review B2), exactly as bulkCreate captures its generated ids — the
      // only difference is that here the captured value is the CALLER's id. A hook that mutates a
      // draft's `id` therefore cannot redirect the write target: the write ref and the returned id
      // both come from `capturedIds`, while the (possibly hook-mutated) draft data is what gets
      // validated.
      const capturedIds = [...requestedIds];
      const drafts: (CreateInput<W> & { id: ID })[] = entries.map(
        (entry, index) =>
          FirestoreRepository.withReadonlyId(
            { ...(entry.data as Record<string, any>) },
            capturedIds[index],
          ) as unknown as CreateInput<W> & { id: ID },
      );
      // Stable pre-hook work list (review A1): each captured id is paired with its draft OBJECT
      // before the hook runs. A `beforeBulkCreate` hook may mutate a draft's DATA fields in place,
      // but reordering, splicing, or replacing entries in the array it receives cannot change which
      // id gets which data — the write loop iterates THIS list, not the hook-handed `drafts` array.
      const work = drafts.map((draft, index) => ({ id: capturedIds[index], draft }));

      // Freeze the array the hook sees (review R2): membership/order/length are immutable and each
      // draft's `id` is already non-writable, while `data` fields stay mutable (shared with `work`),
      // so documented in-place data mutation still reaches the write.
      Object.freeze(drafts);
      await this.runHooks('beforeBulkCreate', drafts);

      const actions: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];
      // Result/hook payload is built from the VALIDATED create OUTPUT (never the raw draft), so any
      // key Zod strips is absent from both the return value and the afterBulkCreate payload
      // (review R4).
      const validatedDocs: (CreateOutput<WO> & { id: ID })[] = [];

      for (const { id, draft } of work) {
        const docRef = colRef.doc(id);
        const validData = this.validateCreateData(draft as CreateInput<W>);

        // `batch.create` — NOT `batch.set`: create-only semantics, and the batch stays atomic, so a
        // collision on any entry means none of the siblings land.
        actions.push(batch => batch.create(docRef, validData as any));
        validatedDocs.push({
          ...validData,
          id,
        });
      }

      const writeResults = await this.commitInChunks(actions);
      // emitAfterBulkCreate freezes the array and each doc so the hook cannot mutate the accounting.
      await this.emitAfterBulkCreate(validatedDocs);

      if (options?.returnDoc === true) {
        return await Promise.all(
          validatedDocs.map(doc => this.readAfterCommit(() => this.getByIdOrThrow(doc.id))),
        );
      }
      if (options?.withMetadata === true) {
        return validatedDocs.map((doc, index) => ({
          id: doc.id,
          writeTime: writeResults[index]!.writeTime,
        }));
      }
      return validatedDocs.map(doc => ({ id: doc.id }));
    } catch (error: any) {
      if (error instanceof z.ZodError) throw new ValidationError(error.issues);
      throw parseFirestoreError(error);
    }
  }

  /**
   * Materialize one existing snapshot into the shape the caller's `withMetadata` flag selected.
   *
   * **Requires `snapshot.exists`.** Every caller narrows first; see {@link buildDocumentMetadata}
   * for why the metadata builder is unsound on a missing document.
   */
  private toDocumentResult(
    snapshot: FirebaseFirestore.DocumentSnapshot,
    withMetadata: boolean | undefined,
  ): FirestoreDocument<T> | WithMetadata<FirestoreDocument<T>> {
    // Overlay the authoritative document name (snapshot.id), never a caller-supplied argument.
    const doc = asFirestoreDocument<T>({ ...(snapshot.data() as T), id: snapshot.id });
    return withMetadata ? { doc, metadata: buildDocumentMetadata(snapshot) } : doc;
  }

  /**
   * Metadata-carrying counterpart to {@link mapManySnapshots}.
   *
   * Deliberately a SEPARATE method rather than a flag on `mapManySnapshots`: that helper is shared
   * with `getManyInTransaction`, whose result shape is out of scope for issue #39 and whose
   * `ReadOnlyTransactionalRepository` overloads would not catch a shape change.
   */
  private mapManySnapshotsWithMetadata(
    snapshots: FirebaseFirestore.DocumentSnapshot[],
  ): (WithMetadata<FirestoreDocument<T>> | null)[] {
    return snapshots.map(snapshot =>
      snapshot.exists
        ? {
            doc: asFirestoreDocument<T>({ ...(snapshot.data() as T), id: snapshot.id }),
            metadata: buildDocumentMetadata(snapshot),
          }
        : null,
    );
  }

  /**
   * Retrieve a document by its ID.
   * Returns null if the document doesn't exist.
   *
   * @param id - Document ID
   * @returns Document with ID or null if not found
   *
   * @example
   * // Get active user
   * const user = await userRepo.getById('user-123');
   * if (user) {
   *   console.log(user.name);
   * }
   *
   */
  async getById(
    id: ID,
    options: { withMetadata: true },
  ): Promise<WithMetadata<FirestoreDocument<T>> | null>;
  async getById(id: ID, options?: { withMetadata?: false }): Promise<FirestoreDocument<T> | null>;
  async getById(
    id: ID,
    options?: { withMetadata?: boolean },
  ): Promise<FirestoreDocument<T> | WithMetadata<FirestoreDocument<T>> | null> {
    this.validateId(id);
    try {
      const snapshot = await this.readCol().doc(id).get();
      if (!snapshot.exists) return null;
      return this.toDocumentResult(snapshot, options?.withMetadata);
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Retrieve a document by its ID **together with its Firestore `updateTime`** — the token that
   * drives optimistic-concurrency (compare-and-set) writes.
   *
   * This is the read half of the conditional-write flow: pass the returned `updateTime` back as
   * `lastUpdateTime` on {@link update} / {@link patch} / {@link delete} (or their bulk and
   * transaction variants) and the write commits only if nobody else changed the document in between.
   *
   * The result is a **pair** — `{ doc, updateTime }` — rather than an `updateTime` overlaid on the
   * document. Overlaying would shadow a stored field named `updateTime` and make it unreachable,
   * exactly the collision ADR-0018 avoids for `id`. Every other read on this repository keeps its
   * existing return type; nothing here changes {@link getById}.
   *
   * Reads go through `readCol()`, so a configured `readConverter` applies to `doc` and the `id`
   * overlay behaves identically to {@link getById}. A converter-applied snapshot still carries the
   * server's `updateTime`, and the token it yields is accepted on the (raw) write reference.
   *
   * @param id - Document ID
   * @returns `{ doc, updateTime }`, or `null` when the document does not exist
   * @throws {InvalidDocumentIdError} If the id is not a single valid Firestore path segment
   *
   * @example
   * // Precondition-guarded read-modify-write
   * const current = await userRepo.getByIdWithUpdateTime('user-123');
   * if (current) {
   *   await userRepo.update(
   *     current.doc.id,
   *     { name: current.doc.name.trim() },
   *     { lastUpdateTime: current.updateTime },
   *   );
   * }
   */
  async getByIdWithUpdateTime(
    id: ID,
  ): Promise<{ doc: FirestoreDocument<T>; updateTime: FirebaseFirestore.Timestamp } | null> {
    this.validateId(id);
    try {
      const snapshot = await this.readCol().doc(id).get();
      if (!snapshot.exists) return null;

      const data = snapshot.data() as any;
      return {
        // Overlay the authoritative document name (snapshot.id), never the caller-supplied argument
        // — identical to getById.
        doc: asFirestoreDocument<T>({ ...(data as T), id: snapshot.id }),
        // `DocumentSnapshot.updateTime` is optional in the typings only because it is absent for a
        // NON-EXISTENT document; the `!snapshot.exists` early return above already excluded that
        // case, so the assertion is sound rather than optimistic.
        updateTime: snapshot.updateTime!,
      };
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Retrieve a document by its ID and throw when it does not exist.
   * This method is useful when callers require strict existence guarantees and
   * do not want to branch on nullable results.
   *
   * @param id - Document ID
   * @returns Document with ID
   * @throws {NotFoundError} If no document exists for the provided id
   */
  async getByIdOrThrow(
    id: ID,
    options: { withMetadata: true },
  ): Promise<WithMetadata<FirestoreDocument<T>>>;
  async getByIdOrThrow(id: ID, options?: { withMetadata?: false }): Promise<FirestoreDocument<T>>;
  async getByIdOrThrow(
    id: ID,
    options?: { withMetadata?: boolean },
  ): Promise<FirestoreDocument<T> | WithMetadata<FirestoreDocument<T>>> {
    // Forward `options` — calling the no-argument overload here silently drops the metadata the
    // declared return type promises, with no compile error at either end.
    const doc = await this.getById(id, options as { withMetadata: true });
    if (!doc) {
      throw new NotFoundError(`Document with id ${id} not found`);
    }
    return doc;
  }

  /**
   * Map a `getAll` / `tx.getAll` snapshot array into positional `(doc | null)[]` results.
   *
   * WHAT: for each snapshot, either build a `FirestoreDocument<T>` (overlaying `snapshot.id`) or
   * emit `null` when the document does not exist.
   * WHY: shared by {@link getMany} and {@link getManyInTransaction} so the existence test and
   * `.data()` call count stay in one place. Existence is gated on `snapshot.exists` (never on
   * `data() === undefined`) because an empty field mask yields `{}` for an existing document.
   * `.data()` is called exactly once per snapshot because a `readConverter`'s `fromFirestore` runs
   * lazily on every `.data()` invocation and is not memoized.
   */
  private mapManySnapshots(
    snapshots: FirebaseFirestore.DocumentSnapshot[],
  ): (FirestoreDocument<T> | null)[] {
    return snapshots.map(snapshot =>
      snapshot.exists
        ? asFirestoreDocument<T>({ ...(snapshot.data() as T), id: snapshot.id })
        : null,
    );
  }

  /**
   * Batched multi-document read by id via a single `BatchGetDocuments` RPC (`db.getAll`).
   *
   * Prefer this over `query().whereId('in', ids)` for id lookups:
   * - No 30-value `in` operator cap (callers reading many thousands should still chunk themselves —
   *   chunking trades away the single-snapshot guarantee; there is no library-enforced hard limit).
   * - Results are in **input order** (guaranteed client-side by the Admin SDK's re-sort against the
   *   request array — not by the backend).
   * - Missing documents are marked with `null` in position (`ids[i]` is the missing id), instead of
   *   being silently dropped.
   * - Empty input returns `[]` without contacting Firestore (`db.getAll()` with zero refs throws).
   *
   * Duplicate ids are allowed and return one entry per position (reads are idempotent). Bulk *write*
   * methods still reject duplicates via {@link assertNoDuplicateIds}.
   *
   * Billing: charged per **unique** document read — the SDK dedupes duplicate refs in the outbound
   * request — while the result still carries one entry per requested position.
   *
   * When `fieldMask` is supplied, the result narrows to `FirestoreDocument<DeepPartial<T>>` (mirroring
   * `select()`). The document `id` always survives the projection. `fieldMask: []` is a legal
   * ID-only projection (`{ id }` for each found document).
   *
   * ⚠ With a configured `readConverter`, `fromFirestore` receives the **masked** document. A converter
   * that dereferences a field the mask omitted will throw a raw `TypeError` — this cannot be fixed
   * in the library without knowing which fields the converter touches. Either omit the mask, widen
   * it to cover every field the converter reads, or make the converter defensive.
   *
   * @param ids - Document ids to fetch (order preserved; duplicates allowed)
   * @param options - Optional `{ fieldMask }` projection (paths typed against the stored model `S`)
   * @returns Positional `(FirestoreDocument | null)[]` aligned with `ids`
   * @throws {InvalidDocumentIdError} If any id is not a single valid Firestore path segment
   *   (validated before any I/O)
   *
   * @example
   * // Positional results with a miss interleaved
   * const rows = await userRepo.getMany(['a', 'ghost', 'b']);
   * // rows[0] = doc a, rows[1] = null, rows[2] = doc b
   *
   * @example
   * // Field-mask projection (DeepPartial narrowing)
   * const projected = await userRepo.getMany(['a', 'b'], {
   *   fieldMask: ['name', 'address.city'],
   * });
   */
  async getMany(
    ids: ID[],
    options: { fieldMask: (FieldPaths<OmitId<S>> | FieldPath)[]; withMetadata: true },
  ): Promise<(WithMetadata<FirestoreDocument<DeepPartial<T>>> | null)[]>;
  async getMany(
    ids: ID[],
    options: { fieldMask?: undefined; withMetadata: true },
  ): Promise<(WithMetadata<FirestoreDocument<T>> | null)[]>;
  async getMany(
    ids: ID[],
    options: { fieldMask: (FieldPaths<OmitId<S>> | FieldPath)[]; withMetadata?: false },
  ): Promise<(FirestoreDocument<DeepPartial<T>> | null)[]>;
  async getMany(
    ids: ID[],
    options?: { fieldMask?: undefined; withMetadata?: false },
  ): Promise<(FirestoreDocument<T> | null)[]>;
  async getMany(
    ids: ID[],
    options?: {
      fieldMask?: (FieldPaths<OmitId<S>> | FieldPath)[];
      withMetadata?: boolean;
    },
  ): Promise<
    (
      | FirestoreDocument<T>
      | FirestoreDocument<DeepPartial<T>>
      | WithMetadata<FirestoreDocument<T>>
      | WithMetadata<FirestoreDocument<DeepPartial<T>>>
      | null
    )[]
  > {
    // Validate every id first (matches bulk write helpers). forEach over [] is a no-op, so empty
    // input still short-circuits cleanly below without an SDK round trip.
    ids.forEach(id => this.validateId(id));
    // Mandatory: db.getAll() with zero refs throws a plain Error ("requires at least 1 argument").
    if (ids.length === 0) return [];
    try {
      const refs = ids.map(id => this.readCol().doc(id));
      // The SDK's ReadOptions.fieldMask is `(string | FieldPath)[]`. FieldPaths<OmitId<S>> is a
      // string-literal union that does not widen through the rest-argument position, so the cast
      // is required to satisfy the Admin SDK typings without losing our path-literal checking on
      // the public overloads.
      const snapshots = options?.fieldMask
        ? await this.db.getAll(...refs, { fieldMask: options.fieldMask as (string | FieldPath)[] })
        : await this.db.getAll(...refs);
      return options?.withMetadata
        ? this.mapManySnapshotsWithMetadata(snapshots)
        : this.mapManySnapshots(snapshots);
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Reconstruct the read-typed document from a raw Firestore snapshot.
   *
   * This is for snapshots the repository did not read itself — most commonly the snapshot delivered
   * to a Firestore trigger cloud function (`onDocumentCreated` / `onDocumentUpdated` /
   * `onDocumentDeleted`). Such snapshots are **not** converter-applied (the Admin SDK only runs a
   * converter's `fromFirestore` for refs built via `withConverter`) and carry no `id` in
   * `snapshot.data()`, so a bare `snapshot.data() as T` cast is unsafe. `fromSnapshot` applies this
   * repository's `readConverter` `fromFirestore` when one is configured, then overlays the document `id`
   * from `snapshot.id` — mirroring exactly what a normal repository read returns.
   *
   * Does no Firestore I/O. Returns the read model `T` (not the write model `W`), and `null` when the
   * snapshot does not exist. Validation is not performed here (reads are not validated); to validate
   * at a trust boundary, narrow null then call {@link validate}, e.g.
   * `const doc = repo.fromSnapshot(snap); if (doc) repo.validate(doc);`.
   *
   * @param snapshot - A Firestore `DocumentSnapshot` / `QueryDocumentSnapshot`
   * @returns The document as `FirestoreDocument<T>`, or `null` if the snapshot does not exist
   *
   * @example
   * // firebase-functions v2 trigger
   * export const onUserCreated = onDocumentCreated('users/{userId}', event => {
   *   const user = event.data && userRepo.fromSnapshot(event.data);
   *   if (!user) return;
   *   // `user` is a fully reconstructed User & { id }
   * });
   */
  fromSnapshot(snapshot: FirebaseFirestore.DocumentSnapshot): FirestoreDocument<T> | null {
    if (!snapshot.exists) return null;
    const data = this.readConverter
      ? this.readConverter(snapshot as FirebaseFirestore.QueryDocumentSnapshot)
      : (snapshot.data() as T);
    return asFirestoreDocument<T>({ ...(data as T), id: snapshot.id });
  }

  /**
   * Validate an already-read value against this repository's canonical read schema (`schemas.read`).
   *
   * Reads themselves are compile-time casts; this method is the explicit opt-in trust boundary.
   * Pass the *final* read shape (after `id` overlay and any `readConverter` transform) — e.g. the
   * result of `getByIdOrThrow`, `getAll`, or a non-null `fromSnapshot`. Validation therefore runs
   * against the converted shape, so write the read schema against converted types (e.g. a field a
   * millis converter exposes as a `number` is `z.number()`). Returns the **parsed** value (Zod
   * transforms/coercions apply), not the input; per Zod object parsing, keys not declared in the
   * read schema are stripped from the returned value (as on the write paths).
   *
   * On schema mismatch, catches `ZodError` and rethrows {@link ValidationError} — matching write
   * paths so callers handle one error type. The array overload is all-or-nothing: the first bad
   * element throws (its `ValidationError` carries that element's issues, without an array index).
   * Use {@link safeValidate} when one bad document should not fail the batch.
   *
   * Requires a schema-configured repository (`withSchema` / `subcollection`). Calling without a
   * schema is a programmer error and throws a plain `Error` (not `ValidationError`).
   *
   * @param data - A single read document, or an array of read documents
   * @returns The parsed document(s) as `FirestoreDocument<T>`
   * @throws {ValidationError} If any document fails `schemas.read` validation
   * @throws {Error} If the repository was constructed without a schema
   *
   * @example
   * // Single read at a trust boundary
   * const user = repo.validate(await repo.getByIdOrThrow(id));
   *
   * @example
   * // Trigger snapshot: reconstruct, then validate
   * const mapped = event.data && repo.fromSnapshot(event.data);
   * if (mapped) {
   *   const user = repo.validate(mapped);
   * }
   *
   * @example
   * // List — all-or-nothing
   * const users = repo.validate(await repo.getAll());
   */
  validate(data: FirestoreDocument<T>): FirestoreDocument<T>;
  validate(data: FirestoreDocument<T>[]): FirestoreDocument<T>[];
  validate(
    data: FirestoreDocument<T> | FirestoreDocument<T>[],
  ): FirestoreDocument<T> | FirestoreDocument<T>[] {
    const readSchema = this.requireReadSchemaForValidate('validate');
    if (Array.isArray(data)) {
      // All-or-nothing: parse each element; the first Zod failure becomes ValidationError.
      return data.map(item => this.parseReadValue(readSchema, item));
    }
    return this.parseReadValue(readSchema, data);
  }

  /**
   * Non-throwing variant of {@link validate}: validate an already-read value against `schemas.read`.
   *
   * Never throws on data-shape mismatch. Mirrors Zod's `safeParse`, but normalizes failures to
   * {@link ValidationError} (not a raw `ZodError`). The array form returns **one result per
   * element**, so list callers can drop bad docs instead of losing the whole read:
   *
   * ```ts
   * const ok = repo
   *   .safeValidate(await repo.getAll())
   *   .filter(r => r.success)
   *   .map(r => r.data);
   * ```
   *
   * Still throws a plain `Error` when the repository has no schema configured — that is a
   * programmer/config mistake, distinct from a data-shape failure.
   *
   * @param data - A single read document, or an array of read documents
   * @returns A {@link SafeResult} (or array of them) with parsed data or a `ValidationError`
   * @throws {Error} If the repository was constructed without a schema
   *
   * @example
   * const result = repo.safeValidate(await repo.getByIdOrThrow(id));
   * if (result.success) {
   *   console.log(result.data);
   * } else {
   *   console.error(result.error.issues);
   * }
   */
  safeValidate(data: FirestoreDocument<T>): SafeResult<T>;
  safeValidate(data: FirestoreDocument<T>[]): SafeResult<T>[];
  safeValidate(
    data: FirestoreDocument<T> | FirestoreDocument<T>[],
  ): SafeResult<T> | SafeResult<T>[] {
    const readSchema = this.requireReadSchemaForValidate('safeValidate');
    if (Array.isArray(data)) {
      // Per-item results so one bad document does not nuke the batch.
      return data.map(item => this.safeParseReadValue(readSchema, item));
    }
    return this.safeParseReadValue(readSchema, data);
  }

  /**
   * Resolve `schemas.read` for an explicit validate call, or throw a clear config error.
   * An explicit `validate()` / `safeValidate()` with no schema can only be a mistake — no silent
   * no-op.
   */
  private requireReadSchemaForValidate(method: 'validate' | 'safeValidate'): z.ZodObject<any> {
    const readSchema = this.schemasInternal?.read;
    if (!readSchema) {
      throw new Error(
        `${method}() requires a schema — construct the repository with FirestoreRepository.withSchema()`,
      );
    }
    return readSchema;
  }

  /**
   * Parse a single read value through `schemas.read`, returning the parsed output.
   * Wraps Zod failures as {@link ValidationError} to match write-path error handling.
   */
  private parseReadValue(
    readSchema: z.ZodObject<any>,
    data: FirestoreDocument<T>,
  ): FirestoreDocument<T> {
    try {
      // Separate the repository-owned `id` from the read data BEFORE parsing (review A4). The read
      // schema describes the read model's own fields (no top-level `id`); passing the metadata `id`
      // in would be rejected by a STRICT schema (`z.strictObject` / `.strict()`) as an unrecognized
      // key. Parse only the read data (Zod transforms/coercions apply), then re-attach the id.
      const { id, ...readData } = data as Record<string, unknown> & { id: ID };
      const parsed = readSchema.parse(readData) as Record<string, unknown>;
      return { ...parsed, id } as FirestoreDocument<T>;
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ValidationError(err.issues);
      }
      throw err;
    }
  }

  /**
   * Safe-parse a single read value through `schemas.read`, normalizing failures to ValidationError.
   */
  private safeParseReadValue(
    readSchema: z.ZodObject<any>,
    data: FirestoreDocument<T>,
  ): SafeResult<T> {
    // Separate the repository-owned `id` before parsing (review A4 — strict schemas reject it as an
    // unrecognized key), then re-attach it on success.
    const { id, ...readData } = data as Record<string, unknown> & { id: ID };
    const result = readSchema.safeParse(readData);
    if (result.success) {
      return {
        success: true,
        data: { ...(result.data as Record<string, unknown>), id } as FirestoreDocument<T>,
      };
    }
    return { success: false, error: new ValidationError(result.error.issues) };
  }

  /**
   * Update an existing document with partial data.
   * Supports both regular fields and dot notation for nested updates.
   *
   * @param id - Document ID to update
   * @param data - Partial document data (supports dot notation like 'address.city')
   * @param options - Optional update behavior (`merge`, `returnDoc`, `withMetadata`,
   *   `lastUpdateTime`). `{ withMetadata: true }` resolves to `{ id, writeTime }` (Admin SDK commit
   *   receipt). `returnDoc` and `withMetadata` are mutually exclusive. Not available on
   *   `updateInTransaction`.
   * @returns `{ id }` by default; `FirestoreDocument<T>` when `returnDoc` is true; `{ id, writeTime }`
   *   when `withMetadata` is true
   * @throws {NotFoundError} If document doesn't exist and no `lastUpdateTime` was supplied
   * @throws {PreconditionFailedError} If `lastUpdateTime` no longer matches the stored version
   *   (including when the document has been deleted — Firestore reports that as stored version 0)
   * @throws {ValidationError} If validation fails
   *
   * @example
   * // Regular update
   * await userRepo.update('user-123', {
   *   email: 'newemail@example.com'
   * });
   *
   * @example
   * // Conditional (compare-and-set) update — commits only if nobody wrote in between
   * const current = await userRepo.getByIdWithUpdateTime('user-123');
   * if (current) {
   *   await userRepo.update(
   *     'user-123',
   *     { email: 'newemail@example.com' },
   *     { lastUpdateTime: current.updateTime },
   *   );
   * }
   *
   * @example
   * // Dot notation for nested fields
   * await userRepo.update('user-123', {
   *   'address.city': 'Los Angeles',
   *   'address.zipCode': '90001',
   *   name: 'John Doe'
   * });
   *
   * @example
   * // Deep nesting
   * await repo.update('doc-123', {
   *   'settings.notifications.email': true,
   *   'settings.theme': 'dark'
   * });
   *
   * @example
   * // Merge update while preserving existing fields
   * await userRepo.update(
   *   'user-123',
   *   { 'profile.nickname': 'Johnny' },
   *   { merge: true }
   * );
   */
  async update(
    id: ID,
    data: UpdateInput<W>,
    options: UpdateOptions & { returnDoc: true } & NoWriteMetadataOptions,
  ): Promise<FirestoreDocument<T>>;
  async update(
    id: ID,
    data: UpdateInput<W>,
    options: UpdateOptions & WriteMetadataOptions,
  ): Promise<WriteResultWithMetadata<{ id: ID }>>;
  async update(
    id: ID,
    data: UpdateInput<W>,
    options?: UpdateOptions & { returnDoc?: false } & NoWriteMetadataOptions,
  ): Promise<{ id: ID }>;
  async update(
    id: ID,
    data: UpdateInput<W>,
    options?: UpdateOptions,
  ): Promise<{ id: ID } | FirestoreDocument<T> | WriteResultWithMetadata<{ id: ID }>> {
    // A direct update()/patch() legitimately permits FieldValue.delete() to clear a field.
    return this.runUpdate(id, data, options, false);
  }

  /**
   * Shared implementation for {@link update} and the `upsert` update branch.
   *
   * `rejectDeleteSentinels` is set only by `upsert`: it rejects a delete sentinel in the final parsed
   * update payload (after `beforeUpdate` hooks and schema transforms), so `upsert` behaves the same
   * whether the document exists (this branch) or not (the create branch, which rejects delete via
   * {@link validateCreateData}). A direct `update()` leaves it `false` — delete stays valid there
   * (review T1 / ADR-0019).
   */
  private async runUpdate(
    id: ID,
    data: UpdateInput<W>,
    options: UpdateOptions | undefined,
    rejectDeleteSentinels: boolean,
  ): Promise<{ id: ID } | FirestoreDocument<T> | WriteResultWithMetadata<{ id: ID }>> {
    this.validateId(id);
    this.assertExclusiveWriteResultOptions(options);
    try {
      const docRef = this.writeCol().doc(id);
      // The `id` is non-writable on the before-hook payload (review R2): a hook may mutate data
      // fields but cannot repoint identity or forge the id a later hook observes. The write target is
      // `docRef` (captured from the method arg), never this payload.
      const toUpdate = FirestoreRepository.withReadonlyId(
        { ...(data as Record<string, any>) },
        id,
      ) as UpdateInput<W> & { readonly id: ID };

      await this.runHooks('beforeUpdate', toUpdate);
      // In merge mode, normalize nested objects into field paths BEFORE validating so each leaf is
      // validated independently — a partial nested object (`{ address: { city } }`) does not require
      // its sibling fields, matching the recursively-optional write type.
      const normalizedData =
        options?.merge === true
          ? this.normalizeUpdateDataForMerge(toUpdate as UpdateInput<W>)
          : (toUpdate as UpdateInput<W>);
      const validData = this.validateUpdateData(normalizedData);
      const writePayload = this.sanitizeUpdateData(validData);

      this.assertNonEmptyUpdatePayload(writePayload as Record<string, any>);
      // upsert only: reject a delete in the final parsed update output (e.g. from a transform) so its
      // contract is existence-independent. A direct update()/patch() keeps delete valid.
      if (rejectDeleteSentinels) {
        this.assertNoDeleteSentinel(writePayload as Record<string, any>);
      }
      // T1 branch: never forward an `undefined` precondition positionally — `update()`'s
      // field/value overload would parse it as a field argument and throw. See toPrecondition().
      const precondition = this.toPrecondition(options?.lastUpdateTime);
      const writeResult = precondition
        ? await docRef.update(writePayload as any, precondition)
        : await docRef.update(writePayload as any);
      await this.runHooks('afterUpdate', Object.freeze({ id }));

      // When returnDoc is enabled, we re-read the document after write completion.
      // This guarantees callers receive the persisted document shape from Firestore.
      if (options?.returnDoc === true) {
        return await this.readAfterCommit(() => this.getByIdOrThrow(id));
      }
      if (options?.withMetadata === true) {
        return { id, writeTime: writeResult.writeTime };
      }

      return { id };
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        throw new ValidationError(error.issues);
      }
      throw parseFirestoreError(error);
    }
  }

  /**
   * Convenience alias for merge-style partial updates.
   * Equivalent to update(id, data, { merge: true }).
   *
   * Accepts the same optimistic-concurrency `lastUpdateTime` precondition as {@link update} — the
   * merge normalization happens before the write, so the precondition still guards the exact stored
   * version the caller read. Pass `{ withMetadata: true }` for `{ id, writeTime }`; `returnDoc` and
   * `withMetadata` are mutually exclusive. Not available on `patchInTransaction`.
   *
   * @example
   * const current = await userRepo.getByIdWithUpdateTime('user-123');
   * if (current) {
   *   await userRepo.patch(
   *     'user-123',
   *     { 'profile.nickname': 'Johnny' },
   *     { lastUpdateTime: current.updateTime },
   *   );
   * }
   */
  async patch(
    id: ID,
    data: UpdateInput<W>,
    options: {
      returnDoc: true;
      lastUpdateTime?: FirebaseFirestore.Timestamp;
    } & NoWriteMetadataOptions,
  ): Promise<FirestoreDocument<T>>;
  async patch(
    id: ID,
    data: UpdateInput<W>,
    options: WriteMetadataOptions & { lastUpdateTime?: FirebaseFirestore.Timestamp },
  ): Promise<WriteResultWithMetadata<{ id: ID }>>;
  async patch(
    id: ID,
    data: UpdateInput<W>,
    options?: {
      returnDoc?: false;
      lastUpdateTime?: FirebaseFirestore.Timestamp;
    } & NoWriteMetadataOptions,
  ): Promise<{ id: ID }>;
  async patch(
    id: ID,
    data: UpdateInput<W>,
    options?: {
      returnDoc?: boolean;
      withMetadata?: boolean;
      lastUpdateTime?: FirebaseFirestore.Timestamp;
    },
  ): Promise<{ id: ID } | FirestoreDocument<T> | WriteResultWithMetadata<{ id: ID }>> {
    // Reject the impossible flag pair BEFORE forwarding so returnDoc cannot silently win (F1 / T4).
    this.assertExclusiveWriteResultOptions(options);
    // Forward merge + returnDoc/withMetadata/lastUpdateTime. Passing `undefined` through this
    // ORM-owned options bag is safe (unlike forwarding `undefined` to the SDK — see toPrecondition):
    // runUpdate branches on truthiness before it reaches Firestore.
    if (options?.returnDoc === true) {
      return this.update(id, data, {
        merge: true,
        returnDoc: true,
        lastUpdateTime: options.lastUpdateTime,
      });
    }
    if (options?.withMetadata === true) {
      return this.update(id, data, {
        merge: true,
        withMetadata: true,
        lastUpdateTime: options.lastUpdateTime,
      });
    }
    return this.update(id, data, { merge: true, lastUpdateTime: options?.lastUpdateTime });
  }

  /**
   * Update multiple documents in a single batched operation.
   * Supports dot notation for nested field updates.
   *
   * Each entry may carry its own `lastUpdateTime` precondition. Preconditions are evaluated by the
   * backend at commit time, so at or below 500 operations the batch stays atomic: if any one
   * precondition fails, the whole batch is rejected and **nothing** changes. Above 500 operations the
   * existing chunked-commit caveat applies — earlier chunks are already committed when a later chunk
   * fails.
   *
   * Pass `{ withMetadata: true }` for positional `{ id, writeTime }[]` aligned to the input (and to
   * successfully committed chunk order above 500 ops).
   *
   * @param updates - Array of update operations with ID, data, and an optional `lastUpdateTime`
   * @param options - `{ withMetadata: true }` to include each write's commit `writeTime`
   * @returns Array of updated document IDs, or `{ id, writeTime }[]` when metadata is requested
   * @throws {NotFoundError} If any document doesn't exist
   * @throws {PreconditionFailedError} If any supplied `lastUpdateTime` no longer matches
   * @throws {ValidationError} If any validation fails
   *
   * @example
   * // Regular bulk update
   * await userRepo.bulkUpdate([
   *   { id: 'user-1', data: { status: 'active' } },
   *   { id: 'user-2', data: { status: 'active' } }
   * ]);
   *
   * @example
   * // With dot notation
   * await userRepo.bulkUpdate([
   *   { id: 'user-1', data: { 'profile.verified': true } },
   *   { id: 'user-2', data: { 'settings.theme': 'dark' } }
   * ]);
   *
   * @example
   * // Per-entry preconditions — all-or-nothing at or below 500 operations
   * await userRepo.bulkUpdate([
   *   { id: 'user-1', data: { status: 'active' }, lastUpdateTime: firstToken },
   *   { id: 'user-2', data: { status: 'active' }, lastUpdateTime: secondToken },
   * ]);
   */
  async bulkUpdate(
    updates: {
      id: ID;
      data: UpdateInput<W>;
      lastUpdateTime?: FirebaseFirestore.Timestamp;
    }[],
    options: WriteMetadataOptions,
  ): Promise<WriteResultWithMetadata<{ id: ID }>[]>;
  async bulkUpdate(
    updates: {
      id: ID;
      data: UpdateInput<W>;
      lastUpdateTime?: FirebaseFirestore.Timestamp;
    }[],
    options?: NoWriteMetadataOptions,
  ): Promise<{ id: ID }[]>;
  async bulkUpdate(
    updates: {
      id: ID;
      data: UpdateInput<W>;
      lastUpdateTime?: FirebaseFirestore.Timestamp;
    }[],
    options?: { withMetadata?: boolean },
  ): Promise<{ id: ID }[] | WriteResultWithMetadata<{ id: ID }>[]> {
    return this.runBulkBatchWrite(updates, false, options);
  }

  /**
   * Shared batched-write pipeline for {@link bulkUpdate} (replace) and {@link bulkPatch} (merge).
   * Merge mode normalizes nested objects into field paths BEFORE validating, so each leaf is
   * validated independently (a partial nested object doesn't require its siblings) — exactly the
   * order used by single-document `update`/`patch`, so the bulk and single-document variants stay
   * behaviorally identical.
   */
  private async runBulkBatchWrite(
    updates: { id: ID; data: UpdateInput<W>; lastUpdateTime?: FirebaseFirestore.Timestamp }[],
    merge: boolean,
    options?: { withMetadata?: boolean },
  ): Promise<{ id: ID }[] | WriteResultWithMetadata<{ id: ID }>[]> {
    this.assertNoDuplicateIds(
      updates.map(u => u.id),
      merge ? 'bulkPatch' : 'bulkUpdate',
    );
    updates.forEach(u => this.validateId(u.id));
    // Stable pre-hook work list (review A1): pair each captured id with its update ENTRY object
    // before the hook runs. A beforeBulkUpdate hook may mutate an entry's `data` in place
    // (documented), but reordering, splicing, replacing entries, or changing an `id` cannot redirect
    // a write or desync data from its target — the loop iterates THIS list, taking the id from the
    // captured value and the data from the captured entry.
    const work = updates.map(entry => ({ id: entry.id, entry }));
    // The hook sees a FROZEN view (review R2/S3): the array (membership/order), each entry's `id`,
    // AND each entry wrapper are frozen — so a hook can neither reorder/splice nor REPLACE an entry's
    // `data` object. The referenced `data` object is left mutable (shared with `work`), so a
    // documented in-place `data.field = …` mutation still reaches the write, but `entry.data = {…}`
    // now throws instead of silently being dropped. Built from a shallow copy so the caller's own
    // array/entries are never mutated.
    const hookView = Object.freeze(
      updates.map(entry =>
        Object.freeze(FirestoreRepository.withReadonlyId({ data: entry.data }, entry.id)),
      ),
    );
    try {
      await this.runHooks(
        'beforeBulkUpdate',
        hookView as HookDataFor<'beforeBulkUpdate', T, W, WO>,
      );
      const actions: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];
      const ids: ID[] = [];

      for (const { id, entry } of work) {
        const docRef = this.writeCol().doc(id);
        const normalizedData = merge ? this.normalizeUpdateDataForMerge(entry.data) : entry.data;
        const validData = this.validateUpdateData(normalizedData);
        const writePayload = this.sanitizeUpdateData(validData);

        this.assertNonEmptyUpdatePayload(writePayload as Record<string, any>);
        // T1 branch, per entry: the precondition is read from the CAPTURED entry (never from the
        // frozen hook view, which deliberately carries only `id`/`data`), and the one-argument form
        // is used whenever the caller supplied no token. See toPrecondition().
        const precondition = this.toPrecondition(entry.lastUpdateTime);
        if (precondition) {
          actions.push(batch => batch.update(docRef, writePayload as any, precondition));
        } else {
          actions.push(batch => batch.update(docRef, writePayload as any));
        }
        ids.push(id);
      }

      const writeResults = await this.commitInChunks(actions);
      // Freeze the whole envelope (review R2): the `ids` property cannot be reassigned to a forged
      // array, so a first hook cannot corrupt what a second hook observes.
      await this.runHooks('afterBulkUpdate', Object.freeze({ ids: Object.freeze([...ids]) }));
      if (options?.withMetadata === true) {
        return ids.map((id, index) => ({
          id,
          writeTime: writeResults[index]!.writeTime,
        }));
      }
      return ids.map(id => ({ id }));
    } catch (error: any) {
      if (error instanceof z.ZodError) throw new ValidationError(error.issues);
      throw parseFirestoreError(error);
    }
  }

  /**
   * Convenience alias for merge-style batched updates.
   * This method applies the same normalization behavior as patch():
   * nested objects are flattened to dot-notation updates, explicit dot keys
   * take precedence over flattened keys, and writes execute via batch.update.
   *
   * Each entry may carry its own `lastUpdateTime` precondition, with the same atomicity behavior as
   * {@link bulkUpdate}. Pass `{ withMetadata: true }` for positional `{ id, writeTime }[]` aligned
   * across 500-op chunks.
   *
   * @param updates - Array of update operations with ID, data, and an optional `lastUpdateTime`
   * @param options - `{ withMetadata: true }` to include each write's commit `writeTime`
   * @returns Array of updated document IDs, or `{ id, writeTime }[]` when metadata is requested
   * @throws {NotFoundError} If any document doesn't exist
   * @throws {PreconditionFailedError} If any supplied `lastUpdateTime` no longer matches
   * @throws {ValidationError} If any validation fails
   *
   * @example
   * await userRepo.bulkPatch([
   *   { id: 'user-1', data: { profile: { settings: { theme: 'dark' } } } as any },
   *   { id: 'user-2', data: { 'profile.settings.notifications': true } as any },
   * ]);
   */
  async bulkPatch(
    updates: {
      id: ID;
      data: UpdateInput<W>;
      lastUpdateTime?: FirebaseFirestore.Timestamp;
    }[],
    options: WriteMetadataOptions,
  ): Promise<WriteResultWithMetadata<{ id: ID }>[]>;
  async bulkPatch(
    updates: {
      id: ID;
      data: UpdateInput<W>;
      lastUpdateTime?: FirebaseFirestore.Timestamp;
    }[],
    options?: NoWriteMetadataOptions,
  ): Promise<{ id: ID }[]>;
  async bulkPatch(
    updates: {
      id: ID;
      data: UpdateInput<W>;
      lastUpdateTime?: FirebaseFirestore.Timestamp;
    }[],
    options?: { withMetadata?: boolean },
  ): Promise<{ id: ID }[] | WriteResultWithMetadata<{ id: ID }>[]> {
    // Validate raw input first, then normalize — the same order as single-document patch(). This
    // keeps patch() and bulkPatch() consistent (a nested object is validated as a whole object, an
    // explicit dot-notation key is validated at its leaf) rather than validating a pre-flattened
    // payload.
    return this.runBulkBatchWrite(updates, true, options);
  }

  /**
   * Create a new document if it doesn't exist, or update it if it does.
   * Uses the provided ID instead of auto-generating one.
   *
   * Pass `{ returnDoc: true }` for the converted read model, or `{ withMetadata: true }` for
   * `{ id, writeTime }` on either the create or update branch. The two flags are mutually exclusive.
   * Not available inside a transaction helper.
   *
   * @param id - Document ID to upsert
   * @param data - Full document data
   * @param options - `{ returnDoc: true }` or `{ withMetadata: true }`
   * @returns `{ id }` by default; `FirestoreDocument<T>` when `returnDoc` is true; `{ id, writeTime }`
   *   when `withMetadata` is true
   * @throws {ValidationError} If validation fails
   *
   * @example
   * // Sync external data
   * await userRepo.upsert('external-id-123', {
   *   name: 'John Doe',
   *   email: 'john@example.com',
   *   source: 'external-api'
   * });
   *
   * @example
   * // Idempotent operations
   * await settingsRepo.upsert('app-config', {
   *   theme: 'dark',
   *   notifications: true
   * });
   */
  async upsert(
    id: ID,
    data: CreateInput<W>,
    options: { returnDoc: true } & NoWriteMetadataOptions,
  ): Promise<FirestoreDocument<T>>;
  async upsert(
    id: ID,
    data: CreateInput<W>,
    options: WriteMetadataOptions,
  ): Promise<WriteResultWithMetadata<{ id: ID }>>;
  async upsert(
    id: ID,
    data: CreateInput<W>,
    options?: { returnDoc?: false } & NoWriteMetadataOptions,
  ): Promise<{ id: ID }>;
  async upsert(
    id: ID,
    data: CreateInput<W>,
    options?: { returnDoc?: boolean; withMetadata?: boolean },
  ): Promise<{ id: ID } | FirestoreDocument<T> | WriteResultWithMetadata<{ id: ID }>> {
    this.validateId(id);
    this.assertExclusiveWriteResultOptions(options);
    try {
      // upsert would behave inconsistently with dot-notation keys — the create path (new doc) writes
      // a literal dot-in-name field, while the update path (existing doc) merges the field path. The
      // type already forbids dotted keys on `CreateInput`; reject the `as any` bypass up front so the
      // contract is uniform regardless of whether the document exists.
      if (hasDotNotationKeys(data as Record<string, any>)) {
        throw new Error(
          'Dot-notation keys are not supported on upsert() (Firestore treats them as literal field ' +
            'names on create). Use a nested object, or update() for field-path merges.',
        );
      }
      // Fast path: reject a delete sentinel present directly in the raw input up front, before the
      // existence read. A delete introduced later by a schema transform is caught per-branch below
      // (create → validateCreateData scans the parsed output; update → runUpdate with rejection on),
      // so upsert rejects a delete-producing input whether or not the document exists — the
      // existence-independent contract (review T1 / ADR-0019). Clear a field with update()/patch().
      this.assertNoDeleteSentinel(data as Record<string, any>);
      const existing = await this.getById(id);
      const shouldReturnDoc = options?.returnDoc === true;
      const shouldReturnMetadata = options?.withMetadata === true;
      if (existing) {
        // Update branch with delete-rejection ON, so a transform-introduced delete is rejected here
        // exactly as it would be on the create branch (existence-independent determinism).
        // Forward withMetadata so both branches honor the same opt-in receipt contract.
        return await this.runUpdate(
          id,
          data as unknown as UpdateInput<W>,
          {
            returnDoc: shouldReturnDoc,
            withMetadata: shouldReturnMetadata,
          },
          true,
        );
      }

      // The `id` is non-writable on the before-hook payload (review R2): a hook may mutate data but
      // cannot repoint identity. The write target is `writeCol().doc(id)`, captured from the arg.
      const docToCreate = FirestoreRepository.withReadonlyId(
        { ...(data as Record<string, any>) },
        id,
      );
      await this.runHooks('beforeCreate', docToCreate as HookDataFor<'beforeCreate', T, W, WO>);
      const validData = this.validateCreateData(docToCreate as CreateInput<W>);

      const docRef = this.writeCol().doc(id);
      const writeResult = await docRef.set(validData as any);

      // After-create hooks observe the parsed output + id in a frozen envelope (review R4/R2).
      await this.emitAfterCreate(validData, id);
      if (shouldReturnDoc) {
        return await this.readAfterCommit(() => this.getByIdOrThrow(id));
      }
      if (shouldReturnMetadata) {
        return { id, writeTime: writeResult.writeTime };
      }
      return { id };
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        throw new ValidationError(error.issues);
      }
      throw parseFirestoreError(error);
    }
  }

  /**
   * Permanently delete a document from Firestore.
   * This is a hard delete - the document cannot be recovered.
   *
   * Optionally guarded by a `lastUpdateTime` precondition, so a document that changed since the
   * caller read it is not deleted out from under the newer writer.
   *
   * Note the interaction with this method's own existence pre-read: `delete(id, { lastUpdateTime })`
   * on an **already-missing** document raises {@link NotFoundError} (the pre-read throws first), not
   * `PreconditionFailedError`. Only a document that exists but has moved on reaches the backend
   * precondition. The pre-read is unconditional and unchanged — `delete(id)` without a precondition
   * behaves exactly as before, and this method never auto-preconditions on its own snapshot (that
   * would turn today's benign races into errors).
   *
   * @param id - Document ID to delete
   * @param options - `{ lastUpdateTime }` to delete only if the document is still at that version;
   *   `{ withMetadata: true }` to resolve to `{ writeTime }` instead of `void`. Not available on
   *   `deleteInTransaction`.
   * @returns `void` by default, or {@link WriteMetadata} when `withMetadata` is true
   * @throws {NotFoundError} If document doesn't exist
   * @throws {PreconditionFailedError} If `lastUpdateTime` no longer matches the stored version
   *
   * @example
   * // Delete a user permanently
   * await userRepo.delete('user-123');
   *
   * @example
   * // Delete with error handling
   * try {
   *   await userRepo.delete('user-123');
   *   console.log('User deleted successfully');
   * } catch (error) {
   *   if (error instanceof NotFoundError) {
   *     console.log('User not found');
   *   }
   * }
   *
   * @example
   * // Conditional delete — only if the document has not changed since it was read
   * const current = await userRepo.getByIdWithUpdateTime('user-123');
   * if (current) {
   *   await userRepo.delete('user-123', { lastUpdateTime: current.updateTime });
   * }
   *
   * @example
   * // Opt-in commit receipt
   * const { writeTime } = await userRepo.delete('user-123', { withMetadata: true });
   */
  async delete(
    id: ID,
    options: { withMetadata: true; lastUpdateTime?: FirebaseFirestore.Timestamp },
  ): Promise<WriteMetadata>;
  async delete(
    id: ID,
    options?: { withMetadata?: false; lastUpdateTime?: FirebaseFirestore.Timestamp },
  ): Promise<void>;
  async delete(
    id: ID,
    options?: { lastUpdateTime?: FirebaseFirestore.Timestamp; withMetadata?: boolean },
  ): Promise<void | WriteMetadata> {
    this.validateId(id);
    try {
      const docRef = this.readCol().doc(id);
      const snapshot = await docRef.get();

      if (!snapshot.exists) throw new NotFoundError(`Document with id ${id} not found`);

      // Deep-freeze the delete envelope (review R2) so neither hook can forge the id OR nested data
      // the other (or an audit log) observes; after-delete gets a SEPARATE top-level object over the
      // same deeply-frozen data. Delete payloads are observe-only (no data-mutation contract).
      const docData = deepFreeze({ ...(snapshot.data() as T), id: snapshot.id });
      await this.runHooks(
        'beforeDelete',
        asFirestoreDocument<T>(docData) as HookDataFor<'beforeDelete', T, W, WO>,
      );
      // T1 branch: `delete(undefined)` happens to be tolerated by the SDK, but every write site
      // branches identically so there is one rule to remember. See toPrecondition().
      const precondition = this.toPrecondition(options?.lastUpdateTime);
      const writeResult = precondition ? await docRef.delete(precondition) : await docRef.delete();
      await this.runHooks(
        'afterDelete',
        asFirestoreDocument<T>(deepFreeze({ ...docData })) as HookDataFor<'afterDelete', T, W, WO>,
      );
      if (options?.withMetadata === true) {
        return { writeTime: writeResult.writeTime };
      }
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Permanently delete multiple documents in a batched operation.
   * This is a hard delete - documents cannot be recovered.
   *
   * Accepts either a plain array of ids or an array of `{ id, lastUpdateTime? }` entries, so
   * individual deletes can be guarded by an optimistic-concurrency precondition. The two forms are
   * separate overloads and cannot be mixed in one array.
   *
   * Preconditions do not change the "already gone → not counted" behavior: the existence pre-read
   * still filters missing documents out **before** the batch is built, so an entry whose document has
   * already been deleted is skipped rather than raising `PreconditionFailedError`. An empty input (or
   * an input where nothing exists) returns `0` without a commit.
   *
   * The existence pre-read is a single `db.getAll` (`BatchGetDocuments`) — one point-in-time-consistent
   * snapshot that the delete hooks observe — not N parallel `get()`s (which can span distinct
   * `readTime`s). An empty-id guard runs before `getAll` because the SDK rejects a zero-ref call.
   *
   * @param entries - Array of document IDs, or of `{ id, lastUpdateTime? }` entries
   * @param options - `{ withMetadata: true }` to resolve to `{ count, writeTimes }` for surviving
   *   documents only (missing requested ids contribute neither a count nor a fabricated receipt)
   * @returns Number of documents actually deleted, or `{ count, writeTimes }` when metadata is
   *   requested (`writeTimes.length === count`, aligned to surviving snapshot order)
   * @throws {PreconditionFailedError} If a supplied `lastUpdateTime` no longer matches (at or below
   *   500 operations the batch is atomic, so nothing is deleted)
   *
   * @example
   * // Delete multiple users
   * const deletedCount = await userRepo.bulkDelete([
   *   'user-1',
   *   'user-2',
   *   'user-3'
   * ]);
   * console.log(`Deleted ${deletedCount} users`);
   *
   * @example
   * // Clean up test data
   * const testUserIds = await userRepo.query()
   *   .where('email', 'array-contains', '@test.com')
   *   .get()
   *   .then(users => users.map(u => u.id));
   * await userRepo.bulkDelete(testUserIds);
   *
   * @example
   * // Conditional bulk delete — each entry guarded by the version it was read at
   * await userRepo.bulkDelete([
   *   { id: 'user-1', lastUpdateTime: firstToken },
   *   { id: 'user-2' }, // unguarded entries may be mixed in as objects
   * ]);
   *
   * @example
   * // Opt-in receipts for surviving deletes only
   * const { count, writeTimes } = await userRepo.bulkDelete(ids, { withMetadata: true });
   */
  async bulkDelete(
    ids: ID[],
    options: WriteMetadataOptions,
  ): Promise<{ count: number; writeTimes: FirebaseFirestore.Timestamp[] }>;
  async bulkDelete(ids: ID[], options?: NoWriteMetadataOptions): Promise<number>;
  async bulkDelete(
    entries: { id: ID; lastUpdateTime?: FirebaseFirestore.Timestamp }[],
    options: WriteMetadataOptions,
  ): Promise<{ count: number; writeTimes: FirebaseFirestore.Timestamp[] }>;
  async bulkDelete(
    entries: { id: ID; lastUpdateTime?: FirebaseFirestore.Timestamp }[],
    options?: NoWriteMetadataOptions,
  ): Promise<number>;
  async bulkDelete(
    entries: ID[] | { id: ID; lastUpdateTime?: FirebaseFirestore.Timestamp }[],
    options?: { withMetadata?: boolean },
  ): Promise<number | { count: number; writeTimes: FirebaseFirestore.Timestamp[] }> {
    // Normalize the two overloads to one internal shape. The overloads keep a mixed
    // `['a', { id: 'b' }]` array from type-checking; this cast is the implementation-signature
    // widening TypeScript requires to iterate the union.
    const normalized = (
      entries as (ID | { id: ID; lastUpdateTime?: FirebaseFirestore.Timestamp })[]
    ).map(entry => (typeof entry === 'string' ? { id: entry } : entry));
    const ids = normalized.map(entry => entry.id);
    ids.forEach(id => this.validateId(id));
    this.assertNoDuplicateIds(ids, 'bulkDelete');
    // Preconditions are keyed by id because the write targets are derived from the surviving
    // SNAPSHOTS (missing documents are filtered out below), not from the caller's array positions.
    const preconditionById = new Map<ID, FirebaseFirestore.Timestamp | undefined>(
      normalized.map(entry => [entry.id, entry.lastUpdateTime]),
    );
    const withMetadata = options?.withMetadata === true;
    try {
      // One BatchGetDocuments instead of N parallel get()s so the pre-read the delete hooks
      // observe is a single consistent snapshot (measured: 14 distinct readTimes → 1 for 300 ids).
      // The empty-input guard is required because db.getAll() with zero refs throws.
      if (ids.length === 0) {
        return withMetadata ? { count: 0, writeTimes: [] } : 0;
      }
      const snapshots = await this.db.getAll(...ids.map(id => this.readCol().doc(id)));
      const existing = snapshots.filter(snapshot => snapshot.exists);

      if (existing.length === 0) {
        // No surviving docs → no invented receipts for missing requested ids (T3).
        return withMetadata ? { count: 0, writeTimes: [] } : 0;
      }

      // Capture the delete targets and ids from the resolved snapshots BEFORE running the hook
      // (review A1/B2): a `beforeBulkDelete` hook must not be able to redirect a delete, change
      // membership, or corrupt the count. The write refs come from `targetRefs`; the event arrays are
      // FROZEN (and each document is frozen) so a hook cannot splice/reorder/repoint them, and the
      // returned count comes from a captured number. Before- and after-hooks get separate (frozen)
      // event objects so the after-event is never a hook-observed before-event.
      const targetRefs = existing.map(snapshot => this.writeCol().doc(snapshot.id));
      const capturedIds = Object.freeze(existing.map(snapshot => snapshot.id));
      // deepFreeze (not shallow) so a beforeBulkDelete hook cannot mutate NESTED document data that a
      // later afterBulkDelete hook observes (review R2). Delete documents are observe-only.
      const docsData = Object.freeze(
        existing.map(snapshot =>
          asFirestoreDocument<T>(deepFreeze({ ...(snapshot.data() as T), id: snapshot.id })),
        ),
      ) as readonly FirestoreDocument<T>[];
      const deletedCount = capturedIds.length;

      await this.runHooks(
        'beforeBulkDelete',
        Object.freeze({ ids: capturedIds, documents: docsData }),
      );

      // T1 branch, per target: the one-argument form is used whenever the entry carried no token.
      const actions = targetRefs.map(ref => {
        const precondition = this.toPrecondition(preconditionById.get(ref.id));
        return (batch: FirebaseFirestore.WriteBatch) => {
          if (precondition) {
            batch.delete(ref, precondition);
          } else {
            batch.delete(ref);
          }
        };
      });

      // Pair receipts to surviving targetRefs / capturedIds — never to the original input (T3).
      const writeResults = await this.commitInChunks(actions);
      await this.runHooks(
        'afterBulkDelete',
        Object.freeze({ ids: capturedIds, documents: docsData }),
      );
      if (withMetadata) {
        return {
          count: deletedCount,
          writeTimes: writeResults.map(result => result.writeTime),
        };
      }
      return deletedCount;
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Bulk hook events a fixed-batch helper would have run. {@link bulkWrite} runs none of them, so it
   * refuses to start when any is registered unless the caller passes `{ skipHooks: true }`.
   */
  private static readonly BULK_HOOK_EVENTS: readonly HookEvent[] = [
    'beforeBulkCreate',
    'afterBulkCreate',
    'beforeBulkUpdate',
    'afterBulkUpdate',
    'beforeBulkDelete',
    'afterBulkDelete',
  ];

  /**
   * Refuses a {@link bulkWrite} on a repository whose bulk hooks would silently not fire.
   *
   * A hook bypass is exactly the failure the scope docs warn about for raw batches: audit trails and
   * cache invalidation stop running with no error and no log. The fixed-batch helpers cannot be
   * reused here — `afterBulkUpdate({ ids })` promises an all-or-nothing set, and BulkWriter is
   * per-item — so the honest options are "no hooks, loudly" or "no hooks, silently". This is the loud
   * one.
   */
  private assertNoBulkHooksRegistered(): void {
    const registered = FirestoreRepository.BULK_HOOK_EVENTS.filter(
      event => (this.hooks[event]?.length ?? 0) > 0,
    );
    if (registered.length === 0) return;
    throw new Error(
      `bulkWrite() runs no lifecycle hooks, but this repository has ${registered.join(', ')} ` +
        'registered. Use bulkCreate/bulkCreateWithIds/bulkUpdate/bulkPatch/bulkDelete (fixed 500-op ' +
        'batches, hooks run), or pass { skipHooks: true } to acknowledge that these hooks will not ' +
        'fire for this call.',
    );
  }

  /**
   * Normalizes a per-item failure the same way every other write path normalizes a whole-call one: a
   * raw `ZodError` becomes {@link ValidationError}, everything else goes through
   * {@link parseFirestoreError}.
   */
  private toBulkWriteItemError(error: unknown): Error {
    if (error instanceof z.ZodError) return new ValidationError(error.issues);
    return parseFirestoreError(error);
  }

  /**
   * High-throughput, **non-atomic** writes backed by the Admin SDK's `BulkWriter`, with a result per
   * operation.
   *
   * This is a *separate contract* from the fixed-batch helpers
   * (`bulkCreate`/`bulkCreateWithIds`/`bulkUpdate`/`bulkPatch`/`bulkDelete`), not a faster version of
   * them. Pick deliberately:
   *
   * | | Fixed batch (`bulk*`) | `bulkWrite` |
   * | --- | --- | --- |
   * | Atomicity | atomic at or below 500 ops | **never** — each op succeeds or fails alone |
   * | Failure | first failure throws; nothing after it is applied | per-item result; siblings still land |
   * | Hooks | run | **none** (throws if any bulk hook is registered — see `skipHooks`) |
   * | Retries | none | SDK default: transient statuses, up to 10 attempts per op |
   * | Throughput | 500-op sequential commits | parallel, rate-limit ramped |
   * | Duplicate ids | rejected | rejected (see below) |
   *
   * Duplicate ids are rejected here for a **stronger** reason than on the fixed-batch helpers. The
   * SDK puts two writes to one document in separate batches, but those batches are dispatched
   * concurrently and their commits race — `BulkWriter`'s internal ordering chain is global, not
   * per-document — so which of the two lands last is genuinely undefined. Sequence such writes with
   * separate `bulkWrite` calls (or a transaction) instead.
   *
   * Results are **positional**: `results[i]` describes `operations[i]`. Because a failure is a
   * normal, expected outcome, nothing here throws for a bad *item* — a malformed id, a schema
   * rejection, an empty update payload, or a backend refusal all land as that item's
   * `{ ok: false, error }` while every other operation still writes. Only whole-call problems throw
   * (registered hooks without `skipHooks`).
   *
   * Validation is unchanged per verb: `create` / `set` validate as a full create (dot-notation keys
   * and `FieldValue.delete()` rejected, ADR-0019), `update` / `patch` as a partial update, and
   * `patch` normalizes nested objects into field paths first — exactly as
   * {@link bulkPatch} does.
   *
   * @param operations - Operations to apply, in enqueue order
   * @param options - `{ skipHooks }` to acknowledge the no-hooks contract, `{ throttling }` to
   *   override the SDK's rate-limit ramp
   * @returns One {@link BulkWriteResult} per input operation, in input order
   * @throws {Error} If a bulk hook is registered and `skipHooks` is not `true`, or if two operations
   *   target the same explicit id
   *
   * @example
   * // Mixed operations in one high-throughput pass
   * const results = await userRepo.bulkWrite([
   *   { op: 'create', data: { name: 'Ada' } },
   *   { op: 'update', id: 'user-1', data: { status: 'active' } },
   *   { op: 'delete', id: 'user-2' },
   * ]);
   *
   * @example
   * // A 10k-row import where one bad row must not cost the other 9,999
   * const results = await userRepo.bulkWrite(rows.map(data => ({ op: 'create', data })));
   * const failed = results.filter(result => !result.ok);
   * console.log(`${results.length - failed.length} written, ${failed.length} rejected`);
   * for (const failure of failed) console.error(failure.index, failure.error.message);
   *
   * @example
   * // Cap the write rate, and acknowledge that hooks will not fire
   * await userRepo.bulkWrite(operations, {
   *   skipHooks: true,
   *   throttling: { maxOpsPerSecond: 200 },
   * });
   */
  async bulkWrite(
    operations: BulkWriteOperation<W>[],
    options?: BulkWriteOptions,
  ): Promise<BulkWriteResult[]> {
    if (options?.skipHooks !== true) this.assertNoBulkHooksRegistered();
    // Whole-call input misuse, checked before any I/O: two writes to one document commit in an
    // undefined order here (the SDK's ordering chain is global, not per-document), so an ambiguous
    // call is refused rather than resolved by a coin flip. Generated `create` ids cannot collide and
    // are excluded.
    this.assertNoDuplicateIds(
      operations.flatMap(operation => (operation.id === undefined ? [] : [operation.id])),
      'bulkWrite',
    );
    // Short-circuit before `db.bulkWriter()` so an empty call allocates nothing (and cannot leave an
    // unclosed writer behind, which would block `db.terminate()` forever).
    if (operations.length === 0) return [];

    const writeCol = this.writeCol();
    const writer =
      options?.throttling === undefined
        ? this.db.bulkWriter()
        : this.db.bulkWriter({ throttling: options.throttling });

    const results = new Array<BulkWriteResult>(operations.length);
    // Every settlement is a `.then(onOk, onErr)` chain that always fulfills, so no per-op rejection
    // ever escapes unhandled (the SDK's raw per-op promise DOES reject, and an unobserved one takes
    // the process down under Node's default `--unhandled-rejections=throw`).
    const settlements: Promise<void>[] = [];

    const fail = (index: number, id: ID, op: BulkWriteOperationKind, error: unknown): void => {
      results[index] = { index, id, op, ok: false, error: this.toBulkWriteItemError(error) };
    };

    const enqueue = (
      index: number,
      id: ID,
      op: BulkWriteOperationKind,
      run: () => Promise<FirebaseFirestore.WriteResult>,
    ): void => {
      let pending: Promise<FirebaseFirestore.WriteResult>;
      try {
        // `writer.create/set/update` throw SYNCHRONOUSLY on data the SDK cannot serialize (and on a
        // closed writer), so the call itself has to be guarded, not just its promise.
        pending = run();
      } catch (error) {
        fail(index, id, op, error);
        return;
      }
      settlements.push(
        pending.then(
          writeResult => {
            results[index] = { index, id, op, ok: true, writeTime: writeResult.writeTime };
          },
          (error: unknown) => {
            const failedAttempts = (error as { failedAttempts?: unknown })?.failedAttempts;
            results[index] = {
              index,
              id,
              op,
              ok: false,
              error: this.toBulkWriteItemError(error),
              ...(typeof failedAttempts === 'number' ? { failedAttempts } : {}),
            };
          },
        ),
      );
    };

    try {
      operations.forEach((operation, index) => {
        // Resolve the id first: it is the one field a failure result still needs, and `validateId`
        // must run before any ref is built (a slash-bearing id would address another collection).
        // Across the union `operation.id` is `ID | undefined` — only `create` can leave it out.
        const rawId: ID | undefined = operation.id;
        let id: ID;
        try {
          id = rawId === undefined ? writeCol.doc().id : this.validateId(rawId);
        } catch (error) {
          fail(index, typeof rawId === 'string' ? rawId : '', operation.op, error);
          return;
        }

        const docRef = writeCol.doc(id);

        try {
          switch (operation.op) {
            case 'create': {
              const validData = this.validateCreateData(operation.data);
              enqueue(index, id, 'create', () => writer.create(docRef, validData as any));
              return;
            }
            case 'set': {
              const validData = this.validateCreateData(operation.data);
              enqueue(index, id, 'set', () => writer.set(docRef, validData as any));
              return;
            }
            case 'update':
            case 'patch': {
              // `patch` normalizes nested objects into field paths BEFORE validating, so each leaf is
              // validated independently — the same order as `patch()` / `bulkPatch()`.
              const normalized =
                operation.op === 'patch'
                  ? this.normalizeUpdateDataForMerge(operation.data)
                  : operation.data;
              const validData = this.validateUpdateData(normalized);
              const writePayload = this.sanitizeUpdateData(validData);
              this.assertNonEmptyUpdatePayload(writePayload as Record<string, any>);
              const precondition = this.toPrecondition(operation.lastUpdateTime);
              enqueue(index, id, operation.op, () =>
                precondition
                  ? writer.update(docRef, writePayload as any, precondition)
                  : writer.update(docRef, writePayload as any),
              );
              return;
            }
            case 'delete': {
              const precondition = this.toPrecondition(operation.lastUpdateTime);
              enqueue(index, id, 'delete', () =>
                precondition ? writer.delete(docRef, precondition) : writer.delete(docRef),
              );
              return;
            }
            default: {
              // Typed callers cannot reach this arm — the union is exhaustive — but a JavaScript
              // caller (or a TypeScript `as any` bypass) can still pass a typo'd verb. Without a
              // default, that index stays an unassigned hole in `results`, and the documented
              // `results.filter(r => !r.ok)` idiom silently under-reports it as a success.
              const unknownOp = (operation as { op: unknown }).op;
              fail(
                index,
                id,
                // Preserve whatever string arrived so the caller can still inspect `result.op`.
                (operation as { op: BulkWriteOperationKind }).op,
                new Error(
                  `bulkWrite() received an unknown operation "${String(unknownOp)}" at index ${index}.`,
                ),
              );
              return;
            }
          }
        } catch (error) {
          fail(index, id, operation.op, error);
        }
      });
    } finally {
      // ALWAYS close, on every path: a per-op promise stays pending until flush/close (below 20
      // enqueued ops nothing is even scheduled), and an unclosed BulkWriter makes `db.terminate()`
      // reject forever. `close()` itself never rejects and is safe to call twice.
      await writer.close().catch(() => {});
    }

    await Promise.all(settlements);
    return results;
  }

  /**
   * **Destructive.** Permanently deletes the document at `id` **and every descendant** — all
   * subcollections, at any depth — via the Admin SDK's `Firestore.recursiveDelete()`.
   *
   * Separate from {@link delete} on purpose. `delete(id)` removes one document and *orphans* its
   * subcollections (they survive, unreachable through the parent); this removes the whole subtree and
   * cannot be undone. Nothing outside the subtree is touched: siblings survive, and so does a
   * collection whose id merely shares a prefix with one being deleted.
   *
   * Three contract differences from every other write on this class:
   *
   * 1. **No lifecycle hooks run** — not `beforeDelete`/`afterDelete` for the target, and nothing for
   *    the descendants. The SDK streams name-only snapshots (`select(__name__)`), so there is no
   *    document data to hand a hook, and descendants live in collections this repository does not
   *    model. If your delete hooks are load-bearing, read + delete through concrete repositories
   *    instead.
   * 2. **No count is returned.** The SDK reports none, and one cannot be synthesized honestly: a
   *    delete of an already-absent document *succeeds*, so any tally would count delete operations
   *    rather than documents that existed.
   * 3. **Partial failure is possible and is reported as a whole-call error.** Deletes are issued in
   *    parallel with no atomicity across the subtree, so a rejection means "some deletes failed" —
   *    the SDK's error states how many, and carries the *last* failure's status code. Documents
   *    already deleted stay deleted; re-running is safe and idempotent.
   *
   * A missing document is **not** an error: there is simply nothing to delete, and the call resolves.
   *
   * @param id - Id of the document whose subtree is deleted
   * @throws {InvalidDocumentIdError} If `id` is not a single valid path segment
   * @throws {Error} If any delete in the subtree failed (message states the count; status code is the
   *   last failure's)
   *
   * @example
   * // Delete a user and everything beneath them (posts, posts' comments, …)
   * await userRepo.recursiveDelete('user-123');
   *
   * @example
   * // Works from a subcollection repository too — the subtree is scoped to that document
   * const postRepo = userRepo.subcollection('user-123', 'posts', postSchema);
   * await postRepo.recursiveDelete('post-1'); // deletes post-1 and its comments
   */
  async recursiveDelete(id: ID): Promise<void> {
    this.validateId(id);
    try {
      // Deliberately NOT passing our own BulkWriter: `recursiveDelete` only ever `flush()`es a
      // supplied writer (never closes it), and an unclosed writer blocks `db.terminate()`. The SDK's
      // own lazily-created writer is closed by `terminate()`, so letting it own the lifecycle is the
      // option with no leak to manage. We return `void`, so there is no count to collect either.
      await this.db.recursiveDelete(this.writeCol().doc(id));
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Find documents by a specific field value.
   * Simple equality search on a single field.
   *
   * @param field - The field name to search on
   * @param value - The value to match
   * @returns Array of matching documents
   *
   * @example
   * // Find users by email
   * const users = await userRepo.findByField('email', 'john@example.com');
   *
   * @example
   * // Find orders by status
   * const pendingOrders = await orderRepo.findByField('status', 'pending');
   */
  async findByField(
    field: FieldPaths<OmitId<S>> | FieldPath,
    value: unknown,
    options: { withMetadata: true },
  ): Promise<WithMetadata<FirestoreDocument<T>>[]>;
  async findByField(
    field: FieldPaths<OmitId<S>> | FieldPath,
    value: unknown,
    options?: { withMetadata?: false },
  ): Promise<FirestoreDocument<T>[]>;
  async findByField(
    field: FieldPaths<OmitId<S>> | FieldPath,
    value: unknown,
    options?: { withMetadata?: boolean },
  ): Promise<FirestoreDocument<T>[] | WithMetadata<FirestoreDocument<T>>[]> {
    try {
      const snapshot = await this.readCol()
        .where(field as string | FieldPath, '==', value)
        .get();
      return options?.withMetadata
        ? snapshot.docs.map(doc => ({
            doc: asFirestoreDocument<T>({ ...(doc.data() as T), id: doc.id }),
            metadata: buildDocumentMetadata(doc),
          }))
        : snapshot.docs.map(doc => asFirestoreDocument<T>({ ...(doc.data() as T), id: doc.id }));
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Find the first document that matches a specific field value.
   * This is a convenience helper when callers expect zero-or-one match semantics
   * and do not need the full array that `findByField(...)` returns.
   *
   * Behavior intentionally mirrors the legacy `getBy` pattern:
   * - returns the first matching document when one or more documents match
   * - returns `null` when no documents match
   *
   * @param field - The field name to search on
   * @param value - The value to match
   * @returns The first matching document or null when no match exists
   *
   * @example
   * // Find a user by email
   * const user = await userRepo.getOneByField('email', 'john@example.com');
   *
   * @example
   * // Return null when no matching document exists
   * const missing = await orderRepo.getOneByField('externalId', 'missing-id');
   * if (!missing) {
   *   console.log('No order found');
   * }
   */
  async getOneByField(
    field: FieldPaths<OmitId<S>> | FieldPath,
    value: unknown,
    options: { withMetadata: true },
  ): Promise<WithMetadata<FirestoreDocument<T>> | null>;
  async getOneByField(
    field: FieldPaths<OmitId<S>> | FieldPath,
    value: unknown,
    options?: { withMetadata?: false },
  ): Promise<FirestoreDocument<T> | null>;
  async getOneByField(
    field: FieldPaths<OmitId<S>> | FieldPath,
    value: unknown,
    options?: { withMetadata?: boolean },
  ): Promise<FirestoreDocument<T> | WithMetadata<FirestoreDocument<T>> | null> {
    try {
      // We add `limit(1)` so Firestore only returns one document even if multiple matches exist.
      // This keeps reads/costs low and makes the method intentionally "first-match" oriented.
      const snapshot = await this.readCol()
        .where(field as string | FieldPath, '==', value)
        .limit(1)
        .get();

      // Returning null for "not found" keeps this method aligned with getBy-style nullable semantics.
      if (snapshot.empty) return null;

      // The query is limited to one document, so index 0 is always the first and only match here.
      const doc = snapshot.docs[0];
      return this.toDocumentResult(doc, options?.withMetadata);
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Find exactly one document by field value and throw when strict constraints are not met.
   * This helper enforces both existence and uniqueness semantics for workflows that expect
   * one and only one matching document.
   *
   * @param field - The field name to search on
   * @param value - The value to match
   * @returns The matching document
   * @throws {NotFoundError} If no document matches the provided field/value
   * @throws {ConflictError} If more than one document matches the provided field/value
   */
  async getOneByFieldOrThrow(
    field: FieldPaths<OmitId<S>> | FieldPath,
    value: unknown,
    options: { withMetadata: true },
  ): Promise<WithMetadata<FirestoreDocument<T>>>;
  async getOneByFieldOrThrow(
    field: FieldPaths<OmitId<S>> | FieldPath,
    value: unknown,
    options?: { withMetadata?: false },
  ): Promise<FirestoreDocument<T>>;
  async getOneByFieldOrThrow(
    field: FieldPaths<OmitId<S>> | FieldPath,
    value: unknown,
    options?: { withMetadata?: boolean },
  ): Promise<FirestoreDocument<T> | WithMetadata<FirestoreDocument<T>>> {
    try {
      // We query with limit(2) so we can efficiently detect duplicate matches
      // without paying for an unbounded query read.
      const snapshot = await this.readCol()
        .where(field as string | FieldPath, '==', value)
        .limit(2)
        .get();

      if (snapshot.empty) {
        throw new NotFoundError(`No document found with ${String(field)} = ${String(value)}`);
      }

      if (snapshot.size > 1) {
        throw new ConflictError(
          `Multiple documents found with ${String(field)} = ${String(value)}. Expected exactly one document.`,
        );
      }

      const doc = snapshot.docs[0];
      return this.toDocumentResult(doc, options?.withMetadata);
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Subscribe to real-time updates for a single document by id.
   * The callback receives the latest document state whenever Firestore emits changes.
   *
   * @param id - Document ID to observe
   * @param callback - Function invoked with the updated document
   * @param onError - Optional error handler for not-found and Firestore errors
   * @returns Unsubscribe function to stop listening
   */
  listenOne(
    id: ID,
    callback: (item: FirestoreDocument<T>) => void,
    onError?: (error: Error) => void,
  ): () => void {
    this.validateId(id);
    try {
      return this.readCol()
        .doc(id)
        .onSnapshot(
          snapshot => {
            try {
              if (!snapshot.exists) {
                if (onError) {
                  onError(new NotFoundError(`Document with id ${id} not found`));
                }
                return;
              }

              callback(asFirestoreDocument<T>({ ...(snapshot.data() as T), id: snapshot.id }));
            } catch (error: any) {
              if (onError) {
                onError(parseFirestoreError(error));
              }
            }
          },
          error => {
            if (onError) {
              onError(parseFirestoreError(error));
            }
          },
        );
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Subscribe to real-time updates for a single document, **with snapshot metadata**.
   *
   * Identical to {@link listenOne} except that the callback receives `{ doc, metadata }` — the same
   * document under `doc`, plus its Firestore `ref` / `path` / `parentPath` / `createTime` /
   * `updateTime` / `readTime`.
   *
   * Deletion is reported the same way {@link listenOne} reports it: through
   * `onError(new NotFoundError(...))`, not as a callback emission. A deleted document's snapshot
   * carries no `createTime` / `updateTime`, so there is no metadata to deliver for it.
   *
   * @param id - Document ID to observe
   * @param callback - Function invoked with the updated document and its metadata
   * @param onError - Optional error handler for not-found and Firestore errors
   * @returns Unsubscribe function to stop listening
   *
   * @example
   * const unsubscribe = userRepo.listenOneDetailed(
   *   'user-123',
   *   ({ doc, metadata }) => {
   *     console.log(`${doc.name} last written ${metadata.updateTime.toDate().toISOString()}`);
   *   },
   *   error => console.error(error),
   * );
   */
  listenOneDetailed(
    id: ID,
    callback: (item: WithMetadata<FirestoreDocument<T>>) => void,
    onError?: (error: Error) => void,
  ): () => void {
    this.validateId(id);
    try {
      return this.readCol()
        .doc(id)
        .onSnapshot(
          snapshot => {
            try {
              if (!snapshot.exists) {
                if (onError) {
                  onError(new NotFoundError(`Document with id ${id} not found`));
                }
                return;
              }

              callback({
                doc: asFirestoreDocument<T>({ ...(snapshot.data() as T), id: snapshot.id }),
                metadata: buildDocumentMetadata(snapshot),
              });
            } catch (error: any) {
              if (onError) {
                onError(parseFirestoreError(error));
              }
            }
          },
          error => {
            if (onError) {
              onError(parseFirestoreError(error));
            }
          },
        );
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Get all documents in the collection.
   * This method intentionally performs an unbounded read, so callers should
   * prefer query().paginate() for large collections where incremental loading
   * is more appropriate.
   *
   * @returns Array of all documents in the collection
   *
   * @example
   * // Fetch the entire users collection
   * const users = await userRepo.getAll();
   */
  async getAll(options: { withMetadata: true }): Promise<WithMetadata<FirestoreDocument<T>>[]>;
  async getAll(options?: { withMetadata?: false }): Promise<FirestoreDocument<T>[]>;
  async getAll(options?: {
    withMetadata?: boolean;
  }): Promise<FirestoreDocument<T>[] | WithMetadata<FirestoreDocument<T>>[]> {
    try {
      const snapshot = await this.readCol().get();
      return options?.withMetadata
        ? snapshot.docs.map(doc => ({
            doc: asFirestoreDocument<T>({ ...(doc.data() as T), id: doc.id }),
            metadata: buildDocumentMetadata(doc),
          }))
        : snapshot.docs.map(doc => asFirestoreDocument<T>({ ...(doc.data() as T), id: doc.id }));
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Create a query builder for complex queries.
   * Provides a fluent API for filtering, sorting, pagination, and more.
   *
   * @returns Query builder instance
   *
   * @example
   * // Simple query
   * const activeUsers = await userRepo.query()
   *   .where('status', '==', 'active')
   *   .get();
   *
   * @example
   * // Complex query with multiple conditions
   * const results = await orderRepo.query()
   *   .where('status', '==', 'pending')
   *   .where('total', '>', 100)
   *   .orderBy('createdAt', 'desc')
   *   .limit(50)
   *   .get();
   *
   * @example
   * // Pagination
   * const page = await productRepo.query()
   *   .where('category', '==', 'electronics')
   *   .orderBy('price', 'desc')
   *   .paginate(20, lastCursor);
   */
  query(): FirestoreQueryBuilder<T, W, S> {
    return new FirestoreQueryBuilder<T, W, S>(
      this.readCol(),
      this.readCol(),
      this.db,
      this.commitInChunks.bind(this),
      this.runHooks.bind(this),
      this.validateUpdateData.bind(this),
      this.allowLegacyDatastoreIds,
    );
  }

  /**
   * Query the **collection group** this repository's collection belongs to — every collection with
   * the same id, at any depth in the database, including a same-named root collection.
   *
   * The group id is the last segment of this repository's collection path, so a repository for
   * `users/u1/posts` groups over `posts`. The returned {@link FirestoreCollectionGroup} carries this
   * repository's read model, stored (query-path) model, `readConverter`, and
   * `allowLegacyDatastoreIds` policy — a group query is typed and validated exactly like
   * {@link query}.
   *
   * **Read-only, and results carry full-path identity.** A collection group has no
   * `CollectionReference`, so there is no `create` / `getById` / `update` / `delete` surface, and
   * document ids are not unique across the group — reads return `CollectionGroupDocument`s with
   * `path` and `parentPath` alongside `id`. See ADR-0024.
   *
   * **Indexes:** Firestore's automatic single-field indexes are collection-scoped, so a
   * collection-group query that filters or orders on a field needs an explicitly created
   * collection-group-scoped index in production — even for a single `where(...)`. The emulator does
   * not enforce this.
   *
   * @throws {Error} If this repository's read **or stored** schema declares a top-level `path` or
   *   `parentPath`, which the group identity overlay would shadow (or, for a stored-only field,
   *   which `where('path', …)` could filter while the result can never expose).
   *
   * @example
   * // Every `posts` subcollection, across every user.
   * const postGroup = userRepo.subcollection('u1', 'posts', postSchema).collectionGroup();
   * const drafts = await postGroup.query().where('status', '==', 'draft').get();
   * drafts[0].path; // 'users/u7/posts/abc'
   *
   * @example
   * // No concrete parent handy? A top-level handle does no I/O at construction.
   * const postGroup = FirestoreRepository.withSchema(db, 'posts', postSchema).collectionGroup();
   */
  collectionGroup(): FirestoreCollectionGroup<T, S> {
    // The last segment is a COLLECTION segment of `collectionPath`, which `validateCollectionPath`
    // already proved legal (non-empty, no slash, not `.`/`..`, not reserved) at construction — so no
    // re-validation is needed here. The `!` is for the compiler only: split() on a non-empty string
    // always yields at least one element.
    const collectionId = this.collectionPath.split('/').pop()!;
    FirestoreRepository.assertSchemaHasNoGroupIdentityFields(this.schemasInternal);

    const group = this.db.collectionGroup(collectionId);
    // Mirrors readCol(): attach the read converter so `fromFirestore` runs on group reads too. The
    // pass-through `toFirestore` is never invoked — a group exposes no write surface at all.
    const readGroup = this.readConverter
      ? group.withConverter({
          toFirestore: model => model as FirebaseFirestore.DocumentData,
          fromFirestore: this.readConverter,
        })
      : group;

    return new FirestoreCollectionGroup<T, S>(
      readGroup,
      collectionId,
      this.db,
      this.readConverter,
      this.allowLegacyDatastoreIds,
    );
  }

  /**
   * Validate an untrusted string as a document id for this repository, returning it for use with the
   * repository's id-taking methods. This is the explicit trust boundary for ids arriving from outside
   * (route params, queue payloads, external references): it throws {@link InvalidDocumentIdError} for
   * anything Firestore would reject, so callers can validate once at the edge.
   *
   * @example
   * const id = userRepo.id(req.params.userId); // throws InvalidDocumentIdError if malformed
   * const user = await userRepo.getById(id);
   */
  id(raw: string): ID {
    return this.validateId(raw);
  }

  /**
   * Generate a new, validated auto-id **without** writing a document. The id is independent of any
   * later write — `create()` (via `doc().set()`) and `createInTransaction()` each generate their
   * **own** fresh id — so persist under this id explicitly with `upsert(id, …)` or a transaction
   * `set`. Useful when you need the id before the write, e.g. to reference it elsewhere in the same
   * transaction.
   *
   * @example
   * const id = userRepo.newId();
   * await userRepo.upsert(id, { name: 'Ada' }); // writes under exactly `id`
   */
  newId(): ID {
    return this.validateId(this.writeCol().doc().id);
  }

  /**
   * Commits write actions in sequential chunks of 500 (the Firestore batch limit).
   *
   * Returns the Admin SDK {@link FirebaseFirestore.WriteResult} array for every **successfully**
   * committed action, concatenated in enqueue order across chunks. A failed chunk contributes no
   * fabricated receipts — only prior successful chunks appear in the returned array (and in
   * {@link WriteOutcomeError.committedWrites}).
   *
   * IMPORTANT — non-atomic above 500 operations: each 500-op chunk commits independently, so an
   * operation set larger than 500 writes is NOT globally atomic. If a later chunk fails, earlier
   * chunks remain committed and the operation's after-hook does not run. Bulk operations at or below
   * 500 writes commit as a single atomic batch. Use a transaction if you need all-or-nothing
   * semantics across more than 500 documents.
   */
  private async commitInChunks(
    actions: ((batch: FirebaseFirestore.WriteBatch) => void)[],
  ): Promise<FirebaseFirestore.WriteResult[]> {
    // Accumulate only successfully committed chunk results so a later failure cannot invent
    // receipts for uncommitted actions (trap T2).
    const writeResults: FirebaseFirestore.WriteResult[] = [];
    let committedWrites = 0;
    let batch = this.db.batch();
    let counter = 0;
    let writesInCurrentBatch = 0;

    try {
      for (const action of actions) {
        action(batch);
        counter++;
        writesInCurrentBatch++;

        if (counter === 500) {
          const chunkResults = await batch.commit();
          writeResults.push(...chunkResults);
          committedWrites += writesInCurrentBatch;
          batch = this.db.batch();
          counter = 0;
          writesInCurrentBatch = 0;
        }
      }

      if (counter > 0) {
        const chunkResults = await batch.commit();
        writeResults.push(...chunkResults);
        committedWrites += writesInCurrentBatch;
      }

      return writeResults;
    } catch (error) {
      const cause = parseFirestoreError(error);
      if (committedWrites === 0) {
        throw cause;
      }
      // committedWrites stays a count (length of successfully committed actions), matching the
      // existing WriteOutcomeError contract — callers do not receive the partial receipt array.
      throw new WriteOutcomeError(
        {
          state: 'partially-committed',
          phase: 'commit',
          committedWrites,
          totalWrites: actions.length,
        },
        cause,
      );
    }
  }

  /**
   * Rejects the impossible `{ returnDoc: true, withMetadata: true }` combination before any I/O.
   * Typed overloads already forbid it for TypeScript callers; this guards JavaScript callers so
   * the repository never invents an ambiguous combined result shape (trap T4 / D3).
   */
  private assertExclusiveWriteResultOptions(options?: {
    returnDoc?: boolean;
    withMetadata?: boolean;
  }): void {
    if (options?.returnDoc === true && options?.withMetadata === true) {
      throw new Error(
        'returnDoc and withMetadata are mutually exclusive: returnDoc reads the converted document ' +
          'after commit, while withMetadata returns the write receipt (writeTime). Pass only one.',
      );
    }
  }

  /**
   * Execute a function within a Firestore transaction, optionally forwarding Admin SDK transaction
   * options (`maxAttempts`, `{ readOnly: true, readTime? }`).
   *
   * Overloads discriminate on `options.readOnly`:
   * - `{ readOnly: true }` → callback `repo` is {@link ReadOnlyTransactionalRepository} (read-safe
   *   members only — write helpers and non-transactional reads are absent from the type).
   * - omitted / read-write options → callback `repo` is the full {@link FirestoreRepository}.
   *
   * Options are passed through unchanged to `db.runTransaction(fn, options)`. The SDK validates
   * `maxAttempts` client-side (integer in `[1, Infinity]`); the ORM does not re-validate.
   *
   * Prefer {@link runReadOnlyAt} when the only option you need is a PITR / time-travel `readTime`.
   *
   * @template R - Return type of the transaction function
   * @param fn - Transaction callback receiving `(tx, repo)`
   * @param options - Admin SDK transaction options (`FirebaseFirestore.ReadOnlyTransactionOptions` or
   *   `FirebaseFirestore.ReadWriteTransactionOptions`)
   * @returns Result of the transaction function
   *
   * @example
   * // Transfer balance between accounts (read-write, default retries)
   * await accountRepo.runInTransaction(async (tx, repo) => {
   *   const from = await repo.getInTransaction(tx, 'account-1');
   *   const to = await repo.getInTransaction(tx, 'account-2');
   *
   *   if (!from || from.balance < 100) {
   *     throw new Error('Insufficient funds');
   *   }
   *
   *   await repo.updateInTransaction(tx, from.id, {
   *     balance: from.balance - 100
   *   });
   *   await repo.updateInTransaction(tx, to.id, {
   *     balance: to.balance + 100
   *   });
   * });
   *
   * @example
   * // Cap contention retries on a read-write transaction
   * await counterRepo.runInTransaction(async (tx, repo) => {
   *   const counter = await repo.getInTransaction(tx, 'global-counter');
   *   const newValue = (counter?.value || 0) + 1;
   *   await repo.updateInTransaction(tx, 'global-counter', { value: newValue });
   *   return newValue;
   * }, { maxAttempts: 3 });
   *
   * @example
   * // Read-only transaction — callback repo has no write helpers
   * const snap = await accountRepo.runInTransaction(
   *   async (tx, repo) => repo.getInTransaction(tx, 'account-1'),
   *   { readOnly: true },
   * );
   *
   * @example
   * // PITR / time-travel read (prefer runReadOnlyAt for this shape)
   * const historical = await accountRepo.runInTransaction(
   *   async (tx, repo) => repo.getInTransaction(tx, 'account-1'),
   *   { readOnly: true, readTime },
   * );
   */
  async runInTransaction<R>(
    fn: (
      tx: FirebaseFirestore.Transaction,
      repo: ReadOnlyTransactionalRepository<T, S>,
    ) => Promise<R>,
    options: FirebaseFirestore.ReadOnlyTransactionOptions,
  ): Promise<R>;
  async runInTransaction<R>(
    fn: (tx: FirebaseFirestore.Transaction, repo: FirestoreRepository<T, W, S, WO>) => Promise<R>,
    options?: FirebaseFirestore.ReadWriteTransactionOptions,
  ): Promise<R>;
  async runInTransaction<R>(
    // Implementation signature: always pass a full cloned repo at runtime. Overload resolution
    // (not this signature) is what narrows the callback's typed `repo` for callers.
    fn: (tx: FirebaseFirestore.Transaction, repo: FirestoreRepository<T, W, S, WO>) => Promise<R>,
    options?:
      FirebaseFirestore.ReadOnlyTransactionOptions | FirebaseFirestore.ReadWriteTransactionOptions,
  ): Promise<R> {
    try {
      // Closure-local attempt counter: incremented on every Admin SDK callback entry so each
      // per-invocation transaction repo reports a diagnostic 1-based attempt (issue #46 / ADR-0035).
      let observedAttempt = 0;
      // Forward options verbatim to the Admin SDK — including `undefined` when the caller omitted
      // the second argument, so existing one-arg callers keep the SDK default retry behavior.
      return await this.db.runTransaction(async tx => {
        observedAttempt++;
        // Clone this repository for the transaction. The args cast mirrors `raw()`:
        // `RepositoryConstructorArgs<T, W, WO>` is a deferred conditional under generic params, and
        // this clone is sound by construction — a `WO !== W` repository necessarily already has a
        // validator (the S1 invariant the constructor enforced), which is carried over here.
        //
        // Runtime always hands a full FirestoreRepository (write helpers still exist). Read-only
        // narrowing is type-level only; the SDK rejects writes inside `{ readOnly: true }` txs
        // client-side with a plain Error ("Firestore read-only transactions cannot execute writes.").
        const txArgs = [
          this.db,
          this.collectionPath,
          this.validator,
          this.parentPath,
          this.readConverter,
          this.schemasInternal,
          this.allowLegacyDatastoreIds,
        ] as unknown as RepositoryConstructorArgs<T, W, WO>;
        const txRepo = new FirestoreRepository<T, W, S, WO>(...txArgs);
        // Preserve registered hooks so transactional operations follow the same lifecycle behavior.
        // Harmless for read-only txs (no write helpers on the typed surface) and keeps one code path.
        txRepo.hooks = Object.fromEntries(
          Object.entries(this.hooks).map(([event, handlers]) => [event, [...(handlers ?? [])]]),
        ) as { [K in HookEvent]?: AnyHookFn<T, W, WO>[] };
        txRepo.transactionAttempt = observedAttempt;
        // txRepo is a full instance: its readCol()/writeCol() already resolve the same
        // converter-wrapped read ref and raw write ref. Transaction semantics come from tx.*.
        return await fn(tx, txRepo);
      }, options);
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Run a read-only transaction at a consistent `readTime` (PITR / time-travel when enabled on the
   * database, or within the ~60s window otherwise).
   *
   * Thin wrapper around {@link runInTransaction} with `{ readOnly: true, readTime }`. The callback
   * `repo` is {@link ReadOnlyTransactionalRepository} — only pure / transaction-scoped members.
   *
   * Note: the Firestore emulator accepts a `readTime` well past the 60s window without error, where
   * production rejects it absent PITR retention. Local success is not proof the production call will
   * succeed.
   *
   * @template R - Return type of the transaction function
   * @param readTime - Snapshot timestamp for the read-only transaction
   * @param fn - Read-only transaction callback
   * @returns Result of the transaction function
   *
   * @example
   * const historical = await accountRepo.runReadOnlyAt(readTime, async (tx, repo) => {
   *   return repo.getInTransaction(tx, 'account-1');
   * });
   *
   * @example
   * // Query-shaped PITR via the Admin SDK escape hatch + fromSnapshot mapping.
   * // Build the collection from the callback repo so nested / dynamic paths stay correct.
   * await userRepo.runReadOnlyAt(readTime, async (tx, repo) => {
   *   const snap = await tx.get(
   *     db.collection(repo.getCollectionPath()).where('status', '==', 'active'),
   *   );
   *   return snap.docs.map(d => repo.fromSnapshot(d));
   * });
   */
  async runReadOnlyAt<R>(
    readTime: FirebaseFirestore.Timestamp,
    fn: (
      tx: FirebaseFirestore.Transaction,
      repo: ReadOnlyTransactionalRepository<T, S>,
    ) => Promise<R>,
  ): Promise<R> {
    // Delegate entirely to the overloaded runInTransaction so hook cloning / error parsing stay
    // in one place. The `readOnly: true` literal selects the read-only overload at the type level.
    return this.runInTransaction(fn, { readOnly: true, readTime });
  }

  /**
   * Read a document inside a transaction.
   *
   * In a **read-write** transaction this takes a pessimistic lock (Firestore's default). In a
   * **read-only** / PITR transaction it is lock-free — locking is a property of the transaction
   * mode, not of this method. Uses `readCol()` so converters and the `id` overlay apply.
   *
   * @param tx - Firestore transaction object
   * @param id - Document ID
   * @returns Document or null if not found
   *
   * @example
   * await repo.runInTransaction(async (tx, repo) => {
   *   const user = await repo.getInTransaction(tx, 'user-123');
   *   if (user) {
   *     await repo.updateInTransaction(tx, user.id, {
   *       loginCount: (user.loginCount || 0) + 1
   *     });
   *   }
   * });
   */
  async getInTransaction(
    tx: FirebaseFirestore.Transaction,
    id: ID,
  ): Promise<FirestoreDocument<T> | null> {
    this.validateId(id);
    const docRef = this.readCol().doc(id);
    const snapshot = await tx.get(docRef);

    if (!snapshot.exists) return null;
    return asFirestoreDocument<T>({ ...(snapshot.data() as T), id: snapshot.id });
  }

  /**
   * Batched multi-document read inside a transaction via `tx.getAll`.
   *
   * Same positional / null-for-miss / field-mask / empty-input / duplicate-id contract as
   * {@link getMany}, but scoped to the transaction. In a **read-write** transaction this takes
   * pessimistic locks on **all** requested ids in one round trip; in a **read-only** / PITR
   * transaction it is lock-free.
   *
   * No `try/catch` here — matching {@link getInTransaction}. Transaction errors are parsed once by
   * {@link runInTransaction}'s own catch.
   *
   * ⚠ With a configured `readConverter`, `fromFirestore` receives the **masked** document when
   * `fieldMask` is supplied. A converter that dereferences an omitted field throws a raw
   * `TypeError` — see {@link getMany}.
   *
   * @param tx - Firestore transaction object
   * @param ids - Document ids to fetch (order preserved; duplicates allowed)
   * @param options - Optional `{ fieldMask }` projection (paths typed against the stored model `S`)
   * @returns Positional `(FirestoreDocument | null)[]` aligned with `ids`
   * @throws {InvalidDocumentIdError} If any id is not a single valid Firestore path segment
   *   (validated before any I/O)
   *
   * @example
   * await userRepo.runInTransaction(async (tx, repo) => {
   *   const [a, b] = await repo.getManyInTransaction(tx, ['a', 'b']);
   *   if (a && b) {
   *     await repo.updateInTransaction(tx, a.id, { linkedTo: b.id });
   *   }
   * });
   */
  async getManyInTransaction(
    tx: FirebaseFirestore.Transaction,
    ids: ID[],
    options: { fieldMask: (FieldPaths<OmitId<S>> | FieldPath)[] },
  ): Promise<(FirestoreDocument<DeepPartial<T>> | null)[]>;
  async getManyInTransaction(
    tx: FirebaseFirestore.Transaction,
    ids: ID[],
    options?: { fieldMask?: undefined },
  ): Promise<(FirestoreDocument<T> | null)[]>;
  async getManyInTransaction(
    tx: FirebaseFirestore.Transaction,
    ids: ID[],
    options?: { fieldMask?: (FieldPaths<OmitId<S>> | FieldPath)[] },
  ): Promise<(FirestoreDocument<T> | FirestoreDocument<DeepPartial<T>> | null)[]> {
    // Validate first (matches getMany / bulk helpers); empty arrays short-circuit below.
    ids.forEach(id => this.validateId(id));
    // Mandatory: tx.getAll() with zero refs throws the same way as db.getAll().
    if (ids.length === 0) return [];
    const refs = ids.map(id => this.readCol().doc(id));
    // Same FieldPaths→(string|FieldPath)[] cast as getMany — see comment there.
    const snapshots = options?.fieldMask
      ? await tx.getAll(...refs, { fieldMask: options.fieldMask as (string | FieldPath)[] })
      : await tx.getAll(...refs);
    return this.mapManySnapshots(snapshots);
  }

  /**
   * Update a document within a transaction.
   * Supports dot notation for nested field updates.
   * Reads are optional in transactions, but callers may still use getInTransaction()
   * when business logic needs existing document state.
   *
   * @param tx - Firestore transaction object
   * @param id - Document ID
   * @param data - Partial data to update (supports dot notation)
   * A `lastUpdateTime` precondition may be supplied here too. A failed precondition does **not**
   * trigger a transaction retry — Firestore retries on contention, not on a rejected precondition —
   * so the callback runs exactly once and the whole transaction fails with
   * {@link PreconditionFailedError}. Inside a read-write transaction the transaction's own
   * pessimistic lock is usually the better tool; a precondition is for a token read *outside* the
   * transaction.
   *
   * @param options - Optional update behavior settings (`merge`, `lastUpdateTime`)
   * @throws {ValidationError} If validation fails
   * @throws {PreconditionFailedError} If `lastUpdateTime` no longer matches (transaction not retried)
   *
   * @example
   * await repo.runInTransaction(async (tx, repo) => {
   *   const product = await repo.getInTransaction(tx, 'product-123');
   *   await repo.updateInTransaction(tx, 'product-123', {
   *     stock: product.stock - quantity
   *   });
   * });
   *
   * @example
   * // With dot notation in transaction
   * await repo.runInTransaction(async (tx, repo) => {
   *   const user = await repo.getInTransaction(tx, 'user-123');
   *   await repo.updateInTransaction(tx, 'user-123', {
   *     'settings.notifications': true,
   *     'profile.lastLogin': new Date()
   *   });
   * });
   *
   * @example
   * // Merge update in a transaction while preserving update semantics
   * await repo.runInTransaction(async (tx, transactionRepo) => {
   *   await transactionRepo.updateInTransaction(
   *     tx,
   *     'user-123',
   *     { 'profile.nickname': 'Johnny' },
   *     { merge: true }
   *   );
   * });
   */
  async updateInTransaction(
    tx: FirebaseFirestore.Transaction,
    id: ID,
    data: UpdateInput<W>,
    // Transaction updates cannot honor `returnDoc` (a transaction cannot read a document back after
    // writing it), so the option is deliberately absent here — only `merge` and the optimistic-
    // concurrency `lastUpdateTime` are meaningful. This mirrors `createInTransaction`, which also
    // excludes `returnDoc`.
    options?: { merge?: boolean; lastUpdateTime?: FirebaseFirestore.Timestamp },
  ): Promise<void> {
    this.validateId(id);
    try {
      const docRef = this.writeCol().doc(id);

      // Non-writable `id` on the before-hook payload (review R2); the write target is `docRef`.
      const toUpdate = FirestoreRepository.withReadonlyId(
        { ...(data as Record<string, any>) },
        id,
      ) as UpdateInput<W> & { readonly id: ID };

      await this.runHooks('beforeUpdate', toUpdate, {
        kind: 'transaction',
        attempt: this.transactionAttempt ?? null,
      });
      // In merge mode, normalize nested objects into field paths BEFORE validating so each leaf is
      // validated independently (a partial nested object doesn't require its siblings).
      const normalizedData =
        options?.merge === true
          ? this.normalizeUpdateDataForMerge(toUpdate as UpdateInput<W>)
          : (toUpdate as UpdateInput<W>);
      const validData = this.validateUpdateData(normalizedData);
      const writePayload = this.sanitizeUpdateData(validData);

      this.assertNonEmptyUpdatePayload(writePayload as Record<string, any>);
      // T1 branch: `tx.update(ref, data, undefined)` throws "Input is not an object" exactly like the
      // document and batch surfaces. See toPrecondition().
      const precondition = this.toPrecondition(options?.lastUpdateTime);
      if (precondition) {
        tx.update(docRef, writePayload as any, precondition);
      } else {
        tx.update(docRef, writePayload as any);
      }
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        throw new ValidationError(error.issues);
      }
      throw parseFirestoreError(error);
    }
  }

  /**
   * Convenience alias for merge-style transaction updates.
   * Equivalent to updateInTransaction(tx, id, data, { merge: true }).
   *
   * Accepts the same `lastUpdateTime` precondition, with the same no-retry behavior on failure.
   */
  async patchInTransaction(
    tx: FirebaseFirestore.Transaction,
    id: ID,
    data: UpdateInput<W>,
    options?: { lastUpdateTime?: FirebaseFirestore.Timestamp },
  ): Promise<void> {
    // `lastUpdateTime: undefined` is safe through this ORM-owned options bag — updateInTransaction
    // branches on truthiness before anything reaches the SDK.
    return this.updateInTransaction(tx, id, data, {
      merge: true,
      lastUpdateTime: options?.lastUpdateTime,
    });
  }

  /**
   * Create a document within a transaction.
   * Must be used inside runInTransaction callback.
   *
   * Returns only `{ id }`: a transaction cannot read a document back after writing it (Firestore
   * requires all reads before writes and the write is not committed until the callback returns), so
   * there is no `returnDoc` option here. Read the document after the transaction completes if the
   * converted read model is needed.
   *
   * @param tx - Firestore transaction object
   * @param data - Document data
   * @returns `{ id }` — the generated document id
   * @throws {ValidationError} If validation fails
   *
   * @example
   * await repo.runInTransaction(async (tx, repo) => {
   *   const { id } = await repo.createInTransaction(tx, {
   *     userId: 'user-123',
   *     total: 99.99,
   *     status: 'pending'
   *   });
   *   console.log('Order created:', id);
   * });
   */
  async createInTransaction(
    tx: FirebaseFirestore.Transaction,
    data: CreateInput<W>,
  ): Promise<{ id: ID }> {
    try {
      const docRef = this.writeCol().doc();
      // Non-writable `id` on the before-hook payload (review R2); the write target is `docRef`.
      const docData = FirestoreRepository.withReadonlyId(
        { ...(data as Record<string, any>) },
        docRef.id,
      );

      await this.runHooks('beforeCreate', docData as HookDataFor<'beforeCreate', T, W, WO>, {
        kind: 'transaction',
        attempt: this.transactionAttempt ?? null,
      });
      const validData = this.validateCreateData(docData as CreateInput<W>);

      // NOTE: after* hooks intentionally do not run inside a transaction (the write is not committed
      // until the callback returns) — only beforeCreate fires, matching updateInTransaction.
      tx.set(docRef, validData as any);
      return { id: docRef.id };
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        throw new ValidationError(error.issues);
      }
      throw parseFirestoreError(error);
    }
  }

  /**
   * Create a document under a **caller-supplied id** within a transaction, failing if that id is
   * already taken. The transactional counterpart to {@link createWithId}.
   *
   * Returns only `{ id }` for the same reason as {@link createInTransaction}: a transaction cannot
   * read a document back after writing it, so there is no `returnDoc` option.
   *
   * A collision does **not** trigger a transaction retry. Firestore retries on contention, not on a
   * rejected create — the callback runs exactly once and the whole transaction fails with
   * {@link ConflictError}. Only `beforeCreate` fires; after-hooks never run inside a transaction
   * because the write is not committed until the callback returns (matching every other
   * `*InTransaction` helper).
   *
   * @param tx - Firestore transaction object
   * @param id - Document ID to claim
   * @param data - Document data
   * @returns `{ id }` — the caller-supplied document id
   * @throws {InvalidDocumentIdError} If the id is not a single valid Firestore path segment
   * @throws {ValidationError} If validation fails
   * @throws {ConflictError} If a document already exists at that id (raised when the transaction runs)
   *
   * @example
   * await repo.runInTransaction(async (tx, repo) => {
   *   await repo.createWithIdInTransaction(tx, 'order-123', {
   *     userId: 'user-123',
   *     total: 99.99,
   *   });
   * });
   */
  async createWithIdInTransaction(
    tx: FirebaseFirestore.Transaction,
    id: ID,
    data: CreateInput<W>,
  ): Promise<{ id: ID }> {
    // Security boundary (review B1): validate the caller-supplied id before any hook or write.
    this.validateId(id);
    try {
      const docRef = this.writeCol().doc(id);
      // Non-writable `id` on the before-hook payload (review R2); the write target is `docRef`.
      const docData = FirestoreRepository.withReadonlyId({ ...(data as Record<string, any>) }, id);

      await this.runHooks('beforeCreate', docData as HookDataFor<'beforeCreate', T, W, WO>, {
        kind: 'transaction',
        attempt: this.transactionAttempt ?? null,
      });
      const validData = this.validateCreateData(docData as CreateInput<W>);

      // `tx.create` — create-only semantics inside the transaction. NOTE: after* hooks intentionally
      // do not run inside a transaction, matching createInTransaction/updateInTransaction.
      tx.create(docRef, validData as any);
      return { id };
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        throw new ValidationError(error.issues);
      }
      throw parseFirestoreError(error);
    }
  }

  /**
   * Delete a document within a transaction.
   * Must be used inside runInTransaction callback.
   *
   * Optionally guarded by a `lastUpdateTime` precondition. As with the transactional update, a
   * failed precondition fails the transaction outright rather than retrying it. Note this method's
   * own transactional existence read runs first, so a missing document still raises
   * {@link NotFoundError} regardless of any precondition.
   *
   * @param tx - Firestore transaction object
   * @param id - Document ID
   * @param options - `{ lastUpdateTime }` to delete only if the document is still at that version
   * @throws {NotFoundError} If document doesn't exist
   * @throws {PreconditionFailedError} If `lastUpdateTime` no longer matches (transaction not retried)
   *
   * @example
   * await repo.runInTransaction(async (tx, repo) => {
   *   const item = await repo.getInTransaction(tx, 'item-123');
   *   if (item && item.quantity === 0) {
   *     await repo.deleteInTransaction(tx, item.id);
   *   }
   * });
   */
  async deleteInTransaction(
    tx: FirebaseFirestore.Transaction,
    id: ID,
    options?: { lastUpdateTime?: FirebaseFirestore.Timestamp },
  ): Promise<void> {
    this.validateId(id);
    try {
      const docRef = this.readCol().doc(id);
      const snapshot = await tx.get(docRef);

      if (!snapshot.exists) throw new NotFoundError(`Document with ID ${id} not found`);

      // Deep-freeze the delete envelope (review R2) so the hook cannot forge the observed id or
      // nested data. Delete payloads are observe-only.
      const docData = deepFreeze({ ...(snapshot.data() as T), id: snapshot.id });
      await this.runHooks(
        'beforeDelete',
        asFirestoreDocument<T>(docData) as HookDataFor<'beforeDelete', T, W, WO>,
        {
          kind: 'transaction',
          attempt: this.transactionAttempt ?? null,
        },
      );
      // T1 branch, applied for consistency with every other write site. See toPrecondition().
      const precondition = this.toPrecondition(options?.lastUpdateTime);
      if (precondition) {
        tx.delete(docRef, precondition);
      } else {
        tx.delete(docRef);
      }
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }
}

/**
 * Extracts a repository's **read data** type (`T`) — the application/read shape, with the synthetic
 * top-level `id` removed (review R5). `Omit<'id'>` normalizes a legacy/raw repository whose generic
 * argument still carries `id`; it is a no-op for validated (schema-inferred) repositories.
 */
export type DataOf<R> = R extends FirestoreRepository<infer T, any, any, any> ? OmitId<T> : never;

/**
 * Extracts a repository's **stored data** type (`S`) — the at-rest Firestore shape that query field
 * paths derive from, with the synthetic top-level `id` removed (review R5). `Omit<'id'>` normalizes a
 * legacy/raw repository whose generic argument still carries `id`; it is a no-op for validated repos.
 */
export type StoredDataOf<R> =
  R extends FirestoreRepository<any, any, infer S, any> ? OmitId<S> : never;

/**
 * Extracts a repository's **document** result type — {@link FirestoreDocument}`<DataOf<R>>` (read
 * data plus the authoritative, read-only `id`). Name a returned document type without spelling the
 * repository generics.
 *
 * @example
 * const users = FirestoreRepository.withSchema(db, 'users', userSchema);
 * type User = DocumentOf<typeof users>;
 */
export type DocumentOf<R> =
  R extends FirestoreRepository<infer T, any, any, any> ? FirestoreDocument<T> : never;
