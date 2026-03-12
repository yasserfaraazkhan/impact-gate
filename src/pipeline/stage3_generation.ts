// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {dirname, join} from 'path';
import {LLMProviderFactory} from '../provider_factory.js';
import type {LLMProvider} from '../provider_interface.js';
import {buildGenerationPrompt, parseGenerationResponse, detectHallucinatedMethods} from '../prompts/generation.js';
import {loadSpecFileContent} from '../knowledge/context_loader.js';
import type {FlowDecision} from '../validation/output_schema.js';
import type {ApiSurfaceCatalog} from '../knowledge/api_surface.js';

export interface GenerationConfig {
    provider?: string;
    maxTokens?: number;
    temperature?: number;
    timeout?: number;
    /** Directory to write generated specs into when no path is specified */
    defaultOutputDir?: string;
    /** Set to true to log hallucination warnings but still write the file */
    warnOnHallucinations?: boolean;
    /** When true, only log what would be written without actually writing files */
    dryRun?: boolean;
}

export interface GeneratedSpec {
    flowId: string;
    specPath: string;
    mode: 'create_spec' | 'add_scenarios';
    written: boolean;
    hallucinationWarnings: string[];
}

export interface GenerationResult {
    generated: GeneratedSpec[];
    skipped: string[];
    warnings: string[];
    providerName: string;
}

async function getProvider(config: GenerationConfig): Promise<LLMProvider> {
    if (config.provider && config.provider !== 'auto') {
        return LLMProviderFactory.createFromString(config.provider);
    }
    return LLMProviderFactory.createFromEnv();
}

/**
 * Resolve the spec path for a decision.
 * For add_scenarios: use decision.targetSpec.
 * For create_spec: use decision.newSpecPath, falling back to a generated path under defaultOutputDir.
 */
function resolveSpecPath(
    decision: FlowDecision,
    testsRoot: string,
    defaultOutputDir: string,
): {specPath: string; mode: 'create_spec' | 'add_scenarios'} | null {
    if (decision.action === 'add_scenarios') {
        const target = decision.targetSpec;
        if (!target) {
            return null;
        }
        return {specPath: join(testsRoot, target), mode: 'add_scenarios'};
    }

    if (decision.action === 'create_spec') {
        const suggested = decision.newSpecPath;
        if (suggested) {
            return {specPath: join(testsRoot, suggested), mode: 'create_spec'};
        }
        // Generate a path under defaultOutputDir
        const safeName = decision.flowId.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
        const outputDir = join(testsRoot, defaultOutputDir);
        return {specPath: join(outputDir, `${safeName}.spec.ts`), mode: 'create_spec'};
    }

    return null;
}

export async function runGenerationStage(
    decisions: FlowDecision[],
    apiSurface: ApiSurfaceCatalog,
    testsRoot: string,
    config: GenerationConfig,
): Promise<GenerationResult> {
    const warnings: string[] = [];
    const generated: GeneratedSpec[] = [];
    const skipped: string[] = [];

    const actionable = decisions.filter(
        (d) => d.action === 'create_spec' || d.action === 'add_scenarios',
    );

    if (actionable.length === 0) {
        return {generated, skipped, warnings, providerName: 'none'};
    }

    let provider: LLMProvider;
    try {
        provider = await getProvider(config);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Generation agent unavailable: ${message}`);
        return {generated, skipped, warnings, providerName: 'none'};
    }

    const defaultOutputDir = config.defaultOutputDir || 'specs/functional/ai-assisted';
    const dryRun = config.dryRun ?? false;

    for (const decision of actionable) {
        const resolved = resolveSpecPath(decision, testsRoot, defaultOutputDir);
        if (!resolved) {
            skipped.push(`${decision.flowId}: no target spec path`);
            continue;
        }

        const {specPath, mode} = resolved;

        // Load existing spec content for add_scenarios mode
        let existingSpecContent: string | undefined;
        if (mode === 'add_scenarios' && existsSync(specPath)) {
            try {
                existingSpecContent = readFileSync(specPath, 'utf-8').slice(0, 12000);
            } catch {
                warnings.push(`Could not read existing spec at ${specPath}`);
            }
        } else if (mode === 'add_scenarios' && !existsSync(specPath)) {
            // Target spec doesn't exist — downgrade to create
            skipped.push(`${decision.flowId}: targetSpec not found at ${specPath}, skipping add_scenarios`);
            continue;
        }

        const prompt = buildGenerationPrompt({
            decision,
            apiSurface,
            existingSpecContent,
            specPath,
            mode,
        });

        try {
            const response = await provider.generateText(prompt, {
                maxTokens: config.maxTokens || 6000,
                temperature: config.temperature ?? 0.1,
                timeout: config.timeout || 60000,
                systemPrompt: 'Return only TypeScript code. No explanations or markdown fences.',
            });

            const parsed = parseGenerationResponse(response.text, specPath, mode, decision.flowId);
            if (!parsed) {
                warnings.push(`Generation agent returned invalid code for flow ${decision.flowId}`);
                skipped.push(`${decision.flowId}: invalid code returned`);
                continue;
            }

            // Hallucination detection
            const hallucinationWarnings = detectHallucinatedMethods(parsed.code, apiSurface);
            if (hallucinationWarnings.length > 0) {
                warnings.push(
                    `Flow ${decision.flowId}: suspected hallucinated methods: ${hallucinationWarnings.join(', ')}`,
                );
            }

            let written = false;
            if (!dryRun) {
                const dir = dirname(specPath);
                if (!existsSync(dir)) {
                    mkdirSync(dir, {recursive: true});
                }

                let finalCode = parsed.code;
                if (mode === 'add_scenarios' && existingSpecContent) {
                    // Append new tests to the existing file
                    // Strip import lines from generated code since existing file already has them
                    const codeWithoutImports = finalCode.replace(/^import\s+.*?from\s+['"][^'"]+['"]\s*;?\s*\n/gm, '').trim();
                    finalCode = `${existingSpecContent.trimEnd()}\n\n${codeWithoutImports}\n`;
                } else {
                    finalCode = `${finalCode}\n`;
                }

                writeFileSync(specPath, finalCode, 'utf-8');
                written = true;
            }

            generated.push({
                flowId: decision.flowId,
                specPath,
                mode,
                written,
                hallucinationWarnings,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`Generation agent failed for flow ${decision.flowId}: ${message}`);
            skipped.push(`${decision.flowId}: error — ${message}`);
        }
    }

    return {
        generated,
        skipped,
        warnings,
        providerName: provider.name,
    };
}

// Re-export for convenience
export {loadSpecFileContent};
