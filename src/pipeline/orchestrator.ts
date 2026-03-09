// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, mkdirSync, writeFileSync} from 'fs';
import {join} from 'path';
import {getChangedFiles} from '../agent/git.js';
import {preprocess, type PreprocessConfig} from './stage0_preprocess.js';
import {runImpactStage, type ImpactConfig} from './stage1_impact.js';
import {runCoverageStage, type CoverageConfig} from './stage2_coverage.js';
import {runGenerationStage, type GenerationConfig, type GeneratedSpec} from './stage3_generation.js';
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
    stages?: Array<'preprocess' | 'impact' | 'coverage' | 'generation'>;
}

export interface PipelineResult {
    report: FlowDecisionReport;
    reportPath: string;
    warnings: string[];
    generated?: GeneratedSpec[];
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

function isTestFile(file: string): boolean {
    const normalized = file.replace(/\\/g, '/');
    return /\.(spec|test)\.(ts|tsx|js|jsx)$/.test(normalized) ||
           normalized.includes('__tests__/') ||
           normalized.includes('/tests/') ||
           normalized.includes('/test/');
}

export async function runPipeline(config: PipelineConfig): Promise<PipelineResult> {
    const runId = createRunId();
    const startedAt = new Date().toISOString();
    const allWarnings: string[] = [];
    const stages = config.stages || ['preprocess', 'impact', 'coverage'];
    let generatedSpecs: GeneratedSpec[] | undefined;

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

    // Step 2: Preprocess — deterministic file classification + route family binding
    const preprocessResult = preprocess(changedFiles, {
        appPath: config.appPath,
        testsRoot: config.testsRoot,
        routeFamilies: config.routeFamilies,
        apiSurface: config.apiSurface,
    });
    allWarnings.push(...preprocessResult.warnings);

    let decisions: FlowDecision[] = [];

    // Step 3: Impact stage — AI-powered flow identification per family
    if (stages.includes('impact')) {
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
        const coverageResult = await runCoverageStage(
            decisions,
            preprocessResult.specIndex,
            preprocessResult.context,
            config.testsRoot,
            config.coverage || {},
        );
        decisions = coverageResult.decisions;
        allWarnings.push(...coverageResult.warnings);
    }

    // Step 5: Generation stage — AI-powered spec generation for create_spec / add_scenarios
    if (stages.includes('generation') && decisions.length > 0) {
        const generationResult = await runGenerationStage(
            decisions,
            preprocessResult.apiSurface,
            config.testsRoot,
            config.generation || {},
        );
        generatedSpecs = generationResult.generated;
        allWarnings.push(...generationResult.warnings);
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

    const reportPath = writeReport(config.testsRoot, report);

    return {report, reportPath, warnings: allWarnings, generated: generatedSpecs};
}

function writeReport(testsRoot: string, report: FlowDecisionReport): string {
    const outputDir = join(testsRoot, '.e2e-ai-agents');
    if (!existsSync(outputDir)) {
        mkdirSync(outputDir, {recursive: true});
    }

    const jsonPath = join(outputDir, 'pipeline-report.json');
    writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');

    const mdPath = join(outputDir, 'pipeline-report.md');
    writeFileSync(mdPath, renderMarkdown(report), 'utf-8');

    return jsonPath;
}

function renderMarkdown(report: FlowDecisionReport): string {
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

    if (report.warnings.length > 0) {
        lines.push('## Warnings', '');
        for (const w of report.warnings) {
            lines.push(`- ${w}`);
        }
        lines.push('');
    }

    return lines.join('\n');
}
