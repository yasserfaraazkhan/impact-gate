// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {dirname, join} from 'path';
import {minimatch} from 'minimatch';
import type {ReportData} from './report.js';
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

export interface PlanReport {
    schemaVersion: '1.0.0';
    runId: string;
    sourceRunId?: string;
    generatedAt: string;
    source: 'impact';
    runSet: RecommendedRunSet;
    confidence: number;
    reasons: string[];
    recommendedTests: string[];
    requiredNewTests: string[];
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
        uncoveredP0P1Flows: number;
        warnings: number;
    };
}

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

function countPriority(flows: ReportData['flows']): {p0: number; p1: number; p2: number} {
    const counts = {p0: 0, p1: 0, p2: 0};
    for (const flow of flows) {
        if (flow.priority === 'P0') counts.p0 += 1;
        else if (flow.priority === 'P1') counts.p1 += 1;
        else counts.p2 += 1;
    }
    return counts;
}

function computeConfidence(impact: ReportData, p0: number, p1: number): number {
    let confidence = 85;
    confidence -= Math.min(25, impact.warnings.length * 8);
    confidence -= Math.min(20, impact.gaps.length * 5);
    if (p0 > 0) {
        confidence -= Math.min(10, p0 * 3);
    } else if (p1 > 0) {
        confidence -= Math.min(6, p1 * 2);
    }

    if (impact.impactModel) {
        if (impact.impactModel.flowMapping === 'catalog') {
            confidence += 4;
        } else if (impact.impactModel.flowMapping === 'ai') {
            confidence += 4;
        }
        if (impact.impactModel.testMapping === 'catalog') {
            confidence += 4;
        } else if (impact.impactModel.testMapping === 'traceability') {
            confidence += 6;
        } else if (impact.impactModel.testMapping === 'ai') {
            confidence += 4;
        }
        if (impact.impactModel.confidenceClass === 'medium') {
            confidence -= 4;
        } else if (impact.impactModel.confidenceClass === 'low') {
            confidence -= 12;
        }
        if (impact.impactModel.traceability) {
            if (!impact.impactModel.traceability.manifestFound) {
                confidence -= 6;
            } else if (impact.impactModel.traceability.coverageRatio >= 0.8) {
                confidence += 2;
            } else if (impact.impactModel.traceability.coverageRatio < 0.5) {
                confidence -= 4;
            }
        }
        if (impact.impactModel.dependencyGraph?.truncated) {
            confidence -= 6;
        }
        if (impact.impactModel.dependencyGraph && impact.impactModel.dependencyGraph.expandedFiles > 0) {
            confidence += 2;
        }
    }

    return Math.max(0, Math.min(100, confidence));
}

function findRiskyFiles(changedFiles: string[], patterns: string[]): string[] {
    const risky = changedFiles.filter((file) => patterns.some((pattern) => minimatch(file, pattern, {matchBase: true})));
    return [...new Set(risky)];
}

