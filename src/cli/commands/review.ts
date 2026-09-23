// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * CLI command: impact-gate review
 *
 * Unified PR review that combines impact analysis, coverage planning,
 * and defect prediction into a single human-readable report.
 *
 * With --generate, the review pipeline feeds its uncovered recommendations
 * directly into the agentic test generator. Unverified proposals remain
 * quarantined for review.
 *
 * Usage:
 *   impact-gate review --path . --since origin/main
 *   impact-gate review --path . --since origin/main --deep
 *   impact-gate review --path . --since origin/main --json
 *   impact-gate review --path . --since origin/main --ci-comment-path comment.md
 *   impact-gate review --path . --since origin/main --generate [--dry-run]
 */

import {existsSync, mkdirSync, writeFileSync} from 'fs';
import {join} from 'path';

import type {resolveConfig} from '../../agent/config.js';
import {getChangedFiles} from '../../agent/git.js';
import {analyzeImpact} from '../../engine/impact_engine.js';
import {buildPlanFromImpact} from '../../engine/plan_builder.js';
import {expandChangedFilesViaKG} from '../../engine/kg_impact.js';
import type {KGImpactResult} from '../../engine/kg_impact.js';
import {analyzeBehavior} from '../../engine/behavior_analyzer.js';
import type {BehaviorAnalysisResult} from '../../engine/behavior_analyzer.js';
import {loadDiffs} from '../../engine/diff_loader.js';
import {loadRouteFamilyManifest} from '../../knowledge/route_families.js';
import {predict, predictSync} from '../../prediction/index.js';
import {synthesizeReview} from '../../engine/review_synthesizer.js';
import type {ReviewReport} from '../../engine/review_types.js';
import {formatReviewText, formatReviewMarkdown, formatReviewJSON} from '../../engine/review_formatter.js';
import {loadKnowledgeGraph} from '../../knowledge/kg_bridge.js';
import {loadGraphifyGraph} from '../../knowledge/graphify_bridge.js';
import {LLMProviderFactory} from '../../provider_factory.js';
import {runAgenticGeneration} from '../../agentic/runner.js';
import type {ScenarioInput} from '../../agentic/runner.js';
import {loadOrBuildApiSurface} from '../../knowledge/api_surface.js';
import {resolveGenerationProfile} from '../../prompts/generation_profile.js';

import type {ParsedArgs} from '../types.js';
import {classifyError} from '../errors.js';

interface ReviewGenerationOutcome {
    status: 'completed' | 'failed' | 'skipped';
    error?: string;
    summaryPath?: string;
    totalFailed?: number;
}

