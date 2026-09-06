# FlintFire

A type-safe, schema-aware Firestore data-access library for Node.js, built for the Firebase Admin
SDK. Validation, lifecycle hooks, and a fluent query builder.

[![npm version](https://img.shields.io/npm/v/flintfire.svg)](https://www.npmjs.com/package/flintfire)
[![Coverage](https://img.shields.io/badge/coverage-dual%20gated-brightgreen.svg)](#coverage-thresholds)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5+-blue.svg)](https://www.typescriptlang.org/)

## Table of Contents

- [About This Project](#about-this-project)
- [Why FlintFire?](#why-flintfire)
- [Install & docs](#install--docs)
- [Testing Strategy](#testing-strategy)
- [Contributing](#contributing)
- [License](#license)

## About This Project

`flintfire` is a type-safe Firestore data-access library for Node.js and the Firebase Admin SDK. The
goal is backend Firestore development that is type-safe, productive, and production-ready.

If you've built with Firestore on the server, you probably recognize the recurring pain points:

- Repetitive CRUD boilerplate across collections
- Inconsistent pagination and query patterns
- Runtime composite-index failures that only show up in production
- Validation and lifecycle hooks bolted on ad hoc
- Update semantics that fight Firestore's native field-path behavior

This package addresses those problems with a repository pattern, Zod validation, lifecycle hooks, a
chainable query builder, transaction helpers, subcollection support, dot-notation updates, and
Firestore-native write semantics (including `FieldValue` sentinels).

## Why FlintFire?

### Built for Real Production Use

- **Type-Safe Everything** - Full TypeScript support with intelligent inference
- **Zod Validation** - Schema validation that integrates seamlessly with your data layer
- **Explicit Delete Semantics** - Keep data lifecycle behavior clear and predictable
- **Lifecycle Hooks** - Add logging, analytics, or side effects without cluttering your business
  logic
- **Powerful Query Builder** - Intuitive, chainable queries with pagination, aggregation, and
  streaming
- **Vector Search Extension** - Opt-in KNN similarity search via `flintfire/vector`
  ([guide](https://reggieofarrell.github.io/flintfire/guides/advanced/vector-search/))
- **Transaction Support** - ACID guarantees for critical operations
- **Subcollection Support** - Navigate document hierarchies naturally, and query every parent's
  subcollection at once with collection groups
- **Dot Notation Updates** - Update nested fields without replacing entire objects

### Framework Agnostic

Works seamlessly with:

- Express.js
- NestJS (with DTOs and dependency injection)
- Fastify
- Koa
- Next.js API routes
- Any Node.js environment

## Install & docs

```bash
npm install flintfire firebase-admin zod
```

**Peer dependencies:** Node.js >= 22; `firebase-admin` ^12 \|\| ^13 \|\| ^14; `zod` ^4. Optional
`express` for the `flintfire/express` middleware.

Full install, quick start, and API walkthrough:
**[reggieofarrell.github.io/flintfire](https://reggieofarrell.github.io/flintfire/)** — start with
[Getting Started](https://reggieofarrell.github.io/flintfire/getting-started/). Upgrading from
`@reggieofarrell/firestore-orm` 2.x? See the
[v2 → v3 migration guide](https://reggieofarrell.github.io/flintfire/guides/migration-v2-to-v3/).

> The README published on [npmjs.org](https://www.npmjs.com/package/flintfire) is a consumer-focused
> variant sourced from [`npm-readme.md`](npm-readme.md) (staged at pack time). Keep shared content
> in sync via the `readme-sync` skill.

## Testing Strategy

This project uses a **two-tier Jest** strategy:

| Tier            | Runner                                            | Role                                            |
| --------------- | ------------------------------------------------- | ----------------------------------------------- |
| **Unit**        | `jest.config.unit.js`                             | Fast checks on utils, errors, validation, mocks |
| **Integration** | `jest.config.integration.js` + Firestore emulator | **Primary ORM safety net** — real reads/writes  |

Each suite enforces **path-specific coverage gates** (not merged LCOV). A merged report would count
a line as covered if either suite hit it, which overstates confidence for a database library.

```bash
npm run test:unit              # Fast unit tests
npm run test:integration:emulator  # Emulator-backed integration tests
npm test                       # Both tiers
npm run test:coverage:all      # Full coverage + dual gates
```

**Full guide:** [docs/development/testing.md](docs/development/testing.md)

### Coverage thresholds

Releases require `npm run test:coverage:all` to pass (publish CI runs the same check). Thresholds
are enforced per suite by `scripts/check-coverage-gates.mjs` — not by a single global percentage.

| Suite           | Scope                                         | Lines | Branches | Functions |
| --------------- | --------------------------------------------- | ----- | -------- | --------- |
| **Unit**        | `src/utils/**`                                | 95%   | 90%      | 90%       |
| **Unit**        | Errors, ErrorParser, ErrorHandler, Validation | 90%   | 85%      | 90%       |
| **Unit**        | `src/index.ts`                                | 100%  | 100%     | 65%       |
| **Integration** | `FirestoreRepository.ts`                      | 90%   | 75%      | 85%       |
| **Integration** | `QueryBuilder.ts`                             | 90%   | 75%      | 95%       |
| **Integration** | `Validation.ts` (emulator paths)              | 90%   | 80%      | 95%       |
| **Integration** | `src/vector/**`                               | 90%   | 75%      | 90%       |

The static **coverage** badge above means these dual gates are enforced on PR CI and before npm
publish — it is not a live Codecov-style percentage.

### Quick prerequisites (integration)

- JDK 21+ (Firestore emulator; required ahead of `firebase-tools@15`)
- `FIRESTORE_EMULATOR_HOST` defaults to `127.0.0.1:8080`

### Hooks and CI

- **Pre-commit:** fail-closed Sonar secret scan, then lint-staged (ESLint including sonarjs)
- **Pre-push:** outgoing secret scan, skippable `sonar:precheck`, then unit coverage + unit gate (no
  emulator)
- **CI:** unit and integration jobs run in parallel (each enforces its own gate), then the Casadega
  reusable SonarQube scan with a **new-code-only** quality gate. SonarQube's GitHub integration owns
  PR decoration; combined LCOV in Sonar is informational.
- **Publish:** `test:coverage:all` must pass before the package is published to npm

**SonarQube setup:** [docs/development/sonarqube.md](docs/development/sonarqube.md)

See [.github/workflows/tests.yml](.github/workflows/tests.yml) and
[docs/development/releasing.md](docs/development/releasing.md).

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Add tests — **unit** for pure logic; **integration (emulator)** for repository/query behavior
5. Run `npm test` before opening a PR; run `npm run test:coverage:all` when changing test infra
6. Commit using [Conventional Commits](https://www.conventionalcommits.org/) (e.g.
   `git commit -m 'feat(query): add distinct filter'`) — a `commit-msg` hook validates the format,
   and the changelog is generated from these messages (see
   [docs/development/releasing.md](docs/development/releasing.md))
7. Push to your branch (`git push origin feature/amazing-feature`) — pre-push runs a secret scan, a
   skippable Sonar changed-file precheck, then the unit coverage gate
8. Open a Pull Request — CI runs both suite gates and the SonarQube new-code quality gate

For significant architectural or contract-level changes, record the decision as an
[Architecture Decision Record](docs/adr/README.md) (start from
[`docs/adr/0000-template.md`](docs/adr/0000-template.md)).

### Development Setup

```bash
git clone https://github.com/reggieofarrell/flintfire.git
cd flintfire
npm install
npm run build
npm test
```

Development uses the private `@casadega-development/ts-repo-tooling` package. Maintainers must
configure read access before installing dependencies; see
[private package access](docs/development/private-packages.md). Untrusted fork CI is intentionally
not supported.

`.npmrc` sets `min-release-age=2` (npm 11.10+, shipped with Node 24). Fresh publishes are not
resolved until they are two days old. Use Node 24 from `.nvmrc` for installs; npm 10 (Node 22)
ignores that setting silently. Do not pass `--min-release-age=0` unless a human is applying a known
emergency `npm audit fix` (then prefer `min-release-age-exclude` for that package).

### Coding Standards

- Use TypeScript strict mode
- Follow existing code style
- Write **integration** tests for `FirestoreRepository` / `QueryBuilder` changes; **unit** tests for
  utils and error layer
- Update documentation (including `docs/development/testing.md` when test policy changes)
- Keep commits focused and atomic

## License

MIT. Full text: [LICENSE](LICENSE). Required attribution for redistributors: [NOTICE](NOTICE).

- Copyright (c) 2025 HBFL3Xx (original work)
- Copyright (c) 2026 Reggie O'Farrell (subsequent modifications)

## Support

- **Issues:** [GitHub Issues](https://github.com/reggieofarrell/flintfire/issues)
- **Documentation:**
  [https://reggieofarrell.github.io/flintfire/](https://reggieofarrell.github.io/flintfire/)

## Acknowledgments

- [Happy Banda (HBFL3Xx)](https://github.com/HBFLEX) — original MIT-licensed work this repository
  builds on (see [NOTICE](NOTICE))
- **Firebase team** for the Admin SDK
- **Zod team** for schema validation
- Everyone who has contributed ideas, issues, and feedback

---

**Maintained by [Reggie O'Farrell](https://github.com/reggieofarrell)** · Built on MIT-licensed work
by [HBFL3Xx](https://github.com/HBFLEX) (see [NOTICE](NOTICE))
