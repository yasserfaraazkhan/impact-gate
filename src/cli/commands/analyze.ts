// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {resolveConfig} from '../../agent/config.js';
import {runPipeline} from '../../pipeline/orchestrator.js';

import type {ParsedArgs} from '../types.js';

export async function runAnalyzeCommand(args: ParsedArgs, autoConfig: string | undefined): Promise<void> {
    if (!args.path && !autoConfig) {
        // eslint-disable-next-line no-console
        console.error('Error: --path is required for analyze command');
        process.exit(1);
    }

    const {config} = resolveConfig(process.cwd(), autoConfig, {
        path: args.path,
        profile: args.profile,
        testsRoot: args.testsRoot,
        mode: 'impact',
        gitSince: args.gitSince,
        llmProvider: args.llmProvider,
    });
    const testsRoot = config.testsRoot || config.path;

    const analyzeStages: Array<'preprocess' | 'impact' | 'coverage' | 'generation' | 'heal'> = [
        'preprocess', 'impact', 'coverage',
    ];
    if (args.analyzeGenerate) {
        analyzeStages.push('generation');
    }
    if (args.analyzeHeal || args.analyzeHealReport) {
        analyzeStages.push('heal');
    }

    const result = await runPipeline({
        appPath: config.path,
        testsRoot,
        gitSince: args.gitSince || config.git.since,
        routeFamilies: config.routeFamilies,
        apiSurface: config.apiSurface,
        stages: analyzeStages,
        generation: args.analyzeGenerate
            ? {
                  defaultOutputDir: args.analyzeGenerateOutputDir || 'specs/functional/ai-assisted',
                  dryRun: args.dryRun,
              }
            : undefined,
        heal: (args.analyzeHeal || args.analyzeHealReport)
            ? {
                  mcp: args.pipelineMcp ?? true,
                  mcpAllowFallback: args.pipelineMcpAllowFallback ?? false,
                  mcpOnly: args.pipelineMcpOnly ?? false,
                  mcpCommandTimeoutMs: args.pipelineMcpTimeoutMs,
                  mcpRetries: args.pipelineMcpRetries ?? 1,
                  dryRun: args.dryRun,
              }
            : undefined,
        playwrightReportPath: args.analyzeHealReport,
    });

    // eslint-disable-next-line no-console
    console.log(`Analyze report: ${result.reportPath}`);
    // eslint-disable-next-line no-console
    console.log(`Analyze flows identified: ${result.report.summary.flowsIdentified}`);
    // eslint-disable-next-line no-console
    console.log(`Analyze flows covered: ${result.report.summary.flowsCovered}`);
    // eslint-disable-next-line no-console
    console.log(`Analyze flows uncovered: ${result.report.summary.flowsUncovered}`);
    // eslint-disable-next-line no-console
    console.log(`Analyze overall confidence: ${result.report.summary.overallConfidence}`);
    // eslint-disable-next-line no-console
    console.log(`Analyze route families: ${result.report.summary.routeFamiliesImpacted.join(', ') || 'none'}`);
    if (result.generated && result.generated.length > 0) {
        const written = result.generated.filter((g) => g.written).length;
        // eslint-disable-next-line no-console
        console.log(`Analyze generated specs: ${result.generated.length} (written=${written})`);
        for (const g of result.generated) {
            // eslint-disable-next-line no-console
            console.log(`  ${g.mode}: ${g.specPath}`);
        }
    }
    if (result.healResult) {
        const healed = result.healResult.summary.results.filter((r) => r.healStatus === 'success').length;
        const healFailed = result.healResult.summary.results.filter((r) => r.healStatus === 'failed').length;
        // eslint-disable-next-line no-console
        console.log(`Analyze heal targets: ${result.healResult.targets.length} (healed=${healed}, failed=${healFailed})`);
    }
    if (result.warnings.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`Analyze warnings: ${result.warnings.join(' | ')}`);
    }
}
