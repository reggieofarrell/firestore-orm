# ADR-0017: v3 scope is Firestore Core operations; server-parity features are deferred

- **Status:** Accepted (v3)
- **Date:** 2026-07-19
- **Deciders:** maintainer
- **Related:** ADR-0001 (fork and 2.0 re-architecture), ADR-0015 (express adapter subpath), ADR-0016
  (dual build & support floor)

## Context

A follow-up to the v3 release review enumerated a large set of server-side Firestore features the
ORM does not expose first-class: composite `Filter.and(...)` / `Filter.or(...)` queries,
collection-group queries, read-only / PITR transaction options, conditional writes (create-only +
`lastUpdateTime` preconditions), generic multi-aggregation, multi-document `getAll`, `BulkWriter`,
Query Explain, the full cursor surface (`limitToLast`, typed bounds), richer listener metadata,
server-side distinct, and the pre-GA Enterprise Pipeline query model.

The round-2 review correctly noted that the round-1 response overstated completeness: its closing
line claimed "everything else in the review's final release gate is satisfied," but that gate lists
composite filters, transaction options, and conditional writes as pre-v3 items. Native query
streaming is the only follow-up item implemented on the v3 branch.

The original review's own guidance was that "the best v3 is a tightened, internally consistent
release rather than a larger one," and it did not recommend a broad new feature set. A repository
ORM also should not attempt to duplicate the entire server database plane, and the Enterprise
Pipeline API is still pre-GA.

## Decision

We will scope and describe **v3 as a type-safe ORM for Firestore _Core operations_**, not as full
server-side Firestore parity. Concretely:

1. **Ship the tightened contract set** already in v3 (create/read-model, strict sentinels,
   empty-update rejection, projection typing, native streaming, dual build, support floor, error
   normalization, security hardening) plus the cheap local guard for the SDK-invalid combination
   `select().onSnapshot()`.
2. **Document the scope and the escape hatch.** A "Scope & capability matrix" guide states which
   Core features are supported vs. deferred and documents the supported raw-SDK escape hatch:
   callers who own the injected `Firestore` instance can drop down to the Admin SDK for anything the
   ORM does not wrap. (`FirestoreQueryBuilder.getUnderlyingQuery()` remains `@internal` and returns
   `Query<any>`; it is not a re-entry point into the builder.)
3. **Defer the parity features to tracked v3.x work**, each recorded as a GitHub issue labeled
   `parity` / `v3.x`: composite filters (#30), collection-group queries (#31), transaction options /
   PITR (#32), conditional writes / preconditions (#33), generic multi-aggregation (#34), `getMany`
   multi-document reads (#35), typed lower-level bounds + `limitToLast` (#36), Query Explain (#37),
   BulkWriter + recursive delete (#38), snapshot/write metadata + detailed listeners (#39),
   server-side / structured-equality distinct (#40), and an experimental Enterprise Pipeline subpath
   (#41).

We explicitly do **not** block v3 on any of the deferred items.

## Consequences

The v3 release message is honest: a Core-operations ORM with documented Admin SDK escape hatches,
not a claim of full server-side or Enterprise Pipeline parity. Consumers needing a deferred
capability use the raw SDK today and can track/ upvote the corresponding issue. The round-1
response's completeness claim is corrected (see
`docs/development/v3-release-review-response-round2.md`). Future adapters (e.g. Pipelines) follow
the ADR-0015 pattern: a separate subpath, generic over an explicit output schema, rather than
overloading the Core builder that always returns `T & { id }`.

## Alternatives considered

**Implement the narrower pre-v3 parity set now** (composite filters, transaction options,
conditional writes, collection-group): rejected for v3 — it materially expands scope and delays the
release, and runs against the review's "tightened, not larger" guidance. These remain the
highest-priority v3.x additions.

**Narrow the release message to only the five original blockers and say nothing about parity:**
rejected — silence would let the package imply broader parity than it provides. An explicit
capability matrix is the honest middle ground.

## References

- The v3 release review and its round-2 response — "Server-side Firestore feature parity follow-up"
  (maintainer-local review records under `reviews/`, not committed to the repo).
- GitHub issues #30–#41 (labels `parity`, `v3.x`).
