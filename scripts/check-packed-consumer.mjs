/**
 * Isolated packed-consumer compile check — the release regression guard for the package boundary.
 *
 * Packs the library, installs the tarball into a throwaway project with ONLY its declared
 * production/peer dependencies (firebase-admin, zod — NOT express), and type-checks fresh consumers
 * the way real consumers configure TypeScript (`skipLibCheck: true`, the ecosystem default — a
 * strict `skipLibCheck:false` pass would drown in firebase-admin's transitive .d.ts, unrelated to
 * this package). Verifies the published exports map actually resolves in both module systems:
 *   1. an ESM consumer imports every root symbol + the /vector subpath (module: nodenext),
 *   2. a CJS consumer imports the same via the require condition (module: node16, type: commonjs),
 *   3. both compile with express NOT installed (the root graph must not require it),
 *   4. the `/express` subpath compiles once express + @types/express are installed.
 *
 * The precise "no express in the root declaration graph" guarantee (F1) is enforced separately and
 * network-free by check-package-contents.mjs. Run AFTER `npm run build`; requires network to install
 * deps into the temp project.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const PKG = pkg.name;
const ADMIN = `firebase-admin@${pkg.devDependencies['firebase-admin']}`;
const ZOD = `zod@${pkg.devDependencies['zod']}`;
const TS = `typescript@${pkg.devDependencies['typescript']}`;

function run(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: 'pipe', env: { ...process.env, HUSKY: '0' } });
}

function tscExpectOk(dir, label) {
  try {
    run('npx', ['tsc', '-p', 'tsconfig.json'], dir);
    console.log(`  ✓ ${label} compiled`);
  } catch (err) {
    console.error(`  ✗ ${label} failed to compile:\n${err.stdout || err.message}`);
    throw err;
  }
}

const ROOT_IMPORTS = `
  FirestoreRepository, FirestoreQueryBuilder, NotFoundError, ValidationError, ConflictError,
  FirestoreIndexError, parseFirestoreError, makeValidator, zNumberWrite, zDateWrite, zArrayWrite,
  zSentinel, withDelete, isDotNotation, expandDotNotation, mergeDotNotationUpdate,
  convertTimestampsToMillis, createMillisTimestampConverter
`;

const work = mkdtempSync(join(tmpdir(), 'form-consumer-'));
let tarball;
try {
  // Pack the library.
  const packJson = execFileSync('npm', ['pack', '--json', '--ignore-scripts'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, HUSKY: '0' },
  });
  // Slice from the first JSON bracket in case the prepare lifecycle printed to stdout.
  tarball = join(process.cwd(), JSON.parse(packJson.slice(packJson.indexOf('[')))[0].filename);

  // Root project: install the tarball + declared peers only (no express).
  writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'consumer', private: true }));
  console.log('Installing packed tarball + peers (firebase-admin, zod) — no express...');
  run('npm', ['install', '--no-audit', '--no-fund', tarball, ADMIN, ZOD, TS], work);

  const tsconfig = (extra = {}) =>
    JSON.stringify({
      compilerOptions: {
        module: 'nodenext',
        moduleResolution: 'nodenext',
        target: 'ES2022',
        strict: true,
        // Real consumers use skipLibCheck:true; this validates that the exports map resolves and the
        // public API is usable. The express-isolation guarantee is checked separately (grep-based).
        skipLibCheck: true,
        noEmit: true,
        types: [],
        ...extra,
      },
      include: ['consumer.ts'],
    });

  // 1. ESM consumer (no express installed).
  const esm = join(work, 'esm');
  mkdirSync(esm);
  writeFileSync(join(esm, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(esm, 'tsconfig.json'), tsconfig());
  writeFileSync(
    join(esm, 'consumer.ts'),
    `import {${ROOT_IMPORTS}} from '${PKG}';\n` +
      `import { withVectorSearch } from '${PKG}/vector';\n` +
      `export const used = [FirestoreRepository, FirestoreQueryBuilder, NotFoundError, ValidationError, ConflictError, FirestoreIndexError, parseFirestoreError, makeValidator, zNumberWrite, zDateWrite, zArrayWrite, zSentinel, withDelete, isDotNotation, expandDotNotation, mergeDotNotationUpdate, convertTimestampsToMillis, createMillisTimestampConverter, withVectorSearch];\n`,
  );
  tscExpectOk(esm, 'ESM root+vector consumer (express NOT installed)');

  // 2. CJS consumer (no express installed).
  const cjs = join(work, 'cjs');
  mkdirSync(cjs);
  writeFileSync(join(cjs, 'package.json'), JSON.stringify({ type: 'commonjs' }));
  writeFileSync(join(cjs, 'tsconfig.json'), tsconfig({ module: 'node16', moduleResolution: 'node16' }));
  writeFileSync(
    join(cjs, 'consumer.ts'),
    `import {${ROOT_IMPORTS}} from '${PKG}';\n` +
      `import { withVectorSearch } from '${PKG}/vector';\n` +
      `export const used = [FirestoreRepository, parseFirestoreError, makeValidator, withVectorSearch];\n`,
  );
  tscExpectOk(cjs, 'CJS root+vector consumer (express NOT installed)');

  // 3. Express subpath — install express + types, then compile.
  console.log('Installing express + @types/express for the subpath consumer...');
  run('npm', ['install', '--no-audit', '--no-fund', 'express', '@types/express'], work);
  const exp = join(work, 'express');
  mkdirSync(exp);
  writeFileSync(join(exp, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(exp, 'tsconfig.json'), tsconfig());
  writeFileSync(
    join(exp, 'consumer.ts'),
    `import { errorHandler } from '${PKG}/express';\nexport const h = errorHandler;\n`,
  );
  tscExpectOk(exp, 'Express subpath consumer (express installed)');

  console.log('✓ Packed-consumer check passed (ESM + CJS root express-free; /express subpath OK).');
} finally {
  rmSync(work, { recursive: true, force: true });
  if (tarball) rmSync(tarball, { force: true });
}
