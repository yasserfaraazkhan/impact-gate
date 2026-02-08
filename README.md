# e2e-ai-agents

Framework-agnostic LLM provider library with MCP server for autonomous E2E testing.

[![npm](https://img.shields.io/npm/v/e2e-ai-agents)](https://www.npmjs.com/package/e2e-ai-agents)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![GitHub](https://img.shields.io/badge/github-yasserfaraazkhan%2Fe2e--agents-blue?logo=github)](https://github.com/yasserfaraazkhan/e2e-agents)

## Overview

Pluggable LLM provider abstraction for test automation with:
- **Anthropic Claude** — Advanced reasoning, vision support
- **Ollama** — Free, local, privacy-first
- **MCP Server** — 6 tools for test discovery, generation, and healing
- **Custom Providers** — Extend with any OpenAI-compatible API

## Installation

```bash
npm install e2e-ai-agents
```

## Quick Links

📖 **[Comprehensive Guide](E2E_AI_TESTING.md)** - In-depth documentation including:
- How to use e2e-ai-agents in your projects
- Real-world examples for Playwright, Cypress, Selenium
- How Mattermost uses this package
- Cost optimization and best practices

## Quick Start

### Use Claude

```typescript
import { AnthropicProvider } from 'e2e-ai-agents';

const claude = new AnthropicProvider({
    apiKey: process.env.ANTHROPIC_API_KEY
});

const response = await claude.generateText('Analyze test failure');
console.log(response.text);
console.log(`Cost: $${response.cost.toFixed(4)}`);
```

### Use Ollama (Free)

```typescript
import { OllamaProvider } from 'e2e-ai-agents';

const ollama = new OllamaProvider({
    model: 'deepseek-r1:7b'
});

const response = await ollama.generateText('Generate test case');
console.log(response.text); // Free!
```

### Factory Pattern

```typescript
import { LLMProviderFactory } from 'e2e-ai-agents';

// Auto-detect from environment
const provider = LLMProviderFactory.create({
    type: 'anthropic',
    config: { apiKey: process.env.ANTHROPIC_API_KEY }
});
```

### Hybrid Mode (Free + Premium)

```typescript
const provider = LLMProviderFactory.createHybrid({
    primary: { type: 'ollama', config: { model: 'deepseek-r1:7b' } },
    fallback: { type: 'anthropic', config: { apiKey: process.env.ANTHROPIC_API_KEY } },
    useFallbackFor: ['vision'] // Only use Claude for vision
});

await provider.generateText('Analyze code'); // Uses Ollama (free)
await provider.analyzeImage([...], 'Compare screenshots'); // Uses Claude (vision)
```

## Extending with Custom Frameworks

### 1. Create Custom Provider

```typescript
import { LLMProvider } from 'e2e-ai-agents';

export class MyCustomProvider implements LLMProvider {
    async generateText(prompt: string) {
        // Your API call here
        return {
            text: '...',
            cost: 0.001,
            tokens: { input: 100, output: 50 }
        };
    }

    async analyzeImage(images, prompt) {
        throw new Error('Vision not supported');
    }

    async streamText(prompt) {
        // Generator implementation
        yield 'chunk1';
        yield 'chunk2';
    }

    getUsageStats() {
        return { /* ... */ };
    }
}
```

### 2. Register with Factory

```typescript
import { LLMProviderFactory } from 'e2e-ai-agents';

LLMProviderFactory.register('my-provider', (config) => {
    return new MyCustomProvider(config);
});

// Use it
const provider = LLMProviderFactory.create({
    type: 'my-provider',
    config: { apiKey: '...' }
});
```

### 3. Integrate with Test Framework

```typescript
// Playwright example
import { test } from '@playwright/test';
import { LLMProviderFactory } from 'e2e-ai-agents';

const llm = LLMProviderFactory.create({
    type: 'anthropic',
    config: { apiKey: process.env.ANTHROPIC_API_KEY }
});

test('use LLM to verify UI', async ({ page }) => {
    await page.goto('https://example.com');
    const screenshot = await page.screenshot();

    const analysis = await llm.analyzeImage(
        [{ data: screenshot.toString('base64'), mimeType: 'image/png' }],
        'Is the login button visible and correctly styled?'
    );

    console.log(analysis.text);
});
```

## MCP Server Integration

For Playwright test agents (v1.56+):

```typescript
import { E2EAgentsMCPServer } from 'e2e-ai-agents/mcp';

const server = new E2EAgentsMCPServer();
const tools = server.getTools();

// Available tools:
// - discover_tests: Find tests needed for code changes
// - read_file: Read repository files
// - write_file: Create/update test files
// - run_tests: Execute tests
// - get_git_changes: Detect changed files
// - get_repository_context: Gather metadata
```

## Configuration

### Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929

OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=deepseek-r1:7b
```

### Setup

**Claude:**
1. Get key: https://console.anthropic.com
2. Export: `export ANTHROPIC_API_KEY=sk-ant-...`

**Ollama:**
1. Install: `curl -fsSL https://ollama.com/install.sh | sh`
2. Pull: `ollama pull deepseek-r1:7b`
3. Run: `ollama serve`

## Error Handling

```typescript
import { LLMProviderError, UnsupportedCapabilityError } from 'e2e-ai-agents';

try {
    await provider.analyzeImage([...], 'Analyze');
} catch (error) {
    if (error instanceof UnsupportedCapabilityError) {
        console.log(`Not supported by: ${error.provider}`);
    } else if (error instanceof LLMProviderError) {
        console.log(`API error: ${error.message}`);
    }
}
```

## Performance Comparison

| Feature | Claude | Ollama |
|---------|--------|--------|
| Vision | ✅ | ❌ |
| Cost | $3-15/1M tokens | Free |
| Speed | ~800ms | ~3000ms |
| Streaming | ✅ | ✅ |
| Local | ❌ | ✅ |

## Cost Optimization

```typescript
const stats = provider.getUsageStats();
console.log(`Tokens: ${stats.totalTokens.toLocaleString()}`);
console.log(`Cost: $${stats.totalCost.toFixed(2)}`);
console.log(`Avg speed: ${stats.averageResponseTimeMs.toFixed(0)}ms`);
```

## Learn More

For comprehensive documentation on:
- Real-world usage examples
- Integration with different frameworks
- How Mattermost uses e2e-ai-agents in production
- Cost optimization strategies
- Security features and best practices

👉 **See [E2E_AI_TESTING.md](E2E_AI_TESTING.md)**

## Production Usage

This package is used in production by Mattermost for:
- ✅ Automated test generation
- ✅ Test validation and healing
- ✅ UI screenshot analysis
- ✅ Test data generation

See the [Mattermost e2e-test-gen implementation](https://github.com/mattermost/mattermost/tree/master/e2e-tests/playwright) for a complete example.

## License

Apache 2.0
