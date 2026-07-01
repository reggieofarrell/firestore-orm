#!/usr/bin/env node
/* eslint-env node */
/**
 * Merge lcov coverage across unit and integration Jest suites and enforce thresholds.
 *
 * Repository code is exercised by both fast unit tests (pure logic + mocked Firestore)
 * and emulator integration tests (real reads/writes). Neither suite alone fairly
 * represents total coverage, so CI merges coverage/unit and coverage/integration
 * before gating.
 *
 * Usage:
 *   node scripts/merge-coverage.mjs           # full merge (CI and test:coverage:all)
 *   node scripts/merge-coverage.mjs --unit-only # pre-push: gate unit report only
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const unitOnly = process.argv.includes('--unit-only');

const fullInputs = ['coverage/unit/lcov.info', 'coverage/integration/lcov.info'];
const inputs = unitOnly ? ['coverage/unit/lcov.info'] : fullInputs;

const inputPattern = unitOnly
  ? 'coverage/unit/lcov.info'
  : 'coverage/+(unit|integration)/lcov.info';

const output = unitOnly ? 'coverage/unit-merged/lcov.info' : 'coverage/merged/lcov.info';

/** @type {{ lines: number; functions: number; branches: number }} */
const thresholds = unitOnly
  ? {
      lines: Number(process.env.UNIT_COVERAGE_LINES_THRESHOLD ?? 50),
      functions: Number(process.env.UNIT_COVERAGE_FUNCTIONS_THRESHOLD ?? 50),
      branches: Number(process.env.UNIT_COVERAGE_BRANCHES_THRESHOLD ?? 45),
    }
  : {
      lines: Number(process.env.COVERAGE_LINES_THRESHOLD ?? 70),
      functions: Number(process.env.COVERAGE_FUNCTIONS_THRESHOLD ?? 70),
      branches: Number(process.env.COVERAGE_BRANCHES_THRESHOLD ?? 60),
    };

for (const path of inputs) {
  const abs = resolve(repoRoot, path);
  if (!existsSync(abs)) {
    console.error(`Missing coverage input: ${path}`);
    if (unitOnly) {
      console.error('Run `npm run test:unit:coverage` first.');
    } else {
      console.error('Run `npm run test:coverage:all` to produce both reports first.');
    }
    process.exit(1);
  }
  if (statSync(abs).size === 0) {
    console.error(`Empty coverage input: ${path}`);
    process.exit(1);
  }
}

mkdirSync(resolve(repoRoot, dirname(output)), { recursive: true });

if (unitOnly) {
  execSync(`cp '${resolve(repoRoot, inputs[0])}' '${resolve(repoRoot, output)}'`, {
    stdio: 'inherit',
    cwd: repoRoot,
  });
} else {
  execSync(`npx lcov-result-merger '${inputPattern}' '${output}'`, {
    stdio: 'inherit',
    cwd: repoRoot,
  });
}

const totals = { LF: 0, LH: 0, FNF: 0, FNH: 0, BRF: 0, BRH: 0 };
for (const line of readFileSync(resolve(repoRoot, output), 'utf8').split('\n')) {
  for (const key of Object.keys(totals)) {
    if (line.startsWith(`${key}:`)) {
      totals[key] += Number.parseInt(line.slice(key.length + 1), 10) || 0;
    }
  }
}

const pct = (hit, found) => (found === 0 ? 100 : (hit / found) * 100);
const results = {
  lines: pct(totals.LH, totals.LF),
  functions: pct(totals.FNH, totals.FNF),
  branches: pct(totals.BRH, totals.BRF),
};
const fmt = n => n.toFixed(2);

const label = unitOnly ? 'Unit' : 'Merged';
console.log(`\n${label} coverage:`);
console.log(`  lines:     ${fmt(results.lines)}% (threshold ${thresholds.lines}%)`);
console.log(`  functions: ${fmt(results.functions)}% (threshold ${thresholds.functions}%)`);
console.log(`  branches:  ${fmt(results.branches)}% (threshold ${thresholds.branches}%)`);

const failures = Object.entries(thresholds).filter(([k, v]) => results[k] < v);
if (failures.length > 0) {
  console.error(`\n${label} coverage below threshold:`);
  for (const [k, v] of failures) {
    console.error(`  ${k}: ${fmt(results[k])}% < ${v}%`);
  }
  process.exit(1);
}
console.log(`\nAll ${label.toLowerCase()} coverage thresholds met.`);
