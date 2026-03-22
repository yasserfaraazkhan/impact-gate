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
export {analyzeImpact as analyzeImpactV2, getGaps, getGapsWithSuppressed, getPartialGaps} from './engine/impact_engine.js';
export type {ImpactResult, ImpactedFeature, CoverageStatus, ImpactEngineOptions, SpecWithScenarios, PrTestFile, PrTestFileType, GapResult} from './engine/impact_engine.js';
export {extractScenarios} from './engine/impact_engine.js';
export {buildPlanFromImpact} from './engine/plan_builder.js';
export {appendFeedbackAndRecompute, readCalibration, readFlakyTests, getAdaptiveThresholds} from './agent/feedback.js';
export type {RecommendationFeedbackEntry, CalibrationSummary, FlakySummary, AdaptiveThresholds} from './agent/feedback.js';
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

// Crew (multi-agent QA workflows)
export {CrewOrchestrator} from './crew/orchestrator.js';
export type {CrewConfig, CrewResult} from './crew/orchestrator.js';
export type {CrewContext} from './crew/context.js';
export type {Agent, AgentPlugin, AgentTask, AgentResult, AgentMessage} from './crew/protocol.js';
export type {
    AgentRole, TestCaseType, TestCase, TestDesign,
    CrossImpact, Finding, RegressionRisk, StrategyEntry,
} from './crew/types.js';
export type {WorkflowDef, WorkflowName} from './crew/workflows.js';
export {WORKFLOWS} from './crew/workflows.js';

// Crew agents
export {ImpactAnalystAgent} from './agents/impact-analyst.js';
export {CoverageEvaluatorAgent} from './agents/coverage-evaluator.js';
export {GeneratorAgent} from './agents/generator.js';
export {ExecutorAgent} from './agents/executor.js';
export {HealerAgent} from './agents/healer.js';
export {ExplorerAgent} from './agents/explorer.js';
export {StrategistAgent} from './agents/strategist.js';
export {TestDesignerAgent} from './agents/test-designer.js';
export {CrossImpactAgent} from './agents/cross-impact.js';
export {RegressionAdvisorAgent} from './agents/regression-advisor.js';

// Base provider (for extending with custom providers)
export {BaseProvider, BudgetExceededError} from './base_provider.js';

// Budget tracking
export {BudgetLedger} from './budget_ledger.js';

// Model routing
export {ModelRouter} from './model_router.js';
export type {TaskComplexity, ModelRoutingConfig} from './model_router.js';

// Resilience
export {withRetry} from './resilience/retry.js';
export type {RetryConfig} from './resilience/retry.js';
export {CircuitBreaker} from './resilience/circuit_breaker.js';
export type {CircuitBreakerConfig} from './resilience/circuit_breaker.js';

// Metrics
export {PrometheusMetrics} from './metrics/prometheus.js';

// Secret scanning
export {sanitizeSecrets, containsSecrets, sanitizeObject} from './sanitize.js';

// CLI errors
export {CliError, classifyError, EXIT_CODES} from './cli/errors.js';
export type {ExitCode} from './cli/errors.js';

// Training (route-families bootstrap and maintenance)
export {scanProject} from './training/scanner.js';
export {mergeFamilies, detectStaleFamilies} from './training/merger.js';
export {enrichFamilies} from './training/enricher.js';
export {getCommitFiles, validateCommit, buildValidationReport, formatValidationReport} from './training/validator.js';
export type {
    ScanResult, ScannedFamily, ScannedFeature, DiscoveredDir,
    EnrichmentResult, ValidationReport, CommitValidation, MergeResult, TrainOptions,
} from './training/types.js';

// Knowledge graph types and bridge
export type {KnowledgeGraph, KGNode, KGEdge, KGProject} from './knowledge/kg_types.js';
export {loadKnowledgeGraph, classifyProjectType, transformKGToFamilies, loadDiffOverlay} from './knowledge/kg_bridge.js';
export {scanFromKnowledgeGraph} from './training/kg_scanner.js';

// Generation profile
export type {GenerationProfile} from './prompts/generation_profile.js';
export {resolveGenerationProfile, isMattermostProfile} from './prompts/generation_profile.js';

// Framework adapter
export type {RunCommand} from './adapters/framework_adapter.js';
export {detectFramework, detectTestMode} from './adapters/framework_adapter.js';

// Route families (additional)
export {serializeManifest} from './knowledge/route_families.js';
