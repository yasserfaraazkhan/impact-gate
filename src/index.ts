// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * LLM Provider Module
 *
 * Framework-agnostic library for working with Language Learning Models.
 * Pluggable architecture supports multiple providers:
 * - Anthropic Claude (premium, vision support)
 * - Ollama (free, local)
 * - OpenAI (official API)
 * - Custom providers
 *
 * Switch between providers seamlessly without changing application code.
 */

// Core interfaces and types
export type {
    LLMProvider,
    GenerateOptions,
    ImageInput,
    LLMResponse,
    TokenUsage,
    ProviderCapabilities,
    ProviderUsageStats,
    ProviderConfig,
    AnthropicConfig,
    OllamaConfig,
    OpenAIConfig,
    CustomConfig,
} from './provider_interface.js';

export {LLMProviderError, UnsupportedCapabilityError} from './provider_interface.js';

// Provider implementations
export {AnthropicProvider, checkAnthropicSetup} from './anthropic_provider.js';
export {OllamaProvider, checkOllamaSetup} from './ollama_provider.js';
export {OpenAIProvider, checkOpenAISetup} from './openai_provider.js';
export {CustomProvider} from './custom_provider.js';

// Factory
export {LLMProviderFactory, validateProviderSetup} from './provider_factory.js';
export type {HybridConfig} from './provider_factory.js';

// Agent API (impact, gap, suggest, traceability ingest)
export {analyzeImpact, findGaps, recommendTests, handoffGeneratedTests, ingestTraceability, captureTraceability} from './api.js';
export type {
    AgentApiOptions,
    AnalyzeResult,
    RecommendTestsResult,
    TraceabilityIngestApiOptions,
    TraceabilityCaptureApiOptions,
} from './api.js';
export {appendFeedbackAndRecompute, readCalibration} from './agent/feedback.js';
export type {RecommendationFeedbackEntry, CalibrationSummary} from './agent/feedback.js';
export {finalizeGeneratedTests} from './agent/handoff.js';
export type {FinalizeGeneratedTestsOptions, FinalizeGeneratedTestsResult} from './agent/handoff.js';
export {ingestTraceabilityInput} from './agent/traceability_ingest.js';
export type {TraceabilityIngestOptions, TraceabilityIngestResult, TraceabilityIngestEntry} from './agent/traceability_ingest.js';
export {captureTraceabilityInput} from './agent/traceability_capture.js';
export type {TraceabilityCaptureOptions, TraceabilityCaptureResult} from './agent/traceability_capture.js';