export async function runReviewCommand(
    args: ParsedArgs,
    config: ReturnType<typeof resolveConfig>['config'],
): Promise<void> {
    const reportRoot = config.testsRoot || config.path;
    const baseRef = config.git.since || 'origin/main';

    console.error(`Reviewing: ${baseRef}...HEAD`);
    console.error(`Repository: ${config.path}`);
    console.error('');

    // Step 1: Get changed files
    const gitResult = getChangedFiles(config.path, baseRef, {
        includeUncommitted: config.git.includeUncommitted,
    });

    if (gitResult.error) {
        throw new Error(gitResult.error);
    }
    if (gitResult.files.length === 0) {
        console.error('No changed files detected. Nothing to review.');
    }

    // Step 1.5: Load knowledge graph if available (Graphify or Understand-Anything)
    let kgImpact: KGImpactResult | undefined;
    const kg = loadGraphifyGraph(config.path) || loadKnowledgeGraph(config.path);
    let expandedFiles: string[] | undefined;

    if (kg) {
        console.error(`Knowledge graph loaded (${kg.nodes.length} nodes, ${kg.edges.length} edges)`);
        kgImpact = expandChangedFilesViaKG(gitResult.files, kg, 3);
        expandedFiles = kgImpact.expandedFiles;
        console.error(`KG expansion: ${kgImpact.stats.directFunctions} direct, ${kgImpact.stats.transitiveFunctions} transitive functions affected`);
        console.error(`Function test coverage: ${kgImpact.stats.testedFunctions}/${kgImpact.stats.directFunctions + kgImpact.stats.transitiveFunctions} functions tested`);
        console.error('');
    }

    // Step 2: Impact analysis
    const impact = analyzeImpact(gitResult.files, {
        testsRoot: reportRoot,
        routeFamilies: config.routeFamilies,
        traceability: config.impact.traceability,
        sourceRoot: gitResult.repositoryRoot || config.path,
        filteredTestFiles: gitResult.filteredTestFiles,
        expandedFiles,
    });

    // Step 2.5: Behavior analysis (deterministic, no LLM)
    let behaviorAnalysis: BehaviorAnalysisResult | undefined;
    try {
        const diffs = loadDiffs(config.path, baseRef, gitResult.files);
        const manifest = loadRouteFamilyManifest(reportRoot, config.routeFamilies);
        if (diffs.size > 0) {
            behaviorAnalysis = analyzeBehavior(diffs, impact, manifest, gitResult.repositoryRoot || config.path);
            if (behaviorAnalysis.signals.length > 0) {
                console.error(`Behavior analysis: ${behaviorAnalysis.signals.length} signals, ${behaviorAnalysis.recommendations.length} recommendations`);
            }
        }
    } catch {
        // Non-fatal: behavior analysis is additive
    }

    // Step 3: Build plan (deterministic — no AI for the plan layer)
    const plan = buildPlanFromImpact(impact, config.policy);

    // Step 4: Defect prediction
    let prediction;
    const useDeep = args.deep === true;

    if (useDeep) {
        try {
            const provider = args.llmProvider
                ? LLMProviderFactory.createFromString(args.llmProvider)
                : await LLMProviderFactory.createFromEnv();

            prediction = await predict(config.path, baseRef, 'HEAD', {
                deep: true,
                provider,
                projectRoot: config.path,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`Deep prediction unavailable (${msg}), using deterministic fallback.`);
            prediction = predictSync(config.path, baseRef, 'HEAD');
        }
    } else {
        prediction = await predict(config.path, baseRef, 'HEAD', {
            projectRoot: config.path,
        });
    }

    // Step 5: Synthesize
    const report = synthesizeReview(impact, plan, prediction, kgImpact, behaviorAnalysis);

    if (args.scenariosOutput) {
        const scenarios = buildScenariosFromReview(report);
        writeFileSync(args.scenariosOutput, JSON.stringify(scenarios, null, 2) + '\n', 'utf-8');
        console.error(`Wrote ${scenarios.length} scenario group(s) to ${args.scenariosOutput}`);
    }

    // Write markdown for CI comments if requested
    if (args.ciCommentPath) {
        const markdown = formatReviewMarkdown(report);
        writeFileSync(args.ciCommentPath, markdown, 'utf-8');
        console.error('');
        console.error(`PR comment written to ${args.ciCommentPath}`);
    }

    // --generate: feed uncovered recommendations into agentic test generation
    let generation: ReviewGenerationOutcome | undefined;
    if (args.analyzeGenerate) {
        try {
            generation = await runReviewGenerate(args, config, report, reportRoot);
            if (generation.status === 'failed') process.exitCode = 1;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            generation = {status: 'failed', error: message};
            console.error(`Test generation failed: ${message}`);
            process.exitCode = classifyError(error);
        }
    }

    // Optional generation must not discard the completed provider-free review.
    const jsonReport = {...formatReviewJSON(report), ...(generation ? {generation} : {})};
    console.log(args.jsonOutput ? JSON.stringify(jsonReport, null, 2) : formatReviewText(report));
    if (generation?.error !== undefined) return;

    // Exit code based on enforcement
    if (plan.enforcement.shouldFail) {
        process.exitCode = 2;
        return;
    }

    // Also check predict threshold if set
    const threshold = args.threshold ?? args.gateThreshold;
    if (typeof threshold === 'number' && prediction.score > threshold) {
        console.error('');
        console.error(`GATE FAILED: defect risk ${prediction.score.toFixed(2)} exceeds threshold ${threshold}`);
        process.exitCode = 1;
        return;
    }
}

// ─── Review → Generate pipeline ───

const STOP_WORDS = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'has', 'was', 'one', 'our', 'out', 'new', 'with', 'from', 'this', 'that']);

