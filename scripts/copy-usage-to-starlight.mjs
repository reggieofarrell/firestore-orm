#!/usr/bin/env node
/**
 * One-shot helper: copy docs/usage/*.md into website/src/content/docs as Starlight
 * pages (plain Markdown + YAML frontmatter). Does not modify docs/usage/.
 *
 * Link rewrites (website copies only):
 *   - ./README.md        → ../overview/  (docs index; site splash is separate)
 *   - ../../README.md    → GitHub blob URL for the project README
 *   - ./topic.md[#a]     → ./topic/[#a]  (sibling guide pages)
 *
 * Site-owned pages (not overwritten by this script):
 *   - website/src/content/docs/index.md (splash home)
 *   - website/src/content/docs/getting-started.md
 *   - website/src/content/docs/overview.md
 *
 * Usage: node scripts/copy-usage-to-starlight.mjs
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const usageDir = join(repoRoot, 'docs', 'usage');
const websiteDocs = join(repoRoot, 'website', 'src', 'content', 'docs');
const guidesDir = join(websiteDocs, 'guides');

const GITHUB_README = 'https://github.com/reggieofarrell/firestore-orm/blob/main/README.md';
const GITHUB_DEV = 'https://github.com/reggieofarrell/firestore-orm/blob/main/docs/development';
const GITHUB_ADR = 'https://github.com/reggieofarrell/firestore-orm/blob/main/docs/adr';

/** Per-page descriptions when the first prose paragraph is too long or awkward. */
const DESCRIPTIONS = {
  'advanced-patterns.md':
    'Audit logging, caching, event-driven updates, and denormalization patterns with FirestoreORM.',
  'api-reference.md':
    'Full type signatures for FirestoreRepository, FirestoreQueryBuilder, and exported types.',
  'best-practices.md':
    'Recommended patterns for production use of FirestoreORM repositories and queries.',
  'core-concepts.md':
    'Repository pattern, Firestore converters, and delete behavior in FirestoreORM.',
  'crud-operations.md': 'Create, read, update, delete, and bulk variants on FirestoreRepository.',
  'dot-notation.md':
    'Field-path updates, merge/patch semantics, and FieldValue sentinels for nested data.',
  'error-handling.md':
    'Error classes, when they throw, parseFirestoreError, and the Express error middleware.',
  'examples.md':
    'End-to-end e-commerce, multi-tenant, and social feed examples using FirestoreORM.',
  'field-value-sentinels.md':
    'Write combinators, sentinelPolicy strict mode, and sharing write types with the front end.',
  'framework-integration.md': 'Wire FirestoreORM into Express.js and NestJS applications.',
  'lifecycle-hooks.md':
    'before*/after* lifecycle hooks, payloads, and ordering around validated writes.',
  'performance.md': 'Firestore cost model, optimization tips, and benchmarks for FirestoreORM.',
  'queries.md': 'Query builder, aggregations, streaming, and real-time subscriptions.',
  'schema-validation.md':
    'Zod validation lifecycle, derived create/update schemas, and id handling.',
  'subcollections.md': 'Nested collections and per-instance converter behavior with FirestoreORM.',
  'timestamps.md': 'createMillisTimestampConverter and the write/read timestamp pattern.',
  'transactions.md': 'runInTransaction and transaction-scoped repository methods.',
  'triggers.md': 'Map Cloud Function trigger snapshots to read types with fromSnapshot().',
  'troubleshooting.md': 'Common FirestoreORM errors and how to fix them.',
  'vector-search.md': 'Optional ./vector extension and findNearest KNN similarity search.',
};

/**
 * Rewrite relative Markdown links for the Starlight site.
 * @param {string} text
 */
function rewriteLinks(text) {
  return text.replace(/\]\(([^)]+)\)/g, (full, target) => {
    const trimmed = target.trim();
    // Leave external URLs, mailto, pure anchors, and fenced-code paths alone.
    if (/^(https?:|mailto:|tel:|#|\/\/)/.test(trimmed) || trimmed === '') {
      return full;
    }

    const hashIdx = trimmed.indexOf('#');
    const pathOnly = hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed;
    const hash = hashIdx >= 0 ? trimmed.slice(hashIdx) : '';

    if (pathOnly === './README.md' || pathOnly === 'README.md') {
      // Site docs index lives at /overview/ (splash home is separate).
      return `](../overview/${hash})`;
    }
    if (pathOnly === '../../README.md') {
      return `](${GITHUB_README}${hash})`;
    }
    // Contributing / ADR / development links (if any appear later) → GitHub blobs.
    if (pathOnly.startsWith('../../docs/development/')) {
      const rest = pathOnly.slice('../../docs/development/'.length);
      return `](${GITHUB_DEV}/${rest}${hash})`;
    }
    if (pathOnly.startsWith('../../docs/adr/')) {
      const rest = pathOnly.slice('../../docs/adr/'.length);
      return `](${GITHUB_ADR}/${rest}${hash})`;
    }

    // Sibling usage pages: ./foo.md → relative Starlight slug (keeps `base` working).
    const mdMatch = pathOnly.match(/^\.\/([a-z0-9-]+)\.md$/i);
    if (mdMatch) {
      return `](./${mdMatch[1]}/${hash})`;
    }

    return full;
  });
}

/**
 * Strip the leading H1 (Starlight renders title from frontmatter) and the
 * redundant "← Documentation index · Project README" nav line used in GitHub docs.
 * @param {string} body
 */
function stripGithubChrome(body) {
  let text = body.replace(/^#\s+[^\n]+\n+/, '');
  // Drop the one-line nav that points at README / project README.
  text = text.replace(
    /^\[← Documentation index\]\([^)]+\)\s*·\s*\[Project README\]\([^)]+\)\n+/m,
    '',
  );
  return text.trimStart();
}

/**
 * Build a Starlight guide page from a usage Markdown file.
 * @param {string} filename
 * @param {string} raw
 */
function toStarlightPage(filename, raw) {
  const h1Match = raw.match(/^#\s+(.+)$/m);
  const title = h1Match?.[1] ?? filename.replace(/\.md$/, '');
  const description = DESCRIPTIONS[filename] ?? title;

  const body = rewriteLinks(stripGithubChrome(raw));

  // YAML frontmatter — keep description as a single quoted string (escape quotes).
  const safeDescription = description.replace(/'/g, "''");
  return `---
title: ${JSON.stringify(title)}
description: '${safeDescription}'
---

${body}`;
}

// Rebuild topic guides only. Splash / getting-started / overview live outside guides/.
rmSync(guidesDir, { recursive: true, force: true });
mkdirSync(guidesDir, { recursive: true });

// Topic pages only — skip docs/usage/README.md (site owns index + overview + getting-started).
const files = readdirSync(usageDir).filter(f => f.endsWith('.md') && f !== 'README.md');

for (const filename of files) {
  const raw = readFileSync(join(usageDir, filename), 'utf8');
  const page = toStarlightPage(filename, raw);
  writeFileSync(join(guidesDir, filename), page);
  console.log(`wrote website/src/content/docs/guides/${filename}`);
}

console.log(`✓ copied ${files.length} usage topic pages into website/src/content/docs/guides`);
