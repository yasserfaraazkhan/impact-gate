# E2E AI Testing Framework Guide

> **Intelligent E2E Test Generation, Validation, and Self-Healing**

Learn how to use e2e-ai-agents in your testing projects and how the Mattermost team leverages it for production testing.

---

## 🎯 Overview

The E2E AI testing ecosystem consists of two complementary systems:

1. **e2e-ai-agents** (This Package) - Reusable LLM provider abstractions
2. **e2e-test-gen** (Mattermost) - Complete test generation & orchestration for Mattermost

```
┌─────────────────────────────────────────────────────┐
│         e2e-ai-agents (This Package)                │
│                                                      │
│   ┌─────────────────────────────────────────┐      │
│   │  Unified LLM Provider Interface          │      │
│   │  ├─ Anthropic Claude                     │      │
│   │  ├─ OpenAI GPT                           │      │
│   │  ├─ Ollama (Local, Free)                 │      │
│   │  └─ Custom Providers                     │      │
│   │                                          │      │
│   │  + Cost Tracking                         │      │
│   │  + Usage Statistics                      │      │
│   │  + Hybrid Provider Mode                  │      │
│   │  + Streaming Support                     │      │
│   │  + Vision/Image Analysis                 │      │
│   └─────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────┘
            ↑                          ↑
            │ (used by)                │ (used by)
    ┌───────────────┐        ┌────────────────────┐
    │e2e-test-gen   │        │ Any Other Project  │
    │(Mattermost)   │        │ (Playwright/Cypress│
    │               │        │  /Selenium/etc)    │
    │ ✓ Generation  │        │                    │
    │ ✓ Validation  │        │ ✓ Test Generation  │
    │ ✓ Healing     │        │ ✓ Test Fixing      │
    │ ✓ Exploration │        │ ✓ Data Generation  │
    └───────────────┘        │ ✓ Image Analysis   │
                             └────────────────────┘
```

---

## 📦 What e2e-ai-agents Provides

**Framework-agnostic** LLM provider library with:

✅ **Multiple Providers**
- Anthropic Claude (best quality, costs money)
- OpenAI GPT (good quality, costs money)
- Ollama (free, local, lower quality)
- Custom providers (bring your own LLM)

✅ **Core Features**
- Unified provider interface
- Cost tracking and optimization
- Usage statistics
- Hybrid mode (primary + fallback)
- Streaming support
- Vision/image analysis
- Error handling and recovery

✅ **Production Ready**
- Security hardening
- Input validation
- Rate limiting
- Type safety (TypeScript)

---

## 🚀 Real-World Usage Examples

### Example 1: Generate Test Scenarios (Playwright)

```typescript
import {AnthropicProvider} from 'e2e-ai-agents';

const llm = new AnthropicProvider({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-4-5-20250929'
});

// Generate test data dynamically
const response = await llm.generateText(`
    Generate 5 realistic user profiles for e-commerce testing.
    Return as JSON array with: name, email, age, country
`);

const testUsers = JSON.parse(response.text);
console.log(`Generated ${testUsers.length} test users`);
console.log(`Cost: $${response.cost.toFixed(4)}`);
```

### Example 2: Fix Failing Tests (Cypress)

```typescript
import {OpenAIProvider} from 'e2e-ai-agents';

const fixer = new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4'
});

async function healFailedTest(testCode: string, errorMessage: string) {
    const response = await fixer.generateText(`
        Fix this Cypress test:

        Code:
        ${testCode}

        Error:
        ${errorMessage}

        Return only the corrected code.
    `);

    return response.text;
}

// Usage
try {
    await runTest(testCode);
} catch (error) {
    const fixedCode = await healFailedTest(testCode, error.message);
    await runTest(fixedCode); // Retry with fixed code
}
```

### Example 3: Analyze UI Screenshots (Playwright)

```typescript
import {AnthropicProvider} from 'e2e-ai-agents';

const analyzer = new AnthropicProvider({
    apiKey: process.env.ANTHROPIC_API_KEY
});

test('verify UI with AI vision', async ({page}) => {
    await page.goto('https://example.com');
    const screenshot = await page.screenshot({fullPage: true});

    const analysis = await analyzer.analyzeImage(
        [{
            data: screenshot.toString('base64'),
            mimeType: 'image/png'
        }],
        'Is the login button visible, correctly styled, and in the expected location?'
    );

    console.log(analysis.text);
    expect(analysis.text).toContain('visible');
});
```