/** Normalize text into meaningful tokens for matching */
function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 3 && !STOP_WORDS.has(t));
}

/**
 * Convert review recommendations into ScenarioInput[] for the generator.
 * Only uncovered (no alreadyCoveredBy) recommendations become scenarios.
 * Scenarios are grouped by the flow/family they relate to.
 */
export function buildScenariosFromReview(report: ReviewReport): ScenarioInput[] {
    const uncoveredRecs = (report.recommendations || []).filter((r) => !r.alreadyCoveredBy);

    // Also collect uncovered flow IDs for context
    const uncoveredFlows = report.impactedFlows.filter((f) =>
        f.status === 'uncovered' || f.status === 'partial' ||
        // An unverified association may still have a known coverage gap. The
        // absence of newly added PR scenarios alone is not such a gap.
        (f.status === 'associated' && f.gaps.some((gap) =>
            gap.trim().length > 0 && !/^no new scenarios? (?:were )?added\b/i.test(gap.trim()))));

    const scenarios: ScenarioInput[] = [];

    // Strategy 1: Build scenarios from uncovered flows with their gap descriptions
    for (const flow of uncoveredFlows) {
        const flowRecs = uncoveredRecs.filter((r) => {
            const scenarioTokens = tokenize(r.scenario);
            const nameTokens = tokenize(flow.name);
            const gapTokens = flow.gaps.flatMap(tokenize);
            // Match if scenario and flow share meaningful tokens
            return scenarioTokens.some((t) => nameTokens.includes(t) || gapTokens.includes(t)) ||
                nameTokens.some((t) => scenarioTokens.includes(t));
        });

        // If we have specific recommendations for this flow, use them
        const missingScenarios = flow.gaps.filter((gap) => gap.startsWith('Missing scenario:'));
        const scenarioDescriptions = flowRecs.length > 0
            ? flowRecs.map((r) => r.scenario)
            : missingScenarios.length > 0
                ? missingScenarios.map((gap) => gap.replace(/^Missing scenario:\s*/i, ''))
                : flow.userFlows.length > 0
                    ? flow.userFlows.map((flow) => `Verify ${flow}`)
                : [`Verify ${flow.name} core user flow`];

        scenarios.push({
            id: flow.id,
            name: flow.name,
            scenarios: scenarioDescriptions,
            routeFamily: flow.id.split('.')[0] || flow.id,
            priority: flow.priority,
            changedFiles: flow.changedFiles,
            evidence: flow.riskNote || `${flow.status} flow with ${flow.gaps.length} gap(s)`,
        });
    }

    // Preserve recommendations not matched to a flow, including new core scenarios.
    const orphanRecs = uncoveredRecs.filter((r) => {
        return !scenarios.some((s) => s.scenarios.includes(r.scenario));
    });

    if (orphanRecs.length > 0) {
        scenarios.push({
            id: 'cross-cutting',
            name: 'Cross-cutting concerns',
            scenarios: orphanRecs.map((r) => r.scenario),
            routeFamily: 'cross-cutting',
            priority: orphanRecs.some((r) => r.priority === 'P0') ? 'P0' : 'P1',
            evidence: orphanRecs.map((r) => r.rationale).join('; '),
        });
    }

    return scenarios;
}

