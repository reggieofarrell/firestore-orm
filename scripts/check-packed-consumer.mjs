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
// The firebase-admin major to test against. Defaults to the dev version, but CI parametrizes it
// (FIRESTORE_ORM_ADMIN_VERSION=^12 / ^13 / ^14) to exercise every declared peer major honestly.
const ADMIN_VERSION =
  process.env.FIRESTORE_ORM_ADMIN_VERSION || pkg.devDependencies['firebase-admin'];
const ADMIN = `firebase-admin@${ADMIN_VERSION}`;
// Optional: force the TRANSITIVE @google-cloud/firestore to a specific version via an npm override,
// to exercise the vector object-form floor (B3). firebase-admin 12 can resolve a firestore below the
// >= 7.10 that the object-form findNearest() requires, so CI pins e.g. 7.9.0 and proves the packed
// library still installs, compiles, and loads against it. Unset (the default) uses whatever the
// chosen firebase-admin resolves.
const FIRESTORE_VERSION = process.env.FIRESTORE_ORM_FIRESTORE_VERSION;
const ZOD = `zod@${pkg.devDependencies['zod']}`;
const TS = `typescript@${pkg.devDependencies['typescript']}`;

function run(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: 'pipe', env: { ...process.env, HUSKY: '0' } });
}

/**
 * Runs a Node script that must exit 0 — the runtime load smoke test. Type-checking proves the
 * exports map resolves for the compiler; this proves the built JS actually loads and its exports are
 * defined at runtime (require() for CJS, import() for ESM), which a tsc pass never exercises.
 */
