---
description: Keep testing documentation in sync when test infrastructure changes
paths:
  - 'jest.config*.js'
  - 'scripts/check-coverage-gates.mjs'
  - '.husky/**'
  - 'src/tests/shared/**'
  - 'src/tests/integration/helpers/**'
---

<!-- Body inlined from .cursor/rules/testing-docs-sync.mdc (Cursor's copy uses `globs:`).
     Claude Code does not expand @import inside rule files, so the body is duplicated here —
     keep the two copies in sync when editing. -->

# Testing Documentation Sync

When you add, rename, move, or delete test infrastructure, update:

1. **`docs/development/testing.md`** — commands, layout, harness/factory paths, dual gate tables
2. **`docs/development/test-coverage-followups.md`** — remove covered items, add new gaps
3. **`scripts/check-coverage-gates.mjs`** — path matchers and thresholds when gate scope changes
4. **`.cursor/skills/unit-testing/SKILL.md`** and **`.cursor/skills/integration-testing/SKILL.md`**
5. **`.cursor/rules/test-awareness.mdc`** and **`.cursor/commands/write-unit-tests.md`**,
   **`.cursor/commands/write-integration-tests.md`** — gate ownership and suite routing
6. **`.cursor/rules/test-guardrails.mdc`** — factory/mock module list
7. **`README.md` Testing Strategy** and **Contributing** — keep summary + link accurate
8. **`.github/workflows/tests.yml`** and **`.husky/pre-push`** — hook/CI behavior matches docs
9. **`package.json`** — script names must match documentation
