---
description: Keep README + user-facing docs in sync when the public API surface changes
paths:
  - 'src/index.ts'
  - 'src/core/**/*.ts'
  - 'src/vector/**/*.ts'
---

<!-- Body inlined from .cursor/rules/docs-api-sync.mdc (Cursor's copy uses `globs:`).
     Claude Code does not expand @import inside rule files, so the body is duplicated here —
     keep the two copies in sync when editing. -->

# Public API ↔ Docs Sync

When a change alters the **public API surface**, update the user-facing docs in the same PR. This
fires on the public source; only act when the _exported/observable contract_ actually changes (not
internal refactors).

Triggers:

- Added / removed / renamed exports in `src/index.ts` (or the `./vector` entry)
- Changed method signatures, options, or **return contracts** in `FirestoreRepository` /
  `QueryBuilder`
- New or changed validation combinators / `sentinelPolicy` / schema behavior in `Validation.ts`
- Vector API changes in `src/vector/**`

Then update:

1. **`docs/usage/`** — the feature guide and API reference now live here, one page per topic (see
   `docs/usage/api-reference.md` and the relevant topic page). Update method contracts, options, and
   any code examples that now behave differently; keep exported names and signatures accurate. The
   root `README.md` keeps only the quick start + a documentation index, so touch it only when the
   quick-start example or that index needs to change.
2. **Examples** — fix snippets that would no longer type-check or run.
3. **ADR** — if it's a contract-level or architectural decision, record one in `docs/adr/` (use the
   `/adr` skill).
4. Do **not** hand-edit `CHANGELOG.md` — it is generated from Conventional Commits; write a clear
   `feat:` / `fix:` / `feat!:` commit instead.

If you touched any doc links, run `npm run check:docs`.
