# ADR-0006: Starlight docs site and major-version archives

- **Status:** Accepted ([#19](https://github.com/reggieofarrell/firestore-orm/pull/19) merged; the
  v3 docs cutover in sub-decision 4 was executed alongside
  [ADR-0007](0007-retire-curried-schema-factories.md))
- **Date:** 2026-07-17
- **Deciders:** Reggie O'Farrell
- **Related:** [`website/`](../../website/); [`website/VERSIONING.md`](../../website/VERSIONING.md);
  [`.cursor/rules/docs-api-sync.mdc`](../../.cursor/rules/docs-api-sync.mdc); `docs/usage/`
  (transitional in-repo mirror, since removed)

## Context

Consumer documentation lived as GitHub-browsable Markdown under `docs/usage/`. That works for agents
and deep links, but it does not give package consumers a searchable, navigable docs site, and it has
no built-in way to keep **v2 and v3 usage docs** available side by side when the library takes a
deliberate major break.

Constraints that shaped the choice:

- **ADRs and contributor guides must stay stable paths.** Skills and rules (`/adr`,
  `testing-docs-sync`, CI comments, README releasing/testing links) already target `docs/adr/` and
  `docs/development/`. Relocating those into a static-site tree would force broad churn for no
  consumer benefit.
- **Published docs should be versionable by major.** Starlight has no first-party version switcher;
  the community plugin [`starlight-versions`](https://github.com/HiDeoo/starlight-versions) archives
  folder trees and requires at least one archived major before the plugin can be enabled.
- **v3 work is landing after this site.** Archiving “v2” as an identical copy of “latest” before v3
  content exists would create useless dual maintenance. The plugin and `versions` collection can be
  wired now; the first archive should wait until v3 usage docs replace latest.
- **Agents need a single published edit target** once the site exists, so public-API doc sync does
  not silently update only the in-repo Markdown mirror.

## Decision

We will publish consumer usage documentation as an **Astro Starlight** site under `website/`, deploy
it to **GitHub Pages** (`site: https://reggieofarrell.github.io`, `base: /firestore-orm`), and treat
that tree as the **published source of truth** for package consumers.

Sub-decisions:

1. **`website/` for the site; `docs/adr/` and `docs/development/` stay plain Markdown.** Only usage
   guides (plus site-owned entry pages: splash home, Getting Started, overview) are published.
   Contributor docs remain GitHub Markdown at their existing paths.
2. **Nested package, not an npm workspace.** The site has its own `package.json` /
   `package-lock.json` and is installed/built via `npm --prefix website`. Root scripts `docs:dev` /
   `docs:build` wrap that. ESLint enforces `import-x/no-extraneous-dependencies` with `packageDir`
   scoped **only** to `website/` so the site cannot silently depend on library root deps.
3. **Plain `.md` content** (Starlight frontmatter + prose). Avoid `.mdx` unless a page truly needs
   embedded components, so agents editing docs stay in familiar Markdown.
4. **Prepare `starlight-versions` now; archive at the v3 docs cutover.** Dependency + `versions`
   content collection ship with the site. The plugin stays disabled until v3 usage docs are ready to
   become latest. At that cutover:
   - Enable `starlightVersions` with `versions: [{ slug: '2.0', label: 'v2' }]` and
     `current: { label: 'v3' }` (see [`website/VERSIONING.md`](../../website/VERSIONING.md)).
   - Let the first `docs:dev` / `docs:build` archive the then-current tree under
     `website/src/content/docs/2.0/`.
   - Rewrite root `website/src/content/docs/` for v3.
   - Commit archive + latest together; smoke-test with `npm run docs:build` (production `NODE_ENV`
     so Pagefind search is included).
5. **`docs-api-sync` targets the Starlight tree.** Public-API contract changes update
   `website/src/content/docs/` (and sidebar entries in `website/astro.config.mjs` when adding
   pages). While `docs/usage/` still exists, mirror topic-guide edits there until a follow-up PR
   deletes that dual tree.
6. **Do not version ADRs or development docs** via the plugin. They remain a single in-repo tree.

## Consequences

**Easier**

- Consumers get a searchable Pages site with a coherent sidebar (Concepts / Operations / Reference /
  Integration / Guidance) and a clear Getting Started path.
- Major-version docs can coexist behind a switcher once v3 lands, without inventing a custom
  versioning scheme.
- Contributor Markdown paths and agent skills for ADRs / testing docs stay unchanged.

**Harder / costs**

- Two trees until `docs/usage/` is removed — temporary drift risk if agents forget the transitional
  mirror step.
- Docs builds need a nested install and must force `NODE_ENV=production` so Starlight does not bake
  the “search only in production” stub when the shell has `NODE_ENV=development`.
- Absolute hero/CTA links must account for `base: /firestore-orm` (Starlight does not always prefix
  absolute `/…` paths).
- The first `starlight-versions` enablement is a deliberate cutover task on the v3 docs PR (or a
  dedicated follow-up), not something that happens automatically when the package major bumps.

**Migration**

- **Now (this change):** site live from `website/`; README points at Pages URL; agents edit
  Starlight first.
- **When v3 usage docs land:** run the archive workflow in
  [`website/VERSIONING.md`](../../website/VERSIONING.md); keep v2 readable under `/2.0/`.
- **Later cleanup:** delete `docs/usage/` and drop the transitional mirror language from
  docs-api-sync once nothing still depends on that path.

## Alternatives considered

- **Keep GitHub Markdown only.** Rejected: no search/nav UX for consumers; no clean major-version
  switcher for the v2→v3 break.
- **Put Starlight under `docs/`.** Rejected: would force relocating `docs/adr/` and
  `docs/development/`, breaking skills, rules, and many in-repo links.
- **Enable `starlight-versions` immediately with a `2.0` archive.** Rejected: archives an identical
  copy of latest before v3 content exists, doubling edit surface for no reader benefit.
- **Custom versioning / hand-maintained `/v2` tree.** Rejected: more maintenance than adopting the
  Starlight plugin already listed in Starlight’s ecosystem.
- **TypeDoc / auto API reference as the primary site.** Deferred: out of scope for the initial
  scaffold; prose guides remain the primary teaching surface.

## References

- PR: [#19](https://github.com/reggieofarrell/firestore-orm/pull/19) (`docs/starlight-site`)
- Site config: [`website/astro.config.mjs`](../../website/astro.config.mjs)
- Versioning runbook: [`website/VERSIONING.md`](../../website/VERSIONING.md)
- Plugin: [HiDeoo/starlight-versions](https://github.com/HiDeoo/starlight-versions)
- Deploy: [`.github/workflows/deploy-docs.yml`](../../.github/workflows/deploy-docs.yml)
- Agent rule: [`.cursor/rules/docs-api-sync.mdc`](../../.cursor/rules/docs-api-sync.mdc) (Claude
  twin under `.claude/rules/`)
