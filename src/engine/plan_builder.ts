// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {mkdirSync, writeFileSync} from 'fs';
import {dirname, join} from 'path';
import {minimatch} from 'minimatch';

import type {PolicyConfig} from '../agent/config.js';
import type {ImpactResult, ImpactedFeature} from './impact_engine.js';
import {getGaps, getPartialGaps} from './impact_engine.js';
import type {AIEnrichmentResult} from './ai_enrichment.js';

// Re-use existing plan types for backward compatibility
import type {
    PlanReport,
    GapDetail,
    CoveredFlowSummary,
    RecommendedRunSet,
    CiAction,
    DecisionSummary,
} from '../agent/plan.js';

export type {PlanReport, GapDetail, CoveredFlowSummary};

const DEFAULT_POLICY: PolicyConfig = {
    minConfidenceForTargeted: 60,
    safeMergeMinConfidence: 85,
    forceFullOnWarningsAtOrAbove: 2,
    forceFullOnP0WithGaps: true,
    forceFullOnRiskyFiles: true,
    riskyFilePatterns: [
        '**/auth/**',
        '**/login/**',
        '**/permissions/**',
        '**/admin/**',
        '**/security/**',
        '**/migrations/**',
        '**/schema/**',
        '**/*.sql',
        '**/webhook/**',
    ],
    enforcementMode: 'advisory',
    blockOnActions: ['must-add-tests'],
};

function featureLabel(f: ImpactedFeature): string {
    return f.featureId || f.familyId;
}

function computeConfidence(impact: ImpactResult): number {
    const gaps = getGaps(impact);
    const totalFeatures = impact.impactedFeatures.length;
    const boundRatio = totalFeatures > 0
        ? (totalFeatures / (totalFeatures + impact.unboundFiles.length))
        : 1;

    // Graph-resolved bindings start at 100
    let confidence = 100;

    // Deduct for unbound files (not mapped to any family)
    if (impact.unboundFiles.length > 0) {
        const unboundPenalty = Math.min(30, impact.unboundFiles.length * 3);
        confidence -= unboundPenalty;
    }

    // Deduct for gaps
    confidence -= Math.min(20, gaps.length * 5);

    // Deduct for warnings
    confidence -= Math.min(15, impact.warnings.length * 5);

    // Bonus for high bound ratio
    if (boundRatio >= 0.9) {
        confidence = Math.min(100, confidence + 5);
    }

    return Math.max(0, Math.min(100, confidence));
}

function findRiskyFiles(changedFiles: string[], patterns: string[]): string[] {
    return [...new Set(
        changedFiles.filter((file) =>
            patterns.some((pattern) => minimatch(file, pattern, {matchBase: true})),
        ),
    )];
}

function pickRunSet(
    impact: ImpactResult,
    confidence: number,
    policy: PolicyConfig,
): {runSet: RecommendedRunSet; reasons: string[]; triggeredRules: string[]; riskyFiles: string[]} {
    const gaps = getGaps(impact);
    const reasons: string[] = [];
    const triggeredRules: string[] = [];
    const riskyFiles = findRiskyFiles(impact.changedFiles, policy.riskyFilePatterns);

    const hasP0 = impact.impactedFeatures.some((f) => f.priority === 'P0');

    if (gaps.length > 0) {
        reasons.push(`${gaps.length} uncovered P0/P1 feature(s) detected.`);
    }
    if (hasP0) {
        reasons.push('P0 features are impacted by this change set.');
    }
    if (policy.forceFullOnRiskyFiles && riskyFiles.length > 0) {
        triggeredRules.push('risky-files');
        reasons.push(`Risky file patterns matched: ${riskyFiles.join(', ')}`);
    }
    if (confidence < policy.minConfidenceForTargeted) {
        triggeredRules.push('low-confidence');
    }
    if (impact.warnings.length >= policy.forceFullOnWarningsAtOrAbove) {
        triggeredRules.push('warning-threshold');
        reasons.push('Warning threshold exceeded.');
    }
    if (policy.forceFullOnP0WithGaps && hasP0 && gaps.length > 0) {
        triggeredRules.push('p0-with-gaps');
    }

    if (triggeredRules.length > 0) {
        return {
            runSet: 'full',
            reasons: reasons.length > 0 ? reasons : ['Policy rules triggered full suite.'],
            triggeredRules,
            riskyFiles,
        };
    }

    // If we have impacted features with specs, recommend targeted
    const coveredFeatures = impact.impactedFeatures.filter((f) => f.coverageStatus !== 'uncovered');
    if (coveredFeatures.length > 0) {
        return {
            runSet: 'targeted',
            reasons: reasons.length > 0 ? reasons : ['Impacted features have test coverage.'],
            triggeredRules,
            riskyFiles,
        };
    }

    return {
        runSet: 'smoke',
        reasons: reasons.length > 0 ? reasons : ['No targeted tests mapped from impacted features.'],
        triggeredRules,
        riskyFiles,
    };
}

