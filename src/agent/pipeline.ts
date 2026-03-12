// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync} from 'fs';
import {dirname, join, relative, resolve} from 'path';
import type {PipelineConfig} from './config.js';
import type {FlowImpact} from './types.js';
import {isPathWithinRoot, normalizePath} from './utils.js';
import type {PipelineResult, PipelineSummary, SpecHealTarget} from './pipeline_types.js';
import {createMcpStatus, finalizePipelineSummary, buildSyntheticFlowFromSpecTarget, toSafeSlug} from './pipeline_utils.js';
import {buildApiSurfaceCatalog} from './api_catalog.js';
import {resolvePlaywrightBinary, runCommand, summarizeCommandOutput} from './process_runner.js';
import {runPackageNativeFlow, runPackageNativePipeline} from './native_flow.js';
import {findDisallowedDescribeFiles, resolveAgentSeedSpec, runPlaywrightAgentsPipeline} from './llm_agents_flow.js';

export type {PipelineResult, PipelineSummary, SpecHealTarget} from './pipeline_types.js';

function hasE2eTestGenCLI(testsRoot: string): string | null {
    const cliPath = join(testsRoot, 'e2e-test-gen-cli.ts');
    return existsSync(cliPath) ? cliPath : null;
}

export function runTargetedSpecHeal(
    testsRoot: string,
    targets: SpecHealTarget[],
    pipeline: PipelineConfig,
): PipelineSummary {
    const warnings = new Set<string>();
    const results: PipelineResult[] = [];
    const mcp = createMcpStatus('package-native', Boolean(pipeline.mcp));
    if (targets.length === 0) {
        warnings.add('No targeted specs provided for heal.');
        return finalizePipelineSummary({
            runner: 'package-native',
            results,
            warnings: Array.from(warnings),
            mcp,
        });
    }

    const playwrightBinary = pipeline.heal ? resolvePlaywrightBinary(testsRoot) : null;
    const seedFile = resolveAgentSeedSpec(testsRoot) || 'specs/seed.spec.ts';
    const apiSurface = buildApiSurfaceCatalog(testsRoot, seedFile);
    if (pipeline.heal && !playwrightBinary) {
        warnings.add('Playwright binary was not found. Targeted heal uses static quality checks without runtime compile validation.');
    }

    for (const target of targets) {
        const inputPath = target.specPath || '';
        const absoluteSpecPath = normalizePath(resolve(testsRoot, inputPath));
        if (!isPathWithinRoot(testsRoot, absoluteSpecPath)) {
            results.push({
                flowId: inputPath || 'unknown',
                flowName: inputPath || 'Unknown Spec',
                generatedDir: normalizePath(dirname(absoluteSpecPath)),
                generateStatus: 'failed',
                healStatus: pipeline.heal ? 'failed' : undefined,
                error: `Targeted spec resolves outside testsRoot: ${inputPath}`,
            });
            continue;
        }

        if (!existsSync(absoluteSpecPath)) {
            results.push({
                flowId: inputPath || 'unknown',
                flowName: inputPath || 'Unknown Spec',
                generatedDir: normalizePath(dirname(absoluteSpecPath)),
                generateStatus: 'failed',
                healStatus: pipeline.heal ? 'failed' : undefined,
                error: `Targeted spec does not exist: ${inputPath}`,
            });
            continue;
        }

        const relativeSpecPath = normalizePath(relative(testsRoot, absoluteSpecPath));
        if (!/\.(spec|test)\.[tj]sx?$/.test(relativeSpecPath)) {
            warnings.add(`Skipping non-spec target path: ${relativeSpecPath}`);
            results.push({
                flowId: relativeSpecPath,
                flowName: relativeSpecPath,
                generatedDir: normalizePath(dirname(absoluteSpecPath)),
                generateStatus: 'skipped',
                healStatus: pipeline.heal ? 'skipped' : undefined,
            });
            continue;
        }

        if (pipeline.dryRun) {
            results.push({
                flowId: relativeSpecPath,
                flowName: relativeSpecPath,
                generatedDir: normalizePath(dirname(absoluteSpecPath)),
                generateStatus: 'skipped',
                healStatus: pipeline.heal ? 'skipped' : undefined,
            });
            continue;
        }

        const syntheticFlow = buildSyntheticFlowFromSpecTarget(relativeSpecPath, target);
        results.push(
            runPackageNativeFlow(
                testsRoot,
                syntheticFlow,
                pipeline,
                normalizePath(dirname(absoluteSpecPath)),
                absoluteSpecPath,
                playwrightBinary,
                apiSurface,
            ),
        );
    }

    return finalizePipelineSummary({
        runner: 'package-native',
        results,
        warnings: Array.from(warnings),
        mcp,
    });
}

