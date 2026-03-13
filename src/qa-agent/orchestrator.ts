// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {execFileSync} from 'child_process';
import {mkdirSync} from 'fs';

import {logger} from '../logger.js';
import type {Phase1Result, Phase2Result, Phase3Result, QAConfig, QAReport} from './types.js';
import {runPhase1} from './phase1/runner.js';
import {runAgentLoop} from './phase2/agent_loop.js';
import {computeVerdict} from './phase3/verdict.js';
import {generateReport} from './phase3/reporter.js';
import {generateSpecsForFindings} from './phase3/spec_generator.js';
import {submitFeedback} from './phase3/feedback.js';

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
            ? {...config, timeLimitMinutes: Math.min(config.timeLimitMinutes, 5)}
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
    // Phase 3: Report + Spec Generation + Verdict
    // -----------------------------------------------------------------------
    logger.info('=== Phase 3: Report & Verdict ===');

    // Generate specs for discovered bugs
    const generatedSpecs = generateSpecsForFindings(phase2.findings, config);

    // Compute verdict
    const verdict = computeVerdict(phase1, phase2);

    // Generate report
    const phase3 = generateReport(config, phase1, phase2, verdict, generatedSpecs);

    // Submit feedback
    try {
        submitFeedback(config);
    } catch (err) {
        logger.warn('Feedback submission failed', {error: String(err)});
    }

    logger.info(`=== QA Agent Complete: ${verdict.decision.toUpperCase()} ===`);
    logger.info(verdict.reason);

    return buildQAReport(config, phase1, phase2, phase3, verdict);
}

function earlyReturn(config: QAConfig, phase1: Phase1Result, phase2?: Phase2Result): QAReport {
    const p2 = phase2 || emptyPhase2Result();
    const verdict = computeVerdict(phase1, p2);
    const phase3 = generateReport(config, phase1, p2, verdict, []);
    return buildQAReport(config, phase1, p2, phase3, verdict);
}

function buildQAReport(
    config: QAConfig,
    phase1: Phase1Result,
    phase2: Phase2Result,
    phase3: Phase3Result,
    verdict: Phase3Result['verdict'],
): QAReport {
    return {
        schemaVersion: '1.0.0',
        generatedAt: new Date().toISOString(),
        mode: config.mode,
        config: {
            baseUrl: config.baseUrl,
            timeLimitMinutes: config.timeLimitMinutes,
            budgetUSD: config.budgetUSD,
        },
        phase1,
        phase2,
        phase3,
        verdict,
    };
}
