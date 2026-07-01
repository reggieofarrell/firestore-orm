# Test Coverage Follow-ups

Tracked gaps beyond the current test suite. Remove items when covered.

## QueryBuilder

- [x] `stream()` async generator
- [x] `onSnapshot()` query subscription
- [x] Pagination edge cases (missing orderBy, invalid page size, stale cursor)
- [x] `select()`, `in`, `array-contains`, `count()`

## FirestoreRepository

- [x] `bulkUpdate` / `bulkPatch` return shape assertions
- [ ] Batch chunking behavior (>500 operations) — may need focused unit test with mocks
- [ ] `listenOne` callback success path when document updates (partially covered)

## Infrastructure

- [ ] ESLint rules for test files (optional)
- [ ] SonarQube upload (only if org adopts it)

## Notes

Core CRUD, delete hooks, query pagination, subcollections, transaction lifecycle, errors,
validation, dot notation, update contracts, and sentinels are covered by the expanded suite
delivered with the testing infrastructure PR.
