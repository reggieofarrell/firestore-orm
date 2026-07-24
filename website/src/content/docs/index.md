---
# Splash landing page for the published docs site (distinct from the Documentation overview page).
title: '@reggieofarrell/firestore-orm'
description:
  Type-safe Firestore ORM for the Firebase Admin SDK — validation, hooks, and a fluent query
  builder.
template: splash
hero:
  title: '@reggieofarrell/firestore-orm'
  tagline:
    Type-safe Firestore for the Firebase Admin SDK. Repositories, Zod validation, lifecycle hooks,
    and a fluent query builder — built for Node.js backends.
  actions:
    # Include `base` explicitly: Starlight hero actions do not auto-prefix absolute `/…` links, and
    # relative `./…` links break when the splash URL is served without a trailing slash
    # (`/firestore-orm` → `./getting-started/` resolves to `/getting-started/`).
    - text: Get started
      link: /firestore-orm/getting-started/
      icon: right-arrow
      variant: primary
    - text: GitHub
      link: https://github.com/reggieofarrell/firestore-orm
      icon: external
      variant: minimal
---

## Why `@reggieofarrell/firestore-orm`?

- **Type-safe repositories** — one consistent API per collection, inferred from your Zod schemas.
- **Validation on writes** — schemas run before Firestore sees the payload; sentinels stay atomic.
- **Lifecycle hooks** — `before*` / `after*` hooks around create, update, and delete.
- **Fluent queries** — filters, pagination, aggregations, streaming, and real-time listeners.
- **Admin SDK native** — Express, NestJS, Cloud Functions, or any Node.js server.

## Where to go next

1. **[Getting Started](/firestore-orm/getting-started/)** — install peers, define a schema, create
   and query documents.
2. **[Documentation overview](/firestore-orm/overview/)** — full guide index by topic.
3. **[Core Concepts](/firestore-orm/guides/concepts/core-concepts/)** — repository pattern,
   converters, and delete semantics.
4. **[API Reference](/firestore-orm/reference/repository/)** — every `FirestoreRepository` /
   `FirestoreQueryBuilder` signature.
