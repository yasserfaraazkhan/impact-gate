// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Autonomous E2E Testing System
 *
 * A specification-driven testing system that bridges PDF/Markdown specs
 * with Playwright's native agents for test planning, generation, and healing.
 *
 * Quick Start:
 * ```typescript
 * import {SpecBridge, createAnthropicBridge} from '@mattermost/playwright-lib/autonomous';
 *
 * // Convert a specification to Playwright-compatible markdown
 * const bridge = createAnthropicBridge(process.env.ANTHROPIC_API_KEY);
 * const result = await bridge.convertToPlaywrightSpecs('spec.pdf', 'specs/');
 *
 * // Then use Playwright agents:
 * // @planner explore http://localhost:8065
 * // @generator create tests from specs/
 * // @healer fix failing tests
 * ```
 *
 * Architecture:
 * - SpecificationParser: Parses PDF/MD/JSON specs into structured format
 * - SpecBridge: Converts specs to Playwright Agent-compatible markdown
 * - LLM Providers: Pluggable AI providers (Anthropic, Ollama, OpenAI)
 *
 * The heavy lifting (test generation, execution, healing) is delegated to
 * Playwright's built-in agents which are production-ready and maintained
 * by the Playwright team.
 */

// Core Components
export {SpecificationParser} from './spec_parser.js';
export type {SpecSummary, SpecificationCache} from './spec_parser.js';

// LLM Providers (re-exported from parent package)
export {LLMProviderFactory} from '../provider_factory.js';
export {OllamaProvider} from '../ollama_provider.js';
export {AnthropicProvider} from '../anthropic_provider.js';

export type {
    LLMProvider,
    LLMResponse,
    GenerateOptions,
    ImageInput,
    ProviderCapabilities,
    ProviderUsageStats,
    ProviderConfig,
    OllamaConfig,
    AnthropicConfig,
} from '../provider_interface.js';
export type {HybridConfig} from '../provider_factory.js';

// Type definitions
export type {
    // Specifications
    FeatureSpecification,
    BusinessScenario,
    SpecScreenshot,

    // Generated test metadata (for tracking)
    GeneratedTest,
} from './types.js';

/**
 * Version info
 */
export const VERSION = '2.0.0';
export const SUPPORTED_PLAYWRIGHT_VERSION = '1.56.0';

/**
 * Feature flags
 */
export const FEATURES = {
    LLM_AGNOSTIC: true,
    SPECIFICATION_DRIVEN: true,
    PLAYWRIGHT_AGENTS: true,
} as const;