### Example 4: Use Ollama (Free, Local)

```typescript
import {OllamaProvider} from 'e2e-ai-agents';

// Free! Runs locally
const llm = new OllamaProvider({
    baseUrl: 'http://localhost:11434',
    model: 'deepseek-r1:7b'
});

const response = await llm.generateText('Generate API test cases for /api/users');
console.log(response.text);
console.log('Cost: $0.00 (runs locally)');
```

### Example 5: Hybrid Mode (Free + Premium)

```typescript
import {LLMProviderFactory} from 'e2e-ai-agents';

// Use free Ollama by default, Claude for complex tasks
const llm = LLMProviderFactory.createHybrid({
    primary: {
        type: 'ollama',
        config: {
            baseUrl: 'http://localhost:11434',
            model: 'deepseek-r1:7b'
        }
    },
    fallback: {
        type: 'anthropic',
        config: {
            apiKey: process.env.ANTHROPIC_API_KEY,
            model: 'claude-sonnet-4-5-20250929'
        }
    },
    useFallbackFor: ['vision'] // Only use Claude for image analysis
});

// Simple task -> Uses Ollama (free)
const scenario = await llm.generateText('Generate login test scenario');

// Vision task -> Uses Claude (paid, but necessary)
const imageAnalysis = await llm.analyzeImage([screenshot], 'Analyze the UI');
```

### Example 6: Multiple Frameworks

```typescript
// Works with Cypress
import {AnthropicProvider} from 'e2e-ai-agents';

Cypress.Commands.add('aiGenerate', async (prompt) => {
    const llm = new AnthropicProvider({...});
    const response = await llm.generateText(prompt);
    return response.text;
});

it('generate and use test data', () => {
    cy.aiGenerate('Generate a valid email').then((email) => {
        cy.get('input[type=email]').type(email);
    });
});

// Works with Selenium
const {AnthropicProvider} = require('e2e-ai-agents');

async function generateTestData(prompt) {
    const llm = new AnthropicProvider({...});
    return await llm.generateText(prompt);
}

// Works with API testing
const llm = new AnthropicProvider({...});
const testCases = await llm.generateText('Generate REST API test cases');
```

---

## 🏢 How Mattermost Uses This

The Mattermost team built **e2e-test-gen** on top of e2e-ai-agents to create a complete test generation pipeline:

```
┌─ Phase 1: UI Exploration
│  └─ Crawl UI, index selectors (150+ elements)
│
├─ Phase 2: Signal Gating
│  └─ Validate UI coverage before generation
│
├─ Phase 3: Selector Validation
│  └─ Whitelist selectors against UI map
│
├─ Phase 4: Self-Healing
│  └─ Re-explore on failure, merge selectors
│
└─ Phase 5: Generate Tests
   └─ Use e2e-ai-agents to generate test code
```

**Usage:**
```bash
npx tsx e2e-test-gen-cli.ts generate "user profile" --scenarios 2
```

