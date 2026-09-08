// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {mkdirSync, writeFileSync} from 'fs';
import {dirname, join} from 'path';
import {minimatch} from 'minimatch';

import type {PolicyConfig} from '../agent/config.js';
import {inferSubsystemFromTestPath} from '../agent/test_path.js';
import type {ImpactResult, ImpactedFeature, PrTestFile} from './impact_engine.js';
import {getGaps, getGapsWithSuppressed, getPartialGaps} from './impact_engine.js';
import {bindFilesToFamilies, loadRouteFamilyManifest} from '../knowledge/route_families.js';
import type {AIEnrichmentResult} from './ai_enrichment.js';
import type {AdaptiveThresholds} from '../agent/feedback.js';

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

    if ((impact.unassessedFiles?.length ?? impact.unboundFiles.length) > 0) {
        triggeredRules.push('unassessed-files');
        reasons.push(`Unassessed changes require full suite: ${(impact.unassessedFiles ?? impact.unboundFiles).join(', ')}`);
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

/**
 * Check which gaps have matching PR-included E2E spec files by binding
 * spec files to families via the manifest. Returns familyIds that are covered.
 */
function matchPrSpecsToGaps(
    prTestFiles: PrTestFile[],
    gaps: ImpactedFeature[],
    testsRoot?: string,
): Set<string> {
    const coveredFamilies = new Set<string>();
    const prE2ESpecs = prTestFiles.filter((t) => t.type === 'playwright' || t.type === 'cypress');
    if (prE2ESpecs.length === 0 || !testsRoot) {
        return coveredFamilies;
    }

    // Try to bind PR spec files to families via the manifest
    const manifest = loadRouteFamilyManifest(testsRoot);
    if (manifest) {
        const specBindings = bindFilesToFamilies(prE2ESpecs.map((s) => s.file), manifest);
        for (const sb of specBindings) {
            for (const binding of sb.bindings) {
                coveredFamilies.add(binding.family);
            }
        }
    }

    // Fallback heuristic: if manifest binding didn't match (common for Cypress specs
    // in directories not mapped in the manifest), check path-based keyword overlap.
    if (coveredFamilies.size === 0) {
        const gapFamilyIds = new Set(gaps.map((g) => g.familyId));
        for (const spec of prE2ESpecs) {
            const specLower = spec.file.toLowerCase().replace(/[_\-/\\]/g, ' ');
            for (const familyId of gapFamilyIds) {
                // Check if the spec path contains the family name or related terms
                if (specLower.includes(familyId.toLowerCase())) {
                    coveredFamilies.add(familyId);
                }
            }
        }
    }

    return coveredFamilies;
}

function buildDecision(
    impact: ImpactResult,
    runSet: RecommendedRunSet,
    confidence: number,
    policy: PolicyConfig,
): DecisionSummary {
    if ((impact.unassessedFiles?.length ?? impact.unboundFiles.length) > 0) {
        return {action: 'run-now', title: 'Run full suite', summary: 'Unassessed changes remain. Coverage and release safety are unknown; run the full suite.'};
    }
    const gaps = getGapsWithSuppressed(impact).gaps;

    if (gaps.length > 0) {
        const prE2ESpecs = (impact.prIncludedTestFiles ?? [])
            .filter((t) => t.type === 'playwright' || t.type === 'cypress');

        if (prE2ESpecs.length > 0) {
            // Bind PR specs to families — only soften gaps that have matching specs
            const coveredFamilies = matchPrSpecsToGaps(
                impact.prIncludedTestFiles ?? [],
                gaps,
                /* testsRoot not available here — use heuristic only */
            );

            const uncoveredGaps = gaps.filter((g) => !coveredFamilies.has(g.familyId));

            if (uncoveredGaps.length === 0) {
                // ALL gaps have matching PR specs
                return {
                    action: 'run-now',
                    title: 'Run now',
                    summary: `Detected ${gaps.length} coverage gap(s), but the PR includes ${prE2ESpecs.length} E2E test file(s) covering them. Verify the new tests cover impacted flows.`,
                };
            }
            if (uncoveredGaps.length < gaps.length) {
                // SOME gaps covered by PR specs, others not
                return {
                    action: 'must-add-tests',
                    title: 'Must add tests',
                    summary: `Detected ${gaps.length} coverage gap(s). PR includes E2E tests for ${gaps.length - uncoveredGaps.length}, but ${uncoveredGaps.length} flow(s) still need coverage.`,
                };
            }
            // No gaps matched by PR specs — but PR still has E2E files.
            // Soften to run-now since the developer is actively writing tests.
            return {
                action: 'run-now',
                title: 'Run now',
                summary: `Detected ${gaps.length} coverage gap(s), but the PR includes ${prE2ESpecs.length} E2E test file(s). Verify the new tests cover impacted flows.`,
            };
        }

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

    // When files changed but no flows were mapped, be transparent about the gap
    if (impact.impactedFeatures.length === 0 && impact.changedFiles.length > 0) {
        const unboundNote = impact.unboundFiles.length > 0
            ? ` ${impact.unboundFiles.length} file(s) could not be mapped to any known flow — consider adding route-families bindings.`
            : '';
        return {
            action: 'run-now',
            title: 'Run now',
            summary: `Changed files could not be mapped to E2E flows — manual review recommended.${unboundNote} Verify with the E2E suite before merge.`,
        };
    }

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
 * When alwaysIncludeSubsystems is provided, specs from those subsystems are
 * included regardless of their coverage status (blind-spot protection).
 */
function buildRecommendedTests(impact: ImpactResult, alwaysIncludeSubsystems: string[] = []): string[] {
    const tests = new Set<string>();
    const alwaysSet = new Set(alwaysIncludeSubsystems);
    for (const feature of impact.impactedFeatures) {
        const shouldInclude = feature.coverageStatus !== 'uncovered' ||
            feature.playwrightSpecs.some((spec) => alwaysSet.has(inferSubsystemFromTestPath(spec)));
        if (shouldInclude) {
            for (const spec of feature.playwrightSpecs) {
                tests.add(spec);
            }
        }
    }
    return [...tests];
}

export function buildPlanFromImpact(
    impact: ImpactResult,
    policyOverride?: Partial<PolicyConfig>,
    aiEnrichment?: AIEnrichmentResult,
    adaptiveThresholds?: AdaptiveThresholds,
): PlanReport {
    const policy: PolicyConfig = {...DEFAULT_POLICY, ...(policyOverride || {})};

    if (impact.advisory) {
        const a = impact.advisory;
        const full = a.fullSuiteFallbackReasons.length > 0;
        const summary = full ? 'Unknown impact: recommend the existing full suite.' : a.diffStatus === 'empty' ? 'Valid empty diff; no changed-file selection. Keep the full suite during the pilot.' : 'Existing specs recommended from candidate mappings. Keep the full suite during the pilot.';
        return {
            schemaVersion: '1.0.0', runId: `advisory-${a.requestedBaseSha}-${a.baseSha}-${a.headSha}-${a.suite.id}-${a.changedFilesSha256.slice(0, 12)}-${a.configurationSha256.slice(0, 12)}`,
            generatedAt: new Date().toISOString(), source: 'impact', runSet: full ? 'full' : 'targeted', confidence: null, confidenceKind: 'unavailable',
            reasons: full ? a.fullSuiteFallbackReasons : [summary], recommendedTests: a.selectedSpecs,
            requiredNewTests: [], gapDetails: [], coveredFlows: [],
            policy: {riskyFiles: [], triggeredRules: full ? ['conservative-full-suite'] : [], applied: {...policy, enforcementMode: 'advisory'}},
            decision: {action: 'run-now', title: 'Advisory plan', summary},
            enforcement: {mode: 'advisory', blockOnActions: [], matchedAction: false, shouldFail: false, summary: 'Report completion only; no coverage pass or release assertion.'},
            metrics: {changedFiles: a.changedFiles.length, impactedFlows: 0, p0Flows: 0, p1Flows: 0, p2Flows: 0, uncoveredP0P1Flows: 0, unboundFiles: impact.unboundFiles.length, warnings: a.fullSuiteFallbackReasons.length},
            advisory: a,
        };
    }
    // Apply adaptive calibration overrides (if available and not explicitly overridden)
    if (adaptiveThresholds && policyOverride?.minConfidenceForTargeted === undefined) {
        policy.minConfidenceForTargeted = adaptiveThresholds.minConfidenceForTargeted;
    }
    if (adaptiveThresholds && policyOverride?.safeMergeMinConfidence === undefined) {
        policy.safeMergeMinConfidence = adaptiveThresholds.safeMergeMinConfidence;
    }
    // Apply alwaysIncludeSubsystems: force their tests into the recommended set
    const alwaysIncludeSubsystems = adaptiveThresholds?.alwaysIncludeSubsystems ?? [];

    const confidence = computeConfidence(impact);
    const runSetResult = pickRunSet(impact, confidence, policy);
    const decision = buildDecision(impact, runSetResult.runSet, confidence, policy);
    const enforcement = evaluateEnforcement(decision, policy);

    const {gaps, suppressedGaps} = getGapsWithSuppressed(impact);
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

        const baseReasons = [`No E2E tests found for ${label}`];
        let aiReasonsList: string[] = [];
        if (aiFeature) {
            if (aiFeature.aiReasons.length > 0) {
                aiReasonsList = aiFeature.aiReasons.slice(0, 2);
            } else {
                // Fallback: LLM returned scenarios but no reasons — synthesize a description
                const fileHint = f.changedFiles.slice(0, 3).map((p) => p.split('/').pop()).join(', ');
                aiReasonsList = [`Changes to ${fileHint} affect the ${label} feature, which currently lacks E2E coverage.`];
            }
        }
        const reasons = aiReasonsList.length > 0
            ? [...baseReasons, ...aiReasonsList]
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

    // Add partial gaps as advisory info (Cypress-only coverage — Playwright migration recommended)
    for (const f of partialGaps) {
        const label = featureLabel(f);
        const aiFeature = f.featureId
            ? (aiFeatureByFeatureId.get(f.featureId) ?? aiFeatureByFamilyId.get(f.familyId))
            : aiFeatureByFamilyId.get(f.familyId);

        const baseReasons = [`${label} is covered by Cypress only — consider adding Playwright tests`];
        let partialAiReasons: string[] = [];
        if (aiFeature) {
            if (aiFeature.aiReasons.length > 0) {
                partialAiReasons = aiFeature.aiReasons.slice(0, 2);
            } else {
                const fileHint = f.changedFiles.slice(0, 3).map((p) => p.split('/').pop()).join(', ');
                partialAiReasons = [`Changes to ${fileHint} affect the ${label} feature, which has Cypress but no Playwright coverage.`];
            }
        }
        const reasons = partialAiReasons.length > 0
            ? [...baseReasons, ...partialAiReasons]
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
        .map((f) => {
            const aiFeature = f.featureId
                ? (aiFeatureByFeatureId.get(f.featureId) ?? aiFeatureByFamilyId.get(f.familyId))
                : aiFeatureByFamilyId.get(f.familyId);
            // Only surface advisory scenarios when AI found new behavior in this diff
            let advisoryScenarios = aiFeature?.aiMissingScenarios?.length
                ? [...aiFeature.aiMissingScenarios]
                : undefined;

            // Promote suppressed gaps to advisory on covered flows that share changed files.
            // When a family-level gap is suppressed (e.g. "post" because post.go is also in
            // a covered feature like "channels/threads"), the behavioral change should appear
            // here as "new behavior detected" instead of vanishing.
            for (const sg of suppressedGaps) {
                const sharedFiles = sg.changedFiles.filter((file) => f.changedFiles.includes(file));
                if (sharedFiles.length > 0) {
                    const sgAi = sg.featureId
                        ? (aiFeatureByFeatureId.get(sg.featureId) ?? aiFeatureByFamilyId.get(sg.familyId))
                        : aiFeatureByFamilyId.get(sg.familyId);
                    const sgScenarios = sgAi?.aiMissingScenarios?.length
                        ? sgAi.aiMissingScenarios
                        : sg.userFlows.slice(0, 3);
                    if (sgScenarios.length > 0) {
                        advisoryScenarios = [...(advisoryScenarios || []), ...sgScenarios];
                    }
                }
            }

            return {
                id: featureLabel(f),
                name: featureLabel(f),
                priority: f.priority,
                coveredBy: [
                    ...(f.playwrightSpecs.length > 0 ? [`${f.playwrightSpecs.length} Playwright spec(s)`] : []),
                    ...(f.cypressSpecs.length > 0 ? [`${f.cypressSpecs.length} Cypress spec(s)`] : []),
                ].slice(0, 3),
                advisoryScenarios,
            };
        });

    const recommendedTests = buildRecommendedTests(impact, alwaysIncludeSubsystems);
    const requiredNewTests = gaps.map((f) => `${featureLabel(f)}: Add E2E tests`);

    const p0 = impact.impactedFeatures.filter((f) => f.priority === 'P0').length;
    const p1 = impact.impactedFeatures.filter((f) => f.priority === 'P1').length;
    const p2 = impact.impactedFeatures.filter((f) => f.priority === 'P2').length;
    const coveredCount = impact.impactedFeatures.filter((f) => f.coverageStatus === 'covered').length;
    const partialCount = impact.impactedFeatures.filter((f) => f.coverageStatus === 'partial').length;

    const runId = `plan-${Date.now().toString(36)}`;
    const planSource = aiEnrichment ? 'ai+deterministic' : 'impact';

    return {
        schemaVersion: '1.0.0',
        runId,
        generatedAt: new Date().toISOString(),
        source: planSource,
        runSet: runSetResult.runSet,
        confidence,
        confidenceKind: 'heuristic',
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
            coveredFlows: coveredCount,
            partialFlows: partialCount,
            uncoveredP0P1Flows: gaps.length,
            unboundFiles: impact.unboundFiles.length,
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
    if (plan.advisory) return `${plan.decision.summary}\n\n${plan.enforcement.summary}\n`;
    const lines: string[] = [];
    const {uncoveredP0P1Flows, changedFiles, impactedFlows, coveredFlows: coveredCount, partialFlows: partialCount, unboundFiles: unboundCount} = plan.metrics;
    const mustAddTests = plan.decision.action === 'must-add-tests';
    const hasGapsButPrHasSpecs = !mustAddTests && plan.gapDetails.filter((g) => !g.name.includes('(partial)')).length > 0;

    const flowsWithAdvisory = plan.coveredFlows.filter((f) => f.advisoryScenarios && f.advisoryScenarios.length > 0);
    const cleanFlows = plan.coveredFlows.filter((f) => !f.advisoryScenarios || f.advisoryScenarios.length === 0);

    const statusEmoji = mustAddTests ? '🔴' : plan.decision.action === 'safe-to-merge' ? '🟢' : '🟡';
    lines.push(`## ${statusEmoji} E2E Coverage: ${plan.decision.title}`);
    lines.push('');
    lines.push(`${plan.decision.summary}`);
    lines.push('');

    // Coverage breakdown: "3 covered · 2 new · 1 gap · 1 partial"
    const parts: string[] = [];
    if ((coveredCount ?? 0) > 0) {
        parts.push(`${coveredCount} covered`);
    }
    if (flowsWithAdvisory.length > 0) {
        parts.push(`${flowsWithAdvisory.length} new behavior`);
    }
    if (uncoveredP0P1Flows > 0) {
        parts.push(`${uncoveredP0P1Flows} gap${uncoveredP0P1Flows !== 1 ? 's' : ''}`);
    }
    if ((partialCount ?? 0) > 0) {
        parts.push(`${partialCount} partial`);
    }
    const breakdown = parts.length > 0 ? ` (${parts.join(' · ')})` : '';
    lines.push(
        `**${changedFiles}** files changed → **${impactedFlows}** features impacted${breakdown}`,
    );

    // ── Blocking gaps ──────────────────────────────────────────────────────────
    if (mustAddTests && plan.requiredNewTests.length > 0) {
        lines.push('');
        lines.push(`### ⚠️ Missing coverage for ${uncoveredP0P1Flows} P0/P1 flow(s)`);
        lines.push('');
        for (const gap of plan.gapDetails.filter((g) => !g.name.includes('(partial)'))) {
            const aiLabel = gap.source === 'ai+deterministic' ? ' ✦ AI-enriched' : '';
            // Warning box: name + priority + AI reason (always visible)
            lines.push(`> [!WARNING]`);
            lines.push(`> **${gap.name}** · ${gap.priority}${aiLabel}`);
            const aiReasons = gap.reasons.slice(1);
            if (aiReasons.length > 0) {
                lines.push(`> ${aiReasons.join(' ')}`);
            }
            lines.push('');
            // Scenarios: collapsible below the warning box
            if (gap.missingScenarios && gap.missingScenarios.length > 0) {
                lines.push(`<details><summary>📋 Suggested test scenarios (${gap.missingScenarios.length})</summary>`);
                lines.push('');
                for (const scenario of gap.missingScenarios) {
                    lines.push(`- [ ] ${scenario}`);
                }
                lines.push('');
                lines.push('</details>');
                lines.push('');
            }
        }
    }

    // ── Informational gaps (PR includes E2E specs) ─────────────────────────────
    if (hasGapsButPrHasSpecs) {
        const infoGaps = plan.gapDetails.filter((g) => !g.name.includes('(partial)'));
        lines.push('');
        lines.push(`### ℹ️ Coverage gaps detected (PR includes E2E tests)`);
        lines.push('');
        lines.push('> The PR adds E2E test files. Verify they cover these flows:');
        lines.push('');
        for (const gap of infoGaps) {
            const aiLabel = gap.source === 'ai+deterministic' ? ' ✦ AI-enriched' : '';
            lines.push(`- **${gap.name}** · ${gap.priority}${aiLabel}`);
            const aiReasons = gap.reasons.slice(1);
            if (aiReasons.length > 0) {
                lines.push(`  ${aiReasons.join(' ')}`);
            }
        }
        lines.push('');
    }

    // ── Advisory: covered flows with new behavior ─────────────────────────────
    if (flowsWithAdvisory.length > 0) {
        lines.push('');
        lines.push(`### 💡 New behavior detected in ${flowsWithAdvisory.length} covered feature${flowsWithAdvisory.length !== 1 ? 's' : ''} — consider adding tests`);
        lines.push('');
        for (const flow of flowsWithAdvisory) {
            const specParts: string[] = [];
            for (const s of flow.coveredBy) {
                // Strip "N Playwright spec(s)" → "N PW" and "N Cypress spec(s)" → "N Cy"
                specParts.push(s.replace(/ Playwright spec\(s\)/, ' PW').replace(/ Cypress spec\(s\)/, ' Cy'));
            }
            const specSummary = specParts.length > 0 ? ` — ${specParts.join(' · ')}` : '';
            const scenarioCount = flow.advisoryScenarios!.length;
            lines.push(`<details><summary>💡 <strong>${flow.name}</strong> · ${flow.priority}${specSummary} · ${scenarioCount} scenario${scenarioCount !== 1 ? 's' : ''}</summary>`);
            lines.push('');
            for (const s of flow.advisoryScenarios!) {
                lines.push(`- [ ] ${s}`);
            }
            lines.push('');
            lines.push('</details>');
            lines.push('');
        }
    }

    // ── Clean covered flows (collapsed) ───────────────────────────────────────
    if (cleanFlows.length > 0) {
        lines.push('');
        lines.push(`<details><summary>✅ Covered flows (${cleanFlows.length})</summary>`);
        lines.push('');
        for (const flow of cleanFlows) {
            lines.push(`- **${flow.name}** [${flow.priority}] — ${flow.coveredBy.join(', ')}`);
        }
        lines.push('');
        lines.push('</details>');
    }

    // ── Risky files detected ──────────────────────────────────────────────────
    if (plan.policy.riskyFiles.length > 0) {
        lines.push('');
        lines.push(`### ⚠️ Risky file patterns matched`);
        lines.push('');
        for (const f of plan.policy.riskyFiles) {
            lines.push(`- \`${f}\``);
        }
    }

    // ── Unbound files warning ────────────────────────────────────────────────
    if ((unboundCount ?? 0) > 0) {
        lines.push('');
        lines.push(`> **${unboundCount}** changed file(s) could not be mapped to any E2E flow. Consider updating \`route-families.json\` to cover these files.`);
    }

    if (plan.confidence !== null && plan.confidence < 100) {
        lines.push('');
        lines.push(`**Heuristic confidence score**: ${plan.confidence}%`);
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
