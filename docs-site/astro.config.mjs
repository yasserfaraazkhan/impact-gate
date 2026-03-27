import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      title: 'Impact Gate',
      description: 'Diff-aware E2E impact analysis and coverage gating for Playwright/Cypress teams. Optional AI features can suggest, generate, and heal tests once your project has a route-families.json manifest.',
      social: {
        github: 'https://github.com/yasserfaraazkhan/impact-gate',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Quick Start', slug: 'getting-started/quick-start' },
            { label: 'Installation', slug: 'getting-started/installation' },
            { label: 'Zero Config', slug: 'getting-started/zero-config' },
          ],
        },
        {
          label: 'Core CI Workflow',
          items: [
            { label: 'Impact Analysis', slug: 'guides/impact-analysis' },
            { label: 'CI Integration', slug: 'guides/ci-integration' },
            { label: 'Cost Management', slug: 'guides/cost-management' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'CLI Commands', slug: 'reference/cli' },
            { label: 'Configuration', slug: 'reference/config' },
            { label: 'Providers', slug: 'reference/providers' },
          ],
        },
        {
          label: 'Advanced / Experimental',
          items: [
            { label: 'Crew Workflows', slug: 'guides/crew-workflows' },
            { label: 'Agents', slug: 'reference/agents' },
          ],
        },
        {
          label: 'Contributing',
          items: [
            { label: 'Development', slug: 'contributing/development' },
            { label: 'Architecture', slug: 'contributing/architecture' },
          ],
        },
      ],
    }),
  ],
});
