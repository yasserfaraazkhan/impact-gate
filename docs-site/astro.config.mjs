import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const isLocalDocs = process.env.IMPACT_GATE_DOCS_LOCAL === '1';

export default defineConfig({
  site: isLocalDocs ? 'http://127.0.0.1:4324' : 'https://yasserfaraazkhan.github.io',
  base: isLocalDocs ? '/' : '/impact-gate',
  integrations: [
    starlight({
      title: 'Impact Gate',
      description: 'Diff-aware E2E impact analysis, release-ready test planning, coverage gating, and hallucination-resistant AI generation for Playwright/Cypress teams.',
      logo: {
        dark: './src/assets/impact-gate-logo-dark.svg',
        light: './src/assets/impact-gate-logo-light.svg',
        alt: 'Impact Gate',
        replacesTitle: true,
      },
      credits: false,
      customCss: ['/src/styles/custom.css'],
      favicon: '/favicon.svg',
      disable404Route: true,
      editLink: {
        baseUrl: 'https://github.com/yasserfaraazkhan/impact-gate/blob/master/docs-site/',
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
