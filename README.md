# e2e-ai-agents

Framework-agnostic LLM provider library with MCP server for autonomous E2E testing.

[![npm](https://img.shields.io/npm/v/e2e-ai-agents)](https://www.npmjs.com/package/e2e-ai-agents)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![GitHub](https://img.shields.io/badge/github-yasserfaraazkhan%2Fe2e--agents-blue?logo=github)](https://github.com/yasserfaraazkhan/e2e-agents)

## Overview

Pluggable LLM provider abstraction for test automation with:
- **Anthropic Claude** — Advanced reasoning, vision support
- **OpenAI GPT** — Official OpenAI API integration
- **Ollama** — Free, local, privacy-first
- **MCP Server** — 6 tools for test discovery, generation, and healing
- **Custom Providers** — Extend with any OpenAI-compatible API

## Installation

```bash
npm install e2e-ai-agents
```

## Module Formats (CJS + ESM)

This package ships both CommonJS and ESM builds:
- `require('e2e-ai-agents')` loads the CommonJS build from `dist/index.js`.
- `import ... from 'e2e-ai-agents'` loads the ESM build from `dist/esm/index.js`.
- `./mcp` follows the same pattern (`dist/mcp-server.js` for CJS, `dist/esm/mcp-server.js` for ESM).

Node.js >= 20 is required.

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

### Use OpenAI

```typescript
import { OpenAIProvider } from 'e2e-ai-agents';

const openai = new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4'
});

const response = await openai.generateText('Summarize test failure');
console.log(response.text);
```

Tip: for accurate OpenAI cost tracking, set `costPer1MInputTokens` and `costPer1MOutputTokens` in the `OpenAIProvider` config.

### Use Ollama (Free)

```typescript
import { OllamaProvider } from 'e2e-ai-agents';

const ollama = new OllamaProvider({
    model: 'deepseek-r1:7b'
});

const response = await ollama.generateText('Generate test case');
console.log(response.text); // Free!
```

### Use Custom Provider (OpenAI-compatible endpoint)

```typescript
import { CustomProvider } from 'e2e-ai-agents';

const custom = new CustomProvider({
    baseUrl: 'https://your-llm-gateway.example.com/v1',
    auth: { Authorization: `Bearer ${process.env.CUSTOM_API_KEY}` },
    model: 'your-model-name',
    requestFormat: 'openai'
});

const response = await custom.generateText('Generate test case');
console.log(response.text);
```

`requestFormat` can be `'openai'`, `'anthropic'`, or `'custom'` (with `transformRequest`/`transformResponse`).

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

## CLI: Impact and Gap Analysis

Run AI-driven impact analysis or gap analysis on any frontend repo.

```bash
npx e2e-ai-agents impact --path /path/to/webapp
npx e2e-ai-agents gap --path /path/to/webapp
```

If tests live outside the app root:

```bash
npx e2e-ai-agents impact --path /path/to/webapp --tests-root /path/to/e2e-tests
```

Optional config file `e2e-ai-agents.config.json` (JSON):

```json
{
  "path": ".",
  "testsRoot": ".",
  "flowCatalogPath": ".e2e-ai-agents/flows.json",
  "mode": "impact",
  "framework": "auto",
  "timeLimitMinutes": 10,
  "budget": { "maxUSD": 2, "maxTokens": 20000 },
  "artifacts": { "mode": "commit", "specsDir": ".e2e-ai-agents/reports" },
  "selectors": { "patchOnApply": true },
  "testDiscovery": { "patterns": ["tests/**/*.spec.ts"] },
  "flowDiscovery": {
    "patterns": ["channels/src/components/**/*.{tsx,jsx}"],
    "exclude": ["**/components/**/stories/**"]
  },
  "catalogScoring": {
    "priorityScores": { "P0": 10, "P1": 6, "P2": 3 },
    "fileMatchWeight": 1
  },
  "impact": { "allowFallback": false },
  "pipeline": {
    "enabled": false,
    "scenarios": 3,
    "outputDir": "specs/functional/ai-assisted",
    "heal": true,
    "mcp": false
  },
  "llm": { "provider": "anthropic", "fallback": "ollama" },
  "flags": { "defaultState": "on" },
  "audience": { "defaultRoles": ["member"] },
  "blastRadius": {
    "memberBonus": 1,
    "guestBonus": 1,
    "adminOnlyPenalty": -1,
    "flagOffPenalty": -2
  }
}
```

Notes:
- If no framework config is found, provide `testDiscovery.patterns` or `--patterns`.
- Use `flowDiscovery.patterns` or `--flow-patterns` to customize flow scanning.
- Use `testsRoot` when tests live outside the app root.
- Use `flowCatalogPath` or `--flow-catalog` to provide a flow catalog for deterministic P0/P1 mapping.
- Impact mode expects a git diff; use `--since` or add `"impact": { "allowFallback": true }` to fall back to scanning.
- Reports are written under `testsRoot/.e2e-ai-agents/reports` (or app root if `testsRoot` is not set).
- Use `--apply` to patch `data-testid` in React/TSX and generate test skeletons.
- Use `--pipeline` to run the Playwright AI pipeline (requires `e2e-test-gen-cli.ts` in testsRoot).
- Use `--pipeline-mcp` (or `"pipeline": { "mcp": true }`) to run exploration/healing via Playwright MCP.

Flow catalog entries can also include optional audience and flag metadata:

```json
{
  "id": "messaging.realtime",
  "priority": "P0",
  "audience": ["member", "guest"],
  "flags": [
    "EnableSomething",
    { "name": "EnableEnterpriseOnly", "source": "config", "defaultState": "off" }
  ],
  "tests": ["specs/functional/channels/realtime.spec.ts"]
}
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

OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_ORG_ID=org_...

OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=deepseek-r1:7b
```

Note: If `OLLAMA_BASE_URL` points to the root host (for example, `http://localhost:11434`), it will be normalized to `/v1`.

### Setup

**Claude:**
1. Get key: https://console.anthropic.com
2. Export: `export ANTHROPIC_API_KEY=sk-ant-...`

**OpenAI:**
1. Get key: https://platform.openai.com
2. Export: `export OPENAI_API_KEY=sk-...`

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

| Feature | Claude | OpenAI | Ollama |
|---------|--------|--------|--------|
| Vision | ✅ | ✅ (model dependent) | ❌ |
| Cost | $3-15/1M tokens | Model dependent | Free |
| Speed | ~800ms | ~1000ms | ~3000ms |
| Streaming | ✅ | ✅ | ✅ |
| Local | ❌ | ❌ | ✅ |

## Cost Optimization

```typescript
const stats = provider.getUsageStats();
console.log(`Tokens: ${stats.totalTokens.toLocaleString()}`);
console.log(`Cost: $${stats.totalCost.toFixed(2)}`);
console.log(`Avg speed: ${stats.averageResponseTimeMs.toFixed(0)}ms`);
```

## Performance & Optimization (v0.3.0+)

### Logging Configuration

Control logging verbosity with the `LOG_LEVEL` environment variable:

```bash
# Production: errors only
LOG_LEVEL=ERROR npm start

# Development: all messages
LOG_LEVEL=DEBUG npm start
```

Supported levels: `ERROR`, `WARN`, `INFO`, `DEBUG` (default: `INFO`)

### Caching

The library includes a simple TTL cache for repository context:

```typescript
import { SimpleCache } from 'e2e-ai-agents/agent/cache_utils';

// Create a 10-minute cache
const cache = new SimpleCache(10 * 60 * 1000);

// Store and retrieve
cache.set('key', {data: 'value'});
const value = cache.get('key');

// Check stats
const {size, entries} = cache.stats();
```

### Performance Metrics (v0.3.0)

Improvements from code quality refactoring:

- **40% faster** stats calculation (incremental updates)
- **30% faster** API key validation (pre-compiled patterns)
- **90% faster** repository context (cache hits)
- **15% smaller** bundle size (code deduplication)
- **44 comprehensive tests** (80%+ coverage)

See [CHANGELOG.md](CHANGELOG.md) for detailed improvements.

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
