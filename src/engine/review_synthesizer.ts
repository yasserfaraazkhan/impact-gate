// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Review Synthesizer
 *
 * Combines impact analysis, coverage planning, and defect prediction
 * into a single ReviewReport organized by user flows.
 *
 * This is the core value-add: translating technical data into
 * flow-level language that devs, QAs, PMs, and release managers understand.
 */

import type {ImpactResult, ImpactedFeature} from './impact_engine.js';
import type {PlanReport, GapDetail} from '../agent/plan.js';
import type {DefectPrediction} from '../prediction/types.js';
import type {KGImpactResult, AffectedFunction} from './kg_impact.js';
import {formatAffectedFunction} from './kg_impact.js';
import type {BehaviorAnalysisResult} from './behavior_analyzer.js';
import type {
    ReviewReport,
    ReviewedFlow,
    CoverageGapSummary,
    RiskSummary,
    ReviewDecision,
    ReviewMetrics,
} from './review_types.js';

/**
 * Synthesize a unified review report from the three pipeline outputs.
 *
 * @param impact - What files changed and which features they map to
 * @param plan - Coverage gaps and test recommendations
 * @param prediction - Defect risk score and factors
 */
export function synthesizeReview(
    impact: ImpactResult,
    plan: PlanReport,
    prediction: DefectPrediction,
    kgImpact?: KGImpactResult,
    behaviorAnalysis?: BehaviorAnalysisResult,
): ReviewReport {
    const impactedFlows = buildReviewedFlows(impact, plan, prediction);
    const coverageGaps = buildCoverageGaps(plan);
    const riskAssessment = buildRiskSummary(prediction);
    const decision = buildDecision(impact, plan, prediction);
    const metrics = buildMetrics(impact, plan, prediction, impactedFlows);

    // Enrich with KG function-level data when available
    let affectedFunctions: AffectedFunction[] | undefined;
    if (kgImpact) {
        affectedFunctions = kgImpact.affectedFunctions;
    }

    // Enrich with behavior analysis when available
    const report: ReviewReport = {impactedFlows, coverageGaps, riskAssessment, decision, metrics, affectedFunctions};

    if (behaviorAnalysis) {
        report.behaviorSummary = behaviorAnalysis.behaviorSummary;
        report.recommendations = behaviorAnalysis.recommendations;
        report.relevantExistingTests = behaviorAnalysis.relevantTests.map((t) => ({
            file: t.file,
            matchReason: t.matchReason,
        }));

        if (behaviorAnalysis.prIncludedTests.length > 0) {
            report.prIncludedTestSummary = {
                files: behaviorAnalysis.prIncludedTests.map((t) => t.file),
                scenarioCount: behaviorAnalysis.prIncludedTests.reduce((sum, t) => sum + t.scenarios.length, 0),
            };
        }

        // Upgrade decision when PR includes tests that cover the gaps
        if (report.prIncludedTestSummary && report.prIncludedTestSummary.scenarioCount > 0
            && report.decision.action === 'must-add-tests') {
            report.decision = {
                ...report.decision,
                action: 'review-recommended',
                summary: report.decision.summary.replace(
                    /Add tests before merging/,
                    'PR includes tests. Review recommended.',
                ),
            };
        }
    }

    return report;
}

// ─── Impacted Flows ───

