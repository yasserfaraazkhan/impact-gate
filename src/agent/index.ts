// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Agent Module Exports
 *
 * Centralizes all agent-related functionality including:
 * - Impact analysis (detecting affected flows from code changes)
 * - Model routing (intelligent LLM model selection for cost optimization)
 * - Telemetry (metrics collection and reporting)
 * - Report generation (formatted output)
 * - Spec building (test specification generation)
 */

// Impact Analysis
export {
    analyzeImpact,
    detectComparisonBase,
    getGitChanges,
    loadFlowCatalog,
    matchFlowToChanges,
    findExistingTests,
    identifyTestGaps,
} from './impact-analyzer.js';
export type { GitChange, ChangeAnalysis, Flow, FlowImpact, FlowGroup, ImpactReport } from './impact-analyzer.js';

// Model Routing (Cost Optimization - TinyDancer pattern)
export { ModelRouter } from './model-router.js';
export type { TaskContext, TaskComplexity, ModelConfig } from './model-router.js';

// Telemetry (Metrics Collection)
export { TelemetryCollector } from './telemetry.js';
export type { GenerationMetric, TelemetryReport } from './telemetry.js';

// Report Generation (Console, Markdown, JSON)
export { generateReports } from './report-generator.js';
export type { ReportOptions } from './report-generator.js';

// Spec Bridge (PDF → Playwright specs)
export { SpecBridge, createAnthropicBridge, createOllamaBridge } from './spec-builder.js';
export type { SpecBridgeConfig, ConversionResult } from './spec-builder.js';
