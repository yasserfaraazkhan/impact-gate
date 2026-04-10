// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Types for the unified PR review report.
 *
 * The review command combines impact analysis, coverage planning, and defect
 * prediction into a single human-readable report organized by user flows.
 */

/** A user flow impacted by the PR, with coverage and risk assessment */
export interface ReviewedFlow {
    /** Route family or feature ID */
    id: string;

    /** Human-readable name (from route family or heuristic) */
    name: string;

    /** Coverage status */
    status: 'covered' | 'partial' | 'uncovered';

    /** Priority from the manifest */
    priority: 'P0' | 'P1' | 'P2';

    /** Files changed that affect this flow */
    changedFiles: string[];

    /** Existing test files that cover this flow */
    existingTests: string[];

    /** What's missing (human-readable gap descriptions) */
    gaps: string[];

    /** User flow descriptions from the manifest */
    userFlows: string[];

    /** Risk note derived from prediction data */
    riskNote?: string;
}

/** A coverage gap that needs attention */
export interface CoverageGapSummary {
    /** Feature/flow ID */
    id: string;

    /** Human-readable name */
    name: string;

    /** Priority */
    priority: string;

    /** Why this is a gap */
    reason: string;

    /** Files driving this gap */
    files: string[];
}

/** Risk summary from defect prediction */
export interface RiskSummary {
    /** Defect risk score 0.0-1.0 */
    score: number;

    /** Risk level */
    level: 'low' | 'medium' | 'high' | 'critical';

    /** Top risk factors in human language */
    topFactors: string[];

    /** Recommendation */
    recommendation: string;
}

/** The merge decision */
export interface ReviewDecision {
    /** Action to take */
    action: 'safe-to-merge' | 'review-recommended' | 'must-add-tests' | 'block';

    /** One-sentence summary for PMs and stakeholders */
    summary: string;

    /** Bullet points for developers */
    details: string[];
}

/** Metrics for the review */
export interface ReviewMetrics {
    changedFiles: number;
    impactedFlows: number;
    coveredFlows: number;
    uncoveredFlows: number;
    partialFlows: number;
    coverageGaps: number;
    defectRiskScore: number;
    confidence: number;
}

/** The complete review report */
export interface ReviewReport {
    /** Impacted user flows with coverage and risk */
    impactedFlows: ReviewedFlow[];

    /** Coverage gaps that need tests */
    coverageGaps: CoverageGapSummary[];

    /** Defect risk assessment */
    riskAssessment: RiskSummary;

    /** The merge decision */
    decision: ReviewDecision;

    /** Summary metrics */
    metrics: ReviewMetrics;

    /** Function-level affected analysis from knowledge graph (when available) */
    affectedFunctions?: Array<{
        node: {id: string; name: string; kind: string; filePath?: string};
        impact: 'direct' | 'transitive';
        calledBy: Array<{name: string; filePath?: string}>;
        testedBy: Array<{name: string; filePath?: string}>;
        depth: number;
    }>;
}
