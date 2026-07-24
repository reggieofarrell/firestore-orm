/**
 * Asserts the published npm tarball contains only intended files.
 *
 * Runs `npm pack --dry-run --json` (with Husky disabled so the prepare lifecycle does not attempt
 * git/cache writes) and validates every packed path against an allowlist:
 *   - top-level metadata: package.json, README.md, CHANGELOG.md, LICENSE, NOTICE
 *   - everything else must live under dist/
 *   - nothing under dist/tests/ (compiled test fixtures must never ship)
 *   - required dual-build + subpath entrypoints must be present
 *
 * Dual README: GitHub keeps a contributor README.md; npm consumers get npm-readme.md staged into
 * README.md for the tarball. Because this script uses --ignore-scripts (so prepare/husky does not
 * fire), it must stage/restore explicitly around the pack call. It also asserts the staged
 * README.md carries the npm-only marker so the gate cannot pass with the GitHub copy.
 *
 * Exits non-zero on any violation. Run AFTER `npm run build`.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Must match the marker required by scripts/stage-npm-readme.mjs / npm-readme.md. */
const NPM_README_MARKER = '<!-- npm-readme -->';

const ALLOWED_TOP_LEVEL = new Set([
  'package.json',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'NOTICE',
]);

const REQUIRED = [
  'dist/index.js',
  'dist/index.d.ts',
  'dist/cjs/index.js',
  'dist/cjs/index.d.ts',
  'dist/cjs/package.json',
  'dist/express/index.js',
  'dist/express/index.d.ts',
  'dist/vector/index.js',
  'dist/vector/index.d.ts',
];

function runStageReadme(mode) {
  execFileSync(process.execPath, [join(repoRoot, 'scripts', 'stage-npm-readme.mjs'), mode], {
    stdio: 'inherit',
    cwd: repoRoot,
  });
}

function packedFiles() {
  // dist is expected to be built already (run after `npm run build`). The prepare lifecycle (husky)
  // can print to stdout and prepend noise to the --json output, so slice from the first JSON bracket.
  // --ignore-scripts skips prepack/postpack, so we stage/restore around this call ourselves.
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    encoding: 'utf8',
    env: { ...process.env, HUSKY: '0' },
    cwd: repoRoot,
  });
  const jsonStart = out.indexOf('[');
  const parsed = JSON.parse(out.slice(jsonStart));
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  return entry.files.map(f => f.path.replaceAll('\\', '/'));
}

/** Recursively collect .d.ts files under a dir, skipping any path segment in `skipDirs`. */
function collectDtsFiles(dir, skipDirs, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      collectDtsFiles(full, skipDirs, acc);
    } else if (entry.name.endsWith('.d.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Guards F1: the ROOT declaration graph must never reference `express`. The express types are
 * intentionally confined to the `express/` subpath output, so a `from 'express'` /
 * `require('express')` anywhere else in dist means the leak has regressed. This is checked directly
 * (network-free) because a consumer compile with skipLibCheck:true would hide a .d.ts-level import.
 */
function checkNoExpressInRootGraph(violations) {
  const dtsFiles = collectDtsFiles('dist', new Set(['express']));
  for (const file of dtsFiles) {
    const src = readFileSync(file, 'utf8');
    if (/['"]express['"]/.test(src)) {
      violations.push(`express referenced outside the express subpath: ${file}`);
    }
  }
}

/**
 * Guard D13/D14 (declaration hygiene, ADR-0021): tsconfig sets `stripInternal:true` and
 * `removeComments:false`. Both are silent-regression-prone, so assert the emitted artifact directly:
 *   - the sole `@internal` member (`getUnderlyingQuery`) must be stripped from EVERY shipped .d.ts;
 *   - public JSDoc must survive in a representative core declaration (removeComments not re-enabled).
 */
function checkDeclarationHygiene(violations) {
  const dtsFiles = collectDtsFiles('dist', new Set());
  for (const file of dtsFiles) {
    if (readFileSync(file, 'utf8').includes('getUnderlyingQuery')) {
      violations.push(
        `@internal member "getUnderlyingQuery" leaked into declarations (stripInternal regressed): ${file}`,
      );
    }
  }
  const repoDts = 'dist/core/FirestoreRepository.d.ts';
  const jsdocBlocks = (readFileSync(repoDts, 'utf8').match(/\/\*\*/g) ?? []).length;
  if (jsdocBlocks < 10) {
    violations.push(
      `public JSDoc missing from ${repoDts} (removeComments regressed?): found ${jsdocBlocks} block(s), expected >= 10`,
    );
  }
}

/**
 * Assert the on-disk README.md is the staged npm consumer copy (not the GitHub contributor README).
 * Called while staged, before/after pack — the tarball will contain whatever is on disk as README.md.
 */
function checkStagedNpmReadme(violations) {
  const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
  if (!readme.includes(NPM_README_MARKER)) {
    violations.push(
      `staged README.md is missing npm marker ${NPM_README_MARKER} — GitHub README may have been packed`,
    );
  }
  // Contributor-only section that must NOT ship on npmjs.org.
  if (readme.includes('## Testing Strategy')) {
    violations.push(
      'staged README.md still looks like the GitHub contributor README (contains "## Testing Strategy")',
    );
  }
}

function main() {
  const violations = [];
  checkNoExpressInRootGraph(violations);
  checkDeclarationHygiene(violations);

  // Stage the consumer README for the dry-run pack, then always restore — even if pack or
  // validation throws — so a failed gate never leaves the working tree with the npm README.
  runStageReadme('stage');
  let files;
  try {
    checkStagedNpmReadme(violations);
    files = packedFiles();
  } finally {
    runStageReadme('restore');
  }

  for (const path of files) {
    if (path.startsWith('dist/tests/')) {
      violations.push(`test fixture must not be published: ${path}`);
      continue;
    }
    if (path.startsWith('dist/')) continue;
    if (ALLOWED_TOP_LEVEL.has(path)) continue;
    violations.push(`unexpected file in tarball: ${path}`);
  }

  const missing = REQUIRED.filter(req => !files.includes(req));
  for (const req of missing) {
    violations.push(`required entrypoint missing from tarball: ${req}`);
  }

  // Declaration maps should not ship (they reference unshipped src/).
  for (const path of files) {
    if (path.endsWith('.d.ts.map') || path.endsWith('.js.map')) {
      violations.push(`source/declaration map must not be published: ${path}`);
    }
  }

  // npm-readme.md is source-only — it must never appear as a separate tarball path.
  if (files.includes('npm-readme.md')) {
    violations.push(
      'npm-readme.md must not be published as a separate file (stage into README.md)',
    );
  }

  if (violations.length > 0) {
    console.error(`✗ Package content check failed (${files.length} files packed):`);
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }

  console.log(`✓ Package content check passed (${files.length} files, allowlist satisfied).`);
}

main();
