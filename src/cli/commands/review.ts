// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * CLI command: impact-gate review
 *
 * Unified PR review that combines impact analysis, coverage planning,
 * and defect prediction into a single human-readable report.
 *
 * With --generate, the review pipeline feeds its uncovered recommendations
 * directly into the agentic test generator, producing ready-to-run E2E
 * test files — the shift-left QA workflow.
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

export async function runReviewCommand(
    args: ParsedArgs,
    config: ReturnType<typeof resolveConfig>['config'],
): Promise<void> {
    const reportRoot = config.testsRoot || config.path;
    const baseRef = config.git.since || 'origin/main';

    console.log(`Reviewing: ${baseRef}...HEAD`);
    console.log(`Repository: ${config.path}`);
    console.log('');

    // Step 1: Get changed files
    const gitResult = getChangedFiles(config.path, baseRef, {
        includeUncommitted: config.git.includeUncommitted,
    });

    if (gitResult.files.length === 0) {
        console.log('No changed files detected. Nothing to review.');
        return;
    }

    // Step 1.5: Load knowledge graph if available (Graphify or Understand-Anything)
    let kgImpact: KGImpactResult | undefined;
    const kg = loadGraphifyGraph(config.path) || loadKnowledgeGraph(config.path);
    let expandedFiles: string[] | undefined;

    if (kg) {
        console.log(`Knowledge graph loaded (${kg.nodes.length} nodes, ${kg.edges.length} edges)`);
        kgImpact = expandChangedFilesViaKG(gitResult.files, kg, 3);
        expandedFiles = kgImpact.expandedFiles;
        console.log(`KG expansion: ${kgImpact.stats.directFunctions} direct, ${kgImpact.stats.transitiveFunctions} transitive functions affected`);
        console.log(`Function test coverage: ${kgImpact.stats.testedFunctions}/${kgImpact.stats.directFunctions + kgImpact.stats.transitiveFunctions} functions tested`);
        console.log('');
    }

    // Step 2: Impact analysis
    const impact = analyzeImpact(gitResult.files, {
        testsRoot: reportRoot,
        routeFamilies: config.routeFamilies,
        filteredTestFiles: gitResult.filteredTestFiles,
        expandedFiles,
    });

    // Step 2.5: Behavior analysis (deterministic, no LLM)
    let behaviorAnalysis: BehaviorAnalysisResult | undefined;
    try {
        const diffs = loadDiffs(config.path, baseRef, gitResult.files);
        const manifest = loadRouteFamilyManifest(reportRoot, config.routeFamilies);
        if (diffs.size > 0) {
            behaviorAnalysis = analyzeBehavior(diffs, impact, manifest, reportRoot);
            if (behaviorAnalysis.signals.length > 0) {
                console.log(`Behavior analysis: ${behaviorAnalysis.signals.length} signals, ${behaviorAnalysis.recommendations.length} recommendations`);
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
                record: true,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`Deep prediction unavailable (${msg}), using deterministic fallback.`);
            prediction = predictSync(config.path, baseRef, 'HEAD');
        }
    } else {
        prediction = await predict(config.path, baseRef, 'HEAD', {
            projectRoot: config.path,
            record: true,
        });
    }

    // Step 5: Synthesize
    const report = synthesizeReview(impact, plan, prediction, kgImpact, behaviorAnalysis);

    // Step 6: Output
    if (args.jsonOutput) {
        console.log(JSON.stringify(formatReviewJSON(report), null, 2));
    } else {
        console.log(formatReviewText(report));
    }

    // Write markdown for CI comments if requested
    if (args.ciCommentPath) {
        const markdown = formatReviewMarkdown(report);
        writeFileSync(args.ciCommentPath, markdown, 'utf-8');
        console.log('');
        console.log(`PR comment written to ${args.ciCommentPath}`);
    }

    // --generate: feed uncovered recommendations into agentic test generation
    if (args.analyzeGenerate) {
        await runReviewGenerate(args, config, report, reportRoot);
    }

    // Exit code based on enforcement
    if (plan.enforcement.shouldFail) {
        process.exit(2);
    }

    // Also check predict threshold if set
    const threshold = args.threshold ?? args.gateThreshold;
    if (typeof threshold === 'number' && prediction.score > threshold) {
        console.log('');
        console.log(`GATE FAILED: defect risk ${prediction.score.toFixed(2)} exceeds threshold ${threshold}`);
        process.exit(1);
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
function buildScenariosFromReview(report: ReviewReport): ScenarioInput[] {
    const uncoveredRecs = (report.recommendations || []).filter((r) => !r.alreadyCoveredBy);

    if (uncoveredRecs.length === 0) {
        return [];
    }

    // Group recommendations by dimension or create a single scenario group
    type Rec = NonNullable<ReviewReport['recommendations']>[number];
    const groups = new Map<string, Rec[]>();
    for (const rec of uncoveredRecs) {
        const key = rec.dimension || 'core-flow';
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key)!.push(rec);
    }

    // Also collect uncovered flow IDs for context
    const uncoveredFlows = report.impactedFlows.filter((f) => f.status === 'uncovered' || f.status === 'partial');

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
        const scenarioDescriptions = flowRecs.length > 0
            ? flowRecs.map((r) => r.scenario)
            : flow.gaps.length > 0
                ? flow.gaps.map((g) => g.replace(/^Missing scenario:\s*/i, ''))
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

    // Strategy 2: Pick up dimension-expansion recommendations not tied to a specific flow
    const orphanRecs = uncoveredRecs.filter((r) => {
        if (r.dimension === 'core-flow') return false;
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
): Promise<void> {
    console.log('');
    console.log('─── Test Generation ───');

    const scenarios = buildScenariosFromReview(report);

    if (scenarios.length === 0) {
        console.log('All recommendations are already covered. No tests to generate.');
        return;
    }

    const totalScenarios = scenarios.reduce((sum, s) => sum + s.scenarios.length, 0);
    console.log(`Generating tests for ${scenarios.length} flow(s), ${totalScenarios} scenario(s)...`);
    console.log('');

    // Resolve LLM provider
    let provider;
    try {
        provider = args.llmProvider
            ? LLMProviderFactory.createFromString(args.llmProvider)
            : await LLMProviderFactory.createFromEnv();
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Cannot generate tests: LLM provider unavailable (${msg}).`);
        console.error('Set ANTHROPIC_API_KEY or OPENAI_API_KEY, or use --llm-provider.');
        return;
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
            project: args.pipelineProject || 'chrome',
            baseUrl: args.pipelineBaseUrl,
            testTimeoutMs: 120000,
            testsRoot: outputDir,
            dryRun: args.dryRun,
        },
        provider,
        apiSurface,
        generationProfile,
    });

    // Print summary
    console.log('');
    console.log('Test Generation Summary:');
    console.log(`  Generated: ${summary.totalGenerated}`);
    console.log(`  Passed:    ${summary.totalPassed}`);
    console.log(`  Failed:    ${summary.totalFailed}`);
    console.log(`  Attempts:  ${summary.totalAttempts}`);
    console.log(`  Duration:  ${(summary.durationMs / 1000).toFixed(1)}s`);

    for (const result of summary.results) {
        const icon = result.status === 'passed' ? 'PASS' : result.status === 'skipped' ? 'SKIP' : 'FAIL';
        console.log(`  [${icon}] ${result.scenarioSource} (${result.attempts} attempts)`);
        if (result.status === 'passed' || result.status === 'skipped') {
            console.log(`     ${result.specPath}`);
        }
    }

    if (summary.warnings.length > 0) {
        console.log('');
        console.log('Warnings:');
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
    console.log(`\nReport: ${summaryPath}`);
}
