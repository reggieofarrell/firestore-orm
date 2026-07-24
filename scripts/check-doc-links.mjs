#!/usr/bin/env node
/* eslint-env node */
/**
 * Documentation link checker for @reggieofarrell/firestore-orm.
 *
 * Fails (exit 1) when a Markdown doc contains a broken *relative* link, so docs don't silently rot
 * as the repo evolves. Three checks:
 *
 *   1. Markdown links `[text](target)` and images `![alt](target)` in every `*.md` / `*.mdc`
 *      file — a relative target (optionally with a `#anchor`) must resolve to a file or directory.
 *      Site-absolute Starlight URLs under `/firestore-orm/` (splash CTAs that include Astro `base`)
 *      are resolved against `website/src/content/docs/`. A target that resolves to a declared Astro
 *      `redirects` source (in `website/astro.config.mjs`) counts as valid — Astro serves it. For
 *      relative links inside the Starlight tree, the rendered browser URL is checked too: a path
 *      can resolve beside a Markdown source file while still becoming a nested 404 in the browser.
 *   2. `#anchor` fragments in links within the current Starlight content tree — validated against
 *      the target page's heading slugs (github-slugger, plus the `_top` title id), including frozen
 *      numeric version archives (e.g. `2.0/`). `astro build` does *not* check anchors, so this is
 *      the only guard against heading-rename rot.
 *   3. `@import` targets in `CLAUDE.md` and `.claude/rules/**` — the relative `@../path` imports
 *      that wrap the `.cursor` rules must point at files that exist (the most rot-prone links).
 *
 * Skipped: external URLs (http/https/mailto/tel), protocol-relative (`//`), and anything inside
 * fenced code blocks. Symlinks are not followed — their real targets are checked via their
 * canonical path (e.g. `.claude/skills/*` resolves through `.cursor/skills/*`).
 *
 * Usage: node scripts/check-doc-links.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Ignore dependency / build trees (including the nested Starlight site under website/).
const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  '.astro', // Astro generated types under website/.astro
]);
const DOC_EXT = /\.mdc?$/; // .md or .mdc

/** Recursively collect doc files; skip ignored dirs; do not follow symlinks. */
function collectDocs(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    if (entry.isSymbolicLink()) continue; // real target is scanned via its canonical path
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectDocs(full, out);
    else if (DOC_EXT.test(entry.name)) out.push(full);
  }
  return out;
}

const isExternal = target => /^(https?:|mailto:|tel:|#|\/\/)/.test(target) || target.trim() === '';

/**
 * Astro `base` for the Starlight site (must match `website/astro.config.mjs`).
 * Splash CTAs use root-absolute `/firestore-orm/...` links so they work under both
 * `astro preview` and GitHub Pages when the splash URL lacks a trailing slash.
 */
const SITE_BASE = '/firestore-orm';
const SITE_CONTENT_ROOT = join(repoRoot, 'website', 'src', 'content', 'docs');

/**
 * Redirect source slugs declared in `website/astro.config.mjs` (`redirects: { old: new }`).
 * A link that resolves to a redirected *source* is valid: Astro serves it via the redirect, so a
 * cross-version pointer from the frozen v2 archive into a moved current-tree page still works.
 */
/** Drop any trailing slashes without a backtracking-prone regex. */
const stripTrailingSlash = s => {
  let end = s.length;
  while (end > 0 && s[end - 1] === '/') end--;
  return s.slice(0, end);
};

const redirectSources = new Set();
try {
  const cfg = readFileSync(join(repoRoot, 'website', 'astro.config.mjs'), 'utf8');
  // Match `'/old': '/new'` redirect pairs. Only the redirects map has slash-leading string keys
  // *and* values, so scanning the whole file is unambiguous (sidebar entries use bare slugs).
  const pairRe = /(['"])(\/[^'"\n]+)\1\s*:\s*(['"])\/[^'"\n]+\3/g;
  let m;
  while ((m = pairRe.exec(cfg))) redirectSources.add(stripTrailingSlash(m[2]));
} catch {
  /* no astro config found — treat as no redirects */
}

/** True when a resolved content path (no trailing slash) matches a declared redirect source. */
function matchesRedirect(absPath) {
  const rel = relative(SITE_CONTENT_ROOT, absPath).replaceAll('\\', '/');
  if (!rel || rel.startsWith('..')) return false;
  return redirectSources.has(`/${stripTrailingSlash(rel)}`);
}

/** Drop a trailing #anchor, return the path part. */
const pathPart = target => {
  const hash = target.indexOf('#');
  return (hash >= 0 ? target.slice(0, hash) : target).trim();
};

/**
 * Resolve a site-absolute Starlight URL (`/firestore-orm/getting-started/`) to a content file.
 * Returns true when the slug maps to an existing page under website/src/content/docs/.
 */
function siteBaseLinkExists(absoluteTarget) {
  if (!absoluteTarget.startsWith(`${SITE_BASE}/`) && absoluteTarget !== SITE_BASE) {
    return false;
  }
  // Strip the configured base, then map the remaining slug onto the content tree.
  const slug = absoluteTarget === SITE_BASE ? '' : absoluteTarget.slice(SITE_BASE.length);
  const normalized = slug.replace(/^\/+|\/+$/g, '');
  if (!normalized) {
    // `/firestore-orm` / `/firestore-orm/` → splash index
    return existsSync(join(SITE_CONTENT_ROOT, 'index.md'));
  }
  const asFile = join(SITE_CONTENT_ROOT, `${normalized}.md`);
  if (existsSync(asFile)) return true;
  const asIndex = join(SITE_CONTENT_ROOT, normalized, 'index.md');
  if (existsSync(asIndex)) return true;
  if (redirectSources.has(`/${normalized}`)) return true;
  return false;
}

/** Run `fn(line, index)` for every line outside fenced code blocks. */
function forEachProseLine(text, fn) {
  let inFence = false;
  text.split('\n').forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (!inFence) fn(line, index);
  });
}

