# ADR-0038: Collection-wide recursive delete

- **Status:** Accepted (v3.x, pending merge/release)
- **Date:** 2026-08-01
- **Deciders:** maintainer
- **Related:** [Issue #69](https://github.com/reggieofarrell/firestore-orm/issues/69),
  [ADR-0017](0017-v3-core-operations-scope.md),
  [ADR-0032](0032-bulkwriter-high-throughput-writes-and-recursive-delete.md),
  `src/core/FirestoreRepository.ts` (`recursiveDeleteCollection`),
  `src/tests/integration/repository-bulk-writer.integration.test.ts`,
  `src/tests/types/bulk-write.type-test.ts`, `src/tests/types/transaction-options.type-test.ts`,
  repository / scope-and-capabilities / lifecycle-hooks / CRUD / performance Starlight guides

## Context

`delete(id)` removes one document and orphans its subcollections. Document-scoped
`recursiveDelete(id)` (ADR-0032 / #38) removes one document subtree, but wiping an entire repository
collection still required `query().get()` + `bulkDelete`, which leaves nested subcollections behind.
The Admin SDK's `Firestore.recursiveDelete()` already accepts a `CollectionReference` and deletes
every document in that collection plus all nested descendants.

Verified against the emulator (installed `firebase-admin`):

- A root or nested `CollectionReference` wipe clears direct docs and grandchildren.
- A longer-named collection that merely shares the target's id prefix survives (SDK null-byte upper
  bound).
- A nested wipe leaves the parent document and a `children_prefix` sibling intact.
- The return is `Promise<void>` (`undefined`); empty/repeated targets resolve.
- Omitting a caller-owned `BulkWriter` lets the SDK own the lazy writer lifecycle.

This is the most destructive call the library can expose. ADR-0032 deliberately deferred it to #69
so the guard (distinct name vs confirmation ceremony vs none) could be decided before shipping.

Issue #69 is a **separately tracked follow-up** to original ADR-0017 issue #38, not a new member of
the original `#35–#41` living-index set. Remaining original deferral `#41` is unchanged.

## Decision

We will ship collection-wide recursive delete as:

1. **Distinct method** `recursiveDeleteCollection(): Promise<void>` on `FirestoreRepository`. The
   collection-naming verb is the opt-in. We will **not** overload `recursiveDelete()` so an omitted
   document id never selects a collection wipe.
2. **No confirmation ceremony** — no `confirm`, `force`, or literal-token option. ADR-0032 already
   rejected magic confirmation flags; a distinct method name is the durable signal in source, types,
   logs, and autocomplete.
3. **Same contracts as document-scoped `recursiveDelete`:** no lifecycle hooks, no count, empty
   collection resolves, partial failure rejects as a whole-call error, retry is safe. Descendants
   may live in collections this repository does not model; hooks/counts cannot be synthesized
   honestly.
4. **Raw SDK delegation:** pass `this.writeCol()` (converter-free collection reference) as the sole
   argument to `this.db.recursiveDelete`. Do not construct a custom `BulkWriter`, do not reimplement
   the descendant query, and do not widen a nested wipe to a parent `DocumentReference`. Errors go
   through `parseFirestoreError`.

## Consequences

- Additive public API; `recursiveDelete(id)`, `delete(id)`, hooks, and existing return shapes stay
  unchanged.
- Calling the method deletes every document in the repository collection and all nested descendants.
- When the repository points at a subcollection, the parent document and sibling collections
  survive; longer prefix-named collections also survive.
- Partial success on rejection is possible (non-atomic); already-deleted docs stay deleted.
- No audit hooks and no returned count — callers that need modeled payloads must delete through
  concrete repositories instead.
- Capability matrix moves collection-wide recursive delete from Deferred → Supported under #69 /
  this ADR. Original ADR-0017 remaining deferral `#41` is unchanged.

## Alternatives considered

**Zero-argument overload / no distinct name.** Rejected — an accidentally omitted document id would
select the maximally destructive behavior.

**Confirmation token / `force` flag.** Rejected as ceremony (ADR-0032); the distinct method name is
sufficient.

**`query().get()` + `bulkDelete`.** Rejected — leaves orphaned subcollections and is the gap this
method closes.

**Custom writer / throttling / retry options.** Rejected — a supplied writer is flushed but not
closed (lifecycle leak); the SDK default already retries transient statuses.

**Hook or count synthesis.** Rejected — the SDK streams name-only snapshots across arbitrary
descendant collections and reports no count.

**Leave callers on the raw SDK forever.** Rejected for the common repository-collection case; the
ORM already wraps the document-scoped half and the collection half is the same SDK entry point.

## References

- [Issue #69](https://github.com/reggieofarrell/firestore-orm/issues/69)
- [ADR-0017](0017-v3-core-operations-scope.md),
  [ADR-0032](0032-bulkwriter-high-throughput-writes-and-recursive-delete.md)
- Implementation: `src/core/FirestoreRepository.ts` (`recursiveDeleteCollection`)
- Tests: `src/tests/integration/repository-bulk-writer.integration.test.ts`,
  `src/tests/types/bulk-write.type-test.ts`, `src/tests/types/transaction-options.type-test.ts`
- Docs: `website/src/content/docs/reference/repository.md`,
  `website/src/content/docs/reference/scope-and-capabilities.md`,
  `website/src/content/docs/guides/working-with-data/crud-operations.md`,
  `website/src/content/docs/guides/concepts/lifecycle-hooks.md`,
  `website/src/content/docs/guides/designing/performance.md`

> Living note: issue #69 is a separately tracked #38 follow-up. The original ADR-0017 remaining
> deferral (**#41**) is unchanged because #69 was never an original `#35–#41` living-index item.