See the [Mattermost repository](https://github.com/mattermost/mattermost) for the complete implementation.

---

## 💡 Why Use e2e-ai-agents?

### ✅ For Any Project Using Playwright

```typescript
import {AnthropicProvider} from 'e2e-ai-agents';

const llm = new AnthropicProvider({...});

// Generate tests
const testCode = await llm.generateText('Generate login test');

// Analyze screenshots
const analysis = await llm.analyzeImage([screenshot], 'Verify UI');

// Create test data
const data = await llm.generateText('Generate user profiles');
```

### ✅ For Any Project Using Cypress

Same code, works with Cypress too!

### ✅ For Any Project Using Selenium

Framework-agnostic - works everywhere.

### ✅ For API Testing

```typescript
const testCases = await llm.generateText('Generate REST API tests');
const curlCommands = await llm.generateText('Generate curl commands for API');
```

### ✅ For Data Generation

```typescript
const testData = await llm.generateText('Generate realistic e-commerce products');
```

---

## 🎯 Key Benefits

| Benefit | Details |
|---------|---------|
| **Framework Agnostic** | Works with Playwright, Cypress, Selenium, any framework |
| **Provider Choice** | Claude (best), GPT, Ollama (free), or custom |
| **Cost Tracking** | Know exactly how much you're spending |
| **Fallback Support** | Use free Ollama by default, Claude for complex tasks |
| **Production Ready** | Security hardened, tested in Mattermost production |
| **Vision Support** | Analyze screenshots and UI images |
| **Streaming** | Real-time response streaming for large outputs |
| **Type Safe** | Full TypeScript support with interfaces |

---

## 📊 Cost Comparison

```typescript
// Track costs across all providers
const stats = provider.getUsageStats();

console.log(`Total tokens: ${stats.totalTokens.toLocaleString()}`);
console.log(`Total cost: $${stats.totalCost.toFixed(2)}`);
console.log(`Avg response time: ${stats.averageResponseTimeMs}ms`);
```

| Provider | Cost | Speed | Quality | Local |
|----------|------|-------|---------|-------|
| Claude | $3-15/1M tokens | ~800ms | Excellent | ❌ |
| GPT-4 | $3-60/1M tokens | ~1000ms | Excellent | ❌ |
| Ollama | Free | ~3000ms | Good | ✅ |
| Custom | Depends | Depends | Depends | ✅ |

---

## 🔐 Security Features

All providers include:
✅ API key validation
✅ Input sanitization
✅ Error message masking
✅ Rate limiting (100 req/min)
✅ HTTPS enforcement
✅ Timeout protection
✅ No secret leakage in responses

---

## 🛠️ Integration Checklist

- [ ] Install: `npm install e2e-ai-agents`
- [ ] Choose provider (Claude/GPT/Ollama)
- [ ] Set environment variable (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `OLLAMA_BASE_URL`)
- [ ] Import provider: `import {AnthropicProvider} from 'e2e-ai-agents'`
- [ ] Create instance: `new AnthropicProvider({...})`
- [ ] Use in tests: `await llm.generateText(prompt)`
- [ ] Track costs: `provider.getUsageStats()`

---

## 📚 Resources

**This Package:**
- NPM: https://www.npmjs.com/package/e2e-ai-agents
- GitHub: https://github.com/yasserfaraazkhan/e2e-agents
- Issues: https://github.com/yasserfaraazkhan/e2e-agents/issues

**LLM Providers:**
- Anthropic Claude: https://console.anthropic.com
- OpenAI GPT: https://platform.openai.com
- Ollama (Local): https://ollama.ai

**Mattermost Implementation:**
- Repository: https://github.com/mattermost/mattermost
- E2E Tests: `/e2e-tests/playwright/`
- CLI: `e2e-test-gen-cli.ts`

---

## ❓ FAQ

**Q: Can I use e2e-ai-agents with my test framework?**
A: Yes! It's framework-agnostic. Works with Playwright, Cypress, Selenium, etc.

**Q: Which provider should I choose?**
A: Claude for best quality, Ollama for free/local, GPT for middle ground.

**Q: How much does it cost?**
A: Ollama is free (runs locally). Claude/GPT cost per token (~$0.01-0.10 per test).

**Q: Can I use multiple providers?**
A: Yes! Hybrid mode lets you use Ollama by default, Claude for complex tasks.

**Q: Is it production-ready?**
A: Yes! Used in Mattermost production with security hardening.

**Q: Can I extend it?**
A: Yes! Implement `LLMProvider` interface for custom providers.

---

## 📝 Contributing

We welcome contributions!

1. Fork: https://github.com/yasserfaraazkhan/e2e-agents
2. Create feature branch: `git checkout -b feature/my-feature`
3. Commit: `git commit -am 'Add new provider'`
4. Push: `git push origin feature/my-feature`
5. Open PR with description

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## 📄 License

Apache 2.0 - See [LICENSE](LICENSE) file

---

**Last Updated**: February 2026
**Maintained By**: Mattermost Team & Community Contributors
