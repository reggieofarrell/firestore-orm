---
title: 'Helpers & Utilities'
description:
  'Runtime helpers exported from the package root — validation combinators, timestamp converters,
  and dot-notation utilities.'
---

The package root exports the runtime helpers the ORM uses internally so you can reuse them in your
own code. They fall into three families. For the narrative guides that use them, see
[Per-Field Sentinel Approval](/firestore-orm/guides/concepts/field-value-sentinels/),
[Timestamps ↔ Millis](/firestore-orm/guides/concepts/timestamps/), and
[Dot Notation](/firestore-orm/guides/working-with-data/dot-notation/).

## Validation combinators

Per-field **write combinators** let each field accept only its declared type or an explicitly
approved `FieldValue` sentinel. Build a `writeSchema` overlay from them — see
[Per-Field Sentinel Approval](/firestore-orm/guides/concepts/field-value-sentinels/).

| Combinator            | Field accepts                                                 |
| --------------------- | ------------------------------------------------------------- |
| `zNumberWrite()`      | `number` or `FieldValue.increment()`                          |
| `zArrayWrite(elem)`   | `elem[]` or `FieldValue.arrayUnion()` / `arrayRemove()`       |
| `zDateWrite()`        | `Date` or `FieldValue.serverTimestamp()`                      |
| `withDelete(schema)`  | the wrapped type or `FieldValue.delete()`                     |
| `zSentinel(...kinds)` | a sentinel of one of the named kinds (compose with `z.union`) |

`zNumberWrite()` / `zArrayWrite()` / `zDateWrite()` also accept `{ allowDelete: true }` to
additionally permit `FieldValue.delete()`. A `delete()` sentinel is still **rejected on `create` /
`bulkCreate` / `upsert`** regardless — clear a field with `update()` / `patch()`.

The lower-level primitives the repository is built from are also exported:

**`makeValidator<T extends ZodObject, U extends ZodObject = T>(readSchema: T, updateSchema?: U, opts?: { sentinelPolicy?: SentinelPolicy }): Validator<z.input<T>, z.output<T>>`**

Build the `Validator` a repository uses. Derives the create schema (top-level `id` stripped) and,
unless an explicit `updateSchema` is given, a `.partial()` update schema; `sentinelPolicy` defaults
to `'strict'`. `withSchema(...)` calls this for you.

**`isFieldValueSentinel(value: unknown): boolean`**

`true` when `value` is a Firestore `FieldValue` sentinel instance (admin `FieldValue` identity, plus
a structural check for `VectorValue`).

**`whichFieldValue(value: unknown): FieldValueKind`**

Classify a write sentinel into its `FieldValueKind` — `'serverTimestamp'`, `'arrayUnion'`,
`'arrayRemove'`, `'increment'`, `'delete'`, `'vector'`, or `'unknown'`.

**`collectSentinelPaths(input: unknown, basePath?): Path[]`**

Recursively collect every object path at which a `FieldValue` sentinel appears in `input`.

## Timestamp utilities

Store Firestore `Timestamp`s on write and read them as milliseconds-since-epoch `number`s. See
[Timestamps ↔ Millis](/firestore-orm/guides/concepts/timestamps/).

| Export                                       | Purpose                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `createMillisTimestampConverter<T>(fields?)` | Build a `readConverter` mapper (recursive `Timestamp -> number` read conversion)    |
| `convertTimestampsToMillis<T>(data)`         | Recursively convert every `Timestamp` in a value to an ms `number` (returns a copy) |
| `convertTimestampToMillis(ts)`               | Convert a single `Timestamp` to an ms `number` (throws if not a `Timestamp`)        |
| `convertMillisToTimestamp(ms)`               | Convert an ms `number` to a `Timestamp`                                             |

`convertTimestampsToMillis` uses a structural `toMillis` duck-check and never references
`firebase-admin`, so it is safe to reuse in shared/browser code; non-`Timestamp` value types (a
`VectorValue`, `GeoPoint`, or `DocumentReference`) are left untouched.

## Dot-notation utilities

Build and inspect dot-notation payloads. See
[Dot Notation](/firestore-orm/guides/working-with-data/dot-notation/).

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
