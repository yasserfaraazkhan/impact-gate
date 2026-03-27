import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://yasserfaraazkhan.github.io',
  base: '/impact-gate',
  integrations: [
    starlight({
      title: 'Impact Gate',
      description: 'Diff-aware E2E impact analysis, release-ready test planning, coverage gating, and hallucination-resistant AI generation for Playwright/Cypress teams.',
      social: {
        github: 'https://github.com/yasserfaraazkhan/impact-gate',
      },
      sidebar: [
        {
          label: 'Getting Started',
          autogenerate: { directory: 'getting-started' },
        },
        {
          label: 'Core CI Workflow',
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
