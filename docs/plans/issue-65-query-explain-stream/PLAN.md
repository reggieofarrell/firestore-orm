# Issue #65 — Query explainStream() for Core queries

**Implementer:** handoff agent · **Reviewer:** independent reviewer · **Baseline:** main @ aa58f7ae2fe39c75ebd7762eaa745a0724784589 (fix(types): preserve literal paths beside index signatures (#58) (#83)) · **Branch:** codex/issue-65-query-explain-stream — already created and pushed; check it out, do not cut a new one.

**Issue:** [#65](https://github.com/reggieofarrell/firestore-orm/issues/65) — labels enhancement, parity, v3.x. This separately tracked Core-only follow-up to #37 / ADR-0031 is not an original ADR-0017 #35–#41 item, so no living-index range changes.

> **Acceptance (verbatim issue summary):** “Add explainStream() on Core query builders (FirestoreQueryBuilderBase), deferred from #37.”

## §0 How to use this plan

1. Read §1 and §4, rebase main, then repeat §3 enumeration before edits.
2. §6 is copy-verbatim and compile-checked (V3); no production prototype exists.
3. Re-run probes/; §3 takes precedence over the issue body.
4. Follow plan-execution and commit notes.md with deviations, mutation checks, commands, and refute-first review.
5. Keep this directory through external review, then final-cleanup it with git rm -r docs/plans/issue-65-query-explain-stream/.

## §1 Owner-approved decisions

| Id | Fork | Decision | Rejected alternative and why |
| --- | --- | --- | --- |
| D1 | Placement | Add to FirestoreQueryBuilderBase, inherited by collection/group. | Collection-only misses Core Query surface. |
| D2 | Result | **Derived, not asked:** AsyncGenerator<QueryExplainStreamResult<R>> maps documents with toResult and forwards metrics. | Raw Node readable stream leaks snapshots and group path/parentPath. |
| D3 | Types | Reuse private Query-derived aliases; capability-check query.explainStream. | Named Explain imports fail from firebase-admin and gcloud is undeclared in public d.ts. |
| D4 | Error | Local hasLimitToLast guard; parse SDK stream errors. | SDK says Use Query.explain(), wrong wrapper contract. |
| D5 | Scope | No VectorQuery/Aggregate method; preserve vector negative docs. | Vector runtime method is absent. |

These decisions are settled.

## §2 Scope / scope correction

In: QueryBuilder type/generator/JSDoc, root export, unit/integration/type tests, four Starlight pages, ADR-0036/index, amendments to ADR-0017/0031.

Out: src/vector, AggregateQuery, peer bump, production-metrics CI, existing explain() semantics. The issue does not state the stream result type; D2 settles that omission. Do not expose an untyped raw readable stream.

## §3 Verified facts

### P1 — installed SDK probe

Run node docs/plans/issue-65-query-explain-stream/probes/sdk-surface.mjs.

| Id | Expression | Observed |
| --- | --- | --- |
| P1a | typeof Core Query.explainStream | function |
| P1b | typeof VectorQuery.explainStream | undefined |
| P1c | limitToLast(1).explainStream({ analyze: true }) | synchronous: Query results for queries that include limitToLast() constraints cannot be streamed. Use Query.explain() instead. |
| P1d | tree | firebase-admin@14.2.0 → @google-cloud/firestore@8.6.0 |

SDK declaration: Query.explainStream(options?: ExplainOptions): NodeJS.ReadableStream, optional document/metrics chunks, node_modules/@google-cloud/firestore/types/firestore.d.ts:1933-1962. firebase-admin exports Query but no named Explain types, node_modules/firebase-admin/lib/firestore/index.d.ts:22-26.

### P2 — emulator probe

Run firebase emulators:exec --project demo-firestoreorm-test --only firestore "node docs/plans/issue-65-query-explain-stream/probes/emulator-stream.mjs".

| Id | Condition | Observed |
| --- | --- | --- |
| P2a | one seeded document, analyze true | one document chunk; hasMetrics false |

It exited 0; it proves mapping only, never production diagnostics.

### N1 — site enumeration

| Id | Fact | Evidence |
| --- | --- | --- |
| N1a | base owns query / limit state | src/core/QueryBuilder.ts:370-381 |
| N1b | stream generator has guard, AsyncIterable cast, mapping/parser pattern | src/core/QueryBuilder.ts:1409-1435 |
| N1c | explain has aliases/capability pattern | src/core/QueryBuilder.ts:79-105,1714-1740 |
| N1d | collection/group select copy limit flag | src/core/QueryBuilder.ts:1948-1956; src/core/CollectionGroup.ts:301-316 |
| N1e | Explain unit/integration/type seams | src/tests/unit/query-explain.unit.test.ts:1-217; src/tests/integration/query-explain.integration.test.ts:1-73; src/tests/types/query-explain.type-test.ts:17-112 |
| N1f | root export site | src/index.ts:14-24 |
| N1g | deferred docs | reference/query-builder.md:146-160; guides/working-with-data/queries.md:518-542; reference/scope-and-capabilities.md:46-58; guides/migration-v2-to-v3.md:190-193 |

Change exactly: src/core/QueryBuilder.ts; src/index.ts; unit query-explain and queryBuilderBounds; integration query-explain; type query-explain; four N1g pages; docs/adr/0017, 0031, README; new ADR-0036.

**Deliberately NOT changed:** vector QueryBuilder/index/vector guide (P1b); README.md:37,77 and npm-readme.md:32-33 (generic streaming marketing only); frozen website/src/content/docs/2.0/**.

### N2 — coverage headroom

| Gate | Lines | Branches | Functions | Slack |
| --- | --- | --- | --- | --- |
| QueryBuilder | 2135/2203 96.91% (90) | 203/230 88.26% (75) | 62/62 100% (95) | 152 lines, 30 branches, 3 functions |
| CollectionGroup | 446/448 99.55% | 35/36 97.22% | 20/20 100% | unchanged inherited method |

Measured from coverage/integration/lcov.info against scripts/check-coverage-gates.mjs:146-156.

## §4 Traps

- **T1 raw stream leaks identity (D2/N1b):** it compiles but returns snapshots; group identity disappears. U-1/I-1 and U-2/I-2 observe mapped outputs.
- **T2 native limit guard (P1c/N1d):** omit local guard and native stream opens with wrong delayed error; U-4's native spy must stay untouched including selected collection/group.
- **T3 emulator false-green (P2):** it emits docs with no metrics. I tests assert absent metrics; U mock owns a metrics chunk.
- **T4 non-generic readable (P1a):** public stream must use optional-field type; T-1/T-2 prove inference/projection.
- **T5 error confusion (N1b/N1c):** missing capability is plain local Error; coded stream failures parse. U-3a/U-3b distinguish.
- **T6 vector scope creep (P1b):** vector docs are deliberately negative; no vector method/export.

## §5 Could not verify / bounds

No production metrics and only Admin 14 were run; CI/check:consumer keep peer responsibility. Prototype skipped because the method is local/inherited and all sites are enumerated; coverage/mapping are post-change obligations. Aggregate diagnostics remain deferred.

## §6 API specification

In src/core/QueryBuilder.ts after QueryExplainResult, add public type QueryExplainStreamResult<R> with readonly optional document: R and metrics: ExplainMetrics. Its JSDoc must say: document chunks are builder-mapped R; terminal diagnostics chunks carry metrics; fields are optional because SDK emits separately.

After explain(), add this exact method. Its JSDoc must cover Core-only inheritance, analyze, chunk separation, local limitToLast rejection, emulator no-metrics, Firestore SDK >=7.4, and a for-await example.

```ts
async *explainStream(options?: ExplainOptions): AsyncGenerator<QueryExplainStreamResult<R>> {
  if (this.hasLimitToLast) {
    throw new Error(
      'explainStream() is not supported after limitToLast(): Firestore cannot stream limitToLast ' +
        'queries. Use explain() instead.',
    );
  }
  if (typeof this.query.explainStream !== 'function') {
    throw new Error(
      'explainStream() is not available: the installed Firestore SDK does not expose ' +
        'Query.explainStream(). Query Explain requires @google-cloud/firestore >= 7.4 ' +
        '(firebase-admin 12 only when the resolved @google-cloud/firestore is new enough; ' +
        'firebase-admin >= 13 typically bundles it). Upgrade firebase-admin (or ' +
        '@google-cloud/firestore).',
    );
  }
  try {
    const source = this.query.explainStream(options) as unknown as AsyncIterable<{
      document?: QueryDocumentSnapshot<any>;
      metrics?: ExplainMetrics;
    }>;
    for await (const chunk of source) {
      yield {
        ...(chunk.document === undefined ? {} : { document: this.toResult(chunk.document) }),
        ...(chunk.metrics === undefined ? {} : { metrics: chunk.metrics }),
      };
    }
  } catch (error: unknown) {
    throw parseFirestoreError(error);
  }
}
```

Like stream(), guards execute on first iteration. The cast is required by P1a. Do not yield explicit undefined fields.

In src/index.ts, add QueryExplainStreamResult to the existing QueryExplainResult type-export group. Do not re-export from /vector. Estimated eight existing files plus ADR-0036, +210/-20 lines.

## §7 Implementation sequence and anti-instructions

1. Checkout/rebase/re-enumerate.
2. Add type/generator, then root export.
3. Add type tests, then unit boundary mocks, then emulator collection/group tests.
4. Mutation-check tests against unfixed code; write outcomes to notes.md.
5. Complete §9, run §10, preserve plan for review, cleanup after approval.

Do NOT return raw stream; add Vector/Aggregate surface; claim emulator metrics; put local guards in try; alter explain() limit behavior; touch v2 docs/READMEs absent evidence; or commit unless asked.

## §8 Test specification

| Suite | Id | Assertion / observable | Guards |
| --- | --- | --- | --- |
| unit query-explain | U-1 | options forwarded, data/id mapping, metrics-only chunk identity | T1,T3,T4 |
| unit query-explain | U-2 | group maps id/path/parentPath | T1 |
| unit query-explain | U-3a/U-3b | missing method upgrade hint; coded async error becomes NotFoundError | T5 |
| unit bounds | U-4a/U-4b | limit native spy untouched; select retains guard in collection/group, later limit clears it | T2 |
| integration query-explain | I-1/I-2 | collection/unique-group analyze stream map identity and have no metrics; finally cleanup | T1,T3 |
| type query-explain | T-1 | root import/inference equals AsyncGenerator<QueryExplainStreamResult<FirestoreDocument<User>>> | T4 |
| type query-explain | T-2/T-3 | select projection preserved; group names path/parentPath | T1,T4 |

Each type test fails baseline because method/type are absent. Mutation-check U/I by removing mapping, guard, capability, parser, or method and record the observable. I tests document P2; they do not claim production metrics.

| Trap | Site | Falsifying test / observable |
| --- | --- | --- |
| T1 | collection/group | U-1/I-1/T-2 id/data; U-2/I-2/T-3 path/parentPath |
| T2 | base/select/group select | U-4 native spy untouched |
| T3 | emulator/unit | I absent metrics; U preserved metrics |
| T4 | root/projected types | T-1/T-2 signature |
| T5 | capability/SDK | U-3a hint; U-3b NotFoundError |
| T6 | vector | P1b + §11 audit |

QueryBuilder is integration coverage gate, index is unit gate, types use test:types. N2 headroom is not permission to leave new lines uncovered.

## §9 Docs and ADR bookkeeping

Create docs/adr/0036-query-explain-stream.md from template, Accepted (v3.x, pending merge/release). Include P1/P2, D1–D5, mapping/guard/no peer bump, and alternatives raw stream/vector/native guard/production CI. Add row after 0035 in ADR README.

Append, never rewrite, Amendment (3.0.0, issue #65):
- docs/adr/0017-v3-core-operations-scope.md:107-114: Core stream ships; vector absent; #41 remains original deferred item.
- docs/adr/0031-query-explain.md:100-108: #65 ships under ADR-0036.

Run rg -n "remaining deferrals" docs/adr. Expected #41 wording unchanged: #65 is separate, not original #35–#41.

| Website file | Line | Edit |
| --- | --- | --- |
| reference/query-builder.md | 146-160 | signature/chunks/analyze/group/guard/emulator; remove deferral |
| guides/working-with-data/queries.md | 518-542 | for-await document/metrics example; Core-only/emulator caveat |
| reference/scope-and-capabilities.md | 46,49-58 | supported Core stream; remove Deferred #65 |
| guides/migration-v2-to-v3.md | 190-193 | Core stream/no-vector/emulator caveat |

Website markdown is Prettier-exempt. Match style; if adding an aside, docs:build then grep HTML for leaked :::.

Run rg -n -i "explain|query builder|stream" README.md npm-readme.md. Expected generic marketing only: no readme-sync change; record in notes.md/PR.

## §10 Gate and commit

```bash
export PATH="/Users/reggieofarrell/.nvm/versions/node/v24.18.0/bin:$PATH"
npm run test:types && npm run lint && npm run check:format && npm run test:unit && npm run test:integration:emulator && npm run test:unit:coverage && npm run test:coverage:gate:unit && npm run test:integration:coverage && npm run test:coverage:gate:integration && npm run build && npm run check:package && npm run check:consumer && npm run check:docs && npm run docs:build
```

All 14 legs passed baseline: unit **32 suites / 417 tests**; integration **35 suites / 532 tests**. Unit/integration/type counts must rise and QueryBuilder integration gate stays green.

Re-run probes plus rg -n "explainStream" src/core/QueryBuilder.ts src/index.ts website/src/content/docs docs/adr. Expected Core/docs/ADR references and no VectorQueryBuilder method.

Commit: feat(query): add Core explainStream diagnostics (#65)

Breaking: no—new v3 API, no existing signature/peer/vector change.

## §11 Definition of done

- D1–D5 and §6 implemented, with existing explain() unchanged.
- §8 tests fail baseline, have mutation evidence, and owning gates pass.
- §9 docs/ADR/README determination complete, no false #35–#41 update.
- No Vector/Aggregate false surface; full §10 gate passes with increased counts.
- notes.md has self-review; external review happens before plan cleanup.
- No §7 anti-instruction violated; final approved cleanup removes this directory.

## §12 Pre-handoff verification

| Check | Method | Result |
| --- | --- | --- |
| P1 SDK | node sdk-surface.mjs | Core function, Vector undefined, exact native throw |
| P2 emulator | firebase emulators:exec probe | one document, no metrics |
| §6 compile | temporary src/issue65-plan-compile.ts plus test:types, then deleted | initial ambient-class draft failed; corrected abstract-class copy passed |
| imports | scratch Query/QueryDocumentSnapshot import from firebase-admin/firestore | resolved, no named Explain import |
| declaration safety | alias/package inspection | no public undeclared gcloud name |
| headroom | LCOV/gate script | N2 recorded |
| full gate/counts | §10 command | all passed; 32/417 unit, 35/532 integration |
| conditionals | re-read §§1–10 | none; D2 resolves only omission |

### Appendix

| Probe | Purpose |
| --- | --- |
| sdk-surface.mjs | installed Core/vector/limit behavior |
| emulator-stream.mjs | emulator metrics-chunk behavior |
