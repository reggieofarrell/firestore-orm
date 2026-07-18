import { CollectionReference, Firestore, FirestoreDataConverter } from 'firebase-admin/firestore';
import {
  CreateInput,
  makeValidator,
  RepositorySchemaSet,
  SentinelPolicy,
  UpdateInput,
  Validator,
} from './Validation.js';
import { z } from 'zod';
import { ConflictError, NotFoundError, ValidationError } from './Errors.js';
import { FirestoreQueryBuilder } from './QueryBuilder.js';
import { parseFirestoreError } from './ErrorParser.js';
import { flattenToDotNotation, isDotNotation } from '../utils/dotNotation.js';

export type ID = string;
export type UpdateOptions = {
  merge?: boolean;
  returnDoc?: boolean;
};

type SingleHookEvent =
  'beforeCreate' | 'afterCreate' | 'beforeUpdate' | 'afterUpdate' | 'beforeDelete' | 'afterDelete';

type BulkHookEvent =
  | 'beforeBulkCreate'
  | 'afterBulkCreate'
  | 'beforeBulkUpdate'
  | 'afterBulkUpdate'
  | 'beforeBulkDelete'
  | 'afterBulkDelete';

export type HookEvent = SingleHookEvent | BulkHookEvent;

// Write-side hooks are typed by the write model `W` (what create/update accept); the delete hook
// is typed by the read model `T` (it receives persisted documents).
type SingleHookFn<W> = (data: UpdateInput<W> & { id?: ID }) => Promise<void> | void;
type BulkCreateHookFn<W> = (data: (CreateInput<W> & { id: ID })[]) => Promise<void> | void;
type BeforeUpdateHookFn<W> = (data: UpdateInput<W> & { id: ID }) => Promise<void> | void;
type AfterUpdateHookFn = (data: { id: ID }) => Promise<void> | void;
type BeforeBulkUpdateHookFn<W> = (data: { id: ID; data: UpdateInput<W> }[]) => Promise<void> | void;
type AfterBulkUpdateHookFn = (data: { ids: ID[] }) => Promise<void> | void;
type BulkDeleteHookFn<T> = (data: {
  ids: ID[];
  documents: (T & { id: ID })[];
}) => Promise<void> | void;

type AnyHookFn<T, W> =
  | SingleHookFn<W>
  | BulkCreateHookFn<W>
  | BeforeUpdateHookFn<W>
  | AfterUpdateHookFn
  | BeforeBulkUpdateHookFn<W>
  | AfterBulkUpdateHookFn
  | BulkDeleteHookFn<T>;

