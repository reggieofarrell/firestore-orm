# Test Coverage Follow-ups

Tracked gaps beyond the current test suite. Remove items when covered.

## QueryBuilder (lower priority)

- [ ] `stream()` async generator over large result sets
- [ ] `onSnapshot()` real-time query subscription (beyond `listenOne` on repository)
- [ ] `query().update()` hook edge cases not covered by sentinel suite

## FirestoreRepository

- [ ] `bulkUpdate` / `bulkPatch` return shape assertions in dedicated suite
- [ ] Batch chunking behavior (>500 operations) — may need focused unit test with mocks
- [ ] `listenOne` additional error paths

## Infrastructure

- [ ] ESLint rules for test files (optional)
- [ ] SonarQube upload (only if org adopts it)

## Notes

Core CRUD, delete hooks, query pagination, subcollections, transaction lifecycle, errors,
validation, dot notation, update contracts, and sentinels are covered by the expanded suite
delivered with the testing infrastructure PR.
