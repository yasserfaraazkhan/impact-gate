// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Crew Context — shared mutable state accumulated by agents across workflow phases.
 */

import type {RouteFamily, RouteFamilyManifest} from '../knowledge/route_families.js';
import type {ApiSurfaceCatalog} from '../knowledge/api_surface.js';
import type {SpecEntry, SpecIndex} from '../knowledge/spec_index.js';
import type {FlowDecision} from '../validation/output_schema.js';
import type {ProviderUsageStats} from '../provider_interface.js';
import type {GeneratedSpec} from '../pipeline/stage3_generation.js';
import type {LoadedContext} from '../knowledge/context_loader.js';
import type {FamilyGroup, PreprocessResult} from '../pipeline/stage0_preprocess.js';
import type {AgentMessage} from './protocol.js';
import type {TestDesign, CrossImpact, Finding, StrategyEntry, RegressionRisk} from './types.js';

export interface CrewContext {
    // Input (populated during preprocess)
    changedFiles: string[];
    routeFamilies: RouteFamily[];
    manifest: RouteFamilyManifest | null;
    apiSurface: ApiSurfaceCatalog;
    specIndex: SpecIndex;
    context: LoadedContext;
    familyGroups: FamilyGroup[];
    preprocessResult: PreprocessResult;

    // Configuration
    appPath: string;
    testsRoot: string;
    gitSince: string;
    providerOverride?: string;

    // Accumulated by agents
    impactedFlows: FlowDecision[];
    strategyEntries: StrategyEntry[];
    testDesigns: TestDesign[];
    crossImpacts: CrossImpact[];
    regressionRisks: RegressionRisk[];
    findings: Finding[];
    generatedSpecs: GeneratedSpec[];

    // Metadata
    usage: ProviderUsageStats;
    messages: AgentMessage[];
    warnings: string[];
}

export function createEmptyUsageStats(): ProviderUsageStats {
    const now = new Date();
    return {
        requestCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        totalCost: 0,
        averageResponseTimeMs: 0,
        failedRequests: 0,
        startTime: now,
        lastUpdated: now,
    };
}

export function mergeUsageStats(target: ProviderUsageStats, source: ProviderUsageStats): void {
    target.requestCount += source.requestCount;
    target.totalInputTokens += source.totalInputTokens;
    target.totalOutputTokens += source.totalOutputTokens;
    target.totalTokens += source.totalTokens;
    target.totalCost += source.totalCost;
    target.failedRequests += source.failedRequests;
    if (source.requestCount > 0) {
        const totalRequests = target.requestCount;
        const prevWeight = (totalRequests - source.requestCount) / totalRequests;
        const newWeight = source.requestCount / totalRequests;
        target.averageResponseTimeMs =
            target.averageResponseTimeMs * prevWeight + source.averageResponseTimeMs * newWeight;
    }
    target.lastUpdated = new Date();
}
