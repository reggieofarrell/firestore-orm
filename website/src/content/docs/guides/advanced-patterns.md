---
title: 'Advanced Patterns'
description:
  'Custom repository methods, audit logging, caching, event-driven updates, and denormalization with
  FirestoreORM.'
---

Production-tested recipes that compose firestore-orm's hooks, transactions, and repository extension
points into larger architectural patterns.

Most of these recipes lean on two building blocks: [lifecycle hooks](./lifecycle-hooks/) to react to
writes, and [transactions](./transactions/) to keep connected writes atomic. Where a recipe uses the
`withSchema` factory, remember that the schema **must** include a required top-level
`id: z.string()` or the factory throws at construction — see
[schema validation](./schema-validation/) for details.

The recipes below are independent; jump to whichever one fits your problem:

- [Custom repository methods](#custom-repository-methods)
- [Audit logging](#audit-logging)
- [Caching layer](#caching-layer)
- [Full-text search](#full-text-search)
- [Event-driven architecture](#event-driven-architecture)
- [Multi-database pattern](#multi-database-pattern)
- [Data archiving](#data-archiving)
- [Rate limiting](#rate-limiting)
- [Subclassing for enforced denormalization](#subclassing-for-enforced-denormalization)

## Custom repository methods

Adding domain-specific helpers on top of a collection repository is a supported extension point.
Choose **subclassing** when callers should keep the full `FirestoreRepository` surface (plus your
methods), or **composition** when you want a narrower app-owned API (or when you prefer to keep
`withSchema` as the construction path).

### Subclassing

Extend `FirestoreRepository` and call its public methods from your helpers:

```typescript
import { FirestoreRepository, makeValidator } from '@reggieofarrell/firestore-orm';
import { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  active: z.boolean(),
});

type User = z.infer<typeof userSchema>;

class UserRepository extends FirestoreRepository<User> {
  constructor(db: Firestore) {
    // Pass a validator when the subclass needs the same runtime validation `withSchema` provides.
    // `withSchema` always returns a plain `FirestoreRepository` — it cannot construct your subclass.
    super(db, 'users', makeValidator(userSchema));
  }

  async findByEmail(email: string) {
    return this.findByField('email', email);
  }

  async deactivate(id: string) {
    return this.patch(id, { active: false });
  }
}

export const userRepo = new UserRepository(db);
```

Design constraints for subclasses:

- Build custom logic on the **public** API (`create`, `getById`, `findByField`, `query()`,
  transactions, hooks, and so on). Collection refs, validators, and other internals are `private`
  and are not available to subclasses.
- Prefer composition (below) when you want `withSchema`'s construction-time `id` check and options
  bag (`writeSchema`, `readConverter`, `sentinelPolicy`) without re-wiring them through
  `super(...)`.
- Override write entry points only when you must enforce extra behavior on every path — see
  [Subclassing for enforced denormalization](#subclassing-for-enforced-denormalization).

### Composition

Wrap a `withSchema` (or plain) repository and expose only the methods your app needs. This is the
same shape used by the [caching](#caching-layer) and [rate limiting](#rate-limiting) recipes, and by
the NestJS provider pattern in [Framework Integration](./framework-integration/):

```typescript
import { FirestoreRepository } from '@reggieofarrell/firestore-orm';

class UserRepository {
  private repo = FirestoreRepository.withSchema(db, 'users', userSchema);

  findByEmail(email: string) {
    return this.repo.findByField('email', email);
  }

  deactivate(id: string) {
    return this.repo.patch(id, { active: false });
  }

  // Delegate any other public methods your callers still need:
  getById(id: string) {
    return this.repo.getById(id);
  }
}

export const userRepo = new UserRepository();
```

Composition keeps validation and factory options on `withSchema`, while your wrapper owns the
convenience surface.

## Audit Logging

Track all data changes for compliance and debugging. A dedicated audit repository records who did
what, and lifecycle hooks feed it automatically on every create, update, and delete.

```typescript
// services/audit-log.service.ts
class AuditLogService {
  private auditRepo = new FirestoreRepository<AuditLog>(db, 'audit_logs');

  async record(action: string, data: any, userId?: string) {
    await this.auditRepo.create({
      action,
      data,
      userId: userId || 'system',
      timestamp: new Date().toISOString(),
      ipAddress: getCurrentIpAddress(),
      userAgent: getCurrentUserAgent(),
    });
  }
}

export const auditLog = new AuditLogService();

// Apply to all repositories
userRepo.on('afterCreate', async user => {
  await auditLog.record('user_created', user, user.id);
});

userRepo.on('afterUpdate', async ({ id }) => {
  const user = await userRepo.getById(id);
  if (user) {
    await auditLog.record('user_updated', user, id);
  }
});

userRepo.on('afterDelete', async user => {
  await auditLog.record('user_deleted', { id: user.id }, user.id);
});
```

Note the hook payload shapes: `afterCreate` receives the full created document, `afterUpdate`
receives only `{ id }` (so re-read the document if you need the new values), and `afterDelete`
receives the full persisted document that was just removed.

## Caching Layer

Add Redis caching to reduce Firestore reads. Wrap the repository so reads check the cache first and
writes invalidate it.

```typescript
// repositories/cached-user.repository.ts
import { Redis } from 'ioredis';

class CachedUserRepository {
  private repo = FirestoreRepository.withSchema(db, 'users', userSchema);
  private cache = new Redis(process.env.REDIS_URL);
  private cacheTTL = 300; // 5 minutes

  async getById(id: string): Promise<User | null> {
    // Check cache first
    const cached = await this.cache.get(`user:${id}`);
    if (cached) {
      return JSON.parse(cached);
    }

    // Fallback to Firestore
    const user = await this.repo.getById(id);
    if (user) {
      await this.cache.setex(`user:${id}`, this.cacheTTL, JSON.stringify(user));
    }

    return user;
  }

  async update(id: string, data: Partial<User>): Promise<User | null> {
    await this.repo.update(id, data);
    // Invalidate cache
    await this.cache.del(`user:${id}`);
    return this.repo.getById(id);
  }

  async create(data: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User & { id: string }> {
    return this.repo.create({
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  // Delegate other methods to repo...
  query() {
    return this.repo.query();
  }
}

export const cachedUserRepo = new CachedUserRepository();
```

`userSchema` here must include a required top-level `id: z.string()`, since
`FirestoreRepository.withSchema` throws at construction otherwise.

## Full-Text Search

Integrate with Algolia or Elasticsearch for full-text search. Firestore has no native full-text
index, so mirror your documents into a search service and keep the two in sync with hooks.

```typescript
// services/search.service.ts
import algoliasearch from 'algoliasearch';

class SearchService {
  private client = algoliasearch(process.env.ALGOLIA_APP_ID!, process.env.ALGOLIA_ADMIN_KEY!);
  private usersIndex = this.client.initIndex('users');
  private productsIndex = this.client.initIndex('products');

  async indexUser(user: User & { id: string }) {
    await this.usersIndex.saveObject({
      objectID: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
    });
  }

  async deleteUser(userId: string) {
    await this.usersIndex.deleteObject(userId);
  }

  async searchUsers(query: string) {
    const { hits } = await this.usersIndex.search(query);
    return hits;
  }
}

export const searchService = new SearchService();

// Sync with Algolia on user changes
userRepo.on('afterCreate', async user => {
  await searchService.indexUser(user);
});

userRepo.on('afterUpdate', async ({ id }) => {
  const user = await userRepo.getById(id);
  if (user) {
    await searchService.indexUser(user);
  }
});

userRepo.on('afterDelete', async user => {
  await searchService.deleteUser(user.id);
});
```

## Event-Driven Architecture

Publish domain events to a message queue. Repository hooks emit events, and any number of consumers
subscribe to them — decoupling side effects (email, analytics, inventory) from the write path.

```typescript
// services/event-publisher.service.ts
import { EventEmitter } from 'events';

class EventPublisher extends EventEmitter {
  async publish(event: string, data: any) {
    this.emit(event, data);
    // Also publish to external queue (RabbitMQ, SQS, etc.)
    await messageQueue.publish(event, data);
  }
}

export const eventPublisher = new EventPublisher();

// Publish events on repository actions
userRepo.on('afterCreate', async user => {
  await eventPublisher.publish('user.created', user);
});

orderRepo.on('afterCreate', async order => {
  await eventPublisher.publish('order.placed', order);
});

// Consumers can subscribe to events
eventPublisher.on('user.created', async user => {
  await emailService.sendWelcomeEmail(user.email);
  await analyticsService.trackSignup(user);
});

eventPublisher.on('order.placed', async order => {
  await inventoryService.reserveStock(order);
  await notificationService.notifyWarehouse(order);
});
```

## Multi-Database Pattern

Use different databases for different data types — for example, a primary database for transactional
data and a separate database for analytics/reporting. Each database gets its own `Firestore`
instance, and repositories are bound to the instance they read and write.

```typescript
// config/database.ts
import { getFirestore } from 'firebase-admin/firestore';

// Primary database for transactional data
export const primaryDb = getFirestore(primaryApp);

// Analytics database for reporting
export const analyticsDb = getFirestore(analyticsApp);

// repositories/user.repository.ts
export const userRepo = FirestoreRepository.withSchema(primaryDb, 'users', userSchema);

// repositories/analytics.repository.ts
export const userAnalyticsRepo = new FirestoreRepository<UserAnalytics>(
  analyticsDb,
  'user_analytics',
);

// Sync analytics data
userRepo.on('afterCreate', async user => {
  await userAnalyticsRepo.create({
    userId: user.id,
    signupDate: user.createdAt,
    source: user.source,
    plan: user.plan,
  });
});
```

## Data Archiving

Archive documents to a separate collection before permanently deleting them from the primary
collection. The generic helper works against any repository.

```typescript
class ArchivingService {
  private archiveRepo = new FirestoreRepository<ArchivedDocument>(db, 'archived_documents');

  async archiveAndDelete<T extends { id?: ID }>(
    repo: FirestoreRepository<T>,
    id: string,
  ): Promise<void> {
    // Get document
    const doc = await repo.getById(id);
    if (!doc) {
      throw new NotFoundError('Document not found');
    }

    // Archive to separate collection
    await this.archiveRepo.create({
      originalCollection: repo.getCollectionPath(),
      originalId: id,
      data: doc,
      archivedAt: new Date().toISOString(),
    });

    // Permanently delete from original collection
    await repo.delete(id);
  }
}

export const archivingService = new ArchivingService();

// Usage
await archivingService.archiveAndDelete(userRepo, 'user-123');
```

The generic parameter is constrained with `T extends { id?: ID }` to match `FirestoreRepository`'s
own constraint. For stronger guarantees you can run the read, the archive write, and the delete
inside a single [transaction](./transactions/).

## Rate Limiting

Implement rate limiting at the repository level by wrapping write methods and consuming a token
before each call.

```typescript
// decorators/rate-limited-repository.ts
import { RateLimiterMemory } from 'rate-limiter-flexible';

class RateLimitedRepository<T extends { id?: ID }> {
  private rateLimiter = new RateLimiterMemory({
    points: 100, // 100 requests
    duration: 60, // per 60 seconds
  });

  constructor(private repo: FirestoreRepository<T>) {}

  async create(data: T, userId: string): Promise<T & { id: string }> {
    await this.rateLimiter.consume(userId);
    return this.repo.create(data);
  }

  async update(id: string, data: Partial<T>, userId: string): Promise<{ id: string }> {
    await this.rateLimiter.consume(userId);
    return this.repo.update(id, data);
  }

  // Delegate other methods...
}

export const rateLimitedUserRepo = new RateLimitedRepository(userRepo);
```

As with the archiving helper, the generic parameter is constrained with `T extends { id?: ID }` so
it satisfies `FirestoreRepository`'s type bound.

## Subclassing for Enforced Denormalization

When you must guarantee that base document updates always include connected denormalized writes,
subclass `FirestoreRepository` and override write entry points so they all route through one
transactional path. For adding convenience helpers without changing write semantics, see
[Custom repository methods](#custom-repository-methods) first — the same public-API and `withSchema`
constraints apply here.

```typescript
import {
  FirestoreRepository,
  ID,
  NotFoundError,
  UpdateInput,
  UpdateOptions,
} from '@reggieofarrell/firestore-orm';
import { Firestore } from 'firebase-admin/firestore';

type Order = {
  id: string;
  userId: string;
  status: 'pending' | 'processing' | 'cancelled';
  updatedAt: string;
};

type User = {
  id: string;
  lastOrderId?: string;
  lastOrderStatus?: string;
  lastOrderAt?: string;
};

class OrderRepository extends FirestoreRepository<Order> {
  constructor(
    db: Firestore,
    private readonly userRepo: FirestoreRepository<User>,
  ) {
    super(db, 'orders');
  }

  // All order updates go through one transaction that also updates denormalized user fields.
  override async update(
    id: ID,
    data: UpdateInput<Order>,
    options?: UpdateOptions,
  ): Promise<{ id: ID } | (Order & { id: ID })> {
    return this.runInTransaction(async (tx, repo) => {
      const order = await repo.getForUpdateInTransaction(tx, id);
      if (!order) {
        throw new NotFoundError(`Order with id ${id} not found`);
      }

      await repo.updateInTransaction(tx, id, data, options);
      await this.userRepo.updateInTransaction(
        tx,
        order.userId,
        {
          lastOrderId: id,
          lastOrderStatus: (data as Partial<Order>).status ?? order.status,
          lastOrderAt: new Date().toISOString(),
        } as UpdateInput<User>,
        { merge: true },
      );

      if (options?.returnDoc === true) {
        const updated = await repo.getForUpdateInTransaction(tx, id);
        if (!updated) throw new NotFoundError(`Order with id ${id} not found after update`);
        return updated;
      }

      return { id };
    });
  }

  // Keep patch behavior aligned by delegating to the overridden update path.
  override async patch(
    id: ID,
    data: UpdateInput<Order>,
    options?: { returnDoc?: boolean },
  ): Promise<{ id: ID } | (Order & { id: ID })> {
    if (options?.returnDoc === true) {
      return this.update(id, data, { merge: true, returnDoc: true });
    }
    return this.update(id, data, { merge: true });
  }
}
```

`patch` deliberately takes only `{ returnDoc?: boolean }` — patch always merges, so there is no
`merge` option on it. The override reproduces that always-merge behavior by delegating to `update`
with `{ merge: true }`, keeping both entry points on the same transactional path.

Why this pattern is useful:

- It prevents accidental base-only writes because callers use your subclass methods, not the raw
  repository methods.
- It guarantees base + connected writes are atomic by committing them in one transaction.
- The same structure applies to `bulkUpdate`/`bulkPatch`, and to create/delete paths when
  denormalization must be enforced there as well.
