// @ts-check
/**
 * Astro + Starlight config for the public firestore-orm usage docs site.
 *
 * Deployed to GitHub Pages at https://reggieofarrell.github.io/firestore-orm/
 * (`site` + `base` must match that URL shape). Contributor docs (ADRs,
 * development guides) stay in-repo under docs/ and are not published here.
 *
 * starlight-versions is enabled below: v2 docs are archived under
 * src/content/docs/2.0/ (snapshot in src/content/versions/2.0.json) and the
 * root tree is the current major (v3). To archive a future major, see
 * website/VERSIONING.md.
 *
 * The sidebar is organized into two pillars — Guides (learn) and Reference
 * (look up). The `redirects` map below preserves the v3.0 flat `guides/*` URLs
 * that were reorganized into pillar subfolders, so external/bookmarked links
 * keep working.
 */
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightVersions from 'starlight-versions';

// https://astro.build/config
export default defineConfig({
  // Origin only — GitHub Pages project sites publish under /<repo>/.
  site: 'https://reggieofarrell.github.io',
  // Repository name; all built asset/page URLs are prefixed with this path.
  base: '/firestore-orm',
  // Preserve the pre-reorg flat guide URLs. Astro applies `base` to the redirect *source* (routing)
  // but not to the target string, so targets must include the `/firestore-orm` base explicitly.
  redirects: {
    '/guides/core-concepts': '/firestore-orm/guides/concepts/core-concepts/',
    '/guides/schema-validation': '/firestore-orm/guides/concepts/schema-validation/',
    '/guides/field-value-sentinels': '/firestore-orm/guides/concepts/field-value-sentinels/',
    '/guides/timestamps': '/firestore-orm/guides/concepts/timestamps/',
    '/guides/lifecycle-hooks': '/firestore-orm/guides/concepts/lifecycle-hooks/',
    '/guides/crud-operations': '/firestore-orm/guides/working-with-data/crud-operations/',
    '/guides/queries': '/firestore-orm/guides/working-with-data/queries/',
    '/guides/transactions': '/firestore-orm/guides/working-with-data/transactions/',
    '/guides/subcollections': '/firestore-orm/guides/working-with-data/subcollections/',
    '/guides/dot-notation': '/firestore-orm/guides/working-with-data/dot-notation/',
    '/guides/best-practices': '/firestore-orm/guides/designing/best-practices/',
    '/guides/performance': '/firestore-orm/guides/designing/performance/',
    '/guides/advanced-patterns': '/firestore-orm/guides/advanced/patterns/',
    '/guides/examples': '/firestore-orm/guides/advanced/examples/',
    '/guides/vector-search': '/firestore-orm/guides/advanced/vector-search/',
    '/guides/triggers': '/firestore-orm/guides/integrations/cloud-functions/',
    '/guides/framework-integration': '/firestore-orm/guides/integrations/express/',
    '/guides/scope-and-capabilities': '/firestore-orm/reference/scope-and-capabilities/',
    '/guides/troubleshooting': '/firestore-orm/reference/troubleshooting/',
    '/guides/api-reference': '/firestore-orm/reference/repository/',
    '/guides/error-handling': '/firestore-orm/reference/errors/',
  },
  integrations: [
    starlight({
      title: '@reggieofarrell/firestore-orm',
      plugins: [
        starlightVersions({
          versions: [{ slug: '2.0', label: 'v2' }],
          current: { label: 'v3' },
        }),
      ],
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/reggieofarrell/firestore-orm',
        },
      ],
      // Two pillars: Guides (learn) and Reference (look up). See overview.md.
      sidebar: [
        {
          label: 'Guides',
          items: [
            {
              label: 'Get started',
              items: [
                { label: 'Getting Started', slug: 'getting-started' },
                { label: 'Documentation overview', slug: 'overview' },
              ],
            },
            {
              label: 'Core concepts',
              items: [
                { label: 'Core Concepts', slug: 'guides/concepts/core-concepts' },
                { label: 'Document Identity', slug: 'guides/concepts/document-identity' },
                { label: 'Schema Validation', slug: 'guides/concepts/schema-validation' },
                { label: 'Read Converters', slug: 'guides/concepts/read-converters' },
                {
                  label: 'Per-Field Sentinel Approval',
                  slug: 'guides/concepts/field-value-sentinels',
                },
                { label: 'Timestamps ↔ Millis', slug: 'guides/concepts/timestamps' },
                { label: 'Lifecycle Hooks', slug: 'guides/concepts/lifecycle-hooks' },
              ],
            },
            {
              label: 'Working with data',
              items: [
                { label: 'CRUD Operations', slug: 'guides/working-with-data/crud-operations' },
                { label: 'Queries', slug: 'guides/working-with-data/queries' },
                { label: 'Transactions', slug: 'guides/working-with-data/transactions' },
                { label: 'Subcollections', slug: 'guides/working-with-data/subcollections' },
                {
                  label: 'Dot Notation for Nested Updates',
                  slug: 'guides/working-with-data/dot-notation',
                },
              ],
            },
            {
              label: 'Designing your data',
              items: [
                { label: 'Data Modeling', slug: 'guides/designing/data-modeling' },
                { label: 'ID Strategies', slug: 'guides/designing/id-strategies' },
                { label: 'Schema Evolution', slug: 'guides/designing/schema-evolution' },
                { label: 'Trust Boundary & Security', slug: 'guides/designing/security-boundary' },
                { label: 'Best Practices', slug: 'guides/designing/best-practices' },
                { label: 'Performance & Cost', slug: 'guides/designing/performance' },
              ],
            },
            {
              label: 'Advanced',
              items: [
                { label: 'Real-time & Listeners', slug: 'guides/advanced/real-time' },
                { label: 'Advanced Patterns', slug: 'guides/advanced/patterns' },
                { label: 'Real-World Examples', slug: 'guides/advanced/examples' },
                { label: 'Vector Search', slug: 'guides/advanced/vector-search' },
              ],
            },
            {
              label: 'Integrations',
              items: [
                { label: 'Express', slug: 'guides/integrations/express' },
                { label: 'NestJS', slug: 'guides/integrations/nestjs' },
                {
                  label: 'Cloud Functions & Triggers',
                  slug: 'guides/integrations/cloud-functions',
                },
                { label: 'Testing with the Emulator', slug: 'guides/integrations/testing' },
              ],
            },
            {
              label: 'Upgrading',
              items: [{ label: 'Migrating from v2 to v3', slug: 'guides/migration-v2-to-v3' }],
            },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'FirestoreRepository', slug: 'reference/repository' },
            { label: 'FirestoreQueryBuilder', slug: 'reference/query-builder' },
            { label: 'Exported Types', slug: 'reference/types' },
            { label: 'Helpers & Utilities', slug: 'reference/helpers' },
            { label: 'Error Handling', slug: 'reference/errors' },
            { label: 'Scope & Capabilities', slug: 'reference/scope-and-capabilities' },
            { label: 'Troubleshooting', slug: 'reference/troubleshooting' },
          ],
        },
      ],
    }),
  ],
});
