// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {dirname, join, resolve} from 'path';
import type {LLMProvider} from '../provider_interface.js';
import type {AgenticConfig, AgenticResult, AgenticSummary, PlaywrightRunResult} from './types.js';
import {isCleanRun} from './playwright_runner.js';
import {prepareQuarantine, quarantineSpec, safeArtifactPath, verifyGeneratedSpec} from '../pipeline/mutation_verification.js';
import {generateFix} from './fix_loop.js';
import {parseGenerationResponse} from '../prompts/generation.js';
import {formatApiSurfaceForPrompt} from '../knowledge/api_surface.js';
import type {ApiSurfaceCatalog} from '../knowledge/api_surface.js';
import type {GenerationProfile} from '../prompts/generation_profile.js';
import {sanitizeForPrompt} from '../crew/sanitize.js';

export interface ScenarioInput {
    id: string;
    name: string;
    scenarios: string[];
    routeFamily: string;
    priority: string;
    /** Existing spec to add scenarios to */
    targetSpec?: string;
    /** Changed files for context */
    changedFiles?: string[];
    /** Evidence from impact analysis */
    evidence?: string;
}

export interface AgenticRunOptions {
    scenarios: ScenarioInput[];
    config: AgenticConfig;
    provider: LLMProvider;
    apiSurfaceHint?: string;
    apiSurface?: ApiSurfaceCatalog;
    generationProfile?: GenerationProfile;
}

function buildGeneratePrompt(scenario: ScenarioInput, apiSurfaceHint: string, profile?: GenerationProfile): string {
    const projectName = profile?.projectName || 'Mattermost';
    const importSource = profile?.importStatement || '@mattermost/playwright-lib';
    const scenariosBlock = scenario.scenarios
        .map((s, i) => `  ${i + 1}. ${sanitizeForPrompt(s)}`)
        .join('\n');

    return [
        `Generate a ${projectName} Playwright E2E test file.`,
        '',
        `FLOW: ${sanitizeForPrompt(scenario.name)}`,
        `Route Family: ${scenario.routeFamily}`,
        `Priority: ${scenario.priority}`,
        scenario.evidence ? `Evidence: ${sanitizeForPrompt(scenario.evidence)}` : '',
        '',
        'SCENARIOS TO IMPLEMENT:',
        scenariosBlock,
        '',
        'AVAILABLE PAGE OBJECTS AND METHODS:',
        apiSurfaceHint || 'Use page.getByRole() or page.getByTestId() for selectors.',
        '',
        'MANDATORY RULES:',
        `1. Import ONLY from "${importSource}" — no other test framework imports.`,
        '2. Every test must call `await pw.initSetup()` first.',
        '3. Use `await pw.testBrowser.login(user)` to log in — never hardcode credentials.',
        '4. Use ONLY page object methods listed above. Do NOT invent methods.',
        '5. If a method is not available, use `page.getByRole()` or `page.getByTestId()`.',
        `6. Tag every test: {tag: '@${scenario.routeFamily}'}`,
        '7. Write one test per scenario with a descriptive name.',
        `8. Use \`expect\` from "${importSource}".`,
        '9. Include the copyright header.',
        '10. NEVER fabricate test IDs (MM-TXXXX). Use descriptive names only.',
        '',
        'EXAMPLE STRUCTURE:',
        '```typescript',
        '// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.',
        '// See LICENSE.txt for license information.',
        '',
        `import {expect, test} from '${importSource}';`,
        '',
        'test(',
        "    'user can post a message in channel',",
        `    {tag: '@${scenario.routeFamily}'},`,
        '    async ({pw}) => {',
        '        const {user} = await pw.initSetup();',
        '        const {channelsPage} = await pw.testBrowser.login(user);',
        '        await channelsPage.goto();',
        '        await channelsPage.toBeVisible();',
        '        // test steps...',
        '    },',
        ');',
        '```',
        '',
        'Return ONLY the TypeScript code. No explanations.',
    ].filter(Boolean).join('\n');
}

function resolveSpecPath(scenario: ScenarioInput, testsRoot: string): string {
    let specPath: string;
    if (scenario.targetSpec) {
        specPath = join(testsRoot, scenario.targetSpec);
    } else {
        const safeName = scenario.id.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
        const outputDir = join(testsRoot, 'specs', 'functional', 'ai-assisted');
        specPath = join(outputDir, `${safeName}.spec.ts`);
    }
    // SECURITY: Prevent path traversal
    const resolved = resolve(specPath);
    const resolvedRoot = resolve(testsRoot);
    if (!resolved.startsWith(resolvedRoot + '/') && resolved !== resolvedRoot) {
        throw new Error(`Path traversal blocked: ${specPath} resolves outside testsRoot`);
    }
    if (!resolved.endsWith('.spec.ts') && !resolved.endsWith('.test.ts')) {
        throw new Error(`Invalid spec path: must end in .spec.ts or .test.ts`);
    }
    return specPath;
}

