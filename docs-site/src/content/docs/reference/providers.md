---
title: "Providers"
description: "Configure Anthropic, OpenAI, Ollama, or custom LLM providers"
---

<div class="doc-intro">
  <div class="doc-chip">Provider reference</div>
  <p class="doc-lead">
    Every LLM interaction goes through the <code>LLMProvider</code> interface.
    You can stay fully deterministic, choose one provider, or use hybrid
    routing once the AI path is worth enabling.
  </p>
</div>

<div class="docs-grid docs-grid--two">
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Provider model</span>
    <h2 class="docs-panel__title">Four concrete providers plus factory auto-detection</h2>
    <p class="docs-panel__copy">
      Anthropic, OpenAI, Ollama, and custom OpenAI-compatible endpoints are all
      supported behind one interface.
    </p>
  </div>
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Best practice</span>
    <h2 class="docs-panel__title">Keep the core CI loop deterministic first</h2>
    <p class="docs-panel__copy">
      Add a provider when you want generation, healing, or crew workflows. The
      product stays useful even when the AI path is off.
    </p>
  </div>
</div>

## Anthropic (Default)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Supports vision (image analysis) and prompt caching. Used for complex tasks like test generation and code analysis by default.

```typescript
import { AnthropicProvider } from '@yasserkhanorg/impact-gate';

const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
});
```

## OpenAI

```bash
export OPENAI_API_KEY=sk-...
```

Supports GPT models. Configure as the primary provider when you prefer OpenAI's model family.

```typescript
import { OpenAIProvider } from '@yasserkhanorg/impact-gate';

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
});
```

## Ollama (Free, Local)

```bash
export OLLAMA_BASE_URL=http://localhost:11434
export OLLAMA_MODEL=deepseek-r1:7b
```

Runs entirely on your machine with no API costs. Install [Ollama](https://ollama.ai/), pull a model, and point the tool at your local instance.

## Custom Provider

Any OpenAI-compatible endpoint works as a custom provider. Useful for self-hosted models, Azure OpenAI, or other API-compatible services.

## Auto-Detection

The factory detects which provider to use based on environment variables:

```typescript
import { LLMProviderFactory } from '@yasserkhanorg/impact-gate';

// Checks ANTHROPIC_API_KEY, OPENAI_API_KEY, OLLAMA_BASE_URL in order
const provider = LLMProviderFactory.createFromEnv();
```

## Hybrid Mode

<div class="docs-grid docs-grid--two">
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">Hybrid routing</span>
    <h2 class="docs-panel__title">Mix local and premium providers when cost matters</h2>
    <ul>
      <li><strong>Ollama</strong> handles simple classifications and short answers</li>
      <li><strong>Anthropic / OpenAI</strong> handles generation, vision, and complex analysis</li>
    </ul>
  </div>
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">Budget enforcement</span>
    <h2 class="docs-panel__title">Every provider respects the same spend controls</h2>
    <p class="docs-panel__copy">
      Before every LLM request, accumulated cost is checked against the
      <code>--budget-usd</code> limit and rejected cleanly if it would exceed it.
    </p>
  </div>
</div>

Combine a free local provider for routine calls with a premium provider for complex tasks:

- **Ollama** handles simple classifications and short answers
- **Anthropic/OpenAI** handles test generation, vision, and complex analysis

The factory supports this through its hybrid configuration, automatically routing based on task complexity.

## Model Routing

The model router sends different task types to cost-appropriate models:

| Task Type | Model Tier | Examples |
|-----------|-----------|---------|
| Classification | Fast/cheap | Impact categorization, simple yes/no |
| Analysis | Mid-tier | Flow mapping, gap detection |
| Generation | Capable | Test code generation, healing |
| Vision | Vision-enabled | Screenshot analysis, UI verification |

This routing happens automatically and helps control costs without sacrificing
quality where it matters.
