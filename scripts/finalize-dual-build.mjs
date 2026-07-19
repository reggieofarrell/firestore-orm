/**
 * Finalizes the dual ESM/CJS build.
 *
 * The ESM output lives at dist/ (the package root is `"type": "module"`, so dist/*.js are ESM).
 * The CJS output lives at dist/cjs/. Node decides a .js file's module system from the nearest
 * package.json `type`, so we drop a `{ "type": "commonjs" }` marker into dist/cjs/ to make those
 * files load as CommonJS regardless of the root `"type": "module"`.
 */
import { writeFileSync } from 'node:fs';

const marker = JSON.stringify({ type: 'commonjs' }, null, 2) + '\n';
writeFileSync(new URL('../dist/cjs/package.json', import.meta.url), marker);

console.log('finalize-dual-build: wrote dist/cjs/package.json ({ "type": "commonjs" })');
