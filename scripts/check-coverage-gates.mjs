#!/usr/bin/env node
/* eslint-env node */
/**
 * Enforce dual coverage gates tailored to firestore-orm's test pyramid.
 *
 * Unit and integration suites are complementary — merging LCOV inflates confidence
 * because a line hit in either suite counts as covered. Instead:
 *
 * - **Unit gate** owns pure logic: utils, errors, validation, package exports.
 * - **Integration gate** owns emulator-backed ORM core: FirestoreRepository, QueryBuilder,
 *   and Validation paths exercised against the emulator.
 *
 * Usage:
 *   node scripts/check-coverage-gates.mjs --suite unit
 *   node scripts/check-coverage-gates.mjs --suite integration
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const suiteArg = process.argv.find(arg => arg.startsWith('--suite='));
const suiteFlagIndex = process.argv.indexOf('--suite');
const suiteName =
  suiteArg?.split('=')[1] ?? (suiteFlagIndex >= 0 ? process.argv[suiteFlagIndex + 1] : undefined);

if (suiteName !== 'unit' && suiteName !== 'integration') {
  console.error('Usage: node scripts/check-coverage-gates.mjs --suite <unit|integration>');
  process.exit(1);
}

const lcovPath = resolve(repoRoot, `coverage/${suiteName}/lcov.info`);

if (!existsSync(lcovPath) || statSync(lcovPath).size === 0) {
  console.error(`Missing or empty coverage report: coverage/${suiteName}/lcov.info`);
  console.error(`Run npm run test:${suiteName}:coverage first.`);
  process.exit(1);
}

/**
 * Normalizes LCOV SF paths to repo-relative `src/...` paths.
 */
function normalizeSourcePath(rawPath) {
  const normalized = rawPath.replace(/^\.\//, '').replace(/\\/g, '/');
  const srcIndex = normalized.lastIndexOf('/src/');
  if (srcIndex >= 0) {
    return normalized.slice(srcIndex + 1);
  }
  return normalized;
}

/**
 * Parses an lcov.info file into per-file coverage metrics.
 */
function parseLcov(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const records = text.split('end_of_record');
  const files = [];

  for (const record of records) {
    const sourceMatch = record.match(/^SF:(.+)$/m);
    if (!sourceMatch) continue;

    const file = normalizeSourcePath(sourceMatch[1].trim());
    const lf = Number(record.match(/^LF:(\d+)/m)?.[1] ?? 0);
    const lh = Number(record.match(/^LH:(\d+)/m)?.[1] ?? 0);
    const brf = Number(record.match(/^BRF:(\d+)/m)?.[1] ?? 0);
    const brh = Number(record.match(/^BRH:(\d+)/m)?.[1] ?? 0);
    const fnf = Number(record.match(/^FNF:(\d+)/m)?.[1] ?? 0);
    const fnh = Number(record.match(/^FNH:(\d+)/m)?.[1] ?? 0);

    files.push({ file, lf, lh, brf, brh, fnf, fnh });
  }

  return files;
}

/**
 * @param {number} hit
 * @param {number} found
 */
function percent(hit, found) {
  return found === 0 ? 100 : (hit / found) * 100;
}

/**
 * @param {ReturnType<typeof parseLcov>} files
 * @param {(file: string) => boolean} predicate
 */
function aggregate(files, predicate) {
  const matched = files.filter(entry => predicate(entry.file));
  const totals = { lf: 0, lh: 0, brf: 0, brh: 0, fnf: 0, fnh: 0 };

  for (const entry of matched) {
    totals.lf += entry.lf;
    totals.lh += entry.lh;
    totals.brf += entry.brf;
    totals.brh += entry.brh;
    totals.fnf += entry.fnf;
    totals.fnh += entry.fnh;
  }

  return {
    files: matched.map(entry => entry.file),
    lines: percent(totals.lh, totals.lf),
    branches: percent(totals.brh, totals.brf),
    functions: percent(totals.fnh, totals.fnf),
    raw: totals,
  };
}

/** @type {Array<{ name: string; match: (file: string) => boolean; thresholds: { lines: number; branches: number; functions: number } }>} */
const UNIT_GATES = [
  {
    name: 'Pure utilities (src/utils)',
    match: file => file.startsWith('src/utils/'),
    thresholds: { lines: 95, branches: 90, functions: 90 },
  },
  {
    name: 'Error and validation layer',
    match: file =>
      [
        'src/core/Errors.ts',
        'src/core/ErrorParser.ts',
        'src/express/index.ts',
        'src/core/Validation.ts',
      ].includes(file),
    thresholds: { lines: 90, branches: 85, functions: 90 },
  },
  {
    name: 'Package entry exports (src/index.ts)',
    match: file => file === 'src/index.ts',
    thresholds: { lines: 100, branches: 100, functions: 65 },
  },
];

/** @type {typeof UNIT_GATES} */
const INTEGRATION_GATES = [
  {
    name: 'FirestoreRepository (emulator)',
    match: file => file === 'src/core/FirestoreRepository.ts',
    thresholds: { lines: 90, branches: 75, functions: 85 },
  },
  {
    name: 'QueryBuilder (emulator)',
    match: file => file === 'src/core/QueryBuilder.ts',
    thresholds: { lines: 90, branches: 75, functions: 95 },
  },
  {
    name: 'Validation via emulator paths',
    match: file => file === 'src/core/Validation.ts',
    thresholds: { lines: 90, branches: 80, functions: 95 },
  },
  {
    name: 'Vector extension (emulator)',
    match: file => file.startsWith('src/vector/'),
    thresholds: { lines: 90, branches: 75, functions: 90 },
  },
];

const gates = suiteName === 'unit' ? UNIT_GATES : INTEGRATION_GATES;
const files = parseLcov(lcovPath);
const fmt = value => value.toFixed(2);

console.log(`\n${suiteName} coverage gates (coverage/${suiteName}/lcov.info):\n`);

let failed = false;

for (const gate of gates) {
  const result = aggregate(files, gate.match);

  if (result.files.length === 0) {
    console.error(`✗ ${gate.name}`);
    console.error(`  No matching source files found in coverage report.`);
    failed = true;
    continue;
  }

  const metrics = [
    ['lines', result.lines, gate.thresholds.lines],
    ['branches', result.branches, gate.thresholds.branches],
    ['functions', result.functions, gate.thresholds.functions],
  ];

  const gateFailed = metrics.some(([, actual, threshold]) => actual < threshold);

  console.log(`${gateFailed ? '✗' : '✓'} ${gate.name}`);
  console.log(`  files: ${result.files.join(', ')}`);

  for (const [label, actual, threshold] of metrics) {
    const ok = actual >= threshold;
    console.log(
      `  ${label}: ${fmt(actual)}% (threshold ${threshold}%)${ok ? '' : '  ← below threshold'}`,
    );
    if (!ok) failed = true;
  }

  console.log('');
}

if (failed) {
  console.error(`${suiteName} coverage gates failed.`);
  process.exit(1);
}

console.log(`All ${suiteName} coverage gates passed.`);