const problems = [];

/**
 * Resolve a relative Markdown link target on disk.
 *
 * Starlight pages use slug URLs (`./topic/` → topic.md in the same folder, or
 * `../` → parent index.md). GitHub-style docs still use explicit `./topic.md`.
 * Accept either shape so `check:docs` covers both trees.
 */
function linkTargetExists(fromFile, relativeTarget) {
  const base = resolve(dirname(fromFile), relativeTarget);
  if (existsSync(base)) return true;

  // Trailing slash / directory-style slug → sibling or nested .md file.
  const trimmed = base.replace(/[/\\]+$/, '');
  if (existsSync(`${trimmed}.md`)) return true;
  if (existsSync(join(trimmed, 'index.md'))) return true;
  if (existsSync(join(trimmed, 'README.md'))) return true;

  // Bare slug without slash / extension (e.g. ./topic).
  if (!/\.[a-z0-9]+$/i.test(trimmed) && existsSync(`${trimmed}.md`)) return true;

  // A moved page whose old slug is served by an Astro redirect (e.g. the frozen v2 archive links
  // to a v3 page that was reorganized into a pillar subfolder).
  if (matchesRedirect(trimmed)) return true;

  return false;
}

function checkMarkdownLinks(file, text) {
  const linkRe = /\]\(([^)]+)\)/g;
  forEachProseLine(text, (line, index) => {
    let match;
    while ((match = linkRe.exec(line))) {
      const target = match[1].trim();
      if (isExternal(target)) continue;
      const p = pathPart(target);
      if (!p) continue; // pure anchor
      // Site-absolute `/firestore-orm/...` links (splash CTAs) — resolve against Starlight content.
      if (p.startsWith('/')) {
        if (!siteBaseLinkExists(p)) {
          problems.push({ file, line: index + 1, target, kind: 'link' });
        }
        continue;
      }
      // Starlight emits Markdown hrefs as written. A filesystem-relative page link can therefore
      // exist on disk but resolve relative to the public directory URL in the browser. Validate
      // that rendered URL whenever the source target is another doc page (or an Astro redirect).
      if (isContentFile(file)) {
        const diskTarget = resolve(dirname(file), p).replace(/[/\\]+$/, '');
        const pointsToPage = resolveContentMdFile(file, p) !== null || matchesRedirect(diskTarget);
        if (pointsToPage) {
          const renderedPath = new URL(p, `https://docs.invalid${contentRouteFor(file)}`).pathname;
          if (!siteBaseLinkExists(renderedPath)) {
            problems.push({ file, line: index + 1, target, kind: 'link' });
            continue;
          }
        }
      }
      if (!linkTargetExists(file, p)) {
        problems.push({ file, line: index + 1, target, kind: 'link' });
      }
    }
  });
}

// Relative Claude `@import` (a token starting with `.` and containing a slash), e.g.
// `@../../.cursor/rules/test-guardrails.mdc`. Starting with `.` avoids matching npm scopes.
function checkImports(file, text) {
  const importRe = /(?:^|\s)@(\.[^\s)]*\/[^\s)]+)/g;
  forEachProseLine(text, (line, index) => {
    let match;
    while ((match = importRe.exec(line))) {
      const p = match[1].trim();
      if (!existsSync(resolve(dirname(file), p))) {
        problems.push({ file, line: index + 1, target: `@${p}`, kind: 'import' });
      }
    }
  });
}

