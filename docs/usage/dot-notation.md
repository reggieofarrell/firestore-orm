# Dot Notation for Nested Updates

Update individual nested fields in place — without replacing the whole parent object — using
Firestore's dot-notation field paths.

[← Documentation index](./README.md) · [Project README](../../README.md)

FirestoreORM supports Firestore's dot-notation syntax for updating nested fields without replacing
entire objects. This lets you change specific nested properties while preserving the other fields
already stored in that object.

## Basic Nested Update

```typescript
// Without dot notation - replaces entire address object
await userRepo.update('user-123', {
  address: {
    city: 'Los Angeles',
  },
});
// Result: { address: { city: 'Los Angeles' } }
// street, zipCode, and other fields are lost

// With dot notation - updates only city, preserves other fields
await userRepo.update('user-123', {
  'address.city': 'Los Angeles',
} as any);
// Result: { address: { city: 'Los Angeles', street: '123 Main', zipCode: '90001' } }
// street and zipCode are preserved
```

## Deep Nested Updates

```typescript
// Update deeply nested settings
await userRepo.update('user-123', {
  'profile.settings.notifications.email': true,
  'profile.settings.theme': 'dark',
} as any);

// Creates nested structure if it doesn't exist
await userRepo.update('user-123', {
  'metadata.preferences.language': 'en',
  'metadata.preferences.timezone': 'UTC',
} as any);
```

## Mixed Updates

```typescript
// Combine regular fields with dot notation
await userRepo.update('user-123', {
  name: 'John Doe', // Regular field
  'address.city': 'New York', // Nested field
  'address.zipCode': '10001', // Another nested field
  'profile.verified': true, // Different nested object
} as any);
```

## Update with Merge Mode

`update(id, data, { merge: true })` normalizes nested objects into dot-notation update paths and
uses Firestore `update(...)` under the hood. This lets you pass a natural nested object and still
get field-level merge semantics instead of whole-object replacement.

```typescript
await userRepo.update(
  'user-123',
  {
    'profile.settings.theme': 'dark',
  } as any,
  { merge: true },
);
```

Because it stays on the `update(...)` code path, `update()` semantics are preserved: a missing
document still throws `NotFoundError`.

When normalizing, explicit dot-notation keys always win over paths derived from flattening a nested
object. For example, an explicit `'profile.name'` overrides the `profile.name` that would otherwise
be produced by flattening `profile: { name: ... }` in the same payload.

`update()` accepts `{ merge?, returnDoc? }`. `merge` defaults to `false` (whole-object replacement);
set `returnDoc: true` to get the persisted document back instead of just `{ id }`.

## Patch Convenience Alias

Use `patch(...)` as a convenience alias for `update(..., { merge: true })`. `patch()` **always
merges** — there is no `merge` option to toggle; its only option is `{ returnDoc? }`. It applies the
same nested-object-to-dot-notation normalization as merge-mode `update()`, so you can pass either
nested objects or explicit dot-notation keys.

```typescript
await userRepo.patch('user-123', {
  profile: {
    settings: {
      theme: 'dark',
    },
  },
} as any);
```

## Merge/Patch/BulkPatch Limitation

Literal field names that contain a dot (`.`) are not supported by the merge/`patch`/`bulkPatch`
normalization. A dot-containing key is always interpreted as a nested field path, never as a single
top-level field whose name happens to include a dot.

## Bulk Updates with Dot Notation

```typescript
// Bulk update nested fields
await userRepo.bulkUpdate([
  {
    id: 'user-1',
    data: {
      'profile.verified': true,
      'settings.notifications': false,
    } as any,
  },
  {
    id: 'user-2',
    data: {
      'profile.verified': true,
    } as any,
  },
]);
```

## Bulk Patch Convenience Alias

Use `bulkPatch(...)` when you want merge-style normalization for batch updates without manually
flattening nested objects. Like `patch()`, `bulkPatch()` always merges.

