/**
 * Investigation probe for issue #79.
 *
 * Asks whether the published Lifecycle Hooks guide still contains the contradictory
 * explanation of `query().delete()` (claims delete hooks do not fire) while the same
 * page's next section correctly documents bulk-delete hooks.
 *
 * Observational only — not a regression test. After the docs fix, re-running this probe
 * must report `contradictionPresent: false`.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../');
const guidePath = resolve(
  root,
  'website/src/content/docs/guides/concepts/lifecycle-hooks.md',
);
const text = readFileSync(guidePath, 'utf8');
const lines = text.split('\n');

/** False claim carried by the example explanation (issue body; line numbers were stale). */
const falseClaim =
  '`query().delete()` is a query-level bulk write that does **not** fire delete';
/** Correct adjacent section heading / body that contradicts the false claim. */
const correctBulkSection = '## Query-level writes run the bulk hooks';
const correctBulkBody =
  '`query().delete()` runs\n`beforeBulkDelete` and `afterBulkDelete`';

const falseClaimLine = lines.findIndex(line => line.includes(falseClaim)) + 1;
const correctHeadingLine =
  lines.findIndex(line => line.includes(correctBulkSection)) + 1;
const hasCorrectBody = text.includes(correctBulkBody);

const report = {
  guidePath: 'website/src/content/docs/guides/concepts/lifecycle-hooks.md',
  falseClaimLine: falseClaimLine || null,
  correctBulkHeadingLine: correctHeadingLine || null,
  hasCorrectBulkBody: hasCorrectBody,
  contradictionPresent:
    falseClaimLine > 0 && correctHeadingLine > 0 && hasCorrectBody,
  /** Sibling v3 pages that already state the correct bulk-vs-per-doc distinction. */
  siblingCorrectPages: [
    'website/src/content/docs/guides/working-with-data/crud-operations.md',
    'website/src/content/docs/guides/working-with-data/queries.md',
    'website/src/content/docs/reference/troubleshooting.md',
    'website/src/content/docs/reference/query-builder.md',
    'website/src/content/docs/reference/repository.md',
  ],
};

console.log(JSON.stringify(report, null, 2));

/**
 * EXPECT_CONTRADICTION controls the exit contract:
 * - `1` (default / unfixed baseline): fail if the contradiction is already gone.
 * - `0` (post-fix): fail if the contradiction is still present.
 */
const expectContradiction = process.env.EXPECT_CONTRADICTION !== '0';
if (expectContradiction && !report.contradictionPresent) {
  console.error(
    'Expected the unfixed baseline contradiction; got contradictionPresent=false.',
  );
  process.exit(1);
}
if (!expectContradiction && report.contradictionPresent) {
  console.error(
    'Expected the fixed guide; got contradictionPresent=true.',
  );
  process.exit(1);
}