// --- Anchor validation (Starlight content tree only) ---------------------------------------------
// Starlight/rehype-slug ids: the frontmatter-title <h1> gets the fixed id `_top`; every `##`..`######`
// heading gets a github-slugger slug (lowercased, punctuation dropped, spaces → hyphens, duplicates
// suffixed `-1`, `-2`). We validate `#anchor` deep-links against that set so heading renames can't
// silently rot cross-page links (neither the path checker above nor `astro build` catches anchors).
// Scoped to the published content tree, including frozen numeric archives: archive copy stays
// immutable, but links can still rot when the archive is first generated or its routing changes.
const SLUG_STRIP = /[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu;
const slugOf = text => text.toLowerCase().replace(SLUG_STRIP, '').replaceAll(' ', '-');
const headingText = raw => raw.replaceAll('`', '').replaceAll('*', '').trim();

const anchorCache = new Map();
function anchorsFor(file) {
  const cached = anchorCache.get(file);
  if (cached) return cached;
  const set = new Set(['_top']);
  if (existsSync(file)) {
    const seen = new Map();
    forEachProseLine(readFileSync(file, 'utf8'), line => {
      const h = line.match(/^(#{2,6})\s+(.*)$/);
      if (!h) return;
      const slug = slugOf(headingText(h[2]));
      if (!slug) return;
      const n = seen.get(slug) ?? 0;
      seen.set(slug, n + 1);
      set.add(n === 0 ? slug : `${slug}-${n}`);
    });
  }
  anchorCache.set(file, set);
  return set;
}

/** Whether a file belongs to the published Starlight content tree, including version archives. */
function isContentFile(file) {
  const rel = relative(SITE_CONTENT_ROOT, file).replaceAll('\\', '/');
  return Boolean(rel) && !rel.startsWith('..');
}

/** Public route for a Starlight source file, always ending in `/`. */
function contentRouteFor(file) {
  let slug = relative(SITE_CONTENT_ROOT, file)
    .replaceAll('\\', '/')
    .replace(/\.mdc?$/, '');
  if (slug === 'index') slug = '';
  else if (slug.endsWith('/index')) slug = slug.slice(0, -'/index'.length);
  return `${SITE_BASE}/${slug ? `${slug}/` : ''}`;
}

/** Resolve a link's path part to the target .md file within the content tree, or null. */
function resolveContentMdFile(fromFile, linkPathPart) {
  if (!linkPathPart) return fromFile; // pure in-page #anchor
  let base;
  if (linkPathPart.startsWith('/')) {
    if (linkPathPart !== SITE_BASE && !linkPathPart.startsWith(`${SITE_BASE}/`)) return null;
    const slug = linkPathPart === SITE_BASE ? '' : linkPathPart.slice(SITE_BASE.length);
    const normalized = stripTrailingSlash(slug.startsWith('/') ? slug.slice(1) : slug);
    base = join(SITE_CONTENT_ROOT, normalized || 'index');
  } else {
    base = resolve(dirname(fromFile), linkPathPart);
  }
  if (base.endsWith('.md') && existsSync(base)) return base;
  if (existsSync(`${base}.md`)) return `${base}.md`;
  const idx = join(base, 'index.md');
  if (existsSync(idx)) return idx;
  return null;
}

function checkAnchors(file, text) {
  if (!isContentFile(file)) return;
  const linkRe = /\]\(([^)]+)\)/g;
  forEachProseLine(text, (line, index) => {
    let match;
    while ((match = linkRe.exec(line))) {
      const target = match[1].trim();
      const hash = target.indexOf('#');
      if (hash < 0) continue;
      if (/^(https?:|mailto:|tel:|\/\/)/.test(target)) continue;
      const anchor = target.slice(hash + 1).trim();
      if (!anchor) continue;
      const targetFile = resolveContentMdFile(file, target.slice(0, hash).trim());
      if (!targetFile || !isContentFile(targetFile)) continue;
      if (!anchorsFor(targetFile).has(anchor)) {
        problems.push({ file, line: index + 1, target, kind: 'anchor' });
      }
    }
  });
}

const docs = collectDocs(repoRoot);
for (const file of docs) {
  const text = readFileSync(file, 'utf8');
  checkMarkdownLinks(file, text);
  checkAnchors(file, text);
  const rel = file.slice(repoRoot.length + 1);
  if (rel === 'CLAUDE.md' || rel.startsWith(join('.claude', 'rules'))) {
    checkImports(file, text);
  }
}

const rel = file => file.slice(repoRoot.length + 1);
if (problems.length > 0) {
  console.error(`\n✗ ${problems.length} broken documentation link(s):\n`);
  for (const p of problems) {
    console.error(`  ${rel(p.file)}:${p.line}  [${p.kind}]  ${p.target}`);
  }
  console.error('\nFix the target path, or use an absolute URL for external references.\n');
  process.exit(1);
}

console.log(`✓ documentation links OK (${docs.length} doc files scanned)`);
