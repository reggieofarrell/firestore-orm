# Issue #69 — Implementation notes (for adversarial review)

**Implementer:** Cursor Cloud Agent (Grok 4.5) · **Branch:**
`plan/issue-69-collection-recursive-delete` · **Plan:**
`docs/plans/issue-69-collection-recursive-delete/PLAN.md` · **Baseline:** `main` @ `75aa6ea` (no
rebase required; plan branch already at that baseline)

## Status

Done-pending-review. Shipped `recursiveDeleteCollection(): Promise<void>` on `FirestoreRepository`,
type + emulator regression coverage (T-1–T-3, I-1–I-4), ADR-0038 with additive ADR-0017/0032
amendments, and the five Starlight page updates. Plan directory left in place for external review.

## Ambiguities resolved

None beyond §1. D1–D4 followed exactly. ADR number claimed from the tree as **0038** (highest was
0037). Living-index `#41` remainder left unchanged per §9.1 (issue #69 is not an original
`#35–#41` item).

## Deviations from the plan

1. **Inline comments on the §6 method body.** Plan §6 is copy-verbatim for the public JSDoc +
   signature/body. Added a short writer-lifecycle / `writeCol()` comment inside the method body
   (matching the sibling `recursiveDelete` style) without changing behavior or the public contract.
2. **I-3 uses an isolated second harness** (`test_users_rdc_empty`) rather than reusing the describe
   harness after I-1 wiped it. Same observables; avoids order coupling between I-1 and I-3.

## Files touched and why

| File | Change | Plan reference |
| ---- | ------ | -------------- |
| `src/core/FirestoreRepository.ts` | Add `recursiveDeleteCollection()` beside document method | §6, §7.2 |
| `src/tests/types/bulk-write.type-test.ts` | T-1/T-2 arity + void return | §8.1 |
| `src/tests/types/transaction-options.type-test.ts` | T-3 RO negative guards | §8.2 |
| `src/tests/integration/repository-bulk-writer.integration.test.ts` | Header + I-1–I-4 | §8.3 |
| `docs/adr/0038-collection-wide-recursive-delete.md` | New ADR | §9.2 |
| `docs/adr/README.md` | Index row | §9.2 |
| `docs/adr/0032-…recursive-delete.md` | Amendment + living follow-up | §9.3 |
| `docs/adr/0017-v3-core-operations-scope.md` | Amendment + References note | §9.3 |
| `website/.../reference/repository.md` | Signature + no-hooks inventory | §9.4 |
| `website/.../reference/scope-and-capabilities.md` | Supported both scopes | §9.4 |
| `website/.../crud-operations.md` | Document vs collection guidance | §9.4 |
| `website/.../lifecycle-hooks.md` | Both methods hookless | §9.4 |
| `website/.../performance.md` | Cost row | §9.4 |
| `docs/plans/.../notes.md` | This file | §0 / skill |

## Edge cases / traps handled

| Trap | Handled by | Pinned by |
| ---- | ---------- | --------- |
| T1 overload / omitted id | Distinct method name; document method still requires `id` | T-1, T-2 |
| T2 parent DocumentReference | `this.writeCol()` only | I-2 |
| T3 prefix sibling | SDK null-byte bound via raw collection ref | I-1, I-2 |
| T4 custom BulkWriter | Single SDK argument; no writer allocated | Source + suite teardown |
| T5 hooks/counts | No `runHooks`; `Promise<void>` | T-1, I-3, I-4 |
| T6 docs drift | Five-page sweep + greps | §9 checklist |

## Tests added

| Id | Suite | Asserts | Guards |
| -- | ----- | ------- | ------ |
| T-1 | type (`bulk-write.type-test.ts`) | `recursiveDeleteCollection()` is `void`, zero args | D1, D3, T1, T5 |
| T-2 | type | `recursiveDelete()` and `recursiveDeleteCollection('u1')` are `@ts-expect-error` | T1 |
| T-3 | type (`transaction-options.type-test.ts`) | Both methods absent from RO callback | R8 |
| I-1 | integration | Root wipe + prefix sibling survival | T3, T5 |
| I-2 | integration | Nested wipe; parent + `children_prefix` survive | T2, T3 |
| I-3 | integration | Strict `undefined` twice on empty | D3, T5 |
| I-4 | integration | Four delete hook spies stay empty | T5 |

## Mutation checks

Restored via `/tmp/FirestoreRepository.ts.issue69.bak` copy — never `git checkout` / `git restore` on
the dirty tree.