async function generateInitialSpec(
    provider: LLMProvider,
    scenario: ScenarioInput,
    specPath: string,
    apiSurfaceHint: string,
    profile?: GenerationProfile,
): Promise<string | null> {
    const prompt = buildGeneratePrompt(scenario, apiSurfaceHint, profile);
    const response = await provider.generateText(prompt, {
        maxTokens: 8000,
        temperature: 0.1,
        timeout: 60000,
        systemPrompt: `You are an expert Playwright test writer for ${profile?.projectName || 'Mattermost'}. Return only TypeScript code.`,
    });

    // Reuse existing parsing logic from prompts/generation.ts
    const parsed = parseGenerationResponse(response.text, specPath, 'create_spec', scenario.id);
    return parsed?.code ?? null;
}

async function runSingleScenario(
    scenario: ScenarioInput,
    options: AgenticRunOptions,
): Promise<AgenticResult> {
    const {config, provider} = options;
    const warnings: string[] = [];
    const specPath = safeArtifactPath(resolveSpecPath(scenario, config.testsRoot), config.testsRoot);
    const original = existsSync(specPath) ? readFileSync(specPath) : undefined;

    // Build API surface hint
    let apiHint = options.apiSurfaceHint || '';
    if (!apiHint && options.apiSurface) {
        const allClassNames = options.apiSurface.pageObjects.map((po) => po.className);
        apiHint = formatApiSurfaceForPrompt(options.apiSurface, allClassNames);
    }

    // Step 1: Generate initial spec
    let specCode: string | null;
    try {
        specCode = await generateInitialSpec(provider, scenario, specPath, apiHint, options.generationProfile);
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        warnings.push(`Generation failed for ${scenario.id}: ${msg}`);
        return {specPath, scenarioSource: scenario.id, status: 'failed', attempts: 0, warnings};
    }

    if (!specCode) {
        warnings.push(`LLM returned invalid code for ${scenario.id}`);
        return {specPath, scenarioSource: scenario.id, status: 'failed', attempts: 0, warnings};
    }

    safeArtifactPath(specPath, config.testsRoot);
    if (original ? !existsSync(specPath) || !readFileSync(specPath).equals(original) : existsSync(specPath)) {
        return {specPath, scenarioSource: scenario.id, status: 'unverified', attempts: 0, warnings: ['Concurrent spec change; generated code was not written']};
    }
    let quarantinePath: string;
    try {quarantinePath = prepareQuarantine(config.testsRoot);} catch (error) {
        return {specPath, scenarioSource: scenario.id, status: 'unverified', attempts: 0,
            warnings: [`Quarantine unavailable; destination was not changed: ${String(error)}`]};
    }
    mkdirSync(dirname(specPath), {recursive: true});
    let generated = Buffer.from(specCode);
    writeFileSync(specPath, generated);
    let lastRun: PlaywrightRunResult | undefined;
    let verification;
    let attempts = 0;
    try {
        if (!config.dryRun) {
            for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
                attempts = attempt;
                verification = verifyGeneratedSpec(specPath, {...config, timeoutMs: config.testTimeoutMs});
                lastRun = verification.baseline;
                if (verification.verified) {
                    return {specPath, scenarioSource: scenario.id, status: 'passed', attempts, finalRun: lastRun, verification, warnings};
                }
                // A clean but insensitive test is unverified; fixing it must not reuse old evidence.
                if (!lastRun || isCleanRun(lastRun) || attempt === config.maxAttempts) break;
                const fix = await generateFix(provider, {specCode: generated.toString('utf8'), failures: lastRun.failures, attempt, maxAttempts: config.maxAttempts, apiSurfaceHint: apiHint});
                safeArtifactPath(specPath, config.testsRoot);
                if (!readFileSync(specPath).equals(generated)) throw new Error('Concurrent spec edit; fix was not written');
                if (!fix.code) break;
                generated = Buffer.from(fix.code);
                writeFileSync(specPath, generated);
            }
        }
    } catch (error) {
        warnings.push(error instanceof Error ? error.message : String(error));
    }
    if (verification) warnings.push(verification.reason);
    let reviewPath = specPath;
    try {reviewPath = quarantineSpec(specPath, config.testsRoot, original, generated, quarantinePath);} catch (error) {
        warnings.push(`Quarantine unavailable after rejected-spec cleanup: ${String(error)}`);
    }
    return {specPath: reviewPath, scenarioSource: scenario.id, status: config.dryRun ? 'skipped' : 'unverified', attempts, finalRun: lastRun, verification, warnings};

}

export async function runAgenticGeneration(options: AgenticRunOptions): Promise<AgenticSummary> {
    const startTime = Date.now();
    const results: AgenticResult[] = [];
    const warnings: string[] = [];

    for (const scenario of options.scenarios) {
        const result = await runSingleScenario(scenario, options);
        results.push(result);
        warnings.push(...result.warnings);
    }

    const totalPassed = results.filter((r) => r.status === 'passed').length;
    const totalFailed = results.filter((r) => r.status !== 'passed' && r.status !== 'skipped').length;
    const totalAttempts = results.reduce((sum, r) => sum + r.attempts, 0);

    return {
        results,
        totalGenerated: results.length,
        totalPassed,
        totalFailed,
        totalAttempts,
        durationMs: Date.now() - startTime,
        warnings,
    };
}
