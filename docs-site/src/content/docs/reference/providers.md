---
title: "Providers"
description: "Configure Anthropic, OpenAI, Ollama, or custom LLM providers"
---

Every LLM interaction goes through the `LLMProvider` interface. Four concrete providers are available, plus a factory for auto-detection and hybrid mode.

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

This routing happens automatically and helps control costs without sacrificing quality where it matters.

## Budget Enforcement

All providers inherit budget checking from the base provider. Before every LLM request, accumulated cost is checked against the `--budget-usd` limit. If exceeded, the call is rejected with a clear error.
