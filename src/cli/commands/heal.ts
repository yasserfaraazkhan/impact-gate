// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {resolveConfig} from '../../agent/config.js';
import {runTargetedSpecHeal} from '../../agent/pipeline.js';
import {extractPlaywrightUnstableSpecs} from '../../agent/playwright_report.js';

import type {ParsedArgs} from '../types.js';

export function runHealCommand(args: ParsedArgs, autoConfig: string | undefined): void {
    if (!args.path && !autoConfig) {
        console.error('Error: --path is required for heal command');
        process.exit(1);
    }
    if (!args.traceabilityReportPath) {
        console.error('Error: --traceability-report <path> is required for heal command');
        process.exit(1);
    }

    const {config} = resolveConfig(process.cwd(), autoConfig, {
        path: args.path,
        profile: args.profile,
        testsRoot: args.testsRoot,
        mode: 'gap',
        framework: args.framework,
        pipeline: {
            enabled: true,
            scenarios: args.pipelineScenarios,
            outputDir: args.pipelineOutput,
            baseUrl: args.pipelineBaseUrl,
            browser: args.pipelineBrowser,
            headless: args.pipelineHeadless,
            project: args.pipelineProject,
            parallel: args.pipelineParallel,
            dryRun: args.pipelineDryRun,
            mcp: args.pipelineMcp,
            mcpAllowFallback: args.pipelineMcpAllowFallback,
            mcpOnly: args.pipelineMcpOnly,
        },
        llmProvider: args.llmProvider,
    });

    const reportRoot = config.testsRoot || config.path;
    const unstableSpecs = extractPlaywrightUnstableSpecs(args.traceabilityReportPath, [reportRoot, config.path]);
    if (unstableSpecs.length === 0) {
        console.log('Heal targeted unstable specs: 0');
        return;
    }

    const targetedSummary = runTargetedSpecHeal(
        reportRoot,
        unstableSpecs.map((spec) => ({
            specPath: spec.specPath,
            status: spec.status,
            reason: `Playwright report: failingTests=${spec.failingTests}, flakyTests=${spec.flakyTests}`,
        })),
        {
            ...config.pipeline,
            enabled: true,
            heal: true,
        },
    );
    const healedCount = targetedSummary.results.filter((result) => result.healStatus === 'success').length;
    console.log(`Heal targeted unstable specs: ${unstableSpecs.length} (healed=${healedCount})`);
    if (targetedSummary.warnings.length > 0) {
        console.log(`Heal warnings: ${targetedSummary.warnings.join(' | ')}`);
    }
}
