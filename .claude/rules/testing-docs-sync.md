---
paths:
  - jest.config*.js
  - scripts/check-coverage-gates.mjs
  - .husky/**
  - src/tests/shared/**
  - src/tests/integration/helpers/**
---
# Testing Documentation Sync

When you add, rename, move, or delete test infrastructure, update:

1. **`docs/development/testing.md`** — commands, layout, harness/factory paths, dual gate tables
2. **`docs/development/test-coverage-followups.md`** — remove covered items, add new gaps
3. **`scripts/check-coverage-gates.mjs`** — path matchers and thresholds when gate scope changes
4. **`.cursor/skills/unit-testing/SKILL.md`** and **`.cursor/skills/integration-testing/SKILL.md`** —
   gate ownership, changed-file routing, and suite workflows
5. **`.cursor/rules/test-awareness.mdc`** and **`.cursor/rules/test-guardrails.mdc`** — suite routing
   plus the factory/mock module list
6. **`README.md` Testing Strategy** and **Contributing** — keep summary + link accurate
7. **`.github/workflows/tests.yml`** and **`.husky/pre-push`** — hook/CI behavior matches docs
8. **`package.json`** — script names must match documentation