function buildDecision(
    impact: ImpactResult,
    runSet: RecommendedRunSet,
    confidence: number,
    policy: PolicyConfig,
): DecisionSummary {
    const gaps = getGaps(impact);

    if (gaps.length > 0) {
        return {
            action: 'must-add-tests',
            title: 'Must add tests',
            summary: `Detected ${gaps.length} uncovered P0/P1 feature(s). Add or update tests before merge.`,
        };
    }

    if (impact.changedFiles.length === 0 && impact.impactedFeatures.length === 0) {
        return {
            action: 'safe-to-merge',
            title: 'Safe to merge',
            summary: 'No app file changes detected — no E2E coverage required for this change set.',
        };
    }

    if (runSet === 'smoke' && confidence >= policy.safeMergeMinConfidence && impact.warnings.length === 0) {
        return {
            action: 'safe-to-merge',
            title: 'Safe to merge',
            summary: 'No critical coverage gaps were detected and confidence is high.',
        };
    }

    const coveredCount = impact.impactedFeatures.filter((f) => f.coverageStatus !== 'uncovered').length;
    const coveredSuffix = coveredCount > 0
        ? ` All ${coveredCount} impacted feature(s) have test coverage.`
        : '';

    return {
        action: 'run-now',
        title: 'Run now',
        summary: `Impacted features are covered by existing tests.${coveredSuffix} Verify with the E2E suite before merge.`,
    };
}

function evaluateEnforcement(decision: DecisionSummary, policy: PolicyConfig): PlanReport['enforcement'] {
    const blockOnActions: CiAction[] = (policy.blockOnActions && policy.blockOnActions.length > 0)
        ? [...policy.blockOnActions]
        : ['must-add-tests'];
    const matchedAction = blockOnActions.includes(decision.action);

    if (policy.enforcementMode === 'block' && matchedAction) {
        return {
            mode: policy.enforcementMode,
            blockOnActions,
            matchedAction,
            shouldFail: true,
            summary: `Blocking mode active: decision "${decision.action}" is configured to fail CI.`,
        };
    }
    if (policy.enforcementMode === 'warn' && matchedAction) {
        return {
            mode: policy.enforcementMode,
            blockOnActions,
            matchedAction,
            shouldFail: false,
            summary: `Warning mode active: decision "${decision.action}" is advisory-only for CI.`,
        };
    }
    if (policy.enforcementMode === 'block') {
        return {
            mode: policy.enforcementMode,
            blockOnActions,
            matchedAction,
            shouldFail: false,
            summary: `Blocking mode active, but decision "${decision.action}" is not configured for CI failure.`,
        };
    }
    return {
        mode: policy.enforcementMode,
        blockOnActions,
        matchedAction,
        shouldFail: false,
        summary: 'Advisory mode active: recommendations do not fail CI by default.',
    };
}

/**
 * Build recommended test list from impacted features' Playwright specs.
 */
function buildRecommendedTests(impact: ImpactResult): string[] {
    const tests: string[] = [];
    for (const feature of impact.impactedFeatures) {
        if (feature.coverageStatus !== 'uncovered') {
            for (const spec of feature.playwrightSpecs) {
                if (!tests.includes(spec)) {
                    tests.push(spec);
                }
            }
        }
    }
    return tests;
}

