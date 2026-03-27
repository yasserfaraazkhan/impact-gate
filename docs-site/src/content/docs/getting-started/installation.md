---
title: "Installation"
description: "Install @yasserkhanorg/impact-gate and verify your setup"
---

## Requirements

- **Node.js >= 20** (LTS recommended)
- **Git** (for diff-based analysis)
- A frontend repository with E2E tests (Playwright or Cypress)

## Install

Add the package to your project:

```bash
npm install -D @yasserkhanorg/impact-gate
```

Or install globally for CLI access anywhere:

```bash
npm install -g @yasserkhanorg/impact-gate
```

## Verify

Confirm the CLI is available:

```bash
npx impact-gate --help
```

You should see the list of available commands including `impact`, `plan`, `crew`, `train`, and others.
The best first run is usually `impact`, then `plan`, then `gate`.

## Optional: LLM Provider

AI-powered features (crew workflows, test generation, healing) need a provider. Set one of these environment variables:

```bash
# Anthropic
export ANTHROPIC_API_KEY=sk-ant-...

# OpenAI
export OPENAI_API_KEY=sk-...

# Ollama (free, runs locally)
export OLLAMA_BASE_URL=http://localhost:11434
```

The core CI commands (`impact`, `plan`, `gate`, `train --no-enrich`, `cost-report`, `feedback`) work without any API key.

## Verify Provider Connectivity

```bash
npx impact-gate llm-health
```

This probes the configured provider, or the auto-detected provider if you rely on environment discovery, and reports whether it can accept requests and return responses.
