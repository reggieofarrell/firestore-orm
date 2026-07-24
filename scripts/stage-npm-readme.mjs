#!/usr/bin/env node
/**
 * Stage / restore README.md for npm pack & publish.
 *
 * GitHub renders the committed root README.md (contributor-focused). npmjs.org always
 * displays the tarball's root README.md — there is no package.json field for an alternate
 * filename. This script swaps in npm-readme.md (consumer-focused) for the duration of
 * `npm pack` / `npm publish`, then restores the GitHub copy.
 *
 * Modes:
 *   stage   — backup README.md → .README.github.bak, then copy npm-readme.md → README.md
 *   restore — if .README.github.bak exists, move it back to README.md; otherwise no-op
 *
 * Wired via package.json `prepack` / `postpack`. Also called explicitly by
 * scripts/check-package-contents.mjs (which uses --ignore-scripts and therefore skips
 * lifecycle hooks).
 *
 * The HTML comment `<!-- npm-readme -->` must appear at the top of npm-readme.md so
 * check-package-contents can assert the consumer README was staged (not the GitHub copy).
 *
 * Usage: node scripts/stage-npm-readme.mjs <stage|restore>
 */
import { copyFileSync, existsSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const README = join(repoRoot, 'README.md');
const README_NPM = join(repoRoot, 'npm-readme.md');
const BACKUP = join(repoRoot, '.README.github.bak');

/** Marker that must appear in npm-readme.md; mirrored in check-package-contents.mjs. */
const NPM_README_MARKER = '<!-- npm-readme -->';

function stage() {
  // Fail fast if the npm-facing source is missing — packing without it would silently
  // ship the GitHub README to npmjs.org.
  if (!existsSync(README_NPM)) {
    console.error('✗ stage-npm-readme: npm-readme.md is missing; cannot stage for npm pack.');
    process.exit(1);
  }
  if (!existsSync(README)) {
    console.error('✗ stage-npm-readme: README.md is missing; nothing to back up.');
    process.exit(1);
  }

  const npmSource = readFileSync(README_NPM, 'utf8');
  if (!npmSource.includes(NPM_README_MARKER)) {
    console.error(
      `✗ stage-npm-readme: npm-readme.md is missing the required marker ${NPM_README_MARKER}`,
    );
    process.exit(1);
  }

  // If a previous pack crashed before restore, BACKUP already holds the GitHub copy.
  // Do not overwrite it with the (already staged) npm README — that would lose the
  // contributor file. Only create the backup when one does not already exist.
  if (!existsSync(BACKUP)) {
    copyFileSync(README, BACKUP);
  }

  copyFileSync(README_NPM, README);
  console.log('✓ stage-npm-readme: staged npm-readme.md → README.md (GitHub copy backed up).');
}

function restore() {
  // No-op when already restored (or never staged) — safe to call from finally blocks
  // and from a manual recovery after a crashed pack.
  if (!existsSync(BACKUP)) {
    console.log('✓ stage-npm-readme: nothing to restore (no .README.github.bak).');
    return;
  }

  renameSync(BACKUP, README);
  // renameSync removes BACKUP; if a stale copy somehow remains, clear it.
  if (existsSync(BACKUP)) unlinkSync(BACKUP);
  console.log('✓ stage-npm-readme: restored GitHub README.md from backup.');
}

const mode = process.argv[2];
if (mode === 'stage') {
  stage();
} else if (mode === 'restore') {
  restore();
} else {
  console.error('Usage: node scripts/stage-npm-readme.mjs <stage|restore>');
  process.exit(1);
}
