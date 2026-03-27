// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {execFileSync} from 'child_process';
import {mkdirSync} from 'fs';

import {logger} from '../logger.js';
import type {Phase1Result, Phase2Result, Phase25Result, Phase3Result, QAConfig, QAReport, HealthScore, RegressionComparison} from './types.js';
import {runPhase1} from './phase1/runner.js';
import {runAgentLoop} from './phase2/agent_loop.js';
import {AgentBrowser} from './phase2/agent_browser.js';
import {computeVerdict} from './phase3/verdict.js';
import {generateReport} from './phase3/reporter.js';
import {generateSpecsForFindings} from './phase3/spec_generator.js';
import {submitFeedback} from './phase3/feedback.js';
import {computeHealthScore} from './health_score.js';
import {runFixLoop} from './phase25/fix_loop.js';
import {saveBaseline, loadBaseline, compareBaselines} from './regression/baseline.js';

function emptyPhase2Result(): Phase2Result {
    return {findings: [], flowsExplored: [], actionsCount: 0, tokensUsed: 0, costUSD: 0, durationMs: 0};
}

export async function runQAAgent(inputConfig: QAConfig): Promise<QAReport> {
    const outputDir = inputConfig.outputDir || '.e2e-ai-agents';
    const screenshotDir = inputConfig.screenshotDir || `${outputDir}/qa-screenshots`;
    mkdirSync(screenshotDir, {recursive: true});
    const config: QAConfig = {...inputConfig, outputDir, screenshotDir};

    // -----------------------------------------------------------------------
    // Phase 1: Scripted (scope resolution + run matched specs)
    // -----------------------------------------------------------------------
    logger.info('=== Phase 1: Scope & Scripted Tests ===');
    let phase1: Phase1Result;
    if (config.phase && config.phase > 1) {
        // Skip Phase 1 — provide empty results
        phase1 = {flows: [], specResults: []};
    } else {
        phase1 = runPhase1(config);
    }

    if (phase1.flows.length === 0 && phase1.specResults.length === 0 && !(config.phase && config.phase > 1)) {
        logger.warn('Phase 1 produced no flows and no spec results — scoping may have failed. Check that route-families.json and plan.json are available.');
    }

    logger.info('Phase 1 complete', {
        flows: phase1.flows.length,
        specResults: phase1.specResults.length,
    });

    if (config.phase === 1) {
        return earlyReturn(config, phase1);
    }

    // -----------------------------------------------------------------------
    // Phase 2: Autonomous exploration (LLM + agent-browser)
    // -----------------------------------------------------------------------
    logger.info('=== Phase 2: Autonomous Exploration ===');

    // Verify agent-browser is available before starting the exploration loop
    if (!(config.phase && config.phase > 2)) {
        try {
            execFileSync('agent-browser', ['--version'], {encoding: 'utf-8', timeout: 5_000});
        } catch {
            logger.error('agent-browser CLI not found. Install it (>= 0.18.0) or skip Phase 2 with --phase 1.');
            return earlyReturn(config, phase1);
        }
    }

    let phase2: Phase2Result;
    if (config.phase && config.phase > 2) {
        phase2 = emptyPhase2Result();
    } else {
        const flows = phase1.flows.length > 0
            ? phase1.flows
            : [{id: 'main', name: 'Main application', priority: 'P1' as const}];

        // In fix mode, limit Phase 2 to verification only
        const phase2Config = config.mode === 'fix'
            ? {...config, timeLimitMinutes: Math.min(config.timeLimitMinutes ?? 15, 5)}
            : config;

        phase2 = await runAgentLoop(phase2Config, flows);
    }

    logger.info('Phase 2 complete', {
        findings: phase2.findings.length,
        flowsExplored: phase2.flowsExplored.length,
        cost: `$${phase2.costUSD.toFixed(4)}`,
    });

    if (config.phase === 2) {
        return earlyReturn(config, phase1, phase2);
    }

    // -----------------------------------------------------------------------
    // Phase 2.5: Fix Loop (optional)
    // -----------------------------------------------------------------------
    let phase25: Phase25Result | undefined;
    let healthScore: HealthScore = phase2.healthScore || computeHealthScore(phase2.findings);

    if (config.fixEnabled !== false && phase2.findings.length > 0) {
        logger.info('=== Phase 2.5: Fix Loop ===');

        // Create a browser instance for the fix loop to verify fixes
        const fixBrowser = new AgentBrowser({session: config.headed ? 'qa-fix-headed' : undefined});
        try {
            const projectRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {encoding: 'utf-8'}).trim();
            phase25 = await runFixLoop(config, phase2.findings, fixBrowser, projectRoot);
            healthScore = phase25.healthScoreAfter;

            logger.info('Phase 2.5 complete', {
                attempted: phase25.fixesAttempted,
                verified: phase25.fixesVerified,
                reverted: phase25.fixesReverted,
                scoreDelta: `${phase25.healthScoreBefore.overall} → ${phase25.healthScoreAfter.overall}`,
            });
        } catch (err) {
            logger.warn('Phase 2.5 failed, continuing without fixes', {error: String(err)});
        } finally {
            if (!config.headed) {
                fixBrowser.close();
            }
        }
    }

    // -----------------------------------------------------------------------
    // Compute remaining findings (exclude verified fixes)
    // -----------------------------------------------------------------------
    const verifiedIds = new Set(
        (phase25?.fixes ?? [])
            .filter((f) => f.status === 'verified')
            .map((f) => f.findingId),
    );
    const remainingFindings = verifiedIds.size > 0
        ? phase2.findings.filter((f) => !verifiedIds.has(f.id))
        : phase2.findings;

    // -----------------------------------------------------------------------
    // Regression comparison (optional)
    // -----------------------------------------------------------------------
    let regressionComparison: RegressionComparison | undefined;
    if (config.regression) {
        const baseline = loadBaseline(outputDir);
        if (baseline) {
            regressionComparison = compareBaselines(healthScore, remainingFindings, baseline);
            logger.info('Regression comparison', {
                scoreDelta: regressionComparison.scoreDelta,
                fixedIssues: regressionComparison.fixedIssues.length,
                newIssues: regressionComparison.newIssues.length,
            });
        } else {
            logger.info('No baseline found — saving current run as baseline');
        }
    }

    // Always save baseline for future comparisons (use remaining findings, not stale originals)
    saveBaseline(outputDir, healthScore, remainingFindings, config.baseUrl);

    // -----------------------------------------------------------------------
    // Phase 3: Report + Spec Generation + Verdict
    // -----------------------------------------------------------------------
    logger.info('=== Phase 3: Report & Verdict ===');

    // Generate specs for discovered bugs
    const generatedSpecs = generateSpecsForFindings(phase2.findings, config);

    // Compute verdict (now with health score)
    const verdict = computeVerdict(phase1, phase2, healthScore, phase25);

    // Generate report
    const phase3 = generateReport(config, phase1, phase2, verdict, generatedSpecs, phase25, healthScore, regressionComparison);

    // Submit feedback
    try {
        submitFeedback(config);
    } catch (err) {
        logger.warn('Feedback submission failed', {error: String(err)});
    }

    logger.info(`=== QA Agent Complete: ${verdict.decision.toUpperCase()} ===`);
    logger.info(verdict.reason);

    return buildQAReport(config, phase1, phase2, phase3, verdict, phase25, healthScore, regressionComparison);
}

function earlyReturn(config: QAConfig, phase1: Phase1Result, phase2?: Phase2Result): QAReport {
    const p2 = phase2 || emptyPhase2Result();
    const healthScore = computeHealthScore(p2.findings);
    const verdict = computeVerdict(phase1, p2, healthScore);
    const phase3 = generateReport(config, phase1, p2, verdict, [], undefined, healthScore);
    return buildQAReport(config, phase1, p2, phase3, verdict, undefined, healthScore);
}

function buildQAReport(
    config: QAConfig,
    phase1: Phase1Result,
    phase2: Phase2Result,
    phase3: Phase3Result,
    verdict: Phase3Result['verdict'],
    phase25?: Phase25Result,
    healthScore?: HealthScore,
    regressionComparison?: RegressionComparison,
): QAReport {
    return {
        schemaVersion: '1.1.0',
        generatedAt: new Date().toISOString(),
        mode: config.mode,
        config: {
            baseUrl: config.baseUrl,
            timeLimitMinutes: config.timeLimitMinutes,
            budgetUSD: config.budgetUSD,
            fixTier: config.fixTier,
        },
        phase1,
        phase2,
        phase25,
        phase3,
        verdict,
        healthScore,
        regressionComparison,
    };
}
