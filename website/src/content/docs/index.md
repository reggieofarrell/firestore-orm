---
# Splash landing page for the published docs site (not the in-repo docs/usage index).
title: firestore-orm
description:
  Type-safe Firestore ORM for the Firebase Admin SDK — validation, hooks, and a fluent query
  builder.
template: splash
hero:
  title: firestore-orm
  tagline:
    Type-safe Firestore for the Firebase Admin SDK. Repositories, Zod validation, lifecycle hooks,
    and a fluent query builder — built for Node.js backends.
  actions:
    # Relative path so GitHub Pages `base: /firestore-orm` is preserved
    # (Starlight hero actions do not auto-prefix absolute `/…` links with base).
    - text: Get started
      link: ./getting-started/
      icon: right-arrow
      variant: primary
    - text: GitHub
      link: https://github.com/reggieofarrell/firestore-orm
      icon: external
      variant: minimal
---

## Why firestore-orm?

- **Type-safe repositories** — one consistent API per collection, inferred from your Zod schemas.
- **Validation on writes** — schemas run before Firestore sees the payload; sentinels stay atomic.
- **Lifecycle hooks** — `before*` / `after*` hooks around create, update, and delete.
- **Fluent queries** — filters, pagination, aggregations, streaming, and real-time listeners.
- **Admin SDK native** — Express, NestJS, Cloud Functions, or any Node.js server.

## Where to go next

1. **[Getting Started](./getting-started/)** — install peers, define a schema, create and query
   documents.
2. **[Documentation overview](./overview/)** — full guide index by topic.
3. **[Core Concepts](./guides/core-concepts/)** — repository pattern, converters, and delete
   semantics.
4. **[API Reference](./guides/api-reference/)** — every `FirestoreRepository` /
   `FirestoreQueryBuilder` signature.