function buildReviewedFlows(
    impact: ImpactResult,
    plan: PlanReport,
    prediction: DefectPrediction,
): ReviewedFlow[] {
    const flows: ReviewedFlow[] = [];

    // Build a gap lookup for quick matching
    const gapMap = new Map<string, GapDetail>();
    for (const gap of plan.gapDetails) {
        gapMap.set(gap.id, gap);
    }

    for (const feature of impact.impactedFeatures) {
        const id = feature.featureId || feature.familyId;
        const name = humanizeName(id);
        const gap = gapMap.get(id);

        const existingTests = [
            ...feature.playwrightSpecs,
            ...feature.cypressSpecs,
        ];

        const gaps: string[] = [];
        if (gap) {
            for (const reason of gap.reasons) {
                gaps.push(reason);
            }
            if (gap.missingScenarios) {
                for (const scenario of gap.missingScenarios) {
                    gaps.push(`Missing scenario: ${scenario}`);
                }
            }
        }

        if (feature.coverageStatus === 'uncovered' && gaps.length === 0) {
            gaps.push('No E2E test coverage for this flow');
        }

        const riskNote = buildRiskNoteForFlow(feature, prediction);

        flows.push({
            id,
            name,
            status: feature.coverageStatus,
            priority: feature.priority,
            changedFiles: feature.changedFiles,
            existingTests,
            gaps,
            userFlows: feature.userFlows || [],
            riskNote,
        });
    }

    // Sort: uncovered first, then by priority (P0 > P1 > P2)
    flows.sort((a, b) => {
        const statusOrder = {uncovered: 0, partial: 1, covered: 2};
        const priorityOrder = {P0: 0, P1: 1, P2: 2};
        const aStatus = statusOrder[a.status] ?? 2;
        const bStatus = statusOrder[b.status] ?? 2;
        if (aStatus !== bStatus) return aStatus - bStatus;
        const aPriority = priorityOrder[a.priority] ?? 2;
        const bPriority = priorityOrder[b.priority] ?? 2;
        return aPriority - bPriority;
    });

    return flows;
}

