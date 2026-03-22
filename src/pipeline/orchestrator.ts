// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, mkdirSync, writeFileSync} from 'fs';
import {join} from 'path';
import {getChangedFiles, isTestFile} from '../agent/git.js';
import {logger} from '../logger.js';
import {preprocess, type PreprocessConfig} from './stage0_preprocess.js';
import {runImpactStage, type ImpactConfig} from './stage1_impact.js';
import {runCoverageStage, type CoverageConfig} from './stage2_coverage.js';
import {runGenerationStage, type GenerationConfig, type GeneratedSpec} from './stage3_generation.js';
import {runHealStage, resolveHealTargets, renderHealMarkdown, type HealConfig, type HealResult} from './stage4_heal.js';
import {buildSummary, type FlowDecisionReport, type FlowDecision} from '../validation/output_schema.js';
import {computeCannotDetermineRatio} from '../validation/guardrails.js';
import type {RouteFamilyConfig} from '../knowledge/route_families.js';
import type {ApiSurfaceConfig} from '../knowledge/api_surface.js';

export interface PipelineConfig {
    appPath: string;
    testsRoot: string;
    gitSince: string;
    gitIncludeUncommitted?: boolean;
    routeFamilies?: RouteFamilyConfig;
    apiSurface?: ApiSurfaceConfig;
    impact?: ImpactConfig;
    coverage?: CoverageConfig;
    generation?: GenerationConfig;
    heal?: HealConfig;
    /** Path to a Playwright JSON report for heal-from-report mode */
    playwrightReportPath?: string;
    stages?: Array<'preprocess' | 'impact' | 'coverage' | 'generation' | 'heal'>;
}

export interface PipelineResult {
    report: FlowDecisionReport;
    reportPath: string;
    warnings: string[];
    generated?: GeneratedSpec[];
    healResult?: HealResult;
}

function createRunId(): string {
    const ciRunId = process.env.GITHUB_RUN_ID;
    const entropy = Math.random().toString(36).slice(2, 8);
    const ts = Date.now().toString(36);
    if (ciRunId) {
        return `pipeline-gh-${ciRunId}-${ts}-${entropy}`;
    }
    return `pipeline-local-${ts}-${entropy}`;
}

export async function runPipeline(config: PipelineConfig): Promise<PipelineResult> {
    const runId = createRunId();
    const startedAt = new Date().toISOString();
    const allWarnings: string[] = [];
    const stages = config.stages || ['preprocess', 'impact', 'coverage'];
    let generatedSpecs: GeneratedSpec[] | undefined;
    let healResult: HealResult | undefined;

    // Step 1: Get changed files
    const gitResult = getChangedFiles(config.appPath, config.gitSince, {
        includeUncommitted: config.gitIncludeUncommitted,
    });
    if (gitResult.error) {
        allWarnings.push(`Git diff warning: ${gitResult.error}`);
    }
    const changedFiles = gitResult.files
        .map((f) => f.replace(/\\/g, '/'))
        .filter((f) => !isTestFile(f));

    if (changedFiles.length === 0) {
        allWarnings.push('No changed application files detected.');
        const emptyReport: FlowDecisionReport = {
            runId,
            timestamp: startedAt,
            gitRef: config.gitSince,
            summary: buildSummary([]),
            decisions: [],
            warnings: allWarnings,
            model: {},
        };
        const reportPath = writeReport(config.testsRoot, emptyReport);
        return {report: emptyReport, reportPath, warnings: allWarnings};
    }

    const timings: Record<string, number> = {};

    // Step 2: Preprocess — deterministic file classification + route family binding
    const preprocessTimer = logger.timer('preprocess');
    const preprocessResult = preprocess(changedFiles, {
        appPath: config.appPath,
        testsRoot: config.testsRoot,
        routeFamilies: config.routeFamilies,
        apiSurface: config.apiSurface,
    });
    timings.preprocess = preprocessTimer.end();
    allWarnings.push(...preprocessResult.warnings);

    let decisions: FlowDecision[] = [];

    // Step 3: Impact stage — AI-powered flow identification per family
    if (stages.includes('impact')) {
        const impactTimer = logger.timer('impact');
        const impactResult = await runImpactStage(
            preprocessResult.familyGroups,
            preprocessResult.manifest,
            preprocessResult.specIndex,
            preprocessResult.apiSurface,
            preprocessResult.context,
            config.impact || {},
        );
        decisions = impactResult.decisions;
        allWarnings.push(...impactResult.warnings);

        timings.impact = impactTimer.end();

        // Check cannot_determine ratio
        const cannotDetermineRatio = computeCannotDetermineRatio(decisions);
        if (cannotDetermineRatio > 0.3) {
            allWarnings.push(
                `High cannot_determine ratio (${(cannotDetermineRatio * 100).toFixed(0)}%). Consider updating route-families.json or running with MCP exploration.`,
            );
        }
    }

    // Step 4: Coverage stage — AI-powered spec coverage evaluation
    if (stages.includes('coverage') && decisions.length > 0) {
        const coverageTimer = logger.timer('coverage');
        const coverageResult = await runCoverageStage(
            decisions,
            preprocessResult.specIndex,
            preprocessResult.context,
            config.testsRoot,
            config.coverage || {},
        );
        decisions = coverageResult.decisions;
        timings.coverage = coverageTimer.end();
        allWarnings.push(...coverageResult.warnings);
    }

    // Step 5: Generation stage — AI-powered spec generation for create_spec / add_scenarios
    if (stages.includes('generation') && decisions.length > 0) {
        const generationTimer = logger.timer('generation');
        const generationResult = await runGenerationStage(
            decisions,
            preprocessResult.apiSurface,
            config.testsRoot,
            config.generation || {},
        );
        generatedSpecs = generationResult.generated;
        timings.generation = generationTimer.end();
        allWarnings.push(...generationResult.warnings);
    }

    // Step 6: Heal stage — MCP-backed playwright-test-healer for failing/flaky specs
    if (stages.includes('heal')) {
        const healTimer = logger.timer('heal');
        const healTargets = resolveHealTargets(
            config.testsRoot,
            {
                playwrightReportPath: config.playwrightReportPath,
                generatedSpecs,
            },
            decisions,
        );
        if (healTargets.length > 0) {
            healResult = await runHealStage(config.testsRoot, healTargets, config.heal || {mcp: true});
            allWarnings.push(...healResult.warnings);
        } else {
            allWarnings.push('Heal stage: no targets found (no failing specs in report, no generated specs).');
        }
        timings.heal = healTimer.end();
    }

    // Build report
    const report: FlowDecisionReport = {
        runId,
        timestamp: startedAt,
        gitRef: config.gitSince,
        summary: buildSummary(decisions),
        decisions,
        warnings: allWarnings,
        model: {
            impactAgent: config.impact?.provider || 'auto',
            coverageAgent: config.coverage?.provider || 'auto',
            generationAgent: stages.includes('generation') ? (config.generation?.provider || 'auto') : undefined,
        },
    };

    const reportPath = writeReport(config.testsRoot, report, healResult, timings);

    return {report, reportPath, warnings: allWarnings, generated: generatedSpecs, healResult};
}

