/**
 * Astro content collections for the Starlight docs site.
 *
 * - `docs`: Starlight pages under src/content/docs (latest / current version).
 * - `versions`: starlight-versions metadata + archived major trees. Empty until
 *   the first archive runs (see website/VERSIONING.md).
 */
import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { docsVersionsLoader } from 'starlight-versions/loader';

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  versions: defineCollection({ loader: docsVersionsLoader() }),
};
