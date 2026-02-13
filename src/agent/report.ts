// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {mkdirSync, writeFileSync} from 'fs';
import {join} from 'path';
import type {AgentConfig} from './config.js';
import type {FlowImpact} from './analysis.js';
import type {FlowCoverage} from './tests.js';
import type {DataTestIdSuggestion} from './selectors.js';
import type {GapTestSuggestion} from './gap_suggestions.js';
import {formatFlags} from './flags.js';

export interface ReportData {
    mode: 'impact' | 'gap';
    changedFiles: string[];
    flows: FlowImpact[];
    coverage: FlowCoverage[];
    gaps: FlowImpact[];
    dataTestIds: DataTestIdSuggestion[];
    testSuggestions?: GapTestSuggestion[];
    // Backward-compatible alias for integrations that read the older field name.
    suggestedNewTests?: GapTestSuggestion[];
    framework: string;
    testPatterns: string[];
    specPDF?: string;
    warnings: string[];
    flowCatalog?: string;
    recommendedTests?: string[];
    impactModel?: {
        schemaVersion: '1.0.0';
        flowMapping: 'catalog' | 'heuristic';
        testMapping: 'catalog' | 'traceability' | 'heuristic';
        confidenceClass: 'high' | 'medium' | 'low';
        traceability?: {
            source: 'manifest';
            enabled: boolean;
            manifestPath: string;
            manifestFound: boolean;
            manifestTests: number;
            manifestEdges: number;
            matchedFlows: number;
            totalFlows: number;
            matchedTests: number;
            coverageRatio: number;
        };
        dependencyGraph?: {
            source: 'static-dependency-graph';
            enabled: boolean;
            seedFiles: number;
            expandedFiles: number;
            analyzedFiles: number;
            analyzedEdges: number;
            maxDepth: number;
            truncated: boolean;
        };
        subsystemRisk?: {
            source: 'map';
            enabled: boolean;
            mapPath: string;
            mapFound: boolean;
            rulesLoaded: number;
            filesMatched: number;
            ruleMatches: number;
            boostedFlows: number;
        };
    };
    pipeline?: {
        runner: string;
        results: Array<{
            flowId: string;
            flowName: string;
            generatedDir: string;
            generateStatus: string;
            healStatus?: string;
            error?: string;
        }>;
        warnings: string[];
        mcp?: {
            requested: boolean;
            active: boolean;
            backend: string;
        };
    };
    applied?: {
        patchedFiles: string[];
        generatedTests: string[];
        skippedTests: string[];
    };
}

function formatFlow(flow: FlowImpact): string {
    const reasonText = flow.reasons.length > 0 ? flow.reasons.join('; ') : 'No specific reasons';
    const audienceText = flow.audience && flow.audience.length > 0 ? `\n  Audience: ${flow.audience.join(', ')}` : '';
    const flagsText = flow.flags && flow.flags.length > 0 ? `\n  Flags: ${formatFlags(flow.flags)}` : '';
    const blastText = flow.blastRadius ? `\n  Blast radius: ${flow.blastRadius.summary}` : '';
    return `- [${flow.priority}] ${flow.name} (${flow.id})\n  Score: ${flow.score}\n  Reasons: ${reasonText}\n  Files: ${flow.files.join(', ')}${audienceText}${flagsText}${blastText}`;
}

function formatGap(flow: FlowImpact): string {
    return `- [${flow.priority}] ${flow.name} (${flow.id})`;
}

function formatSuggestion(suggestion: DataTestIdSuggestion): string {
    return `- ${suggestion.file}:${suggestion.line} -> ${suggestion.testId}\n  ${suggestion.snippet}`;
}

function formatTestSuggestion(suggestion: GapTestSuggestion): string {
    const source = suggestion.sourceFiles.length > 0 ? suggestion.sourceFiles.join(', ') : 'N/A';
    return `- [${suggestion.priority}] ${suggestion.flowName} (${suggestion.flowId})\n  Path: ${suggestion.suggestedTestPath}\n  Source files: ${source}\n  Why: ${suggestion.rationale}`;
}

function flowCounts(flows: FlowImpact[]): {p0: number; p1: number; p2: number} {
    return flows.reduce(
        (acc, flow) => {
            if (flow.priority === 'P0') acc.p0 += 1;
            else if (flow.priority === 'P1') acc.p1 += 1;
            else acc.p2 += 1;
            return acc;
        },
        {p0: 0, p1: 0, p2: 0},
    );
}