function pickRunSet(
    impact: ReportData,
    p0: number,
    confidence: number,
    policy: PolicyConfig,
): {runSet: RecommendedRunSet; reasons: string[]; triggeredRules: string[]; riskyFiles: string[]} {
    const reasons: string[] = [];
    const triggeredRules: string[] = [];
    const riskyFiles = findRiskyFiles(impact.changedFiles, policy.riskyFilePatterns);

    if (impact.warnings.length > 0) {
        reasons.push('Impact analysis emitted warnings; broader safety coverage is recommended.');
    }
    if (impact.gaps.length > 0) {
        reasons.push('Uncovered P0/P1 flows were detected.');
    }
    if (p0 > 0) {
        reasons.push('P0 flows are impacted by this change set.');
    }
    if (policy.forceFullOnRiskyFiles && riskyFiles.length > 0) {
        triggeredRules.push('risky-files');
        reasons.push(`Risky file patterns matched: ${riskyFiles.join(', ')}`);
    }
    if (impact.impactModel?.confidenceClass === 'low') {
        triggeredRules.push('low-traceability');
        reasons.push('Impact mapping confidence is low.');
    }
    if (impact.impactModel?.traceability?.manifestFound && impact.impactModel.traceability.coverageRatio < 0.4) {
        triggeredRules.push('traceability-low-coverage');
        reasons.push('Traceability manifest coverage is low for impacted flows; broader safety run is recommended.');
    }
    if (impact.impactModel?.dependencyGraph?.truncated) {
        triggeredRules.push('dependency-graph-truncated');
        reasons.push('Dependency graph expansion was truncated; broader safety run is recommended.');
    }
    if (confidence < policy.minConfidenceForTargeted) {
        triggeredRules.push('low-confidence');
    }
    if (impact.warnings.length >= policy.forceFullOnWarningsAtOrAbove) {
        triggeredRules.push('warning-threshold');
    }
    if (policy.forceFullOnP0WithGaps && p0 > 0 && impact.gaps.length > 0) {
        triggeredRules.push('p0-with-gaps');
    }

    if (triggeredRules.length > 0) {
        return {
            runSet: 'full',
            reasons: reasons.length > 0 ? reasons : ['Low confidence in targeted recommendation.'],
            triggeredRules,
            riskyFiles,
        };
    }
    if (impact.recommendedTests && impact.recommendedTests.length > 0) {
        return {
            runSet: 'targeted',
            reasons: reasons.length > 0 ? reasons : ['Sufficient confidence for targeted run list.'],
            triggeredRules,
            riskyFiles,
        };
    }
    return {
        runSet: 'smoke',
        reasons: reasons.length > 0 ? reasons : ['No targeted tests were mapped from the impacted flows.'],
        triggeredRules,
        riskyFiles,
    };
}

