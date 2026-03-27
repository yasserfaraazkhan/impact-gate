// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {FlowPriority} from '../agent/types.js';

// ---------------------------------------------------------------------------
// Run modes
// ---------------------------------------------------------------------------

export type RunMode = 'pr' | 'hunt' | 'fix' | 'release';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface QAConfig {
    mode: RunMode;
    baseUrl: string;
    since?: string;
    huntTarget?: string;
    phase?: 1 | 2 | 3;
    timeLimitMinutes: number;
    budgetUSD: number;
    headed?: boolean;
    testsRoot?: string;
    project?: string;
    users?: UserCredentials[];
    screenshotDir?: string;
    outputDir?: string;
    fixTier?: FixTier;
    fixEnabled?: boolean;
    regression?: boolean;
}

export interface UserCredentials {
    role: string;
    username: string;
    password: string;
}

// ---------------------------------------------------------------------------
// Browser actions & observations
// ---------------------------------------------------------------------------

export type BrowserActionType =
    | 'navigate'
    | 'click'
    | 'fill'
    | 'type'
    | 'press'
    | 'press_key'
    | 'scroll'
    | 'back'
    | 'go_back'
    | 'screenshot'
    | 'take_screenshot'
    | 'snapshot'
    | 'get_url'
    | 'get_title'
    | 'get_text'
    | 'eval'
    | 'report_finding'
    | 'mark_flow_done'
    | 'switch_user'
    | 'wait_for'
    | 'compressed';

export interface BrowserAction {
    type: BrowserActionType;
    target?: string;
    value?: string;
    timestamp: number;
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

/** Canonical finding categories (v1.1) */
export type FindingCategory = 'visual' | 'functional' | 'ux' | 'content' | 'performance' | 'console' | 'accessibility';

/** Legacy finding types kept for backward compatibility */
export type LegacyFindingType = 'bug' | 'visual-regression' | 'ux-issue' | 'gap' | 'verified-ok';

/** Accepts both canonical categories and legacy type names */
export type FindingType = FindingCategory | LegacyFindingType;

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

// ---------------------------------------------------------------------------
// Health score
// ---------------------------------------------------------------------------

export type HealthScoreCategory = 'console' | 'links' | 'visual' | 'functional' | 'ux' | 'performance' | 'content' | 'accessibility';

export interface CategoryScore {
    category: HealthScoreCategory;
    score: number;
    weight: number;
    findings: string[];
}

export interface HealthScore {
    overall: number;
    categories: CategoryScore[];
    computedAt: string;
}

// ---------------------------------------------------------------------------
// Fix loop (Phase 2.5)
// ---------------------------------------------------------------------------

export type FixTier = 'quick' | 'standard' | 'exhaustive';
export type FixStatus = 'verified' | 'best-effort' | 'reverted' | 'skipped';

export interface FixResult {
    findingId: string;
    status: FixStatus;
    commitHash?: string;
    filesChanged?: string[];
    beforeScreenshot?: string;
    afterScreenshot?: string;
}

export interface Phase25Result {
    fixes: FixResult[];
    fixesAttempted: number;
    fixesVerified: number;
    fixesBestEffort: number;
    fixesReverted: number;
    fixesSkipped: number;
    healthScoreBefore: HealthScore;
    healthScoreAfter: HealthScore;
    durationMs: number;
    tokensUsed: number;
    costUSD: number;
}

// ---------------------------------------------------------------------------
// Regression baselines
// ---------------------------------------------------------------------------

export interface RegressionBaseline {
    date: string;
    url: string;
    healthScore: HealthScore;
    issues: Pick<Finding, 'id' | 'type' | 'severity' | 'summary' | 'flow'>[];
    commitHash?: string;
}

export interface RegressionComparison {
    baselineDate: string;
    scoreDelta: number;
    categoryDeltas: Partial<Record<HealthScoreCategory, number>>;
    fixedIssues: string[];
    newIssues: string[];
}

export interface Finding {
    id: string;
    type: FindingType;
    severity: FindingSeverity;
    summary: string;
    flow: string;
    evidence: FindingEvidence;
    timestamp: number;
    /** Number of duplicate findings collapsed into this one */
    duplicateCount?: number;
}

export interface FindingEvidence {
    screenshotPath?: string;
    /** Multiple screenshot references (e.g. before/after) */
    screenshotRefs?: string[];
    url: string;
    reproSteps: string[];
    consoleErrors?: string[];
    expectedBehavior?: string;
    actualBehavior?: string;
}

// ---------------------------------------------------------------------------
// Exploration state
// ---------------------------------------------------------------------------

export interface TargetFlow {
    id: string;
    name: string;
    url?: string;
    priority: FlowPriority;
}

export interface ExplorationState {
    flowsToExplore: TargetFlow[];
    flowsExplored: string[];
    currentFlow: string | null;
    findings: Finding[];
    /** Dedup index: maps finding hash key → index in findings array. Runtime-only — not serializable to JSON. */
    findingDedupIndex: Record<string, number>;
    actionsLog: BrowserAction[];
    recentActions: BrowserAction[];
    tokensUsed: number;
    costUSD: number;
    startTime: number;
    timeLimitMs: number;
    budgetUSD: number;
}

// ---------------------------------------------------------------------------
// Phase results
// ---------------------------------------------------------------------------

export interface SpecResult {
    specPath: string;
    passed: number;
    failed: number;
    flaky: number;
    skipped: number;
}

export interface Phase1Result {
    flows: TargetFlow[];
    specResults: SpecResult[];
    planPath?: string;
}

export interface Phase2Result {
    findings: Finding[];
    flowsExplored: string[];
    actionsCount: number;
    tokensUsed: number;
    costUSD: number;
    durationMs: number;
    healthScore?: HealthScore;
}

export interface Phase3Result {
    reportPath: string;
    summaryPath: string;
    verdict: ReleaseVerdict;
    generatedSpecs: string[];
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

export type VerdictDecision = 'go' | 'no-go' | 'conditional';

export interface FlowSignoff {
    flowId: string;
    flowName: string;
    status: 'passed' | 'failed' | 'not-tested';
    findings: string[];
}

export interface ReleaseVerdict {
    decision: VerdictDecision;
    reason: string;
    flowSignoffs: FlowSignoff[];
    criticalFindings: number;
    highFindings: number;
    mediumFindings: number;
    lowFindings: number;
    healthScore?: HealthScore;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface QAReport {
    schemaVersion: '1.0.0' | '1.1.0';
    generatedAt: string;
    mode: RunMode;
    config: {
        baseUrl: string;
        timeLimitMinutes: number;
        budgetUSD: number;
        fixTier?: FixTier;
    };
    phase1: Phase1Result;
    phase2: Phase2Result;
    phase25?: Phase25Result;
    phase3: Phase3Result;
    verdict: ReleaseVerdict;
    healthScore?: HealthScore;
    regressionComparison?: RegressionComparison;
}
