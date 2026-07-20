# ADR-0016: Dual ESM+CJS build and the v3 runtime/support floor

- **Status:** Accepted (v3)
- **Date:** 2026-07-19
- **Deciders:** maintainer
- **Related:** ADR-0006 (docs/versioning), ADR-0012 (drop zod v3), ADR-0015 (express subpath)

## Context

v2 shipped ESM-only (`"type": "module"`, `import`-only `exports`). The library's audience is the
Firebase Admin / Firebase Functions / NestJS server ecosystem, which is still heavily CommonJS;
ESM-only forces those consumers onto `require(esm)` (only stable on recent Node and only for
fully-synchronous ESM graphs) or dynamic `import()`, and Firebase Functions specifically has
long-standing ESM friction. Separately, Node 18/20 are end-of-life, Firebase Admin 14 requires Node
22+, and zod 4 is tested against TypeScript 5.5+, so the v2 support metadata (Node ≥18, Admin 12/13,
TS 5.0+) is behind the platforms v3 should target.

## Decision

We will ship a **dual ESM + CommonJS build**: the default `tsc` build emits ESM to `dist/`, a second
`tsc -p tsconfig.cjs.json` emits CommonJS to `dist/cjs/`, and a finalize step writes
`dist/cjs/package.json` (`{ "type": "commonjs" }`). The `exports` map gains a `require` condition
(types-first) for the root, `./vector`, and `./express` entries. Adding CJS is additive and
non-breaking for existing ESM consumers. We will also set the v3 support floor: Node **≥22**,
`firebase-admin` peer `^12 || ^13 || ^14`, and document TypeScript **5.5+**.

## Consequences

CommonJS consumers can `require()` the package; ESM consumers are unaffected. A packed-consumer CI
gate compiles both an ESM and a CJS consumer against the tarball. Breaking: the minimum Node version
is now 22. Two `tsc` passes roughly double build time (acceptable; no new build-tool dependency —
`rimraf` is the only added devDependency, replacing the Unix-only `rm -rf`).

## Alternatives considered

Stay ESM-only and rely on `require(esm)`: rejected — too fragile for the CJS-heavy target ecosystem.
Use a bundler (tsup/tshy) for the dual build: viable, but two `tsc` passes avoid a new build
dependency and reuse the existing config. Narrow the Admin peer to 14 only: rejected — keeping 12/13
avoids forcing an immediate consumer migration.

## References

- [`package.json`](../../package.json) `exports`/`engines`/`peerDependencies`,
  [`tsconfig.cjs.json`](../../tsconfig.cjs.json),
  [`scripts/finalize-dual-build.mjs`](../../scripts/finalize-dual-build.mjs).
