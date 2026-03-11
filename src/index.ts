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

// Agent API (deterministic impact + plan, traceability)
export {analyzeImpactDeterministic, recommendTestsDeterministic, handoffGeneratedTests, ingestTraceability, captureTraceability} from './api.js';
export type {
    AgentApiOptions,
    RecommendTestsV2Result,
    TraceabilityIngestApiOptions,
    TraceabilityCaptureApiOptions,
} from './api.js';

// V2 Engine (deterministic impact + plan)
export {analyzeImpact as analyzeImpactV2, getGaps, getPartialGaps} from './engine/impact_engine.js';
export type {ImpactResult, ImpactedFeature, CoverageStatus, ImpactEngineOptions, SpecWithScenarios} from './engine/impact_engine.js';
export {extractScenarios} from './engine/impact_engine.js';
export {buildPlanFromImpact} from './engine/plan_builder.js';
export {appendFeedbackAndRecompute, readCalibration} from './agent/feedback.js';
export type {RecommendationFeedbackEntry, CalibrationSummary} from './agent/feedback.js';
export {finalizeGeneratedTests} from './agent/handoff.js';
export type {FinalizeGeneratedTestsOptions, FinalizeGeneratedTestsResult} from './agent/handoff.js';
export {ingestTraceabilityInput} from './agent/traceability_ingest.js';
export type {TraceabilityIngestOptions, TraceabilityIngestResult, TraceabilityIngestEntry} from './agent/traceability_ingest.js';
export {captureTraceabilityInput} from './agent/traceability_capture.js';
export type {TraceabilityCaptureOptions, TraceabilityCaptureResult} from './agent/traceability_capture.js';

// Pipeline API (route-family-bound impact analysis)
export {runPipeline} from './pipeline/orchestrator.js';
export type {PipelineConfig, PipelineResult} from './pipeline/orchestrator.js';
export type {FlowDecision, FlowDecisionReport, FlowDecisionSummary, FlowAction, EvidenceSource} from './validation/output_schema.js';
export {runGenerationStage} from './pipeline/stage3_generation.js';
export type {GenerationConfig, GenerationResult, GeneratedSpec} from './pipeline/stage3_generation.js';
export {buildGenerationPrompt, parseGenerationResponse, detectHallucinatedMethods} from './prompts/generation.js';
export type {GenerationPromptContext, GenerationAgentResponse} from './prompts/generation.js';
export {runHealStage, healFromReport, resolveHealTargets, renderHealMarkdown} from './pipeline/stage4_heal.js';
export type {HealConfig, HealTarget, HealResult} from './pipeline/stage4_heal.js';
export {buildHealPrompt, buildQualityFixPrompt} from './prompts/heal.js';
export type {HealPromptContext} from './prompts/heal.js';

// Knowledge modules
export {loadRouteFamilyManifest, bindFilesToFamilies, getCypressSpecDirsForBinding, getPriorityForBinding, getUserFlowsForBinding} from './knowledge/route_families.js';
export type {RouteFamily, RouteFeature, RouteFamilyManifest, FileBinding, FeaturePriority} from './knowledge/route_families.js';
export {buildApiSurface, loadOrBuildApiSurface} from './knowledge/api_surface.js';
export type {ApiSurfaceCatalog, PageObjectSurface} from './knowledge/api_surface.js';
export {buildSpecIndex, getSpecsForFamily} from './knowledge/spec_index.js';
export type {SpecIndex, SpecEntry} from './knowledge/spec_index.js';

// Shared types
export type {FlowImpact, FlowPriority, FlowCoverage, FlagHit, BlastRadius} from './agent/types.js';
export type {PlanReport} from './agent/plan.js';

// Agentic generation
export {runAgenticGeneration} from './agentic/runner.js';
export type {ScenarioInput, AgenticRunOptions} from './agentic/runner.js';
export type {AgenticConfig, AgenticResult, AgenticSummary, PlaywrightRunResult, TestFailure} from './agentic/types.js';
