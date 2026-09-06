---
name: fix-sonarqube-issues
description: >-
  Investigate and fix SonarQube or SonarJS findings, quality-gate failures,
  duplicated-code reports, security hotspots, or server/local rule drift. Not
  for an ordinary lint error with no Sonar finding.
targets:
  - '*'
---
# Fix SonarQube issues

1. Capture the rule ID, message, file, line, branch/PR context, and whether the
   finding came from the server, IDE, agent hook, or ESLint. Read
   `sonar-project.properties` and treat its host and project key as
   authoritative.
2. Retrieve existing server findings through the pinned shared client:
   `npm run sonar:findings -- --pull-request <number> --format json` for a PR, or
   `npm run sonar:findings -- --branch <name> --format json` for a branch. Never
   trust hostless `sonar api` or `sonar list issues` output.
3. Read the surrounding implementation and tests. Diagnose the underlying risk
   instead of mechanically rewriting the highlighted line.
4. Prefer a small structural fix that preserves behavior and strengthens types
   or tests. Never add a blanket suppression, exclude a source path, or mark an
   issue false-positive without explicit authorization and durable rationale.
5. Add a regression test when the finding exposes behavioral risk. Falsify that
   test with the smallest temporary mutation, observe the expected failure, and
   restore the correct implementation before handoff.
6. Run the narrow test and typecheck first, then `npm run lint`,
   `npm run sonar:check`, and `npm run release:verify`.
7. For rule drift, store a user token in the endpoint-scoped macOS Keychain item
   named by the shared tooling diagnostic (or set `SONAR_TOKEN` temporarily),
   run `npm run sonar:rules`, and commit the generated profile. The active
   SonarQube CLI server is irrelevant to the shared direct-API client.

For a security hotspot, explain the trust boundary and mitigation. Leave the
server review status to an authorized human unless the user explicitly asks you
to change it.