export function buildPlanFromImpact(
    impact: ImpactResult,
    policyOverride?: Partial<PolicyConfig>,
    aiEnrichment?: AIEnrichmentResult,
): PlanReport {
    const policy: PolicyConfig = {...DEFAULT_POLICY, ...(policyOverride || {})};
    const confidence = computeConfidence(impact);
    const runSetResult = pickRunSet(impact, confidence, policy);
    const decision = buildDecision(impact, runSetResult.runSet, confidence, policy);
    const enforcement = evaluateEnforcement(decision, policy);

    const gaps = getGaps(impact);
    const partialGaps = getPartialGaps(impact);

    // Build two separate lookup maps from aiEnrichment: one by featureId, one by familyId.
    // The familyId map stores only the FIRST feature encountered to avoid last-write-wins collisions.
    const aiFeatureByFeatureId = new Map<string, AIEnrichmentResult['enrichedFeatures'][number]>();
    const aiFeatureByFamilyId = new Map<string, AIEnrichmentResult['enrichedFeatures'][number]>();
    if (aiEnrichment) {
        for (const ef of aiEnrichment.enrichedFeatures) {
            if (ef.featureId) {
                aiFeatureByFeatureId.set(ef.featureId, ef);
            }
            if (ef.familyId && !aiFeatureByFamilyId.has(ef.familyId)) {
                aiFeatureByFamilyId.set(ef.familyId, ef);
            }
        }
    }

    const gapDetails: GapDetail[] = gaps.map((f) => {
        const label = featureLabel(f);
        const aiFeature = f.featureId
            ? (aiFeatureByFeatureId.get(f.featureId) ?? aiFeatureByFamilyId.get(f.familyId))
            : aiFeatureByFamilyId.get(f.familyId);

        const baseReasons = [`No Playwright or Cypress tests found for ${label}`];
        const reasons = aiFeature && aiFeature.aiReasons.length > 0
            ? [...baseReasons, ...aiFeature.aiReasons]
            : baseReasons;

        const missingScenarios = aiFeature && aiFeature.aiMissingScenarios.length > 0
            ? aiFeature.aiMissingScenarios
            : (f.userFlows.length > 0 ? f.userFlows.slice(0, 5) : undefined);

        return {
            id: label,
            name: label,
            priority: f.priority,
            reasons,
            files: f.changedFiles.slice(0, 6),
            missingScenarios,
            source: aiFeature ? 'ai+deterministic' : 'deterministic',
        };
    });

    // Add partial gaps as advisory info
    for (const f of partialGaps) {
        const coverageType = f.playwrightSpecs.length > 0 ? 'Cypress' : 'Playwright';
        const hasOpposite = f.playwrightSpecs.length > 0 ? 'Playwright' : 'Cypress';
        const label = featureLabel(f);
        const aiFeature = f.featureId
            ? (aiFeatureByFeatureId.get(f.featureId) ?? aiFeatureByFamilyId.get(f.familyId))
            : aiFeatureByFamilyId.get(f.familyId);

        const baseReasons = [`Missing ${coverageType} tests for ${label} (has ${hasOpposite} only)`];
        const reasons = aiFeature && aiFeature.aiReasons.length > 0
            ? [...baseReasons, ...aiFeature.aiReasons]
            : baseReasons;

        gapDetails.push({
            id: label,
            name: `${label} (partial)`,
            priority: f.priority,
            reasons,
            files: f.changedFiles.slice(0, 6),
            source: aiFeature ? 'ai+deterministic' : 'deterministic',
        });
    }

    const coveredFlows: CoveredFlowSummary[] = impact.impactedFeatures
        .filter((f) => f.coverageStatus === 'covered')
        .map((f) => ({
            id: featureLabel(f),
            name: featureLabel(f),
            priority: f.priority,
            coveredBy: [
                ...(f.playwrightSpecs.length > 0 ? [`${f.playwrightSpecs.length} Playwright spec(s)`] : []),
                ...(f.cypressSpecs.length > 0 ? [`${f.cypressSpecs.length} Cypress spec(s)`] : []),
            ].slice(0, 3),
        }));

    const recommendedTests = buildRecommendedTests(impact);
    const requiredNewTests = gaps.map((f) => `${featureLabel(f)}: Add E2E tests`);

    const p0 = impact.impactedFeatures.filter((f) => f.priority === 'P0').length;
    const p1 = impact.impactedFeatures.filter((f) => f.priority === 'P1').length;
    const p2 = impact.impactedFeatures.filter((f) => f.priority === 'P2').length;

    const runId = `plan-${Date.now().toString(36)}`;
    const planSource = aiEnrichment ? 'ai+deterministic' : 'impact';

    return {
        schemaVersion: '1.0.0',
        runId,
        generatedAt: new Date().toISOString(),
        source: planSource,
        runSet: runSetResult.runSet,
        confidence,
        reasons: runSetResult.reasons,
        recommendedTests,
        requiredNewTests,
        gapDetails,
        coveredFlows,
        policy: {
            riskyFiles: runSetResult.riskyFiles,
            triggeredRules: runSetResult.triggeredRules,
            applied: policy,
        },
        decision,
        enforcement,
        metrics: {
            changedFiles: impact.changedFiles.length,
            impactedFlows: impact.impactedFeatures.length,
            p0Flows: p0,
            p1Flows: p1,
            p2Flows: p2,
            uncoveredP0P1Flows: gaps.length,
            warnings: impact.warnings.length,
        },
    };
}