export function writeReport(appRoot: string, config: AgentConfig, data: ReportData): {markdownPath: string; jsonPath: string} {
    const specsDir = join(appRoot, config.artifacts.specsDir);
    const baseDir = join(appRoot, '.e2e-ai-agents');

    if (config.artifacts.mode !== 'none') {
        mkdirSync(specsDir, {recursive: true});
    }
    mkdirSync(baseDir, {recursive: true});

    const counts = flowCounts(data.flows);

    const markdownLines: string[] = [];
    markdownLines.push(`# ${data.mode === 'impact' ? 'Impact Analysis' : 'Gap Analysis'} Report`);
    markdownLines.push('');
    markdownLines.push(`Framework: ${data.framework}`);
    markdownLines.push(`Test Patterns: ${data.testPatterns.join(', ') || 'None'}`);
    if (data.flowCatalog) {
        markdownLines.push(`Flow Catalog: ${data.flowCatalog}`);
    }
    if (data.impactModel) {
        markdownLines.push(
            `Impact Model: flow=${data.impactModel.flowMapping} test=${data.impactModel.testMapping} confidence=${data.impactModel.confidenceClass}`,
        );
        if (data.impactModel.traceability) {
            const traceability = data.impactModel.traceability;
            markdownLines.push(
                `Traceability: enabled=${traceability.enabled} manifestFound=${traceability.manifestFound} matchedFlows=${traceability.matchedFlows}/${traceability.totalFlows} matchedTests=${traceability.matchedTests} coverageRatio=${traceability.coverageRatio}`,
            );
        }
        if (data.impactModel.dependencyGraph) {
            const graph = data.impactModel.dependencyGraph;
            markdownLines.push(
                `Dependency Graph: enabled=${graph.enabled} seeds=${graph.seedFiles} expanded=${graph.expandedFiles} files=${graph.analyzedFiles} edges=${graph.analyzedEdges} depth=${graph.maxDepth}${graph.truncated ? ' (truncated)' : ''}`,
            );
        }
        if (data.impactModel.subsystemRisk) {
            const subsystemRisk = data.impactModel.subsystemRisk;
            markdownLines.push(
                `Subsystem Risk: enabled=${subsystemRisk.enabled} mapFound=${subsystemRisk.mapFound} rules=${subsystemRisk.rulesLoaded} filesMatched=${subsystemRisk.filesMatched} ruleMatches=${subsystemRisk.ruleMatches} boostedFlows=${subsystemRisk.boostedFlows}`,
            );
        }
    }
    markdownLines.push(`Changed Files: ${data.changedFiles.length}`);
    markdownLines.push(`Flows: P0=${counts.p0} P1=${counts.p1} P2=${counts.p2}`);
    if (data.specPDF) {
        markdownLines.push(`Spec PDF: ${data.specPDF}`);
    }
    if (data.warnings.length > 0) {
        markdownLines.push('');
        markdownLines.push('Warnings:');
        markdownLines.push(...data.warnings.map((warning) => `- ${warning}`));
    }

    if (data.flows.length > 0) {
        markdownLines.push('');
        markdownLines.push('Impacted Flows:');
        markdownLines.push(...data.flows.map(formatFlow));
    }

    if (data.gaps.length > 0) {
        markdownLines.push('');
        markdownLines.push('Coverage Gaps (P0/P1 without tests):');
        markdownLines.push(...data.gaps.map(formatGap));
    }

    if (data.recommendedTests && data.recommendedTests.length > 0) {
        markdownLines.push('');
        markdownLines.push('Recommended Tests to Run:');
        markdownLines.push(...data.recommendedTests.map((test) => `- ${test}`));
    }

    if (data.pipeline) {
        markdownLines.push('');
        markdownLines.push('Pipeline Results:');
        markdownLines.push(`- Runner: ${data.pipeline.runner}`);
        if (data.pipeline.mcp) {
            markdownLines.push(
                `- MCP: requested=${data.pipeline.mcp.requested} active=${data.pipeline.mcp.active} backend=${data.pipeline.mcp.backend}`,
            );
        }
        for (const result of data.pipeline.results) {
            const status = result.healStatus ? `${result.generateStatus}/${result.healStatus}` : result.generateStatus;
            markdownLines.push(`- ${result.flowId} (${result.flowName}): ${status} -> ${result.generatedDir}`);
            if (result.error) {
                markdownLines.push(`  Error: ${result.error}`);
            }
        }
        if (data.pipeline.warnings.length > 0) {
            markdownLines.push('Pipeline warnings:');
            markdownLines.push(...data.pipeline.warnings.map((warning) => `- ${warning}`));
        }
    }

    if (data.dataTestIds.length > 0) {
        markdownLines.push('');
        markdownLines.push('data-testid Suggestions:');
        markdownLines.push(...data.dataTestIds.map(formatSuggestion));
    }

    if (data.testSuggestions && data.testSuggestions.length > 0) {
        markdownLines.push('');
        markdownLines.push('Suggested New Tests (Actionable):');
        markdownLines.push(...data.testSuggestions.map(formatTestSuggestion));
    }

    if (data.applied) {
        markdownLines.push('');
        markdownLines.push('Applied Changes:');
        if (data.applied.patchedFiles.length > 0) {
            markdownLines.push(`- Patched files: ${data.applied.patchedFiles.join(', ')}`);
        }
        if (data.applied.generatedTests.length > 0) {
            markdownLines.push(`- Generated tests: ${data.applied.generatedTests.join(', ')}`);
        }
        if (data.applied.skippedTests.length > 0) {
            markdownLines.push(`- Skipped test files: ${data.applied.skippedTests.join(', ')}`);
        }
    }

    const markdownContent = markdownLines.join('\n');

    const reportName = data.mode === 'impact' ? 'impact-plan.md' : 'gap-report.md';
    const markdownPath = join(specsDir, reportName);
    if (config.artifacts.mode !== 'none') {
        writeFileSync(markdownPath, markdownContent, 'utf-8');
    }

    const jsonPath = join(baseDir, data.mode === 'impact' ? 'impact.json' : 'gap.json');
    const jsonData = data.mode === 'gap'
        ? {
            ...data,
            suggestedNewTests: data.suggestedNewTests || data.testSuggestions || [],
        }
        : data;
    writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf-8');

    return {markdownPath, jsonPath};
}