function nodeRunExpectOk(dir, file, label) {
  try {
    run('node', [file], dir);
    console.log(`  ✓ ${label} loaded at runtime`);
  } catch (err) {
    console.error(`  ✗ ${label} failed to load:\n${err.stdout || err.message}`);
    throw err;
  }
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

  // Root project: install the tarball + declared peers only (no express). When a firestore version
  // is pinned, force it transitively with an npm `overrides` entry so firebase-admin resolves it.
  const rootPkg = { name: 'consumer', private: true };
  if (FIRESTORE_VERSION) {
    rootPkg.overrides = { '@google-cloud/firestore': FIRESTORE_VERSION };
  }
  writeFileSync(join(work, 'package.json'), JSON.stringify(rootPkg));
  const firestoreNote = FIRESTORE_VERSION
    ? `, @google-cloud/firestore@${FIRESTORE_VERSION} override`
    : '';
  console.log(
    `Installing packed tarball + peers (${ADMIN}, ${ZOD}${firestoreNote}) — no express...`,
  );
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
    `import { z } from 'zod';\n` +
      `import {${ROOT_IMPORTS}} from '${PKG}';\n` +
      `import { withVectorSearch, vectorEmbeddingSchema } from '${PKG}/vector';\n` +
      // T5: the named vector value type must be importable through the public /vector specifier...
      `import type { VectorValueLike } from '${PKG}/vector';\n` +
      `const vvl: VectorValueLike = { toArray: () => [1, 2, 3], isEqual: () => false };\n` +
      // ...and the schema input must be number[] | VectorValueLike, NOT `any` (which would silently
      // accept a string). A string assignment must be a compile error, or this @ts-expect-error is
      // unused and tsc fails — catching a regression back to an `any`-typed embedding field.
      `const embSchema = vectorEmbeddingSchema(3);\n` +
      `type EmbInput = z.input<typeof embSchema>;\n` +
      `const goodEmb: EmbInput = [1, 2, 3];\n` +
      `// @ts-expect-error vector embedding input is number[] | VectorValueLike, not any/string\n` +
      `const badEmb: EmbInput = 'not-a-vector';\n` +
      `export const used = [FirestoreRepository, FirestoreQueryBuilder, NotFoundError, ValidationError, ConflictError, FirestoreIndexError, parseFirestoreError, makeValidator, zNumberWrite, zDateWrite, zArrayWrite, zSentinel, withDelete, isDotNotation, expandDotNotation, mergeDotNotationUpdate, convertTimestampsToMillis, createMillisTimestampConverter, withVectorSearch, vectorEmbeddingSchema, vvl, goodEmb, badEmb];\n`,
  );
  tscExpectOk(esm, 'ESM root+vector consumer (express NOT installed)');

  // 1b. ESM runtime load: the built ESM output must actually import and expose its exports.
  writeFileSync(
    join(esm, 'smoke.mjs'),
    `import * as root from '${PKG}';\n` +
      `import * as vector from '${PKG}/vector';\n` +
      `const need = ['FirestoreRepository','FirestoreQueryBuilder','parseFirestoreError','makeValidator','convertTimestampsToMillis'];\n` +
      `const missing = need.filter(k => typeof root[k] === 'undefined');\n` +
      `if (missing.length) { console.error('missing root exports:', missing); process.exit(1); }\n` +
      `if (typeof vector.withVectorSearch !== 'function') { console.error('missing vector export'); process.exit(1); }\n`,
  );
  nodeRunExpectOk(esm, 'smoke.mjs', 'ESM root+vector import()');

  // 1c. Vector object-form FLOOR probe (only on the pinned-firestore legs). Import/load alone can't
  // guard B3, so this constructs the object-form findNearest() against the RESOLVED
  // @google-cloud/firestore and asserts the promised behavior: it must construct on >= 7.10, and on
  // 7.6-7.9 (positional-only) it must fail with the library's deterministic object-form compatibility
  // error — not a raw SDK argument error (review T4). No network: building the query is lazy.
  if (FIRESTORE_VERSION) {
    writeFileSync(
      join(esm, 'vector-probe.mjs'),
      `import { createRequire } from 'node:module';\n` +
        `import { initializeApp } from 'firebase-admin/app';\n` +
        `import { getFirestore } from 'firebase-admin/firestore';\n` +
        `import { FirestoreRepository } from '${PKG}';\n` +
        `import { withVectorSearch } from '${PKG}/vector';\n` +
        `const requireCjs = createRequire(import.meta.url);\n` +
        `const version = requireCjs('@google-cloud/firestore/package.json').version;\n` +
        `const [maj, min] = version.split('.').map(Number);\n` +
        `const objectFormSupported = maj > 7 || (maj === 7 && min >= 10);\n` +
        `const db = getFirestore(initializeApp({ projectId: 'floor-probe' }, 'floorprobe'));\n` +
        `const vrepo = withVectorSearch(new FirestoreRepository(db, 'things'));\n` +
        `let constructed = false; let message = null;\n` +
        `try {\n` +
        `  vrepo.vectorQuery().findNearest({ vectorField: 'embedding', queryVector: [0.1, 0.2, 0.3], limit: 1, distanceMeasure: 'COSINE' });\n` +
        `  constructed = true;\n` +
        `} catch (e) { message = e && e.message; }\n` +
        `if (objectFormSupported) {\n` +
        `  if (!constructed) { console.error('expected object-form findNearest to construct on @google-cloud/firestore ' + version + ', but it threw: ' + message); process.exit(1); }\n` +
        `} else {\n` +
        `  if (constructed) { console.error('expected object-form findNearest to be REJECTED on @google-cloud/firestore ' + version + ' (positional-only), but it constructed'); process.exit(1); }\n` +
        `  if (!/object-form findNearest/.test(message || '')) { console.error('expected the ORM object-form compatibility error on ' + version + ', got: ' + message); process.exit(1); }\n` +
        `}\n` +
        `console.log('  vector object-form probe OK on @google-cloud/firestore ' + version + ' (objectFormSupported=' + objectFormSupported + ')');\n`,
    );
    nodeRunExpectOk(
      esm,
      'vector-probe.mjs',
      `Vector object-form floor probe (@google-cloud/firestore ${FIRESTORE_VERSION})`,
    );
  }

  // 2. CJS consumer (no express installed).
  const cjs = join(work, 'cjs');
  mkdirSync(cjs);
  writeFileSync(join(cjs, 'package.json'), JSON.stringify({ type: 'commonjs' }));
  writeFileSync(
    join(cjs, 'tsconfig.json'),
    tsconfig({ module: 'node16', moduleResolution: 'node16' }),
  );
  writeFileSync(
    join(cjs, 'consumer.ts'),
    `import {${ROOT_IMPORTS}} from '${PKG}';\n` +
      `import { withVectorSearch } from '${PKG}/vector';\n` +
      `export const used = [FirestoreRepository, parseFirestoreError, makeValidator, withVectorSearch];\n`,
  );
  tscExpectOk(cjs, 'CJS root+vector consumer (express NOT installed)');

  // 2b. CJS runtime load: the built CJS output must actually require and expose its exports.
  writeFileSync(
    join(cjs, 'smoke.cjs'),
    `const root = require('${PKG}');\n` +
      `const vector = require('${PKG}/vector');\n` +
      `const need = ['FirestoreRepository','FirestoreQueryBuilder','parseFirestoreError','makeValidator','convertTimestampsToMillis'];\n` +
      `const missing = need.filter(k => typeof root[k] === 'undefined');\n` +
      `if (missing.length) { console.error('missing root exports:', missing); process.exit(1); }\n` +
      `if (typeof vector.withVectorSearch !== 'function') { console.error('missing vector export'); process.exit(1); }\n`,
  );
  nodeRunExpectOk(cjs, 'smoke.cjs', 'CJS root+vector require()');

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

  // 3b. Express subpath runtime load (both module systems resolve the require/import conditions).
  writeFileSync(
    join(exp, 'smoke.mjs'),
    `import { errorHandler } from '${PKG}/express';\n` +
      `if (typeof errorHandler !== 'function') { console.error('errorHandler is not a function'); process.exit(1); }\n`,
  );
  nodeRunExpectOk(exp, 'smoke.mjs', 'Express subpath import()');
  writeFileSync(
    join(exp, 'smoke.cjs'),
    `const { errorHandler } = require('${PKG}/express');\n` +
      `if (typeof errorHandler !== 'function') { console.error('errorHandler is not a function'); process.exit(1); }\n`,
  );
  nodeRunExpectOk(exp, 'smoke.cjs', 'Express subpath require()');

  console.log(
    `✓ Packed-consumer check passed for ${ADMIN}${firestoreNote} (ESM + CJS root express-free, ` +
      `compile + runtime load; /express subpath OK).`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
  if (tarball) rmSync(tarball, { force: true });
}
