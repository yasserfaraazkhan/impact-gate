---
title: "Installation"
description: "Install @yasserkhanorg/e2e-agents and verify your setup"
---

## Requirements

- **Node.js >= 20** (LTS recommended)
- **Git** (for diff-based analysis)
- A frontend repository with E2E tests (Playwright or Cypress)

## Install

Add the package to your project:

```bash
npm install @yasserkhanorg/e2e-agents
```

Or install globally for CLI access anywhere:

```bash
npm install -g @yasserkhanorg/e2e-agents
```

## Verify

Confirm the CLI is available:

```bash
npx e2e-ai-agents --help
```

You should see the list of available commands including `impact`, `plan`, `crew`, `train`, and others.

## Optional: LLM Provider

AI-powered features (crew workflows, test generation, healing) need an API key. Set one of these environment variables:

```bash
# Anthropic (default provider)
export ANTHROPIC_API_KEY=sk-ant-...

# OpenAI
export OPENAI_API_KEY=sk-...

# Ollama (free, runs locally)
export OLLAMA_BASE_URL=http://localhost:11434
```

The free-tier commands (`impact`, `plan`, `train --no-enrich`, `cost-report`, `feedback`) work without any API key.

## Verify Provider Connectivity

```bash
npx e2e-ai-agents llm-health
```

This sends a minimal probe to each provider whose environment variable is set (Anthropic, OpenAI, and/or Ollama) and reports whether it can accept requests and return responses.
