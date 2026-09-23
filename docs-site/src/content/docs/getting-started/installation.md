---
title: "Installation"
description: "Build the current source checkout and run a deterministic review"
---

Impact Gate requires Node.js 20 or newer and Git. Use a repository with an available Git base ref and existing Playwright or Cypress specs for useful test recommendations.

## Current source checkout

These docs describe the current source. The recovery and launch changes have not been published as a new npm release, so build the checkout to try them:

```sh
git clone https://github.com/yasserfaraazkhan/impact-gate.git
cd impact-gate
npm ci
npm run build
node dist/cli.js --help
```

From the Impact Gate checkout, review your application's diff:

```sh
node dist/cli.js review --path /absolute/path/to/your/app --since origin/main
```

Use a base ref that exists in the target repository. Static `review` and `gate` need no LLM provider. A gate checks spec-mapping policy; it does not run tests or certify a release.

## Published package

To install the published version into an application:

```sh
npm install -D @yasserkhanorg/impact-gate
npx impact-gate --help
```

Check the installed version's documentation before using options added in this source checkout. The package exposes CommonJS and ESM library entries as well as the CLI.

## Optional provider

Experimental generation, semantic prediction, healing, and crew workflows use a provider. Configure the provider you intend to use, for example:

```sh
export ANTHROPIC_API_KEY=your-key
# Or:
export OPENAI_API_KEY=your-key
# Or a local Ollama service:
export OLLAMA_BASE_URL=http://localhost:11434
```

Use `--llm-provider anthropic`, `--llm-provider openai`, or `--llm-provider ollama` when you want an explicit provider choice. Provider-backed requests can incur cost and require a running provider service.

```sh
node dist/cli.js llm-health
```

The experimental browser QA binary also requires `agent-browser` and a running application. Follow the [browser QA guide](../../guides/browser-qa/) after the [quick start](../quick-start/).
