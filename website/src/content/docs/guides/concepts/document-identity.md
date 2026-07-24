---
title: 'Document Identity'
description:
  'Virtual document identity in v3 — the no-top-level-id rule, generating and validating ids, and
  querying by the document name.'
---

In v3 the Firestore **document name is the sole authority for `id`**. Your schemas describe the
document's own data and never declare an `id`; the repository overlays the id onto every read. This
page is the canonical reference for the identity model — the other guides link here rather than
restating it.

## The no-top-level-`id` rule

A read / write / stored schema **must not** declare a top-level `id` field. `withSchema(...)` (and
`subcollection(...)`) throws at construction with a remedial error if one is present — the document
name is the only source of `id`, so a schema-level `id` would be ambiguous and is disallowed.

```typescript
// ❌ throws at construction — remove the id field
const bad = z.object({ id: z.string(), name: z.string() });
FirestoreRepository.withSchema(db, 'users', bad);

// ✅ the schema describes data only; the repository owns identity
const userSchema = z.object({ name: z.string(), email: z.string().email() });
const userRepo = FirestoreRepository.withSchema(db, 'users', userSchema);
```

A nested field named `id` (e.g. `author.id`) is unaffected — only a **top-level** `id` is rejected.

## Where `id` lives

The read type `T` carries **no** `id`. Reads resolve to `FirestoreDocument<T>`:

```typescript
type FirestoreDocument<T> = Omit<T, 'id'> & { readonly id: ID };
```

The `id` is always taken from `snapshot.id` (the document name) and overlaid after the read — it is
`readonly`, and never part of a write payload. So there are three distinct places identity shows up:

- **Schemas / write payloads** — no `id`. It is generated on `create`, or supplied as the `id`
  argument to `update` / `patch` / `upsert` / `delete`.
- **Read results** — a flat `FirestoreDocument<T>` with `id` overlaid from the document name.
- **Queries** — the synthetic `id` is not a stored field path; query the document name with
  `whereId(...)` / `orderById(...)` (see [below](#querying-by-id)).

`ID` is a `string` alias. `DataOf<R>` / `DocumentOf<R>` extract a repository's read-data and
document types without spelling the generics — see
[Exported Types](/firestore-orm/reference/types/).

## Generating ids

- **`create(data)`** and **`createInTransaction(tx, data)`** auto-generate a fresh id and return
  `{ id }` (or the document with `{ returnDoc: true }`).
- **`repo.newId(): ID`** generates a validated auto-id **without** writing. Persist under it
  explicitly with `upsert(id, …)` or a transaction `set`.
- **`upsert(id, data)`** creates or overwrites the document at a caller-chosen id — the path for
  deterministic/static ids (see [ID Strategies](/firestore-orm/guides/designing/id-strategies/)).

## Validating untrusted ids at the boundary

Every id-taking surface validates its id before touching Firestore — `getById`, `update`, `patch`,
`upsert`, `delete`, the `bulk*` methods, their `*InTransaction` equivalents, and `whereId`. A
malformed id throws `InvalidDocumentIdError` rather than escaping the collection boundary.

An id is rejected when it is empty, contains `/`, is `.` or `..`, is wrapped in a `__…__` reserved
pattern, or exceeds 1500 UTF-8 bytes. Validate a request-supplied id explicitly with
**`repo.id(raw)`** before use — it returns the value as an `ID` or throws:

```typescript
// A route handler receiving an untrusted id
app.get('/users/:id', async (req, res, next) => {
  try {
    const user = await userRepo.getById(userRepo.id(req.params.id));
    res.json(user);
  } catch (err) {
    next(err); // InvalidDocumentIdError → 400 via the Express errorHandler
  }
});
```

`InvalidDocumentIdError` carries a machine-readable `reason` (`InvalidDocumentIdReason`) and maps to
a `400` in the
[Express middleware](/firestore-orm/guides/integrations/express/#error-handling-middleware). The
error class is documented under
[Error Handling](/firestore-orm/reference/errors/#invaliddocumentiderror), and the security
rationale under [Trust Boundary & Security](/firestore-orm/guides/designing/security-boundary/).

## Querying by id

The synthetic `id` is **not** a stored field path, so `where('id', …)` and `orderBy('id')` are
compile errors. Query the document name with the id-aware clauses instead:

```typescript
// ❌ compile error — id is not a stored field
repo.query().where('id', '==', 'user-1');

// ✅ native document-name query via FieldPath.documentId()
await repo.query().whereId('==', 'user-1').getOne();
await repo.query().whereId('in', ['user-1', 'user-2']).get();

// stable pagination tiebreaker
await repo.query().orderBy('createdAt', 'desc').orderById().paginate(20);
```

`whereId(op, value)` takes a `string` for scalar operators and a `readonly string[]` for `in` /
`not-in`; `orderById(direction?)` defaults to ascending. See
[Queries](/firestore-orm/guides/working-with-data/queries/) and
[FirestoreQueryBuilder](/firestore-orm/reference/query-builder/).

## Legacy Datastore ids

Datastore-mode databases can have integer document ids, which do not satisfy the string-id rules
above. Opt into accepting them per repository with `allowLegacyDatastoreIds: true` in the
`withSchema` / `subcollection` options bag. Leave it off (the default) for Native-mode Firestore.
