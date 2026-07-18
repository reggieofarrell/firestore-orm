# Versioning the Starlight docs site

This site is prepared for [`starlight-versions`](https://github.com/HiDeoo/starlight-versions) so
consumers can switch between major documentation lines (e.g. v2 vs v3) in the UI.

## Current setup

- **Latest (current)** docs live at `website/src/content/docs/` (site root under
  `base: /firestore-orm`).
- The `starlight-versions` package is a dependency of `@reggieofarrell/firestore-orm-docs`.
- The `versions` content collection is declared in `src/content.config.ts` (uses
  `docsVersionsLoader`).
- The Starlight plugin is **not enabled yet** in `astro.config.mjs`. The plugin schema requires at
  least one archived major (`versions.length > 0`); enabling it with a slug archives the current
  tree on first `dev`/`build`. We defer that until v3 usage docs exist so we do not dual-maintain an
  identical `2.0/` archive.

ADRs (`docs/adr/`) and development guides (`docs/development/`) are **not** versioned via this
plugin; they stay as single-tree Markdown in the repo.

## Archive workflow (at a major cutover)

When v3 usage docs are ready to become “latest”:

1. In `astro.config.mjs`, import `starlightVersions` and add a plugin entry, e.g.:

   ```js
   import starlightVersions from 'starlight-versions';

   starlight({
     plugins: [
       starlightVersions({
         versions: [{ slug: '2.0', label: 'v2' }],
         current: { label: 'v3' },
       }),
     ],
     // …
   });
   ```

2. Start the docs site (`npm run docs:dev` from the repo root, or `npm run dev` in `website/`). On
   first run, starlight-versions archives the current tree under `website/src/content/docs/2.0/`
   (folder name matches the `slug`).
3. Rewrite / replace the root `website/src/content/docs/` content for the new major.
4. Commit both the archived tree and the new latest content.
5. Build and smoke-test (`npm run docs:build`) before merging.

Repeat for later majors (`3.0`, etc.). Prefer archiving only at **major** releases so the switcher
stays useful rather than noisy.

## What not to version

- Do not copy `docs/adr/` or `docs/development/` into Starlight archives.
- Do not delete in-repo `docs/usage/` as part of versioning — that folder is removed (if at all) in
  a separate cutover PR after agents retarget to `website/`.
