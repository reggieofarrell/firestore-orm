# ADR-0015: Express adapter behind an optional `firestore-orm/express` subpath

- **Status:** Accepted (v3)
- **Date:** 2026-07-19
- **Deciders:** maintainer
- **Related:** ADR-0016 (dual build), ADR-0009 (error handling)

## Context

`errorHandler` imported `Request`/`Response`/`NextFunction` from `express` and was exported from the
package root, so `express` leaked into `dist/index.d.ts`. A consumer type-checking with
`skipLibCheck: false` and no `@types/express` installed failed to compile the library merely by
importing it — even when never using the Express adapter. `express` was only a devDependency, not a
runtime or peer dependency, so the reference was undeclared.

## Decision

We will move `errorHandler` to `src/express/index.ts`, exposed via a new
`@reggieofarrell/firestore-orm/express` subpath export, and declare `express` as an **optional peer
dependency** (`peerDependenciesMeta.express.optional`). The core root type graph no longer
references `express`; only consumers who import the subpath pull it in (and they already have
express installed). `parseFirestoreError` and the error classes stay framework-agnostic at the root.
This establishes the pattern for future framework adapters (each behind its own subpath + optional
peer).

## Consequences

The root package type-checks without `@types/express` under `skipLibCheck:false`, enforced by the
packed-consumer gate (ADR-0016 / the `release:verify` checks). Breaking: `errorHandler` moves from
the root import to `firestore-orm/express`, and consumers must install `express`. A CI check asserts
the shipped root declaration graph contains no `express` reference.

## Alternatives considered

Replace the express types with local structural interfaces and keep `errorHandler` at the root:
simpler and non-breaking, but leaves framework types in the core surface and offers no home for
future adapters. Make express a hard peer dependency: rejected — it would burden consumers who never
use the adapter.

## References

- [`src/express/index.ts`](../../src/express/index.ts),
  [`scripts/check-package-contents.mjs`](../../scripts/check-package-contents.mjs).
