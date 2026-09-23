// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {mkdirSync, writeFileSync} from 'fs';
import {join, resolve} from 'path';

import {resolveConfig} from '../../agent/config.js';
import {runAgenticGeneration, type ScenarioInput} from '../../agentic/runner.js';
import {findConfigUpwards} from '../../cli/parse_args.js';
import {loadOrBuildApiSurface} from '../../knowledge/api_surface.js';
import {loadGraphifyGraph} from '../../knowledge/graphify_bridge.js';
import {loadKnowledgeGraph} from '../../knowledge/kg_bridge.js';
import {logger} from '../../logger.js';
import {resolveGenerationProfile} from '../../prompts/generation_profile.js';
import {LLMProviderFactory} from '../../provider_factory.js';
import type {Finding, QAConfig} from '../types.js';

const MAX_AUTOMATIC_SCENARIOS = 5;
const SEVERITY_RANK = {critical: 0, high: 1, medium: 2, low: 3, info: 4};

export async function generateSpecsForFindings(
    findings: Finding[],
    config: QAConfig,
): Promise<string[]> {
    // Both canonical and legacy functional finding categories are actionable.
    const actionable = findings.filter(
        (f) => f.type === 'functional' || f.type === 'bug' || f.type === 'gap',
    );

    if (actionable.length === 0) {
        logger.info('No actionable findings for spec generation');
        return [];
    }

    const scenarios: ScenarioInput[] = actionable.map((f) => ({
        id: `qa-${f.id}`,
        name: `Verify: ${f.summary}`,
        routeFamily: f.flow || 'qa',
        // Reproduction steps form one test, not a separate test for each click.
        scenarios: [[
            `Verify: ${f.summary}`,
            `URL: ${f.evidence.url || config.baseUrl}`,
            `Expected: ${f.evidence.expectedBehavior || `The issue "${f.summary}" should not occur`}`,
            ...f.evidence.reproSteps.map((step, index) => `${index + 1}. ${step}`),
        ].join('\n')],
        evidence: f.evidence.actualBehavior || f.summary,
        priority: f.severity === 'critical' || f.severity === 'high' ? 'P0' : 'P1',
    }));
    const rankedScenarios = actionable
        .map((finding, index) => ({scenario: scenarios[index], severity: finding.severity}))
        .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
        .map(({scenario}) => scenario);
    const selectedScenarios = rankedScenarios.slice(0, MAX_AUTOMATIC_SCENARIOS);
    const deferredScenarioIds = rankedScenarios.slice(MAX_AUTOMATIC_SCENARIOS).map((scenario) => scenario.id);
    const deferredCount = deferredScenarioIds.length;

    // Keep a reusable CLI-compatible input even if the provider is unavailable.
    const outputDir = resolve(config.outputDir || '.e2e-ai-agents');
    mkdirSync(outputDir, {recursive: true});
    const scenariosPath = join(outputDir, 'qa-findings-scenarios.json');
    const summaryPath = join(outputDir, 'qa-generation-summary.json');
    writeFileSync(scenariosPath, JSON.stringify(scenarios, null, 2), 'utf-8');

    if (deferredCount > 0) {
        logger.warn('Automatic QA generation is limited to five findings; remaining scenarios are saved for manual retry', {
            deferredCount, deferredScenarioIds, scenariosPath,
        });
    }
    logger.info('Generating specs for findings', {count: selectedScenarios.length, deferredCount});

    try {
        const testsRoot = config.testsRoot ? resolve(config.testsRoot) : undefined;
        const projectRoot = testsRoot || process.cwd();
        const configPath = findConfigUpwards(projectRoot);
        const {config: projectConfig} = resolveConfig(projectRoot, configPath, {
            testsRoot,
            gitSince: config.since,
        });
        const reportRoot = projectConfig.testsRoot || projectConfig.path;
        let apiSurface;
        try {
            apiSurface = loadOrBuildApiSurface(reportRoot, projectConfig.apiSurface);
        } catch (error) {
            logger.warn('Could not load API surface for QA generation', {error: String(error)});
        }
        const kg = loadGraphifyGraph(projectConfig.path) || loadKnowledgeGraph(projectConfig.path);
        const provider = await LLMProviderFactory.createFromPreference(projectConfig.llm.provider);
        const summary = await runAgenticGeneration({
            scenarios: selectedScenarios,
            config: {
                maxAttempts: 3,
                project: config.project || projectConfig.pipeline.project || '',
                baseUrl: config.baseUrl,
                testTimeoutMs: 120000,
                testsRoot: reportRoot,
                repositoryRoot: projectConfig.path,
                baseRef: projectConfig.git.since,
            },
            provider,
            apiSurface,
            generationProfile: resolveGenerationProfile({profile: projectConfig.profile, testMode: 'ui'}, kg),
        });
        writeFileSync(summaryPath, JSON.stringify({scenariosPath, ...summary, deferredScenarioIds, deferredCount}, null, 2), 'utf-8');
        logger.info('QA generation report saved', {summaryPath});

        for (const result of summary.results) {
            if (result.status !== 'passed') {
                logger.warn('QA spec was not verified; see generation report', {
                    scenario: result.scenarioSource,
                    status: result.status,
                    specPath: result.specPath,
                    warnings: result.warnings,
                });
            }
        }
        // Quarantined proposals remain in the summary, never in verified coverage.
        return summary.results.filter((result) => result.status === 'passed').map((result) => result.specPath);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writeFileSync(summaryPath, JSON.stringify({scenariosPath, error: message, results: [], deferredScenarioIds, deferredCount}, null, 2), 'utf-8');
        logger.warn('QA spec generation failed; scenarios are available for retry', {error: message, scenariosPath, summaryPath});
        return [];
    }
}
