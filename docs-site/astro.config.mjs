import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      title: 'E2E Agents',
      description: 'AI-powered E2E test impact analysis, generation, and healing',
      social: {
        github: 'https://github.com/yasserfaraazkhan/e2e-agents',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Installation', slug: 'getting-started/installation' },
            { label: 'Quick Start', slug: 'getting-started/quick-start' },
            { label: 'Zero Config', slug: 'getting-started/zero-config' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Impact Analysis', slug: 'guides/impact-analysis' },
            { label: 'Crew Workflows', slug: 'guides/crew-workflows' },
            { label: 'CI Integration', slug: 'guides/ci-integration' },
            { label: 'Cost Management', slug: 'guides/cost-management' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'CLI Commands', slug: 'reference/cli' },
            { label: 'Configuration', slug: 'reference/config' },
            { label: 'Agents', slug: 'reference/agents' },
            { label: 'Providers', slug: 'reference/providers' },
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
