// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, readFileSync, writeFileSync} from 'fs';
import {join, resolve} from 'path';
import {runTargetedSpecHeal} from '../agent/pipeline.js';
import type {SpecHealTarget, PipelineSummary} from '../agent/pipeline.js';
import {extractPlaywrightUnstableSpecs} from '../agent/playwright_report.js';
import {resolvePlaywrightBinary, runCommand} from '../agent/process_runner.js';
import {logger} from '../logger.js';
import type {FlowDecision, FlowDecisionReport} from '../validation/output_schema.js';
import type {GeneratedSpec} from './stage3_generation.js';
import type {GenerationProfile} from '../prompts/generation_profile.js';

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
    profile?: GenerationProfile;
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
    /** Number of heal attempts across all targets */
    healAttempts: number;
    /** Number of targets that passed verification after healing */
    healSuccess: number;
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
        if (!target) return false;
        // Exact match
        if (target === relative || target === specPath) return true;
        // Suffix match with path-segment boundary (must be preceded by /)
        if (relative.endsWith(`/${target}`) || target.endsWith(`/${relative}`)) return true;
        return false;
    });
}

const MAX_HEAL_CYCLES = 2;

/**
 * Verify a healed spec by running it with Playwright.
 * Returns null on success, or the error message on failure.
 */
function verifyHealedSpec(
    testsRoot: string,
    specPath: string,
    playwrightBinary: string | null,
): string | null {
    if (!playwrightBinary) {
        return null; // Can't verify without playwright — assume success
    }

    // Resolve to absolute path to prevent argument injection via paths starting with '-'
    const safePath = resolve(specPath);
    const result = runCommand(
        playwrightBinary,
        ['test', safePath, '--retries', '1', '--reporter', 'list'],
        testsRoot,
        60_000, // 60s timeout for verification
    );

    if (result.status === 0) {
        return null; // Passed
    }

    // Extract meaningful error from output
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    const errorLines = output.split('\n').filter((l) =>
        l.includes('Error') || l.includes('error') || l.includes('FAILED') || l.includes('Timeout'),
    ).slice(0, 5);
    return errorLines.join('\n') || result.error || 'Verification failed';
}

/**
 * Mark a spec as test.fixme() when healing cannot fix it.
 * Adds a comment explaining the failure.
 */
function markSpecAsFixme(specPath: string, reason: string): void {
    if (!existsSync(specPath)) return;
    try {
        const content = readFileSync(specPath, 'utf-8');
        const fixmeComment = `// HEAL-INCOMPLETE: ${reason.split('\n')[0].slice(0, 120)}`;
        let commentAdded = false;
        let inBlockComment = false;
        const lines = content.split('\n');
        const result: string[] = [];
        for (const line of lines) {
            // Minimal block-comment tracking to avoid replacing test( inside /* ... */
            if (!inBlockComment && line.includes('/*')) inBlockComment = true;
            if (inBlockComment) {
                if (line.includes('*/')) inBlockComment = false;
                result.push(line);
                continue;
            }
            const match = line.match(/^([ \t]*)(test\()/);
            if (match) {
                const indent = match[1];
                if (!commentAdded) {
                    commentAdded = true;
                    result.push(`${indent}${fixmeComment}`);
                }
                result.push(line.replace(/^([ \t]*)test\(/, '$1test.fixme('));
            } else {
                result.push(line);
            }
        }
        writeFileSync(specPath, result.join('\n'), 'utf-8');
    } catch {
        // Best effort — don't fail the pipeline
    }
}

export async function runHealStage(
    testsRoot: string,
    targets: HealTarget[],
    config: HealConfig,
): Promise<HealResult> {
    const warnings: string[] = [];
    let healAttempts = 0;
    let healSuccess = 0;

    if (targets.length === 0) {
        return {
            targets,
            summary: {
                runner: 'package-native',
                results: [],
                warnings: ['No heal targets provided.'],
            },
            warnings,
            healAttempts: 0,
            healSuccess: 0,
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
    healAttempts += summary.results.filter((r) => r.healStatus === 'success' || r.healStatus === 'failed').length;
    warnings.push(...summary.warnings);

    // Verify-after-heal: re-run healed specs to confirm fixes work
    if (!config.dryRun) {
        const playwrightBinary = resolvePlaywrightBinary(testsRoot);
        const healedResults = summary.results.filter((r) => r.healStatus === 'success');

        for (const result of healedResults) {
            const normalizedFlowId = result.flowId.replace(/\\/g, '/');
            // Try exact match first, then path-suffix match with segment boundary
            let target = targets.find((t) => {
                const normalizedSpec = t.specPath.replace(/\\/g, '/');
                return normalizedSpec === normalizedFlowId;
            });
            if (!target) {
                // Basename fallback: only accept if exactly one candidate matches
                const candidates = targets.filter((t) => {
                    const specBasename = t.specPath.split('/').pop() || '';
                    const flowBasename = normalizedFlowId.split('/').pop() || '';
                    return specBasename === flowBasename;
                });
                if (candidates.length === 1) {
                    target = candidates[0];
                }
            }
            const specPath = target?.specPath || result.flowId;

            if (!existsSync(specPath)) {
                continue;
            }

            let verifyError = verifyHealedSpec(testsRoot, specPath, playwrightBinary);

            if (verifyError) {
                logger.info(`Heal verification failed for ${specPath}, attempting re-heal (cycle 2/${MAX_HEAL_CYCLES})`);
                healAttempts++;

                // Re-heal with enriched failure detail
                const reHealTargets: SpecHealTarget[] = [{
                    specPath,
                    status: 'failed',
                    reason: `Re-heal: verification failed after first heal. Error: ${verifyError.slice(0, 500)}`,
                }];
                const reHealSummary = runTargetedSpecHeal(testsRoot, reHealTargets, pipelineConfig);
                warnings.push(...reHealSummary.warnings);

                const reHealed = reHealSummary.results.find((r) => r.healStatus === 'success');
                if (reHealed) {
                    verifyError = verifyHealedSpec(testsRoot, specPath, playwrightBinary);
                }

                if (verifyError) {
                    // After 2 cycles, mark as fixme
                    logger.warn(`Heal-and-verify failed after ${MAX_HEAL_CYCLES} cycles for ${specPath}, marking as test.fixme()`);
                    markSpecAsFixme(specPath, verifyError);
                    result.healStatus = 'failed';
                    result.error = `heal-incomplete: ${verifyError.slice(0, 200)}`;
                    warnings.push(`Heal-incomplete: ${specPath} — marked as test.fixme() after ${MAX_HEAL_CYCLES} failed cycles`);
                } else {
                    healSuccess++;
                }
            } else {
                healSuccess++;
            }
        }
    }

    return {targets, summary, warnings, healAttempts, healSuccess};
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

    const successRate = result.healAttempts > 0
        ? `${Math.round((result.healSuccess / result.healAttempts) * 100)}%`
        : 'n/a';

    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Targets | ${result.targets.length} |`);
    lines.push(`| Healed | ${healedCount} |`);
    lines.push(`| Failed | ${failedCount} |`);
    lines.push(`| Skipped | ${skippedCount} |`);
    lines.push(`| Heal Attempts | ${result.healAttempts} |`);
    lines.push(`| Verified Passing | ${result.healSuccess} |`);
    lines.push(`| Success Rate | ${successRate} |`);
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