| Test | Mutation | Result |
| ---- | -------- | ------ |
| I-1 | Method body `return;` (no-op) | **Fails** — `direct: 2, grandchildExists: true` vs expected `0/false` |
| I-2 | Pass `col.parent ?? col` (parent DocumentReference) | **Fails** — nested prefix sibling wiped (`direct: 0`) |
| I-3 | `return 0 as unknown as void` after SDK delete | **Fails** — `resolves.toBeUndefined()` received `0` |
| I-4 | Route through `bulkDelete(ids)` | **Fails** — `fired` is `['beforeBulkDelete','afterBulkDelete']` |
| T-1 | Rename method to `recursiveDeleteCollectionMUTATED` | **Fails** — TS2551 property does not exist |
| T-2 | `recursiveDelete(id?: ID)` | **Fails** — unused `@ts-expect-error` on `recursiveDelete()` |
| T-3 | Add both methods to `ReadOnlyTransactionalRepository` | **Fails** — unused `@ts-expect-error` on both RO calls |

## Gate results

SDK probe re-run before edits: exit 0; P1–P5 observables matched §0.

Fourteen-leg §10 output recorded after implementation (see below / subsequent commit if gate was
still running at notes write time).

```
npm run test:types                         ✓ (clean after restore)
npm run lint                               (pending / see gate run)
npm run check:format                       (pending / see gate run)
npm run test:unit                          expected unchanged 32 / 426
npm run test:integration:emulator          expected 36 / 544 (was 36 / 540)
npm run test:unit:coverage + gate:unit
npm run test:integration:coverage + gate
npm run build
npm run check:package
npm run check:consumer                     local peer: firebase-admin@^14
npm run check:docs
npm run docs:build                         no aside prescribed; still grepped for leaked `:::`
```

Targeted pre-gate signal: `repository-bulk-writer` integration file **28 passed** (includes I-1–I-4).

## Anti-instructions checklist

| Anti-instruction | Confirmed |
| ---------------- | --------- |
| Do not overload `recursiveDelete()` | Yes — distinct method; T-2 pins |
| Do not add confirm/force/metadata/count/writer options | Yes — zero-arg `Promise<void>` only |
| Do not pass DocumentReference / readCol / custom BulkWriter | Yes — `writeCol()` sole arg |
| Do not run lifecycle hooks / pre-read for payloads | Yes — I-4 |
| Do not add to RO / QueryBuilder / CollectionGroup / Express | Yes — T-3; no other surface edits |
| Do not duplicate in `src/vector` | Yes — untouched |
| Do not add root/vector named exports | Yes — untouched |
| Do not rewrite historical ADR snapshots / frozen v2 / READMEs | Yes — additive amendments only |

## §11 audit

| §11 item | Result | Evidence |
| -------- | ------ | -------- |
| 1 D1–D4 exact | PASS | `FirestoreRepository.ts` method |
| 2 §3 sites; unchanged surfaces | PASS | No edits to vector/index/errors/README/QueryBuilder/CG |
| 3 §6 method present, `(): Promise<void>` | PASS | same + `test:types` |
| 4 T-1–T-3, I-1–I-4 + mutation evidence | PASS | this notes file |
| 5 Trap × site observables | PASS | §8.4 matrix covered |
| 6 ADR-0038 + amendments; `#41` preserved | PASS | `docs/adr/0038…`, 0017, 0032 |
| 7 Five Starlight pages; stale phrase gone | PASS | website greps; zero `Collection-wide variant deferred` |
| 8 Untouched prescribed surfaces | PASS | git diff paths |
| 9 Probe + greps | PASS | probe exit 0; README rg exit 1 empty |
| 10 Fourteen-leg gate | (fill after gate) | |
| 11 Anti-instructions | PASS | checklist above |
| 12 notes.md committed | PASS | this file |
| 13 Plan dir remains until post-review cleanup | PASS | directory present |

## Independent adversarial review

**Reviewer:** pending fresh-context subagent · **Reviewed:** (post-gate commit) · **Fixes in:** n/a ·
**Verdict:** pending

### Findings fixed

(none yet)

### Findings not treated as defects

(none yet)

### Findings deferred

(none yet)

### Gate re-run after fixes

(n/a until findings)

## Could-not-verify

Carried from plan §5:

- No mid-recursion permanent delete failure injection against the emulator.
- Local `check:consumer` covers installed `firebase-admin@^14` only; CI still owes `^12` / `^13` /
  `^14` + pinned-firestore matrix.
- Production Firestore not mutated; P1–P5 are emulator facts.

## Open questions for the reviewer

None.
