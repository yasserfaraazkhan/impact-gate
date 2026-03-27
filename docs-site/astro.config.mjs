import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://yasserfaraazkhan.github.io',
  base: '/impact-gate',
  integrations: [
    starlight({
      title: 'Impact Gate',
      description: 'Diff-aware E2E impact analysis, release-ready test planning, coverage gating, and hallucination-resistant AI generation for Playwright/Cypress teams.',
      disable404Route: true,
      editLink: {
        baseUrl: 'https://github.com/yasserfaraazkhan/impact-gate/blob/master/docs-site/src/content/docs/',
      },
      social: {
        github: 'https://github.com/yasserfaraazkhan/impact-gate',
      },
      sidebar: [
        {
          label: 'Getting Started',
          autogenerate: { directory: 'getting-started' },
        },
        {
          label: 'Concepts',
          autogenerate: { directory: 'concepts' },
        },
        {
          label: 'Guides',
          autogenerate: { directory: 'guides' },
        },
        {
          label: 'Reference',
          autogenerate: { directory: 'reference' },
        },
        {
          label: 'Contributing',
          autogenerate: { directory: 'contributing' },
        },
      ],
    }),
  ],
});