async function runReviewGenerate(
    args: ParsedArgs,
    config: ReturnType<typeof resolveConfig>['config'],
    report: ReviewReport,
    reportRoot: string,
): Promise<ReviewGenerationOutcome> {
    console.error('');
    console.error('─── Test Generation ───');

    const scenarios = buildScenariosFromReview(report);

    if (scenarios.length === 0) {
        console.error('All recommendations are already covered. No tests to generate.');
        return {status: 'skipped'};
    }

    const totalScenarios = scenarios.reduce((sum, s) => sum + s.scenarios.length, 0);
    console.error(`Generating tests for ${scenarios.length} flow(s), ${totalScenarios} scenario(s)...`);
    console.error('');

    // Resolve LLM provider
    let provider;
    try {
        provider = args.llmProvider
            ? LLMProviderFactory.createFromString(args.llmProvider)
            : await LLMProviderFactory.createFromEnv();
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Cannot generate tests: LLM provider unavailable (${msg}). Set ANTHROPIC_API_KEY or OPENAI_API_KEY, or use --llm-provider.`);
    }

    // Load API surface for better selector generation
    let apiSurface;
    try {
        apiSurface = loadOrBuildApiSurface(reportRoot, config.apiSurface);
    } catch {
        // Non-fatal: generation will use generic selectors
    }

    // Resolve generation profile from KG or config
    const kg = loadGraphifyGraph(config.path) || loadKnowledgeGraph(config.path);
    const generationProfile = resolveGenerationProfile(
        {profile: config.profile},
        kg,
    );

    const outputDir = args.analyzeGenerateOutputDir || reportRoot;

    const summary = await runAgenticGeneration({
        scenarios,
        config: {
            maxAttempts: args.maxAttempts || 3,
            project: args.pipelineProject || config.pipeline.project || undefined,
            baseUrl: args.pipelineBaseUrl || config.pipeline.baseUrl,
            testTimeoutMs: 120000,
            testsRoot: outputDir,
            repositoryRoot: config.path,
            baseRef: config.git.since,
            dryRun: args.dryRun,
        },
        provider,
        apiSurface,
        generationProfile,
    });

    // Print summary
    console.error('');
    console.error('Test Generation Summary:');
    console.error(`  Generated: ${summary.totalGenerated}`);
    console.error(`  Passed:    ${summary.totalPassed}`);
    console.error(`  Failed:    ${summary.totalFailed}`);
    console.error(`  Attempts:  ${summary.totalAttempts}`);
    console.error(`  Duration:  ${(summary.durationMs / 1000).toFixed(1)}s`);

    for (const result of summary.results) {
        const icon = result.status === 'passed' ? 'PASS' : result.status === 'skipped' ? 'SKIP' : result.status === 'unverified' ? 'UNVERIFIED' : 'FAIL';
        console.error(`  [${icon}] ${result.scenarioSource} (${result.attempts} attempts)`);
        if (result.status === 'passed' || result.status === 'skipped' || result.status === 'unverified') {
            console.error(`     ${result.specPath}`);
        }
    }

    if (summary.warnings.length > 0) {
        console.error('');
        console.error('Warnings:');
        for (const w of summary.warnings) {
            console.warn(`  - ${w}`);
        }
    }

    // Write generation summary
    const summaryDir = join(reportRoot, '.e2e-ai-agents');
    if (!existsSync(summaryDir)) {
        mkdirSync(summaryDir, {recursive: true});
    }
    const summaryPath = join(summaryDir, 'review-generate-summary.json');
    writeFileSync(summaryPath, JSON.stringify({
        generatedFrom: 'review --generate',
        scenarios: scenarios.map((s) => ({id: s.id, name: s.name, scenarioCount: s.scenarios.length})),
        ...summary,
    }, null, 2), 'utf-8');
    console.error(`\nReport: ${summaryPath}`);
    return {status: summary.totalFailed > 0 ? 'failed' : 'completed', summaryPath, totalFailed: summary.totalFailed};
}
