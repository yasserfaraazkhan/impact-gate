// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {join, resolve} from 'path';
import type {PipelineConfig} from './config.js';
import type {FlowImpact} from './types.js';
import type {ApiSurfaceCatalog, NativeSpecStrategy, PipelineResult, PipelineSummary} from './pipeline_types.js';
import {isPathWithinRoot, normalizePath} from './utils.js';
import {createMcpStatus, toSafeSlug, buildNativeStrategyOrder} from './pipeline_utils.js';
import {validateGeneratedSpecContent, createNativePlaywrightSpec} from './spec_generator.js';
import {resolvePlaywrightBinary} from './process_runner.js';
import {runPlaywrightListValidation} from './validation_runner.js';
import {buildApiSurfaceCatalog} from './api_catalog.js';
import {resolveAgentSeedSpec} from './llm_agents_flow.js';

export function runPackageNativeFlow(
    testsRoot: string,
    flow: FlowImpact,
    pipeline: PipelineConfig,
    outputDir: string,
    testFile: string,
    playwrightBinary: string | null,
    apiSurface: ApiSurfaceCatalog,
): PipelineResult {
    const flowId = flow.id;
    const flowName = flow.name;
    const existingFile = existsSync(testFile);
    const originalContent = existingFile ? readFileSync(testFile, 'utf-8') : null;

    if (existingFile && !pipeline.heal) {
        return {
            flowId,
            flowName,
            generatedDir: outputDir,
            generateStatus: 'skipped',
        };
    }

    const slug = toSafeSlug(flow.id);
    const strategies = buildNativeStrategyOrder(flow);
    const attempts: string[] = [];
    const candidates: Array<{label: string; strategy?: NativeSpecStrategy; content: string; write: boolean}> = [];

    if (pipeline.heal && originalContent !== null) {
        candidates.push({
            label: 'existing',
            content: originalContent,
            write: false,
        });
    }
    for (const strategy of strategies) {
        candidates.push({
            label: strategy,
            strategy,
            content: createNativePlaywrightSpec(flow, slug, strategy),
            write: true,
        });
    }

    mkdirSync(outputDir, {recursive: true});
    let wroteNewFile = false;

    for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i];
        if (candidate.write) {
            writeFileSync(testFile, candidate.content, 'utf-8');
            wroteNewFile = true;
        }
        const currentContent = candidate.write ? candidate.content : (originalContent || '');
        const qualityIssues = validateGeneratedSpecContent(currentContent, apiSurface);
        if (qualityIssues.length > 0) {
            attempts.push(`${candidate.label}: ${qualityIssues.map((issue) => issue.message).join(' ')}`);
            if (pipeline.heal && i < candidates.length - 1) {
                continue;
            }
            if (originalContent !== null) {
                writeFileSync(testFile, originalContent, 'utf-8');
            } else if (wroteNewFile && existsSync(testFile)) {
                rmSync(testFile, {force: true});
            }
            return {
                flowId,
                flowName,
                generatedDir: outputDir,
                generateStatus: 'failed',
                healStatus: pipeline.heal ? 'failed' : undefined,
                error: `Quality checks failed. Attempts: ${attempts.join(' | ')}`,
            };
        }

        if (pipeline.heal) {
            const validation = runPlaywrightListValidation(testsRoot, testFile, pipeline, playwrightBinary);
            if (validation.status === 'failed') {
                attempts.push(`${candidate.label}: ${validation.detail || 'playwright validation failed'}`);
                if (i < candidates.length - 1) {
                    continue;
                }
                if (originalContent !== null) {
                    writeFileSync(testFile, originalContent, 'utf-8');
                } else if (wroteNewFile && existsSync(testFile)) {
                    rmSync(testFile, {force: true});
                }
                return {
                    flowId,
                    flowName,
                    generatedDir: outputDir,
                    generateStatus: 'failed',
                    healStatus: 'failed',
                    error: `Heal validation failed. Attempts: ${attempts.join(' | ')}`,
                };
            }
        }

        return {
            flowId,
            flowName,
            generatedDir: outputDir,
            generateStatus: candidate.write ? 'success' : 'skipped',
            healStatus: pipeline.heal ? 'success' : undefined,
        };
    }

    if (originalContent !== null) {
        writeFileSync(testFile, originalContent, 'utf-8');
    } else if (wroteNewFile && existsSync(testFile)) {
        rmSync(testFile, {force: true});
    }
    return {
        flowId,
        flowName,
        generatedDir: outputDir,
        generateStatus: 'failed',
        healStatus: pipeline.heal ? 'failed' : undefined,
        error: attempts.length > 0 ? attempts.join(' | ') : 'No generation candidates were available.',
    };
}

export function runPackageNativePipeline(
    testsRoot: string,
    flows: FlowImpact[],
    pipeline: PipelineConfig,
    baseWarnings: string[] = [],
): PipelineSummary {
    const warningSet = new Set(baseWarnings);
    const mcp = createMcpStatus('package-native', Boolean(pipeline.mcp));

    const playwrightBinary = pipeline.heal ? resolvePlaywrightBinary(testsRoot) : null;
    const seedFile = resolveAgentSeedSpec(testsRoot) || 'specs/seed.spec.ts';
    const apiSurface = buildApiSurfaceCatalog(testsRoot, seedFile);
    if (pipeline.heal && !playwrightBinary) {
        warningSet.add('Playwright binary was not found. Heal uses static quality checks without runtime compile validation.');
    }

    const results: PipelineResult[] = [];
    const outputBase = resolve(testsRoot, pipeline.outputDir || 'specs/functional/ai-assisted');
    if (!isPathWithinRoot(testsRoot, outputBase)) {
        warningSet.add(`Pipeline outputDir resolves outside testsRoot and was blocked: ${pipeline.outputDir}`);
        return {runner: 'unknown', results, warnings: Array.from(warningSet), mcp: createMcpStatus('unknown', Boolean(pipeline.mcp))};
    }

    for (const flow of flows) {
        if (flow.priority !== 'P0' && flow.priority !== 'P1') {
            continue;
        }

        const slug = toSafeSlug(flow.id);
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
                healStatus: pipeline.heal ? 'skipped' : undefined,
            });
            continue;
        }

        const testFile = normalizePath(join(outputDir, `${slug}.spec.ts`));
        if (!isPathWithinRoot(testsRoot, testFile)) {
            results.push({
                flowId: flow.id,
                flowName: flow.name,
                generatedDir: outputDir,
                generateStatus: 'failed',
                error: 'generated test path resolves outside testsRoot',
            });
            continue;
        }

        results.push(runPackageNativeFlow(testsRoot, flow, pipeline, outputDir, testFile, playwrightBinary, apiSurface));
    }

    return {runner: 'package-native', results, warnings: Array.from(warningSet), mcp};
}
