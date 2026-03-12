// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';

import type {resolveConfig} from '../../agent/config.js';
import {LLMProviderFactory} from '../../provider_factory.js';
import {runAgenticGeneration, type ScenarioInput} from '../../agentic/runner.js';
import {loadOrBuildApiSurface} from '../../knowledge/api_surface.js';

import type {ParsedArgs} from '../types.js';

export async function runGenerateCommand(args: ParsedArgs, config: ReturnType<typeof resolveConfig>['config']): Promise<void> {
    const reportRoot = config.testsRoot || config.path;

    // Load scenarios from --scenarios flag or plan-report.json
    let scenarios: ScenarioInput[] = [];

    if (args.generateScenarios) {
        let raw: unknown;
        if (existsSync(args.generateScenarios)) {
            raw = JSON.parse(readFileSync(args.generateScenarios, 'utf-8'));
        } else {
            raw = JSON.parse(args.generateScenarios);
        }
        if (!Array.isArray(raw)) {
            console.error('--scenarios must be a JSON array of ScenarioInput objects.');
            process.exit(1);
        }
        for (const item of raw as Record<string, unknown>[]) {
            if (!item.id || !item.name || !Array.isArray(item.scenarios) || !item.routeFamily || !item.priority) {
                console.error(`Invalid scenario: each must have id, name, scenarios[], routeFamily, priority.`);
                process.exit(1);
            }
        }
        scenarios = raw as ScenarioInput[];
    } else {
        // Try plan.json first (written by plan/suggest command), then plan-report.json (legacy)
        const planJsonPath = join(reportRoot, '.e2e-ai-agents', 'plan.json');
        const planReportPath = join(reportRoot, '.e2e-ai-agents', 'plan-report.json');
        const resolvedPlanPath = existsSync(planJsonPath) ? planJsonPath : existsSync(planReportPath) ? planReportPath : null;
        if (!resolvedPlanPath) {
            console.error('No plan report found. Run `plan` first or pass --scenarios.');
            process.exit(1);
        }
        const planReport = JSON.parse(readFileSync(resolvedPlanPath, 'utf-8'));
        scenarios = (planReport.gapDetails || []).map((gap: {id: string; reasons: string[]; missingScenarios: string[]}) => ({
            id: gap.id,
            name: gap.id,
            scenarios: gap.missingScenarios || gap.reasons || ['Verify core user flow'],
            routeFamily: gap.id.split('.')[0] || gap.id,
            priority: 'P1',
        }));
    }

    if (scenarios.length === 0) {
        console.log('No scenarios to generate tests for.');
        return;
    }

    let apiSurface;
    try {
        apiSurface = loadOrBuildApiSurface(reportRoot, config.apiSurface);
    } catch {
        console.warn('Could not load API surface catalog. Generation will use generic selectors.');
    }

    const provider = await LLMProviderFactory.createFromEnv();

    console.log(`Generating tests for ${scenarios.length} scenario(s)...`);

    const summary = await runAgenticGeneration({
        scenarios,
        config: {
            maxAttempts: args.maxAttempts || 3,
            project: args.pipelineProject || 'chrome',
            baseUrl: args.pipelineBaseUrl,
            testTimeoutMs: 120000,
            testsRoot: reportRoot,
            dryRun: args.dryRun,
        },
        provider,
        apiSurface,
    });

    console.log(`\nAgentic Generation Summary:`);
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
        console.log(`\nWarnings:`);
        for (const w of summary.warnings) {
            console.warn(`  - ${w}`);
        }
    }

    const summaryDir = join(reportRoot, '.e2e-ai-agents');
    if (!existsSync(summaryDir)) {
        mkdirSync(summaryDir, {recursive: true});
    }
    const summaryPath = join(summaryDir, 'agentic-summary.json');
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
    console.log(`\nReport: ${summaryPath}`);

    if (summary.totalFailed > 0) {
        process.exit(1);
    }
}