```typescript
await userRepo.bulkPatch([
  {
    id: 'user-1',
    data: {
      profile: {
        settings: {
          theme: 'dark',
        },
      },
    } as any,
  },
  {
    id: 'user-2',
    data: {
      'profile.settings.notifications': true,
    } as any,
  },
]);
```

## Query Updates with Dot Notation

```typescript
// Update nested fields for all matching documents
await userRepo
  .query()
  .where('role', '==', 'admin')
  .update({
    'permissions.canDelete': true,
    'permissions.canEdit': true,
  } as any);

// Update deeply nested analytics
await postRepo
  .query()
  .where('published', '==', true)
  .update({
    'analytics.impressions': 0,
    'analytics.lastUpdated': new Date().toISOString(),
  } as any);
```

## Transactions with Dot Notation

`updateInTransaction(tx, id, data, options?)` supports dot notation directly. For merge-style
transaction updates without options, `patchInTransaction(tx, id, data)` is the always-merge
convenience alias (it takes no options).

```typescript
await userRepo.runInTransaction(async (tx, repo) => {
  // Read first only when your business logic needs current state
  const user = await repo.getForUpdateInTransaction(tx, 'user-123');

  if (!user) {
    throw new Error('User not found');
  }

  // Update nested fields directly
  await repo.updateInTransaction(tx, 'user-123', {
    'settings.theme': 'dark',
    'profile.lastLogin': new Date().toISOString(),
  } as any);
});
```

## FieldValue Sentinels

Dot-notation paths compose with Firestore `FieldValue` sentinels across every write surface. See
[Field Value Sentinels](./field-value-sentinels.md) for the full sentinel model and per-field
validation.

```typescript
import { FieldValue } from 'firebase-admin/firestore';

// Create with server timestamp
await userRepo.create({
  name: 'Alice',
  createdAt: FieldValue.serverTimestamp(),
} as any);

// Atomic updates
await userRepo.update('user-123', {
  loginCount: FieldValue.increment(1),
  tags: FieldValue.arrayUnion('beta-user'),
  deprecatedField: FieldValue.delete(),
} as any);

// Works in query updates and transactions too
await userRepo
  .query()
  .where('role', '==', 'admin')
  .update({
    tags: FieldValue.arrayRemove('legacy'),
  } as any);
```

## Important Notes

**1. Type Casting Required**

TypeScript requires `as any` for dot-notation keys since they are dynamic strings that do not exist
as literal keys on the write type:

```typescript
// Required type assertion
await userRepo.update('user-123', {
  'address.city': 'NYC',
} as any);
```

**2. Path Validation**

