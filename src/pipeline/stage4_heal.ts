// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync} from 'fs';
import {join, resolve} from 'path';
import {runTargetedSpecHeal} from '../agent/pipeline.js';
import type {SpecHealTarget, PipelineSummary} from '../agent/pipeline.js';
import {extractPlaywrightUnstableSpecs} from '../agent/playwright_report.js';
import type {FlowDecision, FlowDecisionReport} from '../validation/output_schema.js';
import type {GeneratedSpec} from './stage3_generation.js';

export interface HealConfig {
    /** Enable MCP-backed heal via playwright-test-healer agent */
    mcp?: boolean;
    mcpAllowFallback?: boolean;
    mcpOnly?: boolean;
    mcpCommandTimeoutMs?: number;
    mcpRetries?: number;
    dryRun?: boolean;
    /** Output directory for healed/re-generated specs */
    outputDir?: string;
}

export interface HealTarget {
    specPath: string;
    status: 'failed' | 'flaky';
    /** Matching FlowDecision for context-enriched prompts */
    decision?: FlowDecision;
    reason?: string;
}

export interface HealResult {
    targets: HealTarget[];
    summary: PipelineSummary;
    warnings: string[];
}

/**
 * Resolve heal targets from one or more sources, in priority order:
 * 1. Playwright JSON report (CI failures/flakes)
 * 2. Stage 3 generated specs (newly written files that need runtime validation)
 * 3. Explicit target list
 */
export function resolveHealTargets(
    testsRoot: string,
    options: {
        playwrightReportPath?: string;
        generatedSpecs?: GeneratedSpec[];
        explicitTargets?: Array<{specPath: string; status: 'failed' | 'flaky'; reason?: string}>;
    },
    decisions: FlowDecision[],
): HealTarget[] {
    const targets: HealTarget[] = [];
    const seen = new Set<string>();

    const addTarget = (specPath: string, status: 'failed' | 'flaky', reason?: string) => {
        // Normalize to absolute path so relative (from Playwright report) and absolute
        // (from generated specs) deduplicate correctly
        let normalized = specPath.replace(/\\/g, '/');
        if (!specPath.startsWith('/') && !(/^[A-Za-z]:[\\/]/).test(specPath)) {
            normalized = join(testsRoot, specPath).replace(/\\/g, '/');
        }
        if (seen.has(normalized)) {
            return;
        }
        seen.add(normalized);

        // Try to match to a FlowDecision for context
        const decision = findDecisionForSpec(normalized, decisions, testsRoot);
        targets.push({specPath: normalized, status, decision, reason});
    };

    // Source 1: Playwright JSON report
    if (options.playwrightReportPath) {
        const reportPath = resolve(options.playwrightReportPath);
        if (existsSync(reportPath)) {
            const unstable = extractPlaywrightUnstableSpecs(reportPath, [testsRoot]);
            for (const spec of unstable) {
                addTarget(
                    spec.specPath,
                    spec.status,
                    `Playwright report: failingTests=${spec.failingTests}, flakyTests=${spec.flakyTests}`,
                );
            }
        }
    }

    // Source 2: Stage 3 generated specs (heal immediately after generation)
    if (options.generatedSpecs) {
        for (const gen of options.generatedSpecs) {
            if (gen.written) {
                addTarget(gen.specPath, 'failed', `Newly generated spec — needs runtime validation`);
            }
        }
    }

    // Source 3: Explicit targets
    if (options.explicitTargets) {
        for (const t of options.explicitTargets) {
            addTarget(t.specPath, t.status, t.reason);
        }
    }

    return targets;
}

/**
 * Find the FlowDecision most relevant to a given spec path by matching
 * targetSpec / newSpecPath / specPath suffix against decisions.
 */
function findDecisionForSpec(
    specPath: string,
    decisions: FlowDecision[],
    testsRoot: string,
): FlowDecision | undefined {
    const normalizedRoot = testsRoot.replace(/\\/g, '/');
    const relative = specPath.startsWith(normalizedRoot)
        ? specPath.slice(normalizedRoot.length).replace(/^\//, '')
        : specPath;

    return decisions.find((d) => {
        const target = (d.targetSpec || d.newSpecPath || '').replace(/\\/g, '/');
        return target && (target === relative || target === specPath || relative.endsWith(target) || target.endsWith(relative));
    });
}

export async function runHealStage(
    testsRoot: string,
    targets: HealTarget[],
    config: HealConfig,
): Promise<HealResult> {
    const warnings: string[] = [];

    if (targets.length === 0) {
        return {
            targets,
            summary: {
                runner: 'package-native',
                results: [],
                warnings: ['No heal targets provided.'],
            },
            warnings,
        };
    }

    const healTargets: SpecHealTarget[] = targets.map((t) => ({
        specPath: t.specPath,
        status: t.status,
        reason: t.reason,
    }));

    const pipelineConfig = {
        enabled: true,
        scenarios: 1,
        outputDir: config.outputDir || 'specs/functional/ai-assisted',
        heal: true,
        dryRun: config.dryRun,
        mcp: config.mcp ?? true,
        mcpAllowFallback: config.mcpAllowFallback ?? false,
        mcpOnly: config.mcpOnly ?? false,
        mcpCommandTimeoutMs: config.mcpCommandTimeoutMs,
        mcpRetries: config.mcpRetries ?? 1,
    };

    const summary = runTargetedSpecHeal(testsRoot, healTargets, pipelineConfig);
    warnings.push(...summary.warnings);

    return {targets, summary, warnings};
}

/**
 * Convenience: extract heal targets from a complete pipeline report + optional
 * Playwright run results, then run the heal stage.
 */
export async function healFromReport(
    testsRoot: string,
    report: FlowDecisionReport,
    options: {
        playwrightReportPath?: string;
        generatedSpecs?: GeneratedSpec[];
        healConfig?: HealConfig;
    },
): Promise<HealResult> {
    const targets = resolveHealTargets(
        testsRoot,
        {
            playwrightReportPath: options.playwrightReportPath,
            generatedSpecs: options.generatedSpecs,
        },
        report.decisions,
    );

    return runHealStage(testsRoot, targets, options.healConfig || {mcp: true});
}

/**
 * Write a heal summary section to the pipeline report markdown.
 */
export function renderHealMarkdown(result: HealResult): string {
    const lines: string[] = ['## Heal Results', ''];
    const healedCount = result.summary.results.filter((r) => r.healStatus === 'success').length;
    const failedCount = result.summary.results.filter((r) => r.healStatus === 'failed').length;
    const skippedCount = result.summary.results.filter((r) => r.healStatus === 'skipped').length;

    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Targets | ${result.targets.length} |`);
    lines.push(`| Healed | ${healedCount} |`);
    lines.push(`| Failed | ${failedCount} |`);
    lines.push(`| Skipped | ${skippedCount} |`);
    lines.push('');

    for (const r of result.summary.results) {
        const icon = r.healStatus === 'success' ? '✅' : r.healStatus === 'failed' ? '❌' : '⏭';
        lines.push(`- ${icon} \`${r.flowId}\` — heal: ${r.healStatus || 'n/a'}`);
        if (r.error) {
            lines.push(`  - Error: ${r.error}`);
        }
    }

    if (result.warnings.length > 0) {
        lines.push('', '### Heal Warnings', '');
        for (const w of result.warnings) {
            lines.push(`- ${w}`);
        }
    }

    return lines.join('\n');
}
