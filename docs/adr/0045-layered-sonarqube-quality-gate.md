# ADR-0045: Layered SonarQube quality gate

- **Status:** Accepted
- **Date:** 2026-08-30
- **Deciders:** Reggie O'Farrell
- **Related:** [docs/development/sonarqube.md](../development/sonarqube.md),
  [docs/development/testing.md](../development/testing.md), ADR-0016 (tooling floor)

## Context

FlintFire already has fail-closed local gates: commitlint, lint-staged, dual path-specific coverage,
`release:verify`, and PR CI. It did not have a server static-analysis quality gate. The
firebase-starter repository already runs a layered SonarQube model (local SonarJS ESLint, agent
post-edit hook, fail-closed secret scans, changed-file precheck, CI scan).

Constraints that differ from the starter:

- FlintFire is a **mature published library**, not a greenfield app. Failing CI on every historical
  issue would mix debt with new regressions.
- The GitHub repository lives under a personal account, not `black-flag-collective`, so reusable
  workflows from that org are not assumed.
- Coverage is **dual-suite**. Merging LCOV overstates confidence (a line hit in either suite counts
  as covered). That remains true if Sonar combines the two reports.
- Package manager is npm; test runner is Jest.

## Decision

We will adopt the starter's layered SonarQube model with these adaptations:

1. **Local `eslint-plugin-sonarjs` is fail-closed** on production `src/` for every active server
   rule the plugin implements. Tests, scripts, and the website stay out of ESLint, matching the
   existing ignore list.
2. **The server quality gate is new-code-only.** CI does not add an extra “any unresolved issue”
   check.
3. **CI calls public reusable workflows** in
   [`Casadega-Development/action-workflows`](https://github.com/Casadega-Development/action-workflows).
   FlintFire stays under `reggieofarrell`. The org repo is public so a personal repository can
   `uses:` it and maps `SONAR_TOKEN` explicitly (`secrets: inherit` does not cross from a personal
   repository into another GitHub organization). It does not call
   `black-flag-collective/action-workflows`. SonarQube's GitHub integration owns pull-request
   decoration; the reusable workflow does not post a second comment.
4. **Tests also run on pushes to `main`** so Sonar has a branch baseline for new-code comparison.
5. **Sonar's combined LCOV is informational.** Path-specific gates in
   `scripts/check-coverage-gates.mjs` remain the coverage authority.
6. **Pre-push stays light:** secret scan + skippable `sonar:precheck` + the existing unit coverage
   gate. It does not grow into `release:verify`.

## Consequences

- Developers with Scanner and CLI installed catch server issues before push; others skip loudly
  (exit 2) and still get CI enforcement after provisioning.
- Existing findings on unchanged code do not fail the server gate; they still fail local lint when
  production `src/` is analyzed.
- Provisioning (Sonar project, GitHub `SONAR_TOKEN` / `SONAR_HOST_URL`) is required before the CI
  Sonar job can pass on same-repo PRs. A successful `main` analysis must exist before PR decoration.
- Combined coverage dashboards in Sonar must not be used to ratchet or relax the dual gates.

## Alternatives considered

- **Reusable workflow from `black-flag-collective/action-workflows`.** Rejected because this
  repository is not in that GitHub organization; access would be an extra coupling. The Sonar-only
  subset is duplicated into public `Casadega-Development/action-workflows` instead.
- **Keep the scan inlined in FlintFire.** Rejected after CI failed on a non-existent
  `sonarsource/sonarqube-quality-gate-action@v1.3.1` pin, and because scan orchestration and CE
  waiting belong in one shared workflow rather than a second copy per repo.
- **Fail CI on all open issues.** Appropriate for a greenfield starter; inappropriate here without a
  dedicated cleanup campaign.
- **Sonar-only, no local SonarJS.** Would leave the gap the starter closed: editors and agents would
  not see the locally implementable subset until CI.

## References

- [docs/development/sonarqube.md](../development/sonarqube.md)
- [sonar-project.properties](../../sonar-project.properties)
- [.github/workflows/tests.yml](../../.github/workflows/tests.yml)