function writeReport(testsRoot: string, report: FlowDecisionReport, healResult?: HealResult, timings?: Record<string, number>): string {
    const outputDir = join(testsRoot, '.e2e-ai-agents');
    if (!existsSync(outputDir)) {
        mkdirSync(outputDir, {recursive: true});
    }

    // Include timings in the JSON report if available
    const reportWithTimings = timings ? {...report, timings} : report;
    const jsonPath = join(outputDir, 'pipeline-report.json');
    writeFileSync(jsonPath, JSON.stringify(reportWithTimings, null, 2), 'utf-8');

    const mdPath = join(outputDir, 'pipeline-report.md');
    writeFileSync(mdPath, renderMarkdown(report, healResult), 'utf-8');

    return jsonPath;
}

function renderMarkdown(report: FlowDecisionReport, healResult?: HealResult): string {
    const lines: string[] = [
        `# Impact Analysis Pipeline Report`,
        '',
        `**Run ID:** ${report.runId}`,
        `**Timestamp:** ${report.timestamp}`,
        `**Git Ref:** ${report.gitRef}`,
        '',
        `## Summary`,
        '',
        `| Metric | Value |`,
        `|--------|-------|`,
        `| Changed Files | ${report.summary.changedFiles} |`,
        `| Route Families Impacted | ${report.summary.routeFamiliesImpacted.join(', ') || 'none'} |`,
        `| Flows Identified | ${report.summary.flowsIdentified} |`,
        `| Covered | ${report.summary.flowsCovered} |`,
        `| Partial | ${report.summary.flowsPartial} |`,
        `| Uncovered | ${report.summary.flowsUncovered} |`,
        `| Cannot Determine | ${report.summary.actionsRequired.cannot_determine} |`,
        `| Overall Confidence | ${report.summary.overallConfidence} |`,
        '',
    ];

    if (report.decisions.length > 0) {
        lines.push('## Decisions', '');
        for (const d of report.decisions) {
            lines.push(`### ${d.flowName} (${d.priority})`);
            lines.push('');
            lines.push(`- **Action:** ${d.action}`);
            lines.push(`- **Route Family:** ${d.routeFamily}${d.featureId ? ` / ${d.featureId}` : ''}`);
            if (d.specificRoute) {
                lines.push(`- **Route:** ${d.specificRoute}`);
            }
            lines.push(`- **Confidence:** ${d.confidence}%`);
            lines.push(`- **Evidence:** ${d.evidence}`);
            lines.push(`- **Changed Files:** ${d.changedFiles.join(', ')}`);
            if (d.userActions.length > 0) {
                lines.push(`- **User Actions:** ${d.userActions.join('; ')}`);
            }
            if (d.existingSpecs.length > 0) {
                lines.push('- **Existing Coverage:**');
                for (const spec of d.existingSpecs) {
                    lines.push(`  - ${spec.path} (${spec.coverageLevel})`);
                    if (spec.testTitles.length > 0) {
                        for (const title of spec.testTitles) {
                            lines.push(`    - \`${title}\``);
                        }
                    }
                    if (spec.missingScenarios && spec.missingScenarios.length > 0) {
                        lines.push('    - Missing:');
                        for (const scenario of spec.missingScenarios) {
                            lines.push(`      - ${scenario}`);
                        }
                    }
                }
            }
            if (d.scenariosToAdd && d.scenariosToAdd.length > 0) {
                lines.push('- **Scenarios to Add:**');
                for (const s of d.scenariosToAdd) {
                    lines.push(`  - ${s}`);
                }
            }
            if (d.targetSpec) {
                lines.push(`- **Target Spec:** ${d.targetSpec}`);
            }
            if (d.newSpecPath) {
                lines.push(`- **New Spec Path:** ${d.newSpecPath}`);
            }
            if (d.blockingReason) {
                lines.push(`- **Blocking Reason:** ${d.blockingReason}`);
            }
            lines.push('');
        }
    }

    if (healResult) {
        lines.push('');
        lines.push(renderHealMarkdown(healResult));
    }

    if (report.warnings.length > 0) {
        lines.push('## Warnings', '');
        for (const w of report.warnings) {
            lines.push(`- ${w}`);
        }
        lines.push('');
    }

    return lines.join('\n');
}
