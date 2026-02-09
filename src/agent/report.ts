// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {mkdirSync, writeFileSync} from 'fs';
import {join} from 'path';
import type {AgentConfig} from './config.js';
import type {FlowImpact} from './analysis.js';
import type {FlowCoverage} from './tests.js';
import type {DataTestIdSuggestion} from './selectors.js';
import {formatFlags} from './flags.js';

export interface ReportData {
    mode: 'impact' | 'gap';
    changedFiles: string[];
    flows: FlowImpact[];
    coverage: FlowCoverage[];
    gaps: FlowImpact[];
    dataTestIds: DataTestIdSuggestion[];
    framework: string;
    testPatterns: string[];
    specPDF?: string;
    warnings: string[];
    flowCatalog?: string;
    recommendedTests?: string[];
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
    writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');

    return {markdownPath, jsonPath};
}
