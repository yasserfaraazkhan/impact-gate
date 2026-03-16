// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Crew data types — structured test design, cross-impact analysis, and findings.
 */

export type TestCaseType =
    | 'happy-path'
    | 'edge-case'
    | 'boundary'
    | 'negative'
    | 'state-transition'
    | 'race-condition'
    | 'permission'
    | 'accessibility'
    | 'performance';

export interface TestCase {
    name: string;
    type: TestCaseType;
    preconditions: string[];
    steps: string[];
    expectedOutcome: string;
    priority: 'P0' | 'P1' | 'P2';
    rationale: string;
}

export interface TestDesign {
    flowId: string;
    flowName: string;
    testCases: TestCase[];
}

export interface CrossImpact {
    sourceFamily: string;
    affectedFamily: string;
    sharedDependency: string;
    riskLevel: 'high' | 'medium' | 'low';
    evidence: string;
}

export interface Finding {
    id: string;
    type: 'bug' | 'gap' | 'risk' | 'flaky';
    severity: 'critical' | 'high' | 'medium' | 'low';
    source: AgentRole;
    summary: string;
    details: string;
    relatedFlows: string[];
}

export interface RegressionRisk {
    familyId: string;
    filePattern: string;
    riskScore: number;
    reason: string;
    historicalFailures: number;
}

export interface StrategyEntry {
    flowId: string;
    flowName: string;
    priority: 'P0' | 'P1' | 'P2';
    approach: 'full-test' | 'smoke-test' | 'skip' | 'manual-review';
    rationale: string;
    testCategories: TestCaseType[];
    crossImpactRisk: 'high' | 'medium' | 'low' | 'none';
}

export type AgentRole =
    | 'strategist'
    | 'test-designer'
    | 'cross-impact'
    | 'regression-advisor'
    | 'impact-analyst'
    | 'coverage-evaluator'
    | 'generator'
    | 'executor'
    | 'healer'
    | 'explorer';
