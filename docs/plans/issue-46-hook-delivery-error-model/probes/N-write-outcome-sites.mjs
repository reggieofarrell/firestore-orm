/**
 * Probe: enumerate every current hook dispatch, fixed-batch commit, post-commit read-back, and
 * transaction hook-cloning site by source line.
 *
 * This asks where the sites are; it intentionally does not assert a fixed count because the
 * implementer must re-run it after rebasing and reconcile any new write surface.
 *
 * Run from the repository root:
 *   node docs/plans/issue-46-hook-delivery-error-model/probes/N-write-outcome-sites.mjs
 */
import { readFile } from 'node:fs/promises';

const files = ['src/core/FirestoreRepository.ts', 'src/core/QueryBuilder.ts'];
const patterns = {
  hook_dispatch: /(?:this\.)?runHooks\(/,
  fixed_batch_commit: /commitInChunks\(/,
  post_commit_readback: /return await this\.getByIdOrThrow|return await Promise\.all/,
  transaction_hook_clone: /txRepo\.hooks\s*=/,
};

const output = {};

for (const file of files) {
  const lines = (await readFile(file, 'utf8')).split('\n');
  output[file] = {};

  for (const [name, pattern] of Object.entries(patterns)) {
    output[file][name] = lines.flatMap((line, index) =>
      pattern.test(line) ? [{ line: index + 1, text: line.trim() }] : [],
    );
  }
}

console.log(JSON.stringify(output, null, 2));