Dot-notation paths are validated by Firestore during write operations. If you want to validate a
path before issuing the write, use the exported `validateDotNotationPath(key)` helper (see
[Dot-Notation Utilities](#dot-notation-utilities) below).

**3. Firestore Limitations**

- **Undefined values** are automatically filtered out (Firestore doesn't accept `undefined`)
- Use `null` if you need to explicitly clear a field value

```typescript
// Undefined is filtered out, original value preserved
await userRepo.update('user-123', {
  'address.city': undefined,
} as any);

// Use null to clear a field
await userRepo.update('user-123', {
  'address.city': null,
} as any);
```

**4. Transaction Requirements**

`updateInTransaction()` supports dot notation directly. Use `getForUpdateInTransaction()` only when
your transaction logic needs the existing document state.

```typescript
// Valid - read first only when needed by business logic
await repo.runInTransaction(async (tx, repo) => {
  const doc = await repo.getForUpdateInTransaction(tx, 'doc-123');
  if (!doc) throw new Error('Document not found');
  await repo.updateInTransaction(tx, 'doc-123', {
    'nested.field': 'value',
  } as any);
});
```

**5. Schema Validation with Sentinels**

When using repositories created with `withSchema(...)`, the default `sentinelPolicy: 'permissive'`
ignores fields assigned to `FieldValue` sentinels during Zod validation while still validating all
other fields in the payload. To restrict which sentinels a field may receive, declare fields with
the write combinators and use `sentinelPolicy: 'strict'` — see
[Per-Field Sentinel Approval](./field-value-sentinels.md#per-field-sentinel-approval).

## Dot-Notation Utilities

The library exports the dot-notation helpers it uses internally, so you can build and inspect
dot-notation payloads in your own code. Import them from the package root:

```typescript
import {
  isDotNotation,
  hasDotNotationKeys,
  expandDotNotation,
  flattenToDotNotation,
  mergeDotNotationUpdate,
  validateDotNotationPath,
  getRootFields,
  getDotNotationDepth,
} from '@reggieofarrell/firestore-orm';
```

| Utility                                     | Signature                                                                              | Behavior                                                                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isDotNotation(key)`                        | `(key: string) => boolean`                                                             | `true` when the key contains a `.`.                                                                                                               |
| `hasDotNotationKeys(obj)`                   | `(obj: Record<string, any>) => boolean`                                                | `true` when any key in the object uses dot notation.                                                                                              |
| `expandDotNotation(flatObj)`                | `<T = any>(flatObj: Record<string, any>) => T`                                         | Expands flat dot-notation keys into a nested object.                                                                                              |
| `flattenToDotNotation(obj, prefix?)`        | `(obj: Record<string, any>, prefix?: string) => Record<string, any>`                   | Flattens a nested object into dot-notation keys. Only plain objects are flattened — arrays, `Date` instances, and class instances are left as-is. |
| `mergeDotNotationUpdate(existing, updates)` | `(existing: Record<string, any>, updates: Record<string, any>) => Record<string, any>` | Merges a mixed regular/dot-notation update into existing data, skipping `undefined` values.                                                       |
| `validateDotNotationPath(key)`              | `(key: string) => void`                                                                | Throws if the path is empty, starts or ends with a `.`, or contains an empty segment.                                                             |
| `getRootFields(keys)`                       | `(keys: string[]) => string[]`                                                         | Returns the unique top-level roots, e.g. `['address.city', 'address.zip', 'name']` → `['address', 'name']`.                                       |
| `getDotNotationDepth(key)`                  | `(key: string) => number`                                                              | Number of path segments, e.g. `'address.city'` → `2`, `'name'` → `1`.                                                                             |

```typescript
// Expand flat keys into a nested object
expandDotNotation({ 'address.city': 'LA', 'address.zip': '90001', name: 'John' });
// => { address: { city: 'LA', zip: '90001' }, name: 'John' }

// Flatten a nested object into dot-notation keys
flattenToDotNotation({ address: { city: 'LA', zip: '90001' }, name: 'John' });
// => { 'address.city': 'LA', 'address.zip': '90001', name: 'John' }

// Guard a path before writing
validateDotNotationPath('address..city'); // throws: Parts cannot be empty
```

## Use Cases

**User Preferences**

Update specific settings without replacing all preferences:

```typescript
await userRepo.update('user-123', {
  'preferences.emailNotifications': true,
  'preferences.theme': 'dark',
} as any);
```

**Nested Configurations**

Modify individual config values in complex objects:

```typescript
await configRepo.update('app-config', {
  'features.darkMode.enabled': true,
  'features.darkMode.autoSwitch': true,
  'features.analytics.trackingId': 'GA-123456',
} as any);
```

**Analytics Counters**

Update nested counter fields:

```typescript
await postRepo.update('post-123', {
  'analytics.views': 150,
  'analytics.likes': 42,
  'analytics.shares': 8,
} as any);
```

**Status Updates**

Update status in nested workflow objects:

```typescript
await orderRepo.update('order-123', {
  'workflow.payment.status': 'completed',
  'workflow.payment.completedAt': new Date().toISOString(),
  'workflow.fulfillment.status': 'pending',
} as any);
```

**Partial Address Updates**

Update only changed address fields:

```typescript
await userRepo.update('user-123', {
  'shippingAddress.street': '456 New Street',
  'shippingAddress.apt': '10B',
  // city, state, zipCode remain unchanged
} as any);
```