export function runPlaywrightPipeline(
    testsRoot: string,
    flows: FlowImpact[],
    pipeline: PipelineConfig,
): PipelineSummary {
    const mcpFallbackWarnings: string[] = [];

    // MCP-only mode requires MCP to be enabled
    if (pipeline.mcpOnly && !pipeline.mcp) {
        const warnings = [
            '❌ MCP-Only Mode Error: --pipeline-mcp-only requires --pipeline-mcp flag',
            'Run with: npm run gen:tests -- --pipeline-mcp',
        ];
        return finalizePipelineSummary({
            runner: 'unknown',
            results: [],
            warnings,
            mcp: createMcpStatus('unknown', false),
        });
    }

    if (pipeline.mcp) {
        const agentsSummary = runPlaywrightAgentsPipeline(testsRoot, flows, pipeline);
        if (agentsSummary.runner !== 'unknown' || agentsSummary.results.length > 0) {
            return finalizePipelineSummary(agentsSummary);
        }

        // Handle strict MCP-only mode
        if (pipeline.mcpOnly) {
            const warnings = [
                ...agentsSummary.warnings,
                '❌ MCP-Only Mode Error: Claude Code CLI / Playwright Agents MCP is not available',
                'Please install Claude Code CLI: brew install anthropic/tap/claude-code',
                'Or check that the MCP server is properly configured',
            ];
            return finalizePipelineSummary({
                runner: 'unknown',
                results: agentsSummary.results,
                warnings,
                mcp: createMcpStatus('unknown', true),
            });
        }

        if (!pipeline.mcpAllowFallback) {
            const warnings = [
                ...agentsSummary.warnings,
                'Official Playwright MCP mode is strict; fallback generation is disabled unless pipeline.mcpAllowFallback=true.',
            ];
            return finalizePipelineSummary({
                runner: 'unknown',
                results: agentsSummary.results,
                warnings,
                mcp: createMcpStatus('unknown', true),
            });
        }
        mcpFallbackWarnings.push(...agentsSummary.warnings);
    }

    const cliPath = hasE2eTestGenCLI(testsRoot);
    if (!cliPath) {
        return finalizePipelineSummary(runPackageNativePipeline(testsRoot, flows, pipeline, mcpFallbackWarnings));
    }

    const warnings: string[] = [...mcpFallbackWarnings];
    const results: PipelineResult[] = [];
    const outputBase = resolve(testsRoot, pipeline.outputDir || 'specs/functional/ai-assisted');
    if (!isPathWithinRoot(testsRoot, outputBase)) {
        warnings.push(`Pipeline outputDir resolves outside testsRoot and was blocked: ${pipeline.outputDir}`);
        return finalizePipelineSummary({
            runner: 'unknown',
            results,
            warnings,
            mcp: createMcpStatus('unknown', Boolean(pipeline.mcp)),
        });
    }

    for (const flow of flows) {
        if (flow.priority !== 'P0' && flow.priority !== 'P1') {
            continue;
        }
        const slug = flow.id.replace(/[^a-zA-Z0-9._-]+/g, '-');
        const outputDir = normalizePath(join(outputBase, slug));
        if (!isPathWithinRoot(testsRoot, outputDir)) {
            results.push({
                flowId: flow.id,
                flowName: flow.name,
                generatedDir: outputDir,
                generateStatus: 'failed',
                error: 'output directory resolves outside testsRoot',
            });
            continue;
        }

        if (pipeline.dryRun) {
            results.push({
                flowId: flow.id,
                flowName: flow.name,
                generatedDir: outputDir,
                generateStatus: 'skipped',
                healStatus: 'skipped',
            });
            continue;
        }

        const generateArgs = ['tsx', cliPath, 'generate', flow.name, '--output', outputDir, '--scenarios', `${pipeline.scenarios}`];
        if (pipeline.baseUrl) {
            generateArgs.push('--base-url', pipeline.baseUrl);
        }
        if (pipeline.headless) {
            generateArgs.push('--headless');
        }
        if (pipeline.browser) {
            generateArgs.push('--browser', pipeline.browser);
        }
        if (pipeline.project) {
            generateArgs.push('--project', pipeline.project);
        }
        if (pipeline.parallel) {
            generateArgs.push('--parallel');
        }
        if (pipeline.mcp) {
            generateArgs.push('--mcp');
        }

        const generateResult = runCommand('npx', generateArgs, testsRoot);
        if (generateResult.status !== 0) {
            results.push({
                flowId: flow.id,
                flowName: flow.name,
                generatedDir: outputDir,
                generateStatus: 'failed',
                error: summarizeCommandOutput(generateResult.stdout, generateResult.stderr) || generateResult.error || 'generate failed',
            });
            continue;
        }

        let healStatus: PipelineResult['healStatus'] = 'skipped';
        if (pipeline.heal) {
            const healArgs = ['tsx', cliPath, 'heal', outputDir];
            if (pipeline.browser) {
                healArgs.push('--browser', pipeline.browser);
            }
            if (pipeline.project) {
                healArgs.push('--project', pipeline.project);
            }
            if (pipeline.parallel) {
                healArgs.push('--parallel');
            }
            if (pipeline.mcp) {
                healArgs.push('--mcp');
            }
            const healResult = runCommand('npx', healArgs, testsRoot);
            healStatus = healResult.status === 0 ? 'success' : 'failed';
        }

        const disallowedDescribeFiles = findDisallowedDescribeFiles(outputDir);
        if (disallowedDescribeFiles.length > 0) {
            results.push({
                flowId: flow.id,
                flowName: flow.name,
                generatedDir: outputDir,
                generateStatus: 'failed',
                healStatus,
                error: `Generated tests contain test.describe (disallowed): ${disallowedDescribeFiles.join(', ')}`,
            });
            continue;
        }

        results.push({
            flowId: flow.id,
            flowName: flow.name,
            generatedDir: outputDir,
            generateStatus: 'success',
            healStatus,
        });
    }

    return finalizePipelineSummary({
        runner: 'e2e-test-gen',
        results,
        warnings,
        mcp: createMcpStatus('e2e-test-gen', Boolean(pipeline.mcp)),
    });
}
