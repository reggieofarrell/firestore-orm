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
      // Nested to match website/src/content/docs/overview.md section grouping.
      sidebar: [
        { label: 'Getting Started', slug: 'getting-started' },
        { label: 'Documentation overview', slug: 'overview' },
        {
          label: 'Concepts',
          items: [
            { label: 'Core Concepts', slug: 'guides/core-concepts' },
            { label: 'Schema Validation', slug: 'guides/schema-validation' },
            { label: 'Per-Field Sentinel Approval', slug: 'guides/field-value-sentinels' },
            { label: 'Timestamps ↔ Millis', slug: 'guides/timestamps' },
            { label: 'Lifecycle Hooks', slug: 'guides/lifecycle-hooks' },
          ],
        },
        {
          label: 'Operations',
          items: [
            { label: 'CRUD Operations', slug: 'guides/crud-operations' },
            { label: 'Queries', slug: 'guides/queries' },
            { label: 'Transactions', slug: 'guides/transactions' },
            { label: 'Subcollections', slug: 'guides/subcollections' },
            { label: 'Dot Notation for Nested Updates', slug: 'guides/dot-notation' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'API Reference', slug: 'guides/api-reference' },
            { label: 'Scope & Capabilities', slug: 'guides/scope-and-capabilities' },
            { label: 'Error Handling', slug: 'guides/error-handling' },
          ],
        },
        {
          label: 'Integration & extensions',
          items: [
            { label: 'Framework Integration', slug: 'guides/framework-integration' },
            { label: 'Firestore Triggers', slug: 'guides/triggers' },
            { label: 'Vector Search', slug: 'guides/vector-search' },
          ],
        },
        {
          label: 'Guidance',
          items: [
            { label: 'Migrating from v2 to v3', slug: 'guides/migration-v2-to-v3' },
            { label: 'Best Practices', slug: 'guides/best-practices' },
            { label: 'Performance', slug: 'guides/performance' },
            { label: 'Real-World Examples', slug: 'guides/examples' },
            { label: 'Advanced Patterns', slug: 'guides/advanced-patterns' },
            { label: 'Troubleshooting', slug: 'guides/troubleshooting' },
          ],
        },
      ],
    }),
  ],
});
