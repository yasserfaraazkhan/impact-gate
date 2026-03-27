# Contributing to impact-gate

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to the project.

## Getting Started

### Prerequisites
- Node.js >= 20
- npm or yarn
- TypeScript knowledge
- Familiarity with LLM APIs (Anthropic Claude, Ollama)

### Setup for Development

```bash
git clone https://github.com/yasserfaraazkhan/impact-gate
cd impact-gate
npm install
npm run build
```

### Development Workflow

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make changes** to `src/` directory

3. **Build and test**
   ```bash
   npm run build
   npm test
   ```

4. **Commit with clear messages**
   ```bash
   git commit -m "feat: add OpenAI provider"
   ```

5. **Push and create a pull request**
   ```bash
   git push origin feature/your-feature-name
   ```

## Code Standards

### TypeScript
- Strict mode enabled (`strict: true`)
- Full type annotations required
- No `any` without justification
- Document complex types with JSDoc comments

### Naming Conventions
- Classes: PascalCase (e.g., `AnthropicProvider`)
- Functions: camelCase (e.g., `generateText`)
- Constants: UPPER_SNAKE_CASE (e.g., `DEFAULT_TIMEOUT`)
- Private members: underscore prefix (e.g., `_client`)

### Code Style
- Use 4-space indentation
- No trailing whitespace
- Max line length: 120 characters
- Use semicolons
- Order imports: types, then modules, then relative

### Comments
- Document public APIs with JSDoc
- Explain "why", not "what" (code is self-documenting)
- Mark experimental features with `@experimental`
- Note breaking changes with `@breaking`

## Adding a New Provider

### Steps

1. **Create provider file** in `src/providers/your_provider.ts`
2. **Implement LLMProvider interface**
3. **Add configuration type** to `provider_interface.ts`
4. **Export from `src/index.ts`**
5. **Update factory** in `provider_factory.ts`
6. **Add docs** in README

### Example

```typescript
export class YourProvider implements LLMProvider {
    name = 'your-provider';
    capabilities: ProviderCapabilities = {
        vision: true,
        streaming: true,
        maxTokens: 4000,
        costPer1MInputTokens: 1.5,
        costPer1MOutputTokens: 6,
        supportsTools: true,
        supportsPromptCaching: false,
        typicalResponseTimeMs: 1000,
    };

    constructor(config: YourProviderConfig) {
        // Initialize provider
    }

    async generateText(prompt: string, options?: GenerateOptions): Promise<LLMResponse> {
        // Implementation
    }

    // Implement other methods from LLMProvider interface
}
```

## Testing

- Write tests for new providers
- Test both success and error cases
- Verify cost calculations are accurate
- Test streaming and non-streaming modes

## Documentation

- Update README.md for user-facing changes
- Add CHANGELOG entry for each version
- Document configuration options
- Include usage examples

## Pull Request Process

1. **Keep PRs focused** — one feature or fix per PR
2. **Write descriptive titles** — "feat:", "fix:", "docs:" prefixes
3. **Include context** — why this change, what problem it solves
4. **Link issues** — reference GitHub issues being addressed
5. **Ensure CI passes** — all checks must pass before merge
6. **Request review** — from maintainers

## Release Process

Only maintainers can release new versions.

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Commit with message: `chore(release): v1.x.x`
4. Create git tag: `git tag v1.x.x`
5. Push tag: `git push origin v1.x.x`
6. GitHub Actions automatically publishes to npm

## Code of Conduct

Be respectful, inclusive, and constructive. All contributors are expected to follow the [Mattermost Code of Conduct](https://handbook.mattermost.com/operations/operations/mattermost-values).

## Questions?

- Open a GitHub discussion
- Check existing issues
- Review examples in README
- Ask in Mattermost community

## License

By contributing, you agree that your contributions will be licensed under the Apache 2.0 License.
