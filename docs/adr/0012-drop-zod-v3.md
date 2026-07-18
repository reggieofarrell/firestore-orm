# ADR-0012: Drop zod v3; require zod `^4.0.0`

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** Reggie O'Farrell
- **Related:** [0010](0010-type-safe-dot-notation.md) (tolerated both Zod majors; deferred a v3 CI
  matrix — Consequences), [0011](0011-no-defaults-on-partial-update.md) (fix constrained by the
  `^3.25 || ^4` peer range — Context), [0001](0001-fork-and-2.0.0-rearchitecture.md) (zod first
  tightened to `^3.25.0 || ^4.0.0`),
  [issue #26](https://github.com/reggieofarrell/firestore-orm/issues/26)

## Context

The package declared `zod` as a peer at `^3.25.0 || ^4.0.0`, but v3 was never actually supported in
practice:

- **v3 is untested everywhere.** The devDependency, `npm ci` in CI, and every suite (unit,
  integration, type) resolve `zod@^4.0.0` only (installed: `4.4.3`). The CI matrix in
  `.github/workflows/tests.yml` is over suite type, not zod version — there is no v3 leg. Issue #26
  tracked adding one.
- **The code already does not typecheck against v3.** `src/core/Validation.ts` casts a dot-path
  error issue to `z.core.$ZodIssue`, a **v4-only** type export. A v3 `test:types` run would fail on
  that line. So the "defensive v3 support" was already broken at the type level; adding a v3 CI leg
  (issue #26) would require _fixing_ v3 first and then maintaining dual wrapper-internals paths
  indefinitely.
- All v3-compat runtime code was confined to one file (`src/core/Validation.ts`) — the
  `unwrapWrappers` / `normalizedKind` / `objectAllowsUnknownKeys` helpers that read Zod's wrapper
  and object def internals.

Timing: this lands in the in-flight breaking **v3.0.0** of the library, which is the appropriate
place to narrow a peer major. zod v4 (stable since 2025) is the current major.

## Decision

**We will drop zod v3 and require `zod` `^4.0.0` as the sole supported peer.**

- Narrow `peerDependencies.zod` to `^4.0.0` (`package.json`). The devDependency already pins
  `^4.0.0`.
- Simplify the validator internals in `src/core/Validation.ts` to the v4 schema shapes, removing the
  now-dead v3-only branches:
  - `unwrapWrappers` — drop the `.removeDefault()` branch (v4 peels `ZodDefault` via `.unwrap()`,
    checked first) and drop `def.schema` from the inner-schema fallback (a v3 key). Keep
    `.unwrap()`, `def.innerType`, and `def.in`/`def.out` (the last two are load-bearing for
    `pipe`/`transform`, which expose no `.unwrap()`).
  - `normalizedKind` — read `def.type` only, dropping the v3 `def.typeName` + `zod`-prefix strip.
  - `objectAllowsUnknownKeys` — drop the `def.unknownKeys === 'passthrough'` branch (v4 has no
    `unknownKeys`; loose/passthrough objects are expressed via `catchall`, already handled).
  - The `_def ?? _zod.def` dual read is **kept** — in v4 `_def` is still a live alias, not a version
    branch. `stripInjectedDefaults` (deliberately value-based per ADR-0011) is unchanged.
- Close issue #26 as not-planned: v3 is dropped rather than added to the matrix.

## Consequences

- **Breaking (v2 → v3):** consumers still on zod 3 must upgrade to zod 4. No firestore-orm API
  signatures change.
- The validator internals are simpler and read the v4 def shapes directly; there are no longer
  untested code paths pretending to support v3.
- The existing unit/integration/type suites (which run on v4) fully exercise the kept paths; the
  removed branches were never reachable under v4, so behavior is unchanged.
- Future maintainers can assume a single Zod major — no dual wrapper-internals handling.

## Alternatives considered

- **Add a zod-v3 CI matrix (issue #26 as written).** Rejected: v3 does not even typecheck today
  (`z.core.$ZodIssue`), so this is net-new work plus indefinite dual-path maintenance for a major no
  test has ever covered.
- **Keep the peer range but leave v3 untested.** Rejected: advertises support the project does not
  actually provide.

## References

- Issue: [#26](https://github.com/reggieofarrell/firestore-orm/issues/26) (peer range `^3.25`
  untested).
- Code: `package.json` (`peerDependencies.zod`), `src/core/Validation.ts` (`unwrapWrappers`,
  `normalizedKind`, `objectAllowsUnknownKeys`).
- Docs: `README.md`, `website/src/content/docs/getting-started.md`,
  `website/src/content/docs/guides/migration-v2-to-v3.md`.
