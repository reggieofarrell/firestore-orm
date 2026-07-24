---
title: 'Express'
description:
  'Wire FirestoreORM into Express.js route handlers, and map ORM errors to HTTP responses with the
  bundled errorHandler middleware.'
---

Wire the repository into Express.js route handlers with schema-driven validation, and map the ORM's
typed errors to HTTP responses with the bundled `errorHandler` middleware.

The ORM is framework-agnostic: a repository is just an object you construct once and share. For the
error classes themselves, see [Error Handling](/firestore-orm/reference/errors/); for the schema
strategy, see [Schema Validation](/firestore-orm/guides/concepts/schema-validation/); for NestJS,
see [NestJS](/firestore-orm/guides/integrations/nestjs/).

## Basic setup

Construct the repository once and export it. Your schema must **not** declare a top-level `id` — it
is rejected at construction, and the document name is the sole source of `id` (see
[Document Identity](/firestore-orm/guides/concepts/document-identity/)). The returned repository is
fully typed and validated on every write.

```typescript
// repositories/user.repository.ts
import { FirestoreRepository } from '@reggieofarrell/firestore-orm';
import { db } from '../config/firebase';
import { userSchema, User } from '../schemas/user.schema';

export const userRepo = FirestoreRepository.withSchema(db, 'users', userSchema);
```

Define your routes as thin handlers that call the repository and forward any thrown error to the
shared `errorHandler` middleware via `next(error)`:

```typescript
// routes/user.routes.ts
import express from 'express';
import { userRepo } from '../repositories/user.repository';
import { ValidationError, NotFoundError } from '@reggieofarrell/firestore-orm';

const router = express.Router();

router.post('/users', async (req, res, next) => {
  try {
    const user = await userRepo.create(
      {
        ...req.body,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { returnDoc: true },
    );
    res.status(201).json(user);
  } catch (error) {
    next(error); // errorHandler middleware will process this
  }
});

router.get('/users', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status } = req.query;

    let query = userRepo.query();

    if (status) {
      query = query.where('status', '==', status);
    }

    const result = await query
      .orderBy('createdAt', 'desc')
      .offsetPaginate(Number(page), Number(limit));

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/users/:id', async (req, res, next) => {
  try {
    const user = await userRepo.getById(userRepo.id(req.params.id));

    if (!user) {
      throw new NotFoundError(`User with id ${req.params.id} not found`);
    }

    res.json(user);
  } catch (error) {
    next(error);
  }
});

router.patch('/users/:id', async (req, res, next) => {
  try {
    const user = await userRepo.update(
      userRepo.id(req.params.id),
      {
        ...req.body,
        updatedAt: new Date().toISOString(),
      },
      { returnDoc: true },
    );
    res.json(user);
  } catch (error) {
    next(error);
  }
});

router.delete('/users/:id', async (req, res, next) => {
  try {
    await userRepo.delete(userRepo.id(req.params.id));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
```

Register the routes and mount `errorHandler` **last** so it can translate ORM errors into HTTP
responses:

```typescript
// app.ts
import express from 'express';
import { errorHandler } from '@reggieofarrell/firestore-orm/express';
import userRoutes from './routes/user.routes';

const app = express();

app.use(express.json());
app.use('/api', userRoutes);
app.use(errorHandler); // Must be last

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

> Notes on the API used above:
>
> - Request-supplied ids are validated with `userRepo.id(req.params.id)` before touching Firestore —
>   a malformed id throws `InvalidDocumentIdError` (→ 400) rather than escaping the collection. See
>   [Document Identity](/firestore-orm/guides/concepts/document-identity/).
> - Reads use `getById(id)`, which returns `FirestoreDocument<User> | null` — check for `null` (or
>   use `getByIdOrThrow(id)` to get a `NotFoundError` instead).
> - Offset pagination is `offsetPaginate(page, pageSize)`. Cursor pagination is
>   `paginate(pageSize, cursor?)` and requires a prior `orderBy()`; there is no `.startAfter()`
>   chaining method. See [Queries](/firestore-orm/guides/working-with-data/queries/).
> - `update(id, data, { returnDoc: true })` returns the updated document. The `id` field is always
>   stripped from write payloads, so spreading `...req.body` is safe.

## Error-handling middleware

The ORM includes a pre-built Express middleware for consistent error responses. It is published from
the optional **`@reggieofarrell/firestore-orm/express`** subpath (not the package root), so
`express` stays out of the core type graph — install `express` to use it. Register it as the
**last** middleware, after all routes, and call `next(error)` from your route handlers (or throw and
let an async wrapper forward it).

It maps errors to HTTP status codes:

- `ValidationError` → 400 Bad Request
- `InvalidDocumentIdError` → 400 Bad Request (a malformed caller-supplied id; the body carries the
  machine-readable `reason`, never the raw id)
- `NotFoundError` → 404 Not Found
- `ConflictError` → 409 Conflict
- `FirestoreIndexError` → 503 Service Unavailable (a missing index is a server/config failure; the
  index-creation URL is deliberately **not** returned to the client — it stays server-side on the
  caught error's `indexUrl` for logging)
- Others → 500 Internal Server Error

**`errorHandler(err: any, req: Request, res: Response, next: NextFunction): void`**

Maps errors to HTTP status codes and JSON bodies:

| Error                    | Status | Response body                                                       |
| ------------------------ | ------ | ------------------------------------------------------------------- |
| `ValidationError`        | 400    | `{ error: 'ValidationError', details: issues }`                     |
| `InvalidDocumentIdError` | 400    | `{ error: 'InvalidDocumentIdError', reason }`                       |
| `NotFoundError`          | 404    | `{ error: 'NotFoundError', message }`                               |
| `FirestoreIndexError`    | 503    | `{ error: 'Query needs an index', message }`                        |
| `ConflictError`          | 409    | `{ error: 'ConflictError', message }`                               |
| Anything else            | 500    | `{ error: 'InternalServerError', message: 'Something went wrong' }` |

The generic 500 branch intentionally hides the underlying message so internal details are not leaked
to clients.

## See also

- [Error Handling](/firestore-orm/reference/errors/) — the error classes and `parseFirestoreError`
- [NestJS](/firestore-orm/guides/integrations/nestjs/) — the DI-based integration with an exception
  filter
- [Schema Validation](/firestore-orm/guides/concepts/schema-validation/) — the no-top-level-`id`
  schema rule
- [Queries](/firestore-orm/guides/working-with-data/queries/) — pagination (`paginate`,
  `offsetPaginate`)
- [CRUD operations](/firestore-orm/guides/working-with-data/crud-operations/) — `create`, `update`,
  `delete`, and bulk methods
