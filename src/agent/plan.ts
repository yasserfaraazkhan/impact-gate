// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import type {PolicyConfig} from './config.js';

export type RecommendedRunSet = 'smoke' | 'targeted' | 'full';
export type CiAction = 'run-now' | 'must-add-tests' | 'safe-to-merge';

export interface PolicyEvaluation {
    riskyFiles: string[];
    triggeredRules: string[];
    applied: PolicyConfig;
}

export interface DecisionSummary {
    action: CiAction;
    title: string;
    summary: string;
}

export interface GapDetail {
    id: string;
    name: string;
    priority: string;
    reasons: string[];
    files: string[];
    existingTests?: string[];
    missingScenarios?: string[];
    source?: 'deterministic' | 'ai+deterministic';
}

export interface CoveredFlowSummary {
    id: string;
    name: string;
    priority: string;
    coveredBy: string[];
    advisoryScenarios?: string[]; // AI-detected new behavior in this PR that may not be covered
}

export interface PlanReport {
    schemaVersion: '1.0.0';
    runId: string;
    sourceRunId?: string;
    generatedAt: string;
    source: 'impact' | 'ai+deterministic';
    runSet: RecommendedRunSet;
    confidence: number;
    reasons: string[];
    recommendedTests: string[];
    requiredNewTests: string[];
    gapDetails: GapDetail[];
    coveredFlows: CoveredFlowSummary[];
    policy: PolicyEvaluation;
    decision: DecisionSummary;
    enforcement: {
        mode: PolicyConfig['enforcementMode'];
        blockOnActions: CiAction[];
        matchedAction: boolean;
        shouldFail: boolean;
        summary: string;
    };
    insights?: {
        flaky?: {
            highRiskRecommendedTests: Array<{
                test: string;
                flakeRate: number;
                flakeRate7d?: number;
                flakeRate30d?: number;
                trend?: 'up' | 'down' | 'stable';
                subsystem?: string;
                owners?: string[];
                quarantine?: boolean;
                quarantineState?: 'none' | 'active' | 'retire-candidate';
                lastFailureAt?: string;
            }>;
            quarantinedRecommendedTests: string[];
            ownerMentions?: string[];
        };
        qualityGates?: {
            failed: Array<{name: string; status: 'pass' | 'warn' | 'fail'; details?: string}>;
            warnings: Array<{name: string; status: 'pass' | 'warn' | 'fail'; details?: string}>;
        };
        calibration?: {
            precision: number;
            recall: number;
            falseNegativeRate: number;
        };
    };
    nextActions?: {
        requiresUserApprovalForGeneration: boolean;
        runRecommendedTests?: string;
        runSmokeSuite?: string;
        runFullSuite?: string;
        approveAndGenerate?: string;
        generateMissingTests?: string;
        healGeneratedTests?: string;
        commitGeneratedTests?: string;
        openPullRequest?: string;
    };
    metrics: {
        changedFiles: number;
        impactedFlows: number;
        p0Flows: number;
        p1Flows: number;
        p2Flows: number;
        coveredFlows?: number;
        partialFlows?: number;
        uncoveredP0P1Flows: number;
        warnings: number;
    };
}

export interface PlanMetricEvent {
    schemaVersion: '1.0.0';
    timestamp: string;
    runId: string;
    sourceRunId?: string;
    action: CiAction;
    runSet: RecommendedRunSet;
    confidence: number;
    changedFiles: number;
    impactedFlows: number;
    uncoveredP0P1Flows: number;
    warnings: number;
    enforcementMode: PolicyConfig['enforcementMode'];
    enforcementShouldFail: boolean;
}

export interface PlanMetricsSummary {
    schemaVersion: '1.0.0';
    generatedAt: string;
    totalRuns: number;
    averageConfidence: number;
    byAction: Record<CiAction, number>;
    byRunSet: Record<RecommendedRunSet, number>;
    blockingRecommendations: number;
    blockingRate: number;
}

const PLAN_METRICS_EVENTS_PATH = '.e2e-ai-agents/metrics.jsonl';
const PLAN_METRICS_SUMMARY_PATH = '.e2e-ai-agents/metrics-summary.json';

function parsePlanMetricLine(line: string): PlanMetricEvent | null {
    const trimmed = line.trim();
    if (!trimmed) {
        return null;
    }
    try {
        const parsed = JSON.parse(trimmed) as PlanMetricEvent;
        if (!parsed || parsed.schemaVersion !== '1.0.0' || typeof parsed.runId !== 'string') {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

export function appendPlanMetrics(appRoot: string, plan: PlanReport): {eventsPath: string; summaryPath: string} {
    const baseDir = join(appRoot, '.e2e-ai-agents');
    mkdirSync(baseDir, {recursive: true});
    const eventsPath = join(appRoot, PLAN_METRICS_EVENTS_PATH);
    const summaryPath = join(appRoot, PLAN_METRICS_SUMMARY_PATH);

    const event: PlanMetricEvent = {
        schemaVersion: '1.0.0',
        timestamp: new Date().toISOString(),
        runId: plan.runId,
        sourceRunId: plan.sourceRunId,
        action: plan.decision.action,
        runSet: plan.runSet,
        confidence: plan.confidence,
        changedFiles: plan.metrics.changedFiles,
        impactedFlows: plan.metrics.impactedFlows,
        uncoveredP0P1Flows: plan.metrics.uncoveredP0P1Flows,
        warnings: plan.metrics.warnings,
        enforcementMode: plan.enforcement.mode,
        enforcementShouldFail: plan.enforcement.shouldFail,
    };

    appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, 'utf-8');

    const allEvents: PlanMetricEvent[] = existsSync(eventsPath)
        ? readFileSync(eventsPath, 'utf-8')
            .split('\n')
            .map(parsePlanMetricLine)
            .filter((item): item is PlanMetricEvent => Boolean(item))
        : [event];

    const byAction: Record<CiAction, number> = {
        'run-now': 0,
        'must-add-tests': 0,
        'safe-to-merge': 0,
    };
    const byRunSet: Record<RecommendedRunSet, number> = {
        smoke: 0,
        targeted: 0,
        full: 0,
    };
    let totalConfidence = 0;
    let blockingRecommendations = 0;
    for (const metricEvent of allEvents) {
        byAction[metricEvent.action] += 1;
        byRunSet[metricEvent.runSet] += 1;
        totalConfidence += metricEvent.confidence;
        if (metricEvent.enforcementShouldFail) {
            blockingRecommendations += 1;
        }
    }

    const totalRuns = allEvents.length;
    const summary: PlanMetricsSummary = {
        schemaVersion: '1.0.0',
        generatedAt: new Date().toISOString(),
        totalRuns,
        averageConfidence: totalRuns > 0 ? Number((totalConfidence / totalRuns).toFixed(2)) : 0,
        byAction,
        byRunSet,
        blockingRecommendations,
        blockingRate: totalRuns > 0 ? Number((blockingRecommendations / totalRuns).toFixed(4)) : 0,
    };

    writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
    return {eventsPath, summaryPath};
}