/** Convert a kebab-case/snake_case ID into a readable name */
function humanizeName(id: string): string {
    return id
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Build a risk note for a specific flow based on prediction data */
function buildRiskNoteForFlow(feature: ImpactedFeature, prediction: DefectPrediction): string | undefined {
    const parts: string[] = [];

    if (feature.coverageStatus === 'uncovered') {
        parts.push('no test coverage');
    }

    // Check if this flow's files are in high-traffic areas
    if (feature.changedFiles.length > 5) {
        parts.push(`${feature.changedFiles.length} files changed`);
    }

    // Add semantic patterns if available and relevant to this flow's files
    if (prediction.semantic?.patterns) {
        for (const pattern of prediction.semantic.patterns) {
            if (feature.changedFiles.some((f) => pattern.file.includes(f) || f.includes(pattern.file))) {
                parts.push(pattern.description);
            }
        }
    }

    if (parts.length === 0 && prediction.level === 'critical') {
        parts.push(`part of a ${prediction.level}-risk PR`);
    }

    return parts.length > 0 ? parts.join('; ') : undefined;
}

// ─── Coverage Gaps ───

function buildCoverageGaps(plan: PlanReport): CoverageGapSummary[] {
    return plan.gapDetails.map((gap) => ({
        id: gap.id,
        name: gap.name || humanizeName(gap.id),
        priority: gap.priority,
        reason: gap.reasons.join('. ') || 'No E2E test coverage',
        files: gap.files,
    }));
}

// ─── Risk Summary ───

function buildRiskSummary(prediction: DefectPrediction): RiskSummary {
    const topFactors = prediction.factors
        .filter((f) => f.direction === 'risk')
        .slice(0, 3)
        .map((f) => `${f.explanation} (${f.name}: ${f.value})`);

    // Add semantic findings to top factors
    if (prediction.semantic?.patterns) {
        for (const pattern of prediction.semantic.patterns.slice(0, 2)) {
            topFactors.push(`${pattern.description} [${pattern.category}]`);
        }
    }

    return {
        score: prediction.score,
        level: prediction.level,
        topFactors,
        recommendation: prediction.recommendation,
    };
}

// ─── Decision ───

function buildDecision(
    impact: ImpactResult,
    plan: PlanReport,
    prediction: DefectPrediction,
): ReviewDecision {
    // Use the plan's decision as the primary signal, augmented by prediction
    const planAction = plan.decision.action;
    const riskLevel = prediction.level;

    let action: ReviewDecision['action'];
    if (planAction === 'must-add-tests' || (riskLevel === 'critical' && plan.gapDetails.length > 0)) {
        action = 'must-add-tests';
    } else if (planAction === 'run-now' || riskLevel === 'high') {
        action = 'review-recommended';
    } else if (planAction === 'safe-to-merge' && (riskLevel === 'low' || riskLevel === 'medium')) {
        action = 'safe-to-merge';
    } else {
        action = 'review-recommended';
    }

    const summary = buildDecisionSummary(action, impact, plan, prediction);
    const details = buildDecisionDetails(action, impact, plan, prediction);

    return {action, summary, details};
}

function buildDecisionSummary(
    action: ReviewDecision['action'],
    impact: ImpactResult,
    plan: PlanReport,
    prediction: DefectPrediction,
): string {
    const flowCount = impact.impactedFeatures.length;
    const gapCount = plan.gapDetails.length;

    switch (action) {
    case 'safe-to-merge':
        return `This PR impacts ${flowCount} flow${flowCount !== 1 ? 's' : ''}, all with existing test coverage. Low defect risk.`;
    case 'review-recommended':
        return `This PR impacts ${flowCount} flow${flowCount !== 1 ? 's' : ''} with ${prediction.level} defect risk. Review recommended before merging.`;
    case 'must-add-tests':
        return `This PR has ${gapCount} coverage gap${gapCount !== 1 ? 's' : ''} and ${prediction.level} defect risk. Add tests before merging.`;
    case 'block':
        return `This PR should not be merged. ${gapCount} critical coverage gaps and ${prediction.level} defect risk.`;
    }
}

function buildDecisionDetails(
    action: ReviewDecision['action'],
    impact: ImpactResult,
    plan: PlanReport,
    prediction: DefectPrediction,
): string[] {
    const details: string[] = [];

    // Coverage info
    const covered = impact.impactedFeatures.filter((f) => f.coverageStatus === 'covered').length;
    const uncovered = impact.impactedFeatures.filter((f) => f.coverageStatus === 'uncovered').length;
    const partial = impact.impactedFeatures.filter((f) => f.coverageStatus === 'partial').length;

    if (uncovered > 0) {
        details.push(`${uncovered} flow${uncovered !== 1 ? 's' : ''} have no E2E test coverage`);
    }
    if (partial > 0) {
        details.push(`${partial} flow${partial !== 1 ? 's' : ''} have partial coverage`);
    }
    if (covered > 0) {
        details.push(`${covered} flow${covered !== 1 ? 's' : ''} are fully covered`);
    }

    // Risk info
    if (prediction.level === 'high' || prediction.level === 'critical') {
        const cx = prediction.metrics.complexity;
        if (cx.test_ratio < 0.2) {
            details.push(`Only ${Math.round(cx.test_ratio * 100)}% of changes are in test files`);
        }
        if (cx.cognitive_delta > 10) {
            details.push(`Code complexity increased by ${cx.cognitive_delta} points`);
        }
    }

    // Unbound files
    if (impact.unboundFiles.length > 0) {
        details.push(`${impact.unboundFiles.length} changed file${impact.unboundFiles.length !== 1 ? 's' : ''} not mapped to any feature`);
    }

    // Run set
    details.push(`Recommended test run: ${plan.runSet.toUpperCase()}`);

    if (plan.recommendedTests.length > 0) {
        details.push(`${plan.recommendedTests.length} test${plan.recommendedTests.length !== 1 ? 's' : ''} to run`);
    }

    return details;
}

// ─── Metrics ───

function buildMetrics(
    impact: ImpactResult,
    plan: PlanReport,
    prediction: DefectPrediction,
    flows: ReviewedFlow[],
): ReviewMetrics {
    return {
        changedFiles: impact.changedFiles.length,
        impactedFlows: flows.length,
        coveredFlows: flows.filter((f) => f.status === 'covered').length,
        uncoveredFlows: flows.filter((f) => f.status === 'uncovered').length,
        partialFlows: flows.filter((f) => f.status === 'partial').length,
        coverageGaps: plan.gapDetails.length,
        defectRiskScore: prediction.score,
        confidence: plan.confidence,
    };
}