export function writePlanReport(appRoot: string, plan: PlanReport): string {
    const baseDir = join(appRoot, '.e2e-ai-agents');
    mkdirSync(baseDir, {recursive: true});
    const planPath = join(baseDir, 'plan.json');
    writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf-8');
    return planPath;
}

export function renderCiSummaryMarkdown(plan: PlanReport): string {
    const lines: string[] = [];
    const {p0Flows, p1Flows, uncoveredP0P1Flows, changedFiles, impactedFlows} = plan.metrics;
    const mustAddTests = plan.decision.action === 'must-add-tests';

    const statusEmoji = mustAddTests ? '🔴' : plan.decision.action === 'safe-to-merge' ? '🟢' : '🟡';
    lines.push(`## ${statusEmoji} E2E Coverage: ${plan.decision.title}`);
    lines.push('');
    lines.push(`${plan.decision.summary}`);
    lines.push('');
    lines.push(
        `**${changedFiles}** files changed → **${impactedFlows}** features impacted` +
        (p0Flows > 0 || p1Flows > 0 ? ` (P0: ${p0Flows}, P1: ${p1Flows})` : ''),
    );

    if (mustAddTests && plan.requiredNewTests.length > 0) {
        lines.push('');
        lines.push('### ⚠️ Add E2E tests for these uncovered P0/P1 features');
        lines.push('');
        lines.push(`The following ${uncoveredP0P1Flows} feature(s) have no test coverage and must be covered before merge:`);
        lines.push('');
        for (const gap of plan.gapDetails.filter((g) => !g.name.includes('(partial)'))) {
            const aiLabel = gap.source === 'ai+deterministic' ? ' ✦ AI-enriched' : '';
            lines.push(`- **${gap.name}** [${gap.priority}]${aiLabel}`);
            if (gap.missingScenarios && gap.missingScenarios.length > 0) {
                for (const scenario of gap.missingScenarios) {
                    lines.push(`  - ${scenario}`);
                }
            }
            // Show AI-provided reasons (skip the first deterministic reason which is always included)
            const aiReasons = gap.reasons.slice(1);
            if (aiReasons.length > 0) {
                lines.push(`  - *AI insight*: ${aiReasons.join('; ')}`);
            }
        }
    }

    if (plan.coveredFlows.length > 0) {
        lines.push('');
        lines.push('### ✅ Covered features');
        lines.push('');
        for (const flow of plan.coveredFlows) {
            lines.push(`- **${flow.name}** [${flow.priority}] — ${flow.coveredBy.join(', ')}`);
        }
    }

    if (plan.confidence < 100) {
        lines.push('');
        lines.push(`**Confidence**: ${plan.confidence}%`);
    }

    return lines.join('\n');
}

export function writeCiSummary(appRoot: string, markdown: string, relativePath = '.e2e-ai-agents/ci-summary.md'): string {
    const fullPath = join(appRoot, relativePath);
    const dir = dirname(fullPath);
    mkdirSync(dir, {recursive: true});
    writeFileSync(fullPath, markdown, 'utf-8');
    return fullPath;
}