/**
 * Type-safe Firestore repository with validation and lifecycle hooks.
 * Provides a clean API for common database operations with built-in error handling.
 *
 * @template T - The document type for this collection
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
export class FirestoreRepository<T extends { id?: ID }, W = T> {
  private hooks: { [K in HookEvent]?: AnyHookFn<T, W>[] } = {};
  private parentPath?: string;
  private converter?: FirestoreDataConverter<T>;
  private schemasInternal?: RepositorySchemaSet;

  constructor(
    private db: Firestore,
    private collectionPath: string,
    private validator?: Validator<W>,
    parentPath?: string,
    converter?: FirestoreDataConverter<T>,
    schemas?: RepositorySchemaSet,
  ) {
    this.parentPath = parentPath;
    this.converter = converter;
    this.schemasInternal = schemas ?? validator?.schemas;
  }

  /**
   * Ensures a schema includes a required top-level `id` field.
   * This keeps document types aligned with repository read results where `id` is always present.
   */
  private static assertSchemaHasRequiredId(schema: z.ZodObject<any>, context: string): void {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const idSchema = shape.id;

    if (!idSchema) {
      throw new Error(
        `${context} requires a schema with a top-level "id" field. Include "id: z.string()" in the schema.`,
      );
    }

    if (idSchema.isOptional()) {
      throw new Error(
        `${context} requires "id" to be required in the schema. Use "id: z.string()" instead of an optional id.`,
      );
    }

    if (!idSchema.safeParse('firestoreorm-id').success) {
      throw new Error(
        `${context} requires "id" to accept string values. Define the field as a string-compatible schema.`,
      );
    }
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
   * Both the read and write types are inferred from schema values in a single call:
   * - The **read type** is `z.infer<readSchema>` — the canonical document shape (must include a
   *   required top-level `id`).
   * - The **write type** is `z.infer<writeSchema>` when a `writeSchema` overlay is supplied,
   *   otherwise it equals the read type. Build the overlay from the write combinators
   *   (`zNumberWrite`/`zArrayWrite`/`zDateWrite`/`withDelete`/`zSentinel`) to accept native values
   *   and `FieldValue` sentinels on `create`/`update` with no cast.
   *
   * @param db - Firestore database instance
   * @param collection - Collection path
   * @param readSchema - Canonical read schema; must include a required top-level `id` field
   * @param options - Optional settings:
   *   - `writeSchema`: write-side overlay schema. When given, the write type is `z.infer<writeSchema>`
   *     and create/update validation derives from it. Need not include `id`.
   *   - `converter`: Firestore converter for custom serialization/deserialization.
   *   - `sentinelPolicy`: `'strict'` disables the permissive sentinel escape hatch, so only sentinels
   *     a field's schema explicitly permits pass. Defaults to `'permissive'`.
   * @returns Repository instance with validation enabled
   *
   * @example
   * const userSchema = z.object({
   *   id: z.string(),
   *   name: z.string().min(1),
   *   email: z.string().email(),
   *   age: z.number().int().positive().optional(),
   * });
   *
   * // read type = write type = z.infer<userSchema>
   * const userRepo = FirestoreRepository.withSchema(db, 'users', userSchema);
   *
   * @example
   * // Cast-free combinator writes via a write overlay
   * const eventRead = z.object({ id: z.string(), name: z.string(), happenedAt: z.date() });
   * const eventWrite = z.object({ id: z.string(), name: z.string(), happenedAt: zDateWrite() });
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
  static withSchema<RS extends z.ZodObject<any>, WS extends z.ZodObject<any> = RS>(
    db: Firestore,
    collection: string,
    readSchema: RS,
    options?: {
      writeSchema?: WS;
      converter?: FirestoreDataConverter<z.infer<RS>>;
      sentinelPolicy?: SentinelPolicy;
    },
  ): FirestoreRepository<z.infer<RS>, z.infer<WS>>;
  static withSchema(
    db: Firestore,
    collection: string,
    readSchema: z.ZodObject<any>,
    options?: {
      writeSchema?: z.ZodObject<any>;
      converter?: FirestoreDataConverter<any>;
      sentinelPolicy?: SentinelPolicy;
    },
  ): FirestoreRepository<any> {
    FirestoreRepository.assertSchemaHasRequiredId(readSchema, 'FirestoreRepository.withSchema');
    const writeBase = options?.writeSchema ?? readSchema;
    const validator = makeValidator(writeBase, undefined, {
      sentinelPolicy: options?.sentinelPolicy,
    });
    // Validate writes against `writeBase`, but expose the plain `readSchema` as `schemas.read`.
    const schemas = Object.freeze({
      read: readSchema,
      create: validator.schemas.create,
      update: validator.schemas.update,
    });
    return new FirestoreRepository<any, any>(
      db,
      collection,
      validator,
      undefined,
      options?.converter,
      schemas,
    );
  }

  /**
   * Access a subcollection under a specific parent document.
   *
   * Mirrors {@link FirestoreRepository.withSchema}: read/write types are inferred from schema values,
   * a required `readSchema` (with a top-level `id`) drives reads, and an optional `writeSchema`
   * overlay drives cast-free combinator writes. Converters are explicit per repository instance and
   * are never inherited from parent repositories — pass one in `options.converter` when needed.
   *
   * For an unvalidated subcollection, construct a repository directly against the full path, e.g.
   * `new FirestoreRepository<Order>(db, `${parentPath}/${parentId}/orders`)`.
   *
   * @param parentId - Parent document id
   * @param subcollectionName - Subcollection name
   * @param readSchema - Canonical read schema; must include a required top-level `id` field
   * @param options - Optional `writeSchema` overlay, `converter`, and `sentinelPolicy` (see
   *   {@link FirestoreRepository.withSchema})
   *
   * @example
   * // Access orders for a specific user
   * const orderSchema = z.object({ id: z.string(), product: z.string(), price: z.number() });
   * const userOrders = userRepo.subcollection('user-123', 'orders', orderSchema);
   * await userOrders.create({ product: 'Widget', price: 99 });
   *
   * @example
   * // With a write overlay (cast-free combinator writes) and a converter
   * const orderWrite = z.object({ id: z.string(), product: z.string(), price: zNumberWrite() });
   * const userOrders = userRepo.subcollection('user-123', 'orders', orderSchema, {
   *   writeSchema: orderWrite,
   *   converter: orderConverter,
   * });
   * await userOrders.update('o1', { price: FieldValue.increment(5) }); // no cast
   *
   * @example
   * // Nested subcollections
   * const comments = postRepo
   *   .subcollection('post-123', 'comments', commentSchema)
   *   .subcollection('comment-456', 'replies', replySchema);
   */
  subcollection<RS extends z.ZodObject<any>, WS extends z.ZodObject<any> = RS>(
    parentId: ID,
    subcollectionName: string,
    readSchema: RS,
    options?: {
      writeSchema?: WS;
      converter?: FirestoreDataConverter<z.infer<RS>>;
      sentinelPolicy?: SentinelPolicy;
    },
  ): FirestoreRepository<z.infer<RS>, z.infer<WS>>;
  subcollection(
    parentId: ID,
    subcollectionName: string,
    readSchema: z.ZodObject<any>,
    options?: {
      writeSchema?: z.ZodObject<any>;
      converter?: FirestoreDataConverter<any>;
      sentinelPolicy?: SentinelPolicy;
    },
  ): FirestoreRepository<any> {
    const newPath = `${this.collectionPath}/${parentId}/${subcollectionName}`;
    FirestoreRepository.assertSchemaHasRequiredId(
      readSchema,
      'FirestoreRepository.subcollection(..., readSchema, ...)',
    );
    const writeBase = options?.writeSchema ?? readSchema;
    const validator = makeValidator(writeBase, undefined, {
      sentinelPolicy: options?.sentinelPolicy,
    });
    // Validate writes against `writeBase`, but expose the plain `readSchema` as `schemas.read`.
    const schemas = Object.freeze({
      read: readSchema,
      create: validator.schemas.create,
      update: validator.schemas.update,
    });
    return new FirestoreRepository<any, any>(
      this.db,
      newPath,
      validator,
      newPath, // for tracking parent path for reference
      options?.converter,
      schemas,
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
  on(event: Exclude<SingleHookEvent, 'beforeUpdate' | 'afterUpdate'>, fn: SingleHookFn<W>): void;
  on(event: 'beforeUpdate', fn: BeforeUpdateHookFn<W>): void;
  on(event: 'afterUpdate', fn: AfterUpdateHookFn): void;
  on(event: 'beforeBulkCreate' | 'afterBulkCreate', fn: BulkCreateHookFn<W>): void;
  on(event: 'beforeBulkUpdate', fn: BeforeBulkUpdateHookFn<W>): void;
  on(event: 'afterBulkUpdate', fn: AfterBulkUpdateHookFn): void;
  on(event: 'beforeBulkDelete' | 'afterBulkDelete', fn: BulkDeleteHookFn<T>): void;
  on(event: HookEvent, fn: AnyHookFn<T, W>): void {
    if (!this.hooks[event]) this.hooks[event] = [];
    this.hooks[event]!.push(fn);
  }

  private async runHooks(event: HookEvent, data: any) {
    const fns = this.hooks[event] || [];
    for (const fn of fns) await fn(data);
  }

  /**
   * Build the collection reference for this repository instance.
   * Applies a converter only when explicitly configured for this repository.
   * Subcollections do not inherit parent converters automatically.
   */
  private createCollectionReference(): CollectionReference<any> {
    const collectionRef = this.db.collection(this.collectionPath);
    return this.converter ? collectionRef.withConverter(this.converter) : collectionRef;
  }

  /**
   * Return the typed collection/query reference used by read/write operations.
   * Keeping this as a dedicated method allows transaction-scoped repositories
   * to override it when needed while preserving converter behavior.
   */
  private col(): CollectionReference<any> {
    return this.createCollectionReference();
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

    return {
      ...flattenedRegularObject,
      ...explicitDotNotationObject,
    } as UpdateInput<W>;
  }

  /**
   * Validate create payloads using configured schema when available.
   * Falls back to returning the original payload when validation is disabled.
   */
  private validateCreateData(data: CreateInput<W>): CreateInput<W> {
    const createPayload = this.stripTopLevelId(data as Record<string, any>) as CreateInput<W>;
    return (
      this.validator ? this.validator.parseCreate(createPayload) : createPayload
    ) as CreateInput<W>;
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
   * Create a new document in the collection.
   * Runs validation if schema is configured.
   *
   * @param data - Document data (without ID)
   * @returns Created document with generated ID
   * @throws {ValidationError} If schema validation fails
   *
   * @example
   * // Simple create
   * const user = await userRepo.create({
   *   name: 'John Doe',
   *   email: 'john@example.com'
   * });
   * console.log(user.id); // Auto-generated ID
   *
   * @example
   * // With validation error handling
   * try {
   *   await userRepo.create({ name: '', email: 'invalid' });
   * } catch (error) {
   *   if (error instanceof ValidationError) {
   *     console.log(error.issues); // Field-specific errors
   *   }
   * }
   */
  async create(data: CreateInput<W>): Promise<T & { id: ID }> {
    try {
      const docToCreate = { ...(data as Record<string, any>) } as Record<string, any>;
      await this.runHooks('beforeCreate', docToCreate);
      const validData = this.validateCreateData(docToCreate as CreateInput<W>);

      const docRef = await this.col().add(validData as any);
      const created = { ...(validData as Record<string, any>), id: docRef.id };

      await this.runHooks('afterCreate', created);
      return created as T & { id: ID };
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
   * @param dataArray - Array of documents to create
   * @returns Array of created documents with generated IDs
   * @throws {ValidationError} If any document fails validation
   *
   * @example
   * // Bulk insert users
   * const users = await userRepo.bulkCreate([
   *   { name: 'Alice', email: 'alice@example.com' },
   *   { name: 'Bob', email: 'bob@example.com' },
   *   { name: 'Charlie', email: 'charlie@example.com' }
   * ]);
   *
   * @example
   * // Import from CSV
   * const products = csvData.map(row => ({
   *   name: row.name,
   *   price: parseFloat(row.price),
   *   sku: row.sku
   * }));
   * await productRepo.bulkCreate(products);
   */
  async bulkCreate(dataArray: CreateInput<W>[]): Promise<(T & { id: ID })[]> {
    try {
      const colRef = this.col();
      const createdDocs: (T & { id: ID })[] = [];

      for (const data of dataArray) {
        const docRef = colRef.doc();
        const docData = {
          ...(data as Record<string, any>),
          id: docRef.id,
        } as unknown as CreateInput<W> & { id: ID };

        createdDocs.push(docData as unknown as T & { id: ID });
      }

      await this.runHooks('beforeBulkCreate', createdDocs);
      const actions: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];

      for (const createdDoc of createdDocs) {
        const docRef = colRef.doc(createdDoc.id);
        const draftDoc = createdDoc as Record<string, any>;
        const validData = this.validateCreateData(draftDoc as CreateInput<W>);
        const validatedDocData = { ...(validData as Record<string, any>) };

        actions.push(batch => batch.set(docRef, validatedDocData as any));
        Object.assign(createdDoc as Record<string, any>, validatedDocData);
      }

      await this.commitInChunks(actions);
      await this.runHooks('afterBulkCreate', createdDocs);
      return createdDocs;
    } catch (error: any) {
      if (error instanceof z.ZodError) throw new ValidationError(error.issues);
      throw parseFirestoreError(error);
    }
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
  async getById(id: ID): Promise<(T & { id: ID }) | null> {
    try {
      const snapshot = await this.col().doc(id).get();
      if (!snapshot.exists) return null;

      const data = snapshot.data() as any;
      return { ...(data as T), id };
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
  async getByIdOrThrow(id: ID): Promise<T & { id: ID }> {
    const doc = await this.getById(id);
    if (!doc) {
      throw new NotFoundError(`Document with id ${id} not found`);
    }
    return doc;
  }

  /**
   * Reconstruct the read-typed document from a raw Firestore snapshot.
   *
   * This is for snapshots the repository did not read itself — most commonly the snapshot delivered
   * to a Firestore trigger cloud function (`onDocumentCreated` / `onDocumentUpdated` /
   * `onDocumentDeleted`). Such snapshots are **not** converter-applied (the Admin SDK only runs a
   * converter's `fromFirestore` for refs built via `withConverter`) and carry no `id` in
   * `snapshot.data()`, so a bare `snapshot.data() as T` cast is unsafe. `fromSnapshot` applies this
   * repository's converter `fromFirestore` when one is configured, then overlays the document `id`
   * from `snapshot.id` — mirroring exactly what a normal repository read returns.
   *
   * Does no Firestore I/O. Returns the read model `T` (not the write model `W`), and `null` when the
   * snapshot does not exist. Validation is not performed here (reads are not validated); to validate
   * at a trust boundary, run the result through the read schema, e.g.
   * `repo.schemas?.read.parse(repo.fromSnapshot(snap))`.
   *
   * @param snapshot - A Firestore `DocumentSnapshot` / `QueryDocumentSnapshot`
   * @returns The document as `T & { id }`, or `null` if the snapshot does not exist
   *
   * @example
   * // firebase-functions v2 trigger
   * export const onUserCreated = onDocumentCreated('users/{userId}', event => {
   *   const user = event.data && userRepo.fromSnapshot(event.data);
   *   if (!user) return;
   *   // `user` is a fully reconstructed User & { id }
   * });
   */
  fromSnapshot(snapshot: FirebaseFirestore.DocumentSnapshot): (T & { id: ID }) | null {
    if (!snapshot.exists) return null;
    const data = this.converter
      ? this.converter.fromFirestore(snapshot as FirebaseFirestore.QueryDocumentSnapshot)
      : (snapshot.data() as T);
    return { ...(data as T), id: snapshot.id };
  }

  /**
   * Update an existing document with partial data.
   * Supports both regular fields and dot notation for nested updates.
   *
   * @param id - Document ID to update
   * @param data - Partial document data (supports dot notation like 'address.city')
   * @param options - Optional update behavior settings
   * @returns Updated document ID
   * @throws {NotFoundError} If document doesn't exist
   * @throws {ValidationError} If validation fails
   *
   * @example
   * // Regular update
   * await userRepo.update('user-123', {
   *   email: 'newemail@example.com'
   * });
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
    options: UpdateOptions & { returnDoc: true },
  ): Promise<T & { id: ID }>;
  async update(
    id: ID,
    data: UpdateInput<W>,
    options?: UpdateOptions & { returnDoc?: false },
  ): Promise<{ id: ID }>;
  async update(
    id: ID,
    data: UpdateInput<W>,
    options?: UpdateOptions,
  ): Promise<{ id: ID } | (T & { id: ID })> {
    try {
      const docRef = this.col().doc(id);
      const toUpdate = { ...(data as Record<string, any>), id } as UpdateInput<W> & { id: ID };

      await this.runHooks('beforeUpdate', toUpdate);
      const validData = this.validateUpdateData(toUpdate as UpdateInput<W>);
      const sanitizedData = this.sanitizeUpdateData(validData);
      const writePayload =
        options?.merge === true ? this.normalizeUpdateDataForMerge(sanitizedData) : sanitizedData;

      if (Object.keys(writePayload as Record<string, any>).length > 0) {
        await docRef.update(writePayload as any);
      }
      await this.runHooks('afterUpdate', { id });

      // When returnDoc is enabled, we re-read the document after write completion.
      // This guarantees callers receive the persisted document shape from Firestore.
      if (options?.returnDoc === true) {
        return await this.getByIdOrThrow(id);
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
   */
  async patch(id: ID, data: UpdateInput<W>, options: { returnDoc: true }): Promise<T & { id: ID }>;
  async patch(id: ID, data: UpdateInput<W>, options?: { returnDoc?: false }): Promise<{ id: ID }>;
  async patch(
    id: ID,
    data: UpdateInput<W>,
    options?: { returnDoc?: boolean },
  ): Promise<{ id: ID } | (T & { id: ID })> {
    if (options?.returnDoc === true) {
      return this.update(id, data, { merge: true, returnDoc: true });
    }
    return this.update(id, data, { merge: true });
  }

  /**
   * Update multiple documents in a single batched operation.
   * Supports dot notation for nested field updates.
   *
   * @param updates - Array of update operations with ID and data
   * @returns Array of updated document IDs
   * @throws {NotFoundError} If any document doesn't exist
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
   */
  async bulkUpdate(updates: { id: ID; data: UpdateInput<W> }[]): Promise<{ id: ID }[]> {
    try {
      await this.runHooks('beforeBulkUpdate', updates);
      const actions: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];
      const ids: ID[] = [];

      for (const { id, data } of updates) {
        const docRef = this.col().doc(id);
        const validData = this.validateUpdateData(data);
        const sanitizedData = this.sanitizeUpdateData(validData);

        if (Object.keys(sanitizedData as Record<string, any>).length > 0) {
          actions.push(batch => batch.update(docRef, sanitizedData as any));
        }
        ids.push(id);
      }

      await this.commitInChunks(actions);
      await this.runHooks('afterBulkUpdate', { ids });
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
   * @param updates - Array of update operations with ID and data
   * @returns Array of updated document IDs
   * @throws {NotFoundError} If any document doesn't exist
   * @throws {ValidationError} If any validation fails
   *
   * @example
   * await userRepo.bulkPatch([
   *   { id: 'user-1', data: { profile: { settings: { theme: 'dark' } } } as any },
   *   { id: 'user-2', data: { 'profile.settings.notifications': true } as any },
   * ]);
   */
  async bulkPatch(updates: { id: ID; data: UpdateInput<W> }[]): Promise<{ id: ID }[]> {
    const normalizedUpdates = updates.map(({ id, data }) => ({
      id,
      data: this.normalizeUpdateDataForMerge(data),
    }));

    return this.bulkUpdate(normalizedUpdates);
  }

  /**
   * Create a new document if it doesn't exist, or update it if it does.
   * Uses the provided ID instead of auto-generating one.
   *
   * @param id - Document ID to upsert
   * @param data - Full document data
   * @returns Created or updated document ID
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
  async upsert(id: ID, data: CreateInput<W>, options: { returnDoc: true }): Promise<T & { id: ID }>;
  async upsert(id: ID, data: CreateInput<W>, options?: { returnDoc?: false }): Promise<{ id: ID }>;
  async upsert(
    id: ID,
    data: CreateInput<W>,
    options?: { returnDoc?: boolean },
  ): Promise<{ id: ID } | (T & { id: ID })> {
    try {
      const existing = await this.getById(id);
      const shouldReturnDoc = options?.returnDoc === true;
      if (existing) {
        if (shouldReturnDoc) {
          return await this.update(id, data as unknown as UpdateInput<W>, { returnDoc: true });
        }
        return await this.update(id, data as unknown as UpdateInput<W>);
      }

      const docToCreate = {
        ...(data as Record<string, any>),
        id,
      } as Record<string, any>;
      await this.runHooks('beforeCreate', docToCreate);
      const validData = this.validateCreateData(docToCreate as CreateInput<W>);
      const validatedDocToCreate = { ...(validData as Record<string, any>) };

      const docRef = this.col().doc(id);
      await docRef.set(validatedDocToCreate as any);
      const created = { ...validatedDocToCreate, id };

      await this.runHooks('afterCreate', created);
      if (shouldReturnDoc) {
        return await this.getByIdOrThrow(id);
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
   * @param id - Document ID to delete
   * @throws {NotFoundError} If document doesn't exist
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
   */
  async delete(id: ID): Promise<void> {
    try {
      const docRef = await this.col().doc(id);
      const snapshot = await docRef.get();

      if (!snapshot.exists) throw new NotFoundError(`Document with id ${id} not found`);

      const docData = { ...(snapshot.data() as T), id };
      await this.runHooks('beforeDelete', docData);
      await docRef.delete();
      await this.runHooks('afterDelete', docData);
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Permanently delete multiple documents in a batched operation.
   * This is a hard delete - documents cannot be recovered.
   *
   * @param ids - Array of document IDs to delete
   * @returns Number of documents actually deleted
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
   */
  async bulkDelete(ids: ID[]): Promise<number> {
    try {
      const snapshots = await Promise.all(ids.map(id => this.col().doc(id).get()));

      const docsData: (T & { id: ID })[] = snapshots
        .filter(snapshot => snapshot.exists)
        .map(snapshot => ({
          ...(snapshot.data() as T),
          id: snapshot.id,
        }));

      if (docsData.length == 0) return 0;

      await this.runHooks('beforeBulkDelete', {
        ids: docsData.map(d => d.id),
        documents: docsData,
      });

      const actions: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];
      for (const doc of docsData) {
        const docRef = this.col().doc(doc.id);
        actions.push(batch => batch.delete(docRef));
      }

      await this.commitInChunks(actions);
      await this.runHooks('afterBulkDelete', {
        ids: docsData.map(d => d.id),
        documents: docsData,
      });
      return docsData.length;
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
  async findByField<K extends keyof T>(field: K, value: T[K]): Promise<(T & { id: ID })[]> {
    try {
      const snapshot = await this.col()
        .where(field as string, '==', value)
        .get();
      return snapshot.docs.map(doc => ({ ...(doc.data() as T), id: doc.id }));
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
  async getOneByField<K extends keyof T>(field: K, value: T[K]): Promise<(T & { id: ID }) | null> {
    try {
      // We add `limit(1)` so Firestore only returns one document even if multiple matches exist.
      // This keeps reads/costs low and makes the method intentionally "first-match" oriented.
      const snapshot = await this.col()
        .where(field as string, '==', value)
        .limit(1)
        .get();

      // Returning null for "not found" keeps this method aligned with getBy-style nullable semantics.
      if (snapshot.empty) return null;

      // The query is limited to one document, so index 0 is always the first and only match here.
      const doc = snapshot.docs[0];
      return { ...(doc.data() as T), id: doc.id };
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
  async getOneByFieldOrThrow<K extends keyof T>(field: K, value: T[K]): Promise<T & { id: ID }> {
    try {
      // We query with limit(2) so we can efficiently detect duplicate matches
      // without paying for an unbounded query read.
      const snapshot = await this.col()
        .where(field as string, '==', value)
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
      return { ...(doc.data() as T), id: doc.id };
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
    callback: (item: T & { id: ID }) => void,
    onError?: (error: Error) => void,
  ): () => void {
    try {
      return this.col()
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

              callback({ ...(snapshot.data() as T), id: snapshot.id });
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
  async getAll(): Promise<(T & { id: ID })[]> {
    try {
      const snapshot = await this.col().get();
      return snapshot.docs.map(doc => ({ ...(doc.data() as T), id: doc.id }));
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
  query(): FirestoreQueryBuilder<T, W> {
    return new FirestoreQueryBuilder<T, W>(
      this.col(),
      this.col(),
      this.db,
      this.commitInChunks.bind(this),
      this.runHooks.bind(this),
      this.validateUpdateData.bind(this),
    );
  }

  private async commitInChunks(
    actions: ((batch: FirebaseFirestore.WriteBatch) => void)[],
  ): Promise<void> {
    let batch = this.db.batch();
    let counter = 0;

    for (const action of actions) {
      action(batch);
      counter++;

      if (counter === 500) {
        await batch.commit();
        batch = this.db.batch();
        counter = 0;
      }
    }

    if (counter > 0) await batch.commit();
  }

  /**
   * Execute a function within a Firestore transaction.
   * Ensures atomic operations with automatic rollback on failure.
   *
   * @template R - Return type of the transaction function
   * @param fn - Transaction function that receives transaction and repository
   * @returns Result of the transaction function
   *
   * @example
   * // Transfer balance between accounts
   * await accountRepo.runInTransaction(async (tx, repo) => {
   *   const from = await repo.getForUpdateInTransaction(tx, 'account-1');
   *   const to = await repo.getForUpdateInTransaction(tx, 'account-2');
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
   * // Atomic counter increment
   * const newCount = await counterRepo.runInTransaction(async (tx, repo) => {
   *   const counter = await repo.getForUpdateInTransaction(tx, 'global-counter');
   *   const newValue = (counter?.value || 0) + 1;
   *   await repo.updateInTransaction(tx, 'global-counter', {
   *     value: newValue
   *   });
   *   return newValue;
   * });
   */
  async runInTransaction<R>(
    fn: (tx: FirebaseFirestore.Transaction, repo: FirestoreRepository<T, W>) => Promise<R>,
  ): Promise<R> {
    try {
      return await this.db.runTransaction(async tx => {
        const txRepo = new FirestoreRepository<T, W>(
          this.db,
          this.collectionPath,
          this.validator,
          this.parentPath,
          this.converter,
          this.schemasInternal,
        );
        // Preserve registered hooks so transactional operations follow the same lifecycle behavior.
        txRepo.hooks = Object.fromEntries(
          Object.entries(this.hooks).map(([event, handlers]) => [event, [...(handlers ?? [])]]),
        ) as { [K in HookEvent]?: AnyHookFn<T, W>[] };
        // override col() to use transaction reads/writes
        (txRepo as any).col = () => txRepo.createCollectionReference();
        // pass transaction + repo to user callback
        return await fn(tx, txRepo);
      });
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }

  /**
   * Get a document within a transaction for update.
   * Ensures you read the latest version before updating.
   *
   * @param tx - Firestore transaction object
   * @param id - Document ID
   * @returns Document or null if not found
   *
   * @example
   * await repo.runInTransaction(async (tx, repo) => {
   *   const user = await repo.getForUpdateInTransaction(tx, 'user-123');
   *   if (user) {
   *     await repo.updateInTransaction(tx, user.id, {
   *       loginCount: (user.loginCount || 0) + 1
   *     });
   *   }
   * });
   */
  async getForUpdateInTransaction(
    tx: FirebaseFirestore.Transaction,
    id: ID,
  ): Promise<(T & { id: ID }) | null> {
    const docRef = this.col().doc(id);
    const snapshot = await tx.get(docRef);

    if (!snapshot.exists) return null;
    return { ...(snapshot.data() as T), id };
  }

  /**
   * Update a document within a transaction.
   * Supports dot notation for nested field updates.
   * Reads are optional in transactions, but callers may still use getForUpdateInTransaction()
   * when business logic needs existing document state.
   *
   * @param tx - Firestore transaction object
   * @param id - Document ID
   * @param data - Partial data to update (supports dot notation)
   * @param options - Optional update behavior settings
   * @throws {ValidationError} If validation fails
   *
   * @example
   * await repo.runInTransaction(async (tx, repo) => {
   *   const product = await repo.getForUpdateInTransaction(tx, 'product-123');
   *   await repo.updateInTransaction(tx, 'product-123', {
   *     stock: product.stock - quantity
   *   });
   * });
   *
   * @example
   * // With dot notation in transaction
   * await repo.runInTransaction(async (tx, repo) => {
   *   const user = await repo.getForUpdateInTransaction(tx, 'user-123');
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
    options?: UpdateOptions,
  ): Promise<void> {
    try {
      const docRef = this.col().doc(id);

      const toUpdate = { ...(data as Record<string, any>), id } as UpdateInput<W> & { id: ID };

      await this.runHooks('beforeUpdate', toUpdate);
      const validData = this.validateUpdateData(toUpdate as UpdateInput<W>);
      const sanitizedData = this.sanitizeUpdateData(validData);
      const writePayload =
        options?.merge === true ? this.normalizeUpdateDataForMerge(sanitizedData) : sanitizedData;

      if (Object.keys(writePayload as Record<string, any>).length > 0) {
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
   */
  async patchInTransaction(
    tx: FirebaseFirestore.Transaction,
    id: ID,
    data: UpdateInput<W>,
  ): Promise<void> {
    return this.updateInTransaction(tx, id, data, { merge: true });
  }

  /**
   * Create a document within a transaction.
   * Must be used inside runInTransaction callback.
   *
   * @param tx - Firestore transaction object
   * @param data - Document data
   * @returns Created document with ID
   * @throws {ValidationError} If validation fails
   *
   * @example
   * await repo.runInTransaction(async (tx, repo) => {
   *   const newOrder = await repo.createInTransaction(tx, {
   *     userId: 'user-123',
   *     total: 99.99,
   *     status: 'pending'
   *   });
   *   console.log('Order created:', newOrder.id);
   * });
   */
  async createInTransaction(
    tx: FirebaseFirestore.Transaction,
    data: CreateInput<W>,
  ): Promise<T & { id: ID }> {
    try {
      const docRef = this.col().doc();
      const docData = {
        ...(data as Record<string, any>),
        id: docRef.id,
      } as Record<string, any>;

      await this.runHooks('beforeCreate', docData);
      const validData = this.validateCreateData(docData as CreateInput<W>);
      const validatedDocData = { ...(validData as Record<string, any>) };

      tx.set(docRef, validatedDocData as any);
      return { ...validatedDocData, id: docRef.id } as T & { id: ID };
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
   * @param tx - Firestore transaction object
   * @param id - Document ID
   * @throws {NotFoundError} If document doesn't exist
   *
   * @example
   * await repo.runInTransaction(async (tx, repo) => {
   *   const item = await repo.getForUpdateInTransaction(tx, 'item-123');
   *   if (item && item.quantity === 0) {
   *     await repo.deleteInTransaction(tx, item.id);
   *   }
   * });
   */
  async deleteInTransaction(tx: FirebaseFirestore.Transaction, id: ID): Promise<void> {
    try {
      const docRef = this.col().doc(id);
      const snapshot = await tx.get(docRef);

      if (!snapshot.exists) throw new NotFoundError(`Document with ID ${id} not found`);

      const docData = { ...(snapshot.data() as T), id };
      await this.runHooks('beforeDelete', docData);
      tx.delete(docRef);
    } catch (error: any) {
      throw parseFirestoreError(error);
    }
  }
}
