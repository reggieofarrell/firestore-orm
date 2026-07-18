#!/usr/bin/env node
/* eslint-env node */
/**
 * Documentation link checker for @reggieofarrell/firestore-orm.
 *
 * Fails (exit 1) when a Markdown doc contains a broken *relative* link, so docs don't silently rot
 * as the repo evolves. Two checks:
 *
 *   1. Markdown links `[text](target)` and images `![alt](target)` in every `*.md` / `*.mdc`
 *      file — a relative target (optionally with a `#anchor`) must resolve to a file or directory.
 *   2. `@import` targets in `CLAUDE.md` and `.claude/rules/**` — the relative `@../path` imports
 *      that wrap the `.cursor` rules must point at files that exist (the most rot-prone links).
 *
 * Skipped: external URLs (http/https/mailto/tel), protocol-relative (`//`), pure `#anchors`, and
 * anything inside fenced code blocks. Symlinks are not followed — their real targets are checked
 * via their canonical path (e.g. `.claude/skills/*` resolves through `.cursor/skills/*`).
 *
 * Usage: node scripts/check-doc-links.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
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

/** Drop a trailing #anchor, return the path part. */
const pathPart = target => {
  const hash = target.indexOf('#');
  return (hash >= 0 ? target.slice(0, hash) : target).trim();
};

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

const docs = collectDocs(repoRoot);
for (const file of docs) {
  const text = readFileSync(file, 'utf8');
  checkMarkdownLinks(file, text);
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
