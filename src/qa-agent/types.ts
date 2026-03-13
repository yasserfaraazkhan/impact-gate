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
    | 'scroll'
    | 'back'
    | 'screenshot'
    | 'snapshot'
    | 'get_url'
    | 'get_title'
    | 'get_text'
    | 'eval'
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

export type FindingType = 'bug' | 'visual-regression' | 'ux-issue' | 'gap' | 'verified-ok';
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Finding {
    id: string;
    type: FindingType;
    severity: FindingSeverity;
    summary: string;
    flow: string;
    evidence: FindingEvidence;
    timestamp: number;
}

export interface FindingEvidence {
    screenshotPath?: string;
    url: string;
    reproSteps: string[];
    consoleErrors?: string[];
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
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface QAReport {
    schemaVersion: '1.0.0';
    generatedAt: string;
    mode: RunMode;
    config: {
        baseUrl: string;
        timeLimitMinutes: number;
        budgetUSD: number;
    };
    phase1: Phase1Result;
    phase2: Phase2Result;
    phase3: Phase3Result;
    verdict: ReleaseVerdict;
}
