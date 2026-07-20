# ADR-0014: Reject empty update payloads

- **Status:** Accepted (v3)
- **Date:** 2026-07-19
- **Deciders:** maintainer
- **Related:** ADR-0001 (point 2 — write semantics), ADR-0011 (no defaults on partial update)

## Context

When an update payload sanitized to zero fields (every value `undefined`, or a partial-update
default-strip), the repository skipped the Firestore `update()` call, still fired `afterUpdate`, and
returned the id. Because no write was attempted, the missing-document `NotFoundError` — which comes
from Firestore's own `update()` — never surfaced, so a nonexistent document was reported as
successfully updated. The three update surfaces also disagreed: single `update` always fired
`afterUpdate`, `bulkUpdate` reported all input ids, and `query().update()` tracked only written ids.

## Decision

We will reject an empty update payload with a `ValidationError` at every update surface — `update`,
`patch`, `bulkUpdate`, `bulkPatch`, `updateInTransaction`, `patchInTransaction`, and
`query().update()` — checked after sanitization via a shared per-class guard. This removes the
silent no-op, so the documented "update throws for a missing document" contract always holds (empty
→ `ValidationError`; non-empty on a missing doc → `NotFoundError`) and every surface behaves
identically. The empty-payload check is **not** data-dependent: `query().update()` validates and
rejects an empty payload even when the query matches zero documents (an earlier revision returned
`0` on the empty-snapshot path before validating, so an empty payload was silently accepted when
nothing matched). A **valid, non-empty** payload against a zero-match query still returns `0` —
there are simply no rows to write.

## Consequences

Callers can no longer issue an empty patch as a silent no-op — that is now a programming error made
visible. A mixed payload still filters `undefined` leaves and writes the rest. Supersedes ADR-0001
point 2's "an empty payload is a no-op" clause.

## Alternatives considered

Treat empty updates as explicit no-ops that do not fire hooks and document that existence is not
checked: rejected because it abandons the not-found guarantee for the empty case. Verify existence
before reporting success: rejected — an extra read on every empty update for no real benefit.

## References

- [`src/core/FirestoreRepository.ts`](../../src/core/FirestoreRepository.ts),
  [`src/core/QueryBuilder.ts`](../../src/core/QueryBuilder.ts) — `assertNonEmptyUpdatePayload`.
