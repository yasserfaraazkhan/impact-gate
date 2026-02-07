# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-02-07

### Security
- **CRITICAL**: Fixed command injection vulnerability in MCP server `runTests` tool
  - Added strict input validation for test patterns and browser selection
  - Implemented allowlist for browser types (chromium, firefox, webkit)
  - Added `--` argument separator to prevent injection
- **CRITICAL**: Fixed path traversal vulnerability in file operations
  - Implemented `validatePathIsWithinRoot()` using proper path resolution
  - All file reads/writes now checked to stay within repo root
  - Added 10MB file size limit to prevent resource exhaustion
- **HIGH**: Fixed path traversal in `getRepositoryContext` with file allowlist
- **HIGH**: Fixed git ref argument injection with validation and `--` separator
- **HIGH**: Fixed glob pattern injection blocking `.env`, `.pem`, `.key` patterns
- **HIGH**: Added rate limiting (100 req/min) to MCP server to prevent DOS
- Updated dependencies to latest secure versions (@anthropic-ai/sdk 0.73, openai 4.73)
- Sanitized error messages to prevent information leakage
- Replaced unsafe `as any` type casts with proper TypeScript interfaces
- Removed `.mcp.json` from npm package files to reduce attack surface
- Added validation for API keys, model names, URLs, and timeouts

See [SECURITY_FIXES.md](./SECURITY_FIXES.md) for comprehensive documentation.

## [0.2.0] - 2026-02-07

### Added
- Rebranded from `@mattermost/llm-testing-providers` to `e2e-ai-agents`
- Framework-agnostic LLM provider library with MCP server integration
- **Anthropic Provider** — Full support for Claude models
  - Vision/image analysis support
  - Streaming text generation
  - Prompt caching for cost optimization
  - Cost tracking and usage statistics
- **Ollama Provider** — Free, local LLM execution
  - Support for DeepSeek-R1, Llama, and other models
  - Streaming text generation
  - Zero-cost operation
- **Provider Factory** — Easy provider instantiation
  - Single provider creation
  - Hybrid provider mode (free + premium fallback)
  - Auto-detection from environment variables
  - String-based provider creation
- **MCP Server** — 6 tools for Playwright test agents
  - discover_tests, read_file, write_file, run_tests, get_git_changes, get_repository_context
- **Hybrid Provider** — Cost-optimized dual-provider setup
  - Use free Ollama for most tasks
  - Fallback to Claude for vision and complex tasks
  - Cost savings tracking
- **Cost Tracking** — Token usage and cost monitoring
  - Per-request cost calculation
  - Cumulative statistics
  - Support for cached token pricing
- **Framework-agnostic** — Zero Playwright or test framework dependencies
  - Pure LLM library, reusable anywhere
  - Suitable for CLI tools, mobile testing, scripts
- **Full TypeScript** — Complete type safety
  - Strict mode enabled
  - JSDoc documentation
  - Type exports for consumers

## [0.1.0] - 2026-02-07

### Added
- Initial release of e2e-ai-agents (formerly `@mattermost/llm-testing-providers`)
- **Anthropic Provider** — Full support for Claude models
  - Vision/image analysis support
  - Streaming text generation
  - Prompt caching for cost optimization
  - Cost tracking and usage statistics
- **Ollama Provider** — Free, local LLM execution
  - Support for DeepSeek-R1, Llama, and other models
  - Streaming text generation
  - Zero-cost operation
- **Provider Factory** — Easy provider instantiation
  - Single provider creation
  - Hybrid provider mode (free + premium fallback)
  - Auto-detection from environment variables
  - String-based provider creation
- **Hybrid Provider** — Cost-optimized dual-provider setup
  - Use free Ollama for most tasks
  - Fallback to Claude for vision and complex tasks
  - Cost savings tracking
- **Cost Tracking** — Token usage and cost monitoring
  - Per-request cost calculation
  - Cumulative statistics
  - Support for cached token pricing
- **Framework-agnostic** — Zero Playwright or test framework dependencies
  - Pure LLM library, reusable anywhere
  - Suitable for CLI tools, mobile testing, scripts
- **Full TypeScript** — Complete type safety
  - Strict mode enabled
  - JSDoc documentation
  - Type exports for consumers

### Documentation
- Comprehensive README with quick start guides
- Setup instructions for Anthropic and Ollama
- Usage examples for all providers
- Hybrid provider cost optimization guide
- Contributing guidelines
- Apache 2.0 license

### Infrastructure
- GitHub Actions CI/CD workflows
  - Automated testing on push/PR
  - Automated npm publishing on git tags
- npm package configuration
- TypeScript build setup

---

## Unreleased

### Planned for Future Releases
- OpenAI provider implementation
- Custom provider templates
- Advanced error recovery strategies
- Request caching for repeated prompts
- Rate limiting and quota management
- Distributed tracing/observability integration
- Additional language models and providers

---

For migration information and examples, see [MATTERMOST_EXAMPLES.md](./MATTERMOST_EXAMPLES.md).
