# @mattermost/llm-testing-providers

Framework-agnostic library for integrating Language Learning Models (LLMs) into test automation and scripting.

[![npm](https://img.shields.io/npm/v/@mattermost/llm-testing-providers)](https://www.npmjs.com/package/@mattermost/llm-testing-providers)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![GitHub](https://img.shields.io/badge/github-mattermost--llm--testing--providers-blue?logo=github)](https://github.com/mattermost/mattermost-llm-testing-providers)

## Overview

`@mattermost/llm-testing-providers` provides a unified interface for working with multiple LLM providers:

- **Anthropic Claude** — Premium quality, vision support, fast responses
- **Ollama** — Free, local execution, privacy-first
- **OpenAI** — Coming soon
- **Custom providers** — Extensible for any OpenAI-compatible API

## Features

- 🔌 **Pluggable architecture** — Switch providers without changing application code
- 💰 **Cost-aware** — Track token usage and estimate costs
- 🎨 **Vision support** — Analyze screenshots and images (Claude)
- ⚡ **Streaming** — Real-time text generation
- 🔀 **Hybrid mode** — Mix free and premium providers for cost optimization
- 📊 **Usage stats** — Monitor requests, tokens, costs, and performance
- 🏗️ **Framework-agnostic** — Zero test framework dependencies

## Installation

```bash
npm install @mattermost/llm-testing-providers
```

## Quick Start

### Using Anthropic Claude

```typescript
import { AnthropicProvider } from '@mattermost/llm-testing-providers';

const claude = new AnthropicProvider({
    apiKey: process.env.ANTHROPIC_API_KEY
});

const response = await claude.generateText('Explain quantum computing');
console.log(response.text);
console.log(`Cost: $${response.cost.toFixed(4)}`);
```

### Using Ollama (Free, Local)

```typescript
import { OllamaProvider } from '@mattermost/llm-testing-providers';

const ollama = new OllamaProvider({
    model: 'deepseek-r1:7b'
});

const response = await ollama.generateText('What is 2+2?');
console.log(response.text); // Free!
```

### Factory Pattern

```typescript
import { LLMProviderFactory } from '@mattermost/llm-testing-providers';

// Auto-detect from environment
const provider = await LLMProviderFactory.createFromEnv();

// Create specific provider
const claude = LLMProviderFactory.create({
    type: 'anthropic',
    config: { apiKey: process.env.ANTHROPIC_API_KEY }
});
```

## Hybrid Mode (Free + Premium)

Optimize costs by using free Ollama for most tasks and Claude for vision:

```typescript
const provider = LLMProviderFactory.createHybrid({
    primary: {
        type: 'ollama',
        config: { model: 'deepseek-r1:7b' }
    },
    fallback: {
        type: 'anthropic',
        config: { apiKey: process.env.ANTHROPIC_API_KEY }
    },
    useFallbackFor: ['vision']
});

// Uses Ollama (free)
await provider.generateText('Analyze this code');

// Uses Claude (vision)
await provider.analyzeImage([...], 'Compare these screenshots');

// Check cost savings
const breakdown = (provider as any).getProviderBreakdown();
console.log(breakdown.costSavings); // e.g., "$45.23 saved (75% reduction)"
```

## Provider Comparison

| Feature | Claude | Ollama | OpenAI |
|---------|--------|--------|--------|
| Vision | ✅ | ❌ | ⚠️ Limited |
| Cost | $3-15/1M tokens | Free | $0.01-0.06/1K |
| Speed | ~800ms | ~3000ms | ~1200ms |
| Streaming | ✅ | ✅ | ✅ |
| Local | ❌ | ✅ | ❌ |
| Setup | API key | Local install | API key |

## Vision Analysis

```typescript
import fs from 'fs';

const response = await claude.analyzeImage(
    [{
        data: fs.readFileSync('screenshot.png', 'base64'),
        mimeType: 'image/png',
        description: 'Login page'
    }],
    'Does this match our design spec? Any accessibility issues?'
);

console.log(response.text);
```

## Streaming

```typescript
for await (const chunk of provider.streamText('Write a poem')) {
    process.stdout.write(chunk); // Real-time output
}
```

## Cost Optimization

### Hybrid Strategy Example

```
Pure Claude:    $80/month
Pure Ollama:    $0/month (no vision)
Hybrid:         $20/month ← 75% savings!
```

### Track Usage

```typescript
const stats = provider.getUsageStats();
console.log(`Requests: ${stats.requestCount}`);
console.log(`Tokens: ${stats.totalTokens.toLocaleString()}`);
console.log(`Cost: $${stats.totalCost.toFixed(2)}`);
console.log(`Avg response: ${stats.averageResponseTimeMs.toFixed(0)}ms`);
```

## Configuration

### Environment Variables

```bash
# Provider selection
LLM_PROVIDER=anthropic           # or 'ollama'
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929

# Ollama configuration
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=deepseek-r1:7b
```

## Setup Guides

### Anthropic Claude

1. Get API key: https://console.anthropic.com
2. Set environment variable:
   ```bash
   export ANTHROPIC_API_KEY=sk-ant-...
   ```
3. Test:
   ```bash
   npm install @mattermost/llm-testing-providers
   ```

### Ollama (Free, Local)

1. Install: `curl -fsSL https://ollama.com/install.sh | sh`
2. Pull model: `ollama pull deepseek-r1:7b`
3. Start: `ollama serve` (localhost:11434)

## Error Handling

```typescript
import { LLMProviderError, UnsupportedCapabilityError } from '@mattermost/llm-testing-providers';

try {
    await provider.analyzeImage([...], 'Analyze this');
} catch (error) {
    if (error instanceof UnsupportedCapabilityError) {
        console.log(`Provider doesn't support: ${error.provider}`);
    } else if (error instanceof LLMProviderError) {
        console.log(`API error: ${error.message}`);
    }
}
```

## Mattermost Usage

See [MATTERMOST_EXAMPLES.md](./MATTERMOST_EXAMPLES.md) for examples of using this library in Mattermost E2E testing.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## Roadmap

- [x] Anthropic Claude provider
- [x] Ollama provider
- [x] Hybrid provider mode
- [x] Cost tracking
- [ ] OpenAI provider
- [ ] Custom provider templates
- [ ] Advanced caching
- [ ] Distributed tracing
- [ ] Rate limiting

## License

Apache 2.0 — See [LICENSE](./LICENSE)

## Support

- **Issues**: [GitHub Issues](https://github.com/mattermost/mattermost-llm-testing-providers/issues)
- **Discussions**: [GitHub Discussions](https://github.com/mattermost/mattermost-llm-testing-providers/discussions)
- **Community**: [Mattermost Community](https://mattermost.com/community)

---

**Used in production by Mattermost's E2E testing framework.**
