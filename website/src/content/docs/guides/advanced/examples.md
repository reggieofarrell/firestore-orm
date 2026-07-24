---
title: 'Real-World Examples'
description: 'End-to-end e-commerce, multi-tenant, and social feed examples using FirestoreORM.'
---

Three end-to-end walkthroughs that combine schemas, hooks, transactions, queries, and real-time
listeners into production-shaped features.

Each example below is a complete slice — schema, repository (with its
[lifecycle hooks](/firestore-orm/guides/concepts/lifecycle-hooks/)), and a service class — so you
can see how the pieces fit together in a real application. For focused explanations of any single
mechanism, see [CRUD operations](/firestore-orm/guides/working-with-data/crud-operations/), the
[query builder](/firestore-orm/guides/working-with-data/queries/),
[transactions](/firestore-orm/guides/working-with-data/transactions/), and
[error handling](/firestore-orm/reference/errors/).

In this guide:

- [Example 1: E-commerce order system](#example-1-e-commerce-order-system)
- [Example 2: Multi-tenant SaaS application](#example-2-multi-tenant-saas-application)
- [Example 3: Social media feed with real-time updates](#example-3-social-media-feed-with-real-time-updates)

## Example 1: E-commerce order system

This example shows a full order lifecycle: validating inventory in a `beforeCreate` hook, reducing
stock and sending confirmation email in `afterCreate`, guarding shipped orders in `beforeUpdate`,
cancelling via a [transaction](/firestore-orm/guides/working-with-data/transactions/), and computing
revenue with `sum()` / `average()` [aggregations](/firestore-orm/guides/working-with-data/queries/).
Note that no schema declares a top-level `id` — `withSchema` rejects it at construction, and the
document name is the sole source of `id`.

```typescript
// schemas/order.schema.ts
import { z } from 'zod';

export const orderItemSchema = z.object({
  id: z.string(), // domain field inside each item (not the Firestore document id)
  productId: z.string(),
  productName: z.string(),
  quantity: z.number().int().positive(),
  price: z.number().positive(),
  subtotal: z.number().positive(),
});

export const orderSchema = z.object({
  userId: z.string(),
  items: z.array(orderItemSchema),
  total: z.number().positive(),
  status: z.enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled']),
  shippingAddress: z.object({
    street: z.string(),
    city: z.string(),
    state: z.string(),
    zipCode: z.string(),
    country: z.string(),
  }),
  trackingNumber: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Order = z.infer<typeof orderSchema>;
```

```typescript
// repositories/order.repository.ts
import { FirestoreRepository } from '@reggieofarrell/firestore-orm';
import { db } from '../config/firebase';
import { orderSchema, Order } from '../schemas/order.schema';
import { inventoryService } from '../services/inventory.service';
import { emailService } from '../services/email.service';

export const orderRepo = FirestoreRepository.withSchema(db, 'orders', orderSchema);

// Validate inventory before creating order
orderRepo.on('beforeCreate', async order => {
  for (const item of order.items) {
    const available = await inventoryService.checkStock(item.productId, item.quantity);

    if (!available) {
      throw new Error(`Insufficient stock for product ${item.productName}`);
    }
  }
});

// Update inventory and send confirmation after order creation
orderRepo.on('afterCreate', async order => {
  // Reduce inventory
  for (const item of order.items) {
    await inventoryService.reduceStock(item.productId, item.quantity);
  }

  // Send confirmation email
  await emailService.sendOrderConfirmation(order);

  // Log for analytics
  await analytics.track('order_placed', {
    orderId: order.id,
    total: order.total,
    itemCount: order.items.length,
  });
});

// Validate tracking number for shipped orders
orderRepo.on('beforeUpdate', data => {
  if (data.status === 'shipped' && !data.trackingNumber) {
    throw new Error('Tracking number required for shipped orders');
  }
});

// Send shipping notification
orderRepo.on('afterUpdate', async ({ id }) => {
  const order = await orderRepo.getById(id);
  if (order?.status === 'shipped') {
    await emailService.sendShippingNotification(order);
  }
});
```

The `beforeUpdate` payload is the update data merged with `{ id }`, so `data.status` is available
for the guard. The `afterUpdate` payload is just `{ id }`, so the hook re-reads the document with
`getById(id)` when it needs the full record.

```typescript
// services/order.service.ts
import { orderRepo } from '../repositories/order.repository';
import { userRepo } from '../repositories/user.repository';
import { ConflictError } from '@reggieofarrell/firestore-orm';

export class OrderService {
  async createOrder(userId: string, items: OrderItem[]) {
    // Verify user exists
    const user = await userRepo.getById(userId);
    if (!user) {
      throw new ConflictError('User not found');
    }

    // Calculate total
    const total = items.reduce((sum, item) => sum + item.subtotal, 0);

    // Create order (hooks will handle inventory and emails)
    return orderRepo.create({
      userId,
      items,
      total,
      status: 'pending',
      shippingAddress: user.defaultAddress,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  async getUserOrders(userId: string, page: number = 1, limit: number = 20) {
    return orderRepo
      .query()
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .offsetPaginate(page, limit);
  }

  async updateOrderStatus(orderId: string, status: Order['status'], trackingNumber?: string) {
    return orderRepo.update(
      orderId,
      {
        status,
        trackingNumber,
        updatedAt: new Date().toISOString(),
      },
      { returnDoc: true },
    );
  }

  async cancelOrder(orderId: string) {
    // Use transaction to ensure inventory is restored
    await orderRepo.runInTransaction(async (tx, repo) => {
      const order = await repo.getForUpdateInTransaction(tx, orderId);

      if (!order) {
        throw new Error('Order not found');
      }

      if (order.status !== 'pending') {
        throw new Error('Only pending orders can be cancelled');
      }

      await repo.updateInTransaction(tx, orderId, {
        status: 'cancelled',
        updatedAt: new Date().toISOString(),
      });
    });

    // Restore inventory after transaction (outside to avoid transaction limits)
    const order = await orderRepo.getById(orderId);
    for (const item of order!.items) {
      await inventoryService.restoreStock(item.productId, item.quantity);
    }
  }

  async getOrderStats(startDate: string, endDate: string) {
    const orders = await orderRepo
      .query()
      .where('status', '==', 'delivered')
      .where('createdAt', '>=', startDate)
      .where('createdAt', '<=', endDate)
      .get();

    const totalRevenue = await orderRepo
      .query()
      .where('status', '==', 'delivered')
      .where('createdAt', '>=', startDate)
      .where('createdAt', '<=', endDate)
      .sum('total');

    const avgOrderValue = await orderRepo
      .query()
      .where('status', '==', 'delivered')
      .where('createdAt', '>=', startDate)
      .where('createdAt', '<=', endDate)
      .average('total');

    return {
      totalOrders: orders.length,
      totalRevenue,
      avgOrderValue,
    };
  }
}
```

Reads use `getById(id)`, which returns `FirestoreDocument<T>` or `null` — there is no
`repo.get(id)`. The cancellation path uses `runInTransaction`, which hands you a transaction-scoped
`repo`; inside it, `getForUpdateInTransaction` locks the row and `updateInTransaction` stages the
write.

## Example 2: Multi-tenant SaaS application

A tenant record enforces a unique slug via `beforeCreate`, bootstraps a default workspace and owner
membership in `afterCreate`, and enforces seat limits with a
[transaction](/firestore-orm/guides/working-with-data/transactions/) so concurrent invites cannot
oversell seats.

```typescript
// schemas/tenant.schema.ts
export const tenantSchema = z.object({
  name: z.string(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  plan: z.enum(['free', 'pro', 'enterprise']),
  seats: z.number().int().positive(),
  usedSeats: z.number().int().nonnegative().default(0),
  features: z.array(z.string()),
  ownerId: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Tenant = z.infer<typeof tenantSchema>;
```

```typescript
// repositories/tenant.repository.ts
export const tenantRepo = FirestoreRepository.withSchema(db, 'tenants', tenantSchema);

// Ensure slug uniqueness
tenantRepo.on('beforeCreate', async tenant => {
  const existing = await tenantRepo.findByField('slug', tenant.slug);

  if (existing.length > 0) {
    throw new ConflictError('Tenant slug already exists');
  }
});

// Create default resources for new tenant
tenantRepo.on('afterCreate', async tenant => {
  // Create default workspace
  await workspaceRepo.create({
    tenantId: tenant.id,
    name: 'Default Workspace',
    ownerId: tenant.ownerId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Add owner as first member
  await memberRepo.create({
    tenantId: tenant.id,
    userId: tenant.ownerId,
    role: 'owner',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
});
```

`findByField('slug', value)` returns an array of matches, so the uniqueness check reads
`existing.length > 0`. The `afterCreate` payload is the persisted tenant including its generated
`id`, which the hook passes down to the workspace and member records.

```typescript
// services/tenant.service.ts
export class TenantService {
  async createTenant(ownerId: string, name: string, slug: string) {
    return tenantRepo.create({
      name,
      slug,
      plan: 'free',
      seats: 5,
      usedSeats: 1,
      features: ['basic_analytics', 'api_access'],
      ownerId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  async addMember(tenantId: string, userId: string, role: string) {
    // Use transaction to ensure seat limit
    await tenantRepo.runInTransaction(async (tx, repo) => {
      const tenant = await repo.getForUpdateInTransaction(tx, tenantId);

      if (!tenant) {
        throw new Error('Tenant not found');
      }

      if (tenant.usedSeats >= tenant.seats) {
        throw new Error('Seat limit reached. Please upgrade your plan.');
      }

      await repo.updateInTransaction(tx, tenantId, {
        usedSeats: tenant.usedSeats + 1,
      });
    });

    // Add member after transaction succeeds
    await memberRepo.create({
      tenantId,
      userId,
      role,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  async upgradePlan(tenantId: string, newPlan: Tenant['plan']) {
    const planSeats = {
      free: 5,
      pro: 25,
      enterprise: 100,
    };

    return tenantRepo.update(
      tenantId,
      {
        plan: newPlan,
        seats: planSeats[newPlan],
        features: this.getFeaturesForPlan(newPlan),
        updatedAt: new Date().toISOString(),
      },
      { returnDoc: true },
    );
  }

  private getFeaturesForPlan(plan: Tenant['plan']): string[] {
    const features = {
      free: ['basic_analytics', 'api_access'],
      pro: ['basic_analytics', 'api_access', 'advanced_analytics', 'priority_support'],
      enterprise: [
        'basic_analytics',
        'api_access',
        'advanced_analytics',
        'priority_support',
        'custom_domain',
        'sso',
      ],
    };

    return features[plan];
  }
}
```

Passing `{ returnDoc: true }` to `update` returns the updated document instead of just its id, which
is convenient for immediately echoing the new plan back to the caller.

## Example 3: Social media feed with real-time updates

This feed reads a user's follow graph, then serves both a live view (via `onSnapshot`) and a
paginated backfill (via `paginate`) of published posts from followed authors. See the
[query builder guide](/firestore-orm/guides/working-with-data/queries/) for the full surface of
`onSnapshot` and cursor pagination.

```typescript
// schemas/post.schema.ts
import { z } from 'zod';

export const postSchema = z.object({
  authorId: z.string(),
  status: z.enum(['draft', 'published']),
  content: z.string(),
  createdAt: z.string(),
});

export type Post = z.infer<typeof postSchema>;

export const followSchema = z.object({
  followerId: z.string(),
  followingId: z.string(),
});

export type Follow = z.infer<typeof followSchema>;
```

```typescript
// repositories/post.repository.ts
import { FirestoreRepository } from '@reggieofarrell/firestore-orm';
import { db } from '../config/firebase';
import { Follow, followSchema, Post, postSchema } from '../schemas/post.schema';

export const followRepo = FirestoreRepository.withSchema(db, 'follows', followSchema);
export const postRepo = FirestoreRepository.withSchema(db, 'posts', postSchema);

// Monitor new posts in real-time
export async function subscribeToUserFeed(userId: string, callback: (posts: Post[]) => void) {
  // Get list of users this user follows
  const following = await followRepo.query().where('followerId', '==', userId).get();

  const followingIds = following.map(f => f.followingId);

  // Subscribe to posts from followed users
  return postRepo
    .query()
    .where('authorId', 'in', followingIds)
    .where('status', '==', 'published')
    .orderBy('createdAt', 'desc')
    .limit(50)
    .onSnapshot(callback);
}
```

`onSnapshot(cb, onError?)` returns an unsubscribe function; call it to stop listening.

```typescript
// services/feed.service.ts
export class FeedService {
  private unsubscribe: (() => void) | null = null;

  async startFeedUpdates(userId: string, onUpdate: (posts: Post[]) => void) {
    this.unsubscribe = await subscribeToUserFeed(userId, onUpdate);
  }

  stopFeedUpdates() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  async getInitialFeed(userId: string, limit: number = 20) {
    const following = await followRepo.query().where('followerId', '==', userId).get();

    const followingIds = following.map(f => f.followingId);

    return postRepo
      .query()
      .where('authorId', 'in', followingIds)
      .where('status', '==', 'published')
      .orderBy('createdAt', 'desc')
      .paginate(limit);
  }

  async getMorePosts(userId: string, cursor: string, limit: number = 20) {
    const following = await followRepo.query().where('followerId', '==', userId).get();

    const followingIds = following.map(f => f.followingId);

    return postRepo
      .query()
      .where('authorId', 'in', followingIds)
      .where('status', '==', 'published')
      .orderBy('createdAt', 'desc')
      .paginate(limit, cursor);
  }
}
```

Pagination is `paginate(pageSize, cursor?)` and requires a prior `orderBy()` (it throws otherwise) —
the first page calls `paginate(limit)`, and subsequent pages pass the cursor returned by the
previous call as `paginate(limit, cursor)`. There is no `.startAfter()` chaining method; the cursor
threads through `paginate` itself.