function buildDecision(
    runSet: RecommendedRunSet,
    confidence: number,
    impact: ReportData,
    policy: PolicyConfig,
): DecisionSummary {
    if (impact.gaps.length > 0) {
        return {
            action: 'must-add-tests',
            title: 'Must add tests',
            summary: `Detected ${impact.gaps.length} uncovered P0/P1 flow(s). Add or update tests before merge.`,
        };
    }
    if (runSet === 'smoke' && confidence >= policy.safeMergeMinConfidence && impact.warnings.length === 0) {
        return {
            action: 'safe-to-merge',
            title: 'Safe to merge',
            summary: 'No critical coverage gaps were detected and policy confidence is high.',
        };
    }
    return {
        action: 'run-now',
        title: 'Run now',
        summary: `Execute the ${runSet} suite for this change set.`,
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
    if (policy.enforcementMode === 'warn') {
        return {
            mode: policy.enforcementMode,
            blockOnActions,
            matchedAction,
            shouldFail: false,
            summary: `Warning mode active, but decision "${decision.action}" is not configured for warning.`,
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

export function refreshPlanEnforcement(plan: PlanReport): PlanReport {
    return {
        ...plan,
        enforcement: evaluateEnforcement(plan.decision, plan.policy.applied),
    };
}

export function buildPlanFromImpactReport(impact: ReportData, policyOverride?: Partial<PolicyConfig>): PlanReport {
    if (impact.mode !== 'impact') {
        throw new Error(`Plan generation requires impact report data, received mode=${impact.mode}`);
    }

    const policy: PolicyConfig = {...DEFAULT_POLICY, ...(policyOverride || {})};
    const {p0, p1, p2} = countPriority(impact.flows);
    const confidence = computeConfidence(impact, p0, p1);
    const runSet = pickRunSet(impact, p0, confidence, policy);
    const decision = buildDecision(runSet.runSet, confidence, impact, policy);
    const enforcement = evaluateEnforcement(decision, policy);

    const requiredNewTests = impact.gaps.map((flow) => `${flow.id}: ${flow.name}`);
    const sourceRunId = impact.runMetadata?.runId;
    const runId = `plan-${sourceRunId || Date.now().toString(36)}`;

    return {
        schemaVersion: '1.0.0',
        runId,
        sourceRunId,
        generatedAt: new Date().toISOString(),
        source: 'impact',
        runSet: runSet.runSet,
        confidence,
        reasons: runSet.reasons,
        recommendedTests: impact.recommendedTests || [],
        requiredNewTests,
        policy: {
            riskyFiles: runSet.riskyFiles,
            triggeredRules: runSet.triggeredRules,
            applied: policy,
        },
        decision,
        enforcement,
        metrics: {
            changedFiles: impact.changedFiles.length,
            impactedFlows: impact.flows.length,
            p0Flows: p0,
            p1Flows: p1,
            p2Flows: p2,
            uncoveredP0P1Flows: impact.gaps.length,
            warnings: impact.warnings.length,
        },
    };
}

export function attachDeveloperActions(
    plan: PlanReport,
    context: {appPath: string; testsRoot: string; sinceRef?: string},
): PlanReport {
    const safeSince = context.sinceRef ? ` --since "${context.sinceRef}"` : '';
    const runRecommendedTests = plan.recommendedTests.length > 0
        ? `node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('${context.testsRoot}/.e2e-ai-agents/plan.json','utf8')); const tests=p.recommendedTests.map((t)=>t.replace(/ \\(flags:.*\\)$/,'')); console.log(tests.join(' '));" | xargs npx playwright test`
        : undefined;

    return {
        ...plan,
        nextActions: {
            requiresUserApprovalForGeneration: true,
            runRecommendedTests,
            runSmokeSuite: 'npx playwright test --grep @smoke --project=chrome',
            runFullSuite: 'npx playwright test --project=chrome',
            approveAndGenerate: `npx e2e-ai-agents approve-and-generate --path "${context.appPath}" --tests-root "${context.testsRoot}" --pipeline --pipeline-mcp --pipeline-mcp-only${safeSince}`,
            generateMissingTests: `npx e2e-ai-agents approve-and-generate --path "${context.appPath}" --tests-root "${context.testsRoot}" --pipeline --pipeline-mcp --pipeline-mcp-only${safeSince}`,
            healGeneratedTests: `npx e2e-ai-agents approve-and-generate --path "${context.appPath}" --tests-root "${context.testsRoot}" --pipeline --pipeline-mcp --pipeline-mcp-only${safeSince}`,
            commitGeneratedTests: `npx e2e-ai-agents finalize-generated-tests --path "${context.appPath}" --tests-root "${context.testsRoot}" --commit-message "test(e2e): add generated coverage and healed specs"`,
            openPullRequest: `npx e2e-ai-agents finalize-generated-tests --path "${context.appPath}" --tests-root "${context.testsRoot}" --create-pr`,
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
    lines.push(`## E2E Agent Recommendation: ${plan.decision.title}`);
    lines.push('');
    lines.push(`- Action: \`${plan.decision.action}\``);
    lines.push(`- Run set: \`${plan.runSet}\``);
    lines.push(`- Confidence: \`${plan.confidence}\``);
    lines.push(`- Summary: ${plan.decision.summary}`);
    lines.push(`- Enforcement: mode=\`${plan.enforcement.mode}\`, shouldFail=\`${plan.enforcement.shouldFail}\``);
    lines.push(`- Enforcement detail: ${plan.enforcement.summary}`);

    if (plan.policy.triggeredRules.length > 0) {
        lines.push(`- Policy triggers: ${plan.policy.triggeredRules.join(', ')}`);
    }
    if (plan.policy.riskyFiles.length > 0) {
        lines.push(`- Risky files: ${plan.policy.riskyFiles.join(', ')}`);
    }

    if (plan.recommendedTests.length > 0) {
        lines.push('');
        lines.push('### Recommended Tests to Run');
        for (const test of plan.recommendedTests) {
            lines.push(`- ${test}`);
        }
    }

    if (plan.requiredNewTests.length > 0) {
        lines.push('');
        lines.push('### Required New Tests');
        for (const gap of plan.requiredNewTests) {
            lines.push(`- ${gap}`);
        }
    }

    if (plan.nextActions) {
        lines.push('');
        lines.push('### PR Actions');
        if (plan.nextActions.runRecommendedTests) {
            lines.push(`- Run recommended tests: \`${plan.nextActions.runRecommendedTests}\``);
        } else if (plan.nextActions.runSmokeSuite) {
            lines.push(`- Run smoke fallback: \`${plan.nextActions.runSmokeSuite}\``);
        }
        if (plan.nextActions.approveAndGenerate || plan.nextActions.generateMissingTests) {
            lines.push(`- Approve and generate missing tests: \`${plan.nextActions.approveAndGenerate || plan.nextActions.generateMissingTests}\``);
        }
        if (plan.nextActions.healGeneratedTests) {
            lines.push(`- Heal generated tests: \`${plan.nextActions.healGeneratedTests}\``);
        }
        if (plan.nextActions.commitGeneratedTests) {
            lines.push(`- Commit generated artifacts: \`${plan.nextActions.commitGeneratedTests}\``);
        }
        if (plan.nextActions.openPullRequest) {
            lines.push(`- Open PR with generated updates: \`${plan.nextActions.openPullRequest}\``);
        }
    }

    if (plan.insights?.qualityGates) {
        if (plan.insights.qualityGates.failed.length > 0) {
            lines.push('');
            lines.push('### Quality Gates Failed');
            for (const gate of plan.insights.qualityGates.failed) {
                lines.push(`- ${gate.name}${gate.details ? `: ${gate.details}` : ''}`);
            }
        }
        if (plan.insights.qualityGates.warnings.length > 0) {
            lines.push('');
            lines.push('### Quality Gate Warnings');
            for (const gate of plan.insights.qualityGates.warnings) {
                lines.push(`- ${gate.name}${gate.details ? `: ${gate.details}` : ''}`);
            }
        }
    }

    if (plan.insights?.flaky && plan.insights.flaky.highRiskRecommendedTests.length > 0) {
        lines.push('');
        lines.push('### Flaky Risk Alerts');
        for (const item of plan.insights.flaky.highRiskRecommendedTests) {
            const rate = item.flakeRate30d !== undefined ? item.flakeRate30d : item.flakeRate;
            const trend = item.trend ? `, trend=${item.trend}` : '';
            const subsystem = item.subsystem ? `, subsystem=${item.subsystem}` : '';
            const qstate = item.quarantineState && item.quarantineState !== 'none' ? `, quarantine=${item.quarantineState}` : '';
            lines.push(`- ${item.test} (flakeRate=${rate}${trend}${subsystem}${qstate})`);
        }
        if (plan.insights.flaky.ownerMentions && plan.insights.flaky.ownerMentions.length > 0) {
            lines.push(`- Notify owners: ${plan.insights.flaky.ownerMentions.join(', ')}`);
        }
    }

    if (plan.insights?.calibration) {
        lines.push('');
        lines.push('### Historical Calibration');
        lines.push(
            `- precision=${plan.insights.calibration.precision}, recall=${plan.insights.calibration.recall}, falseNegativeRate=${plan.insights.calibration.falseNegativeRate}`,
        );
    }

    return lines.join('\n');
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

export function writeCiSummary(appRoot: string, markdown: string, relativePath = '.e2e-ai-agents/ci-summary.md'): string {
    const fullPath = join(appRoot, relativePath);
    const dir = dirname(fullPath);
    mkdirSync(dir, {recursive: true});
    writeFileSync(fullPath, markdown, 'utf-8');
    return fullPath;
}
