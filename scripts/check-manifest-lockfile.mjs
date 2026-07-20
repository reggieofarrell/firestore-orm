/**
 * Asserts the root manifest and the lockfile's root package entry agree on peerDependencies and
 * engines. `npm ci` does not detect this kind of peer-metadata drift, which is how the lockfile
 * once advertised an obsolete zod peer range after the manifest had moved on.
 *
 * Exits non-zero on any mismatch.
 */
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const root = lock.packages?.[''] ?? {};

const violations = [];

function compare(section) {
  const manifest = pkg[section] ?? {};
  const locked = root[section] ?? {};
  const keys = new Set([...Object.keys(manifest), ...Object.keys(locked)]);
  for (const key of keys) {
    if (manifest[key] !== locked[key]) {
      violations.push(
        `${section}.${key}: manifest="${manifest[key] ?? '(absent)'}" lockfile="${locked[key] ?? '(absent)'}"`,
      );
    }
  }
}

compare('peerDependencies');
compare('engines');

if (violations.length > 0) {
  console.error('✗ Manifest / lockfile root metadata drift detected:');
  for (const v of violations) console.error(`  - ${v}`);
  console.error('  Run `npm install` to regenerate package-lock.json.');
  process.exit(1);
}

console.log('✓ Manifest and lockfile root peerDependencies/engines agree.');
