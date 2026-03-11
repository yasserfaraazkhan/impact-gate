// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

import {enrichImpactWithAI} from '../dist/engine/ai_enrichment.js';

// Minimal mock deterministic impact result
function makeDeterministicImpact() {
    return {
        changedFiles: ['src/components/search/SearchBar.tsx'],
        expandedFiles: [],
        impactedFeatures: [
            {
                familyId: 'search',
                featureId: 'search.basic',
                priority: 'P0',
                changedFiles: ['src/components/search/SearchBar.tsx'],
                playwrightSpecs: ['tests/search/search_basic.spec.ts'],
                cypressSpecs: [],
                userFlows: ['User searches for messages'],
                coverageStatus: 'partial',
            },
        ],
        unboundFiles: ['src/utils/helper.ts'],
        warnings: [],
    };
}

// Mock provider factory
function makeMockProvider(responseText) {
    return {
        name: 'mock',
        capabilities: {
            vision: false,
            streaming: false,
            maxTokens: 8000,
            costPer1MInputTokens: 0,
            costPer1MOutputTokens: 0,
            supportsTools: false,
            supportsPromptCaching: false,
            typicalResponseTimeMs: 100,
        },
        async generateText(_prompt, _options) {
            return {
                text: responseText,
                usage: {inputTokens: 100, outputTokens: 50, totalTokens: 150},
                cost: 0,
            };
        },
        getUsageStats() {
            return {
                requestCount: 1,
                totalInputTokens: 100,
                totalOutputTokens: 50,
                totalTokens: 150,
                totalCost: 0,
                averageResponseTimeMs: 100,
                failedRequests: 0,
                startTime: new Date(),
                lastUpdated: new Date(),
            };
        },
        resetUsageStats() {},
    };
}

describe('enrichImpactWithAI', () => {
    test('Test 1: Valid AI response enriches features correctly', async () => {
        const validAIResponse = JSON.stringify({
            impactedFlows: [
                {
                    id: 'search.basic',
                    name: 'Basic Search',
                    priority: 'P0',
                    reasons: ['SearchBar component changed', 'Query parsing logic updated'],
                    coveredBy: ['tests/search/search_basic.spec.ts'],
                    missingScenarios: ['Search with special characters', 'Empty search query handling'],
                },
            ],
            unboundFileAnalysis: [
                {
                    file: 'src/utils/helper.ts',
                    likelyFeature: 'general-utilities',
                    reason: 'Helper functions used across multiple features',
                },
            ],
        });

        const deterministicImpact = makeDeterministicImpact();
        const diffs = new Map([
            ['src/components/search/SearchBar.tsx', '--- a/SearchBar.tsx\n+++ b/SearchBar.tsx\n@@ -1,3 +1,4 @@\n+import React from "react";'],
        ]);
        const provider = makeMockProvider(validAIResponse);

        const result = await enrichImpactWithAI({
            deterministicImpact,
            diffs,
            provider,
            specList: ['tests/search/search_basic.spec.ts', 'tests/login/login.spec.ts'],
        });

        // Basic structure checks
        assert.ok(result.enrichedFeatures.length > 0, 'Should have enriched features');
        assert.equal(result.providerName, 'mock', 'Provider name should be "mock"');

        // The matched feature should have AI-enriched data
        const firstFeature = result.enrichedFeatures[0];
        assert.ok(firstFeature.aiReasons.length > 0, 'Should have AI reasons');
        assert.ok(
            firstFeature.aiReasons.some((r) => r.includes('SearchBar') || r.includes('changed') || r.includes('Query')),
            'AI reasons should contain expected content',
        );
        assert.ok(firstFeature.aiMissingScenarios.length > 0, 'Should have missing scenarios');
        assert.ok(
            firstFeature.aiMissingScenarios.some((s) => s.includes('special characters') || s.includes('Empty')),
            'Missing scenarios should contain expected content',
        );

        // Token usage
        assert.equal(result.tokenUsage.input, 100, 'Input tokens should be 100');
        assert.equal(result.tokenUsage.output, 50, 'Output tokens should be 50');

        // Unbound file insights
        assert.ok(result.unboundFileInsights.length > 0, 'Should have unbound file insights');
        assert.equal(result.unboundFileInsights[0].file, 'src/utils/helper.ts');
    });

    test('Test 2: Invalid JSON response results in graceful failure', async () => {
        const provider = makeMockProvider('not valid json at all %%%');
        const deterministicImpact = makeDeterministicImpact();
        const diffs = new Map();

        const result = await enrichImpactWithAI({
            deterministicImpact,
            diffs,
            provider,
            specList: [],
        });

        assert.ok(result.warnings.length > 0, 'Should have warnings on parse failure');
        assert.equal(result.enrichedFeatures.length, 0, 'Should have empty enrichedFeatures on failure');
        // Should not throw — result is still a valid AIEnrichmentResult
        assert.ok(Array.isArray(result.unboundFileInsights), 'unboundFileInsights should be an array');
        assert.equal(result.providerName, 'mock', 'providerName should still be set');
    });

    test('Test 3: Provider error results in graceful failure', async () => {
        const throwingProvider = {
            name: 'error-provider',
            capabilities: {},
            async generateText() {
                throw new Error('Network timeout');
            },
            getUsageStats() {
                return {};
            },
            resetUsageStats() {},
        };

        const deterministicImpact = makeDeterministicImpact();

        const result = await enrichImpactWithAI({
            deterministicImpact,
            diffs: new Map(),
            provider: throwingProvider,
            specList: [],
        });

        assert.ok(result.warnings.length > 0, 'Should have warnings on provider error');
        assert.equal(result.enrichedFeatures.length, 0, 'Should have empty enrichedFeatures on error');
        assert.equal(result.providerName, 'error-provider');
    });

    test('Test 4: Deterministic features not mentioned by AI are still included', async () => {
        // AI response mentioning only one of two deterministic features
        const validAIResponse = JSON.stringify({
            impactedFlows: [
                {
                    id: 'login.sso',
                    name: 'SSO Login',
                    priority: 'P1',
                    reasons: ['SSO config changed'],
                    coveredBy: [],
                    missingScenarios: ['SSO token expiry'],
                },
            ],
            unboundFileAnalysis: [],
        });

        const deterministicImpact = {
            changedFiles: ['src/components/search/SearchBar.tsx', 'src/login/sso.ts'],
            expandedFiles: [],
            impactedFeatures: [
                {
                    familyId: 'search',
                    featureId: 'search.basic',
                    priority: 'P0',
                    changedFiles: ['src/components/search/SearchBar.tsx'],
                    playwrightSpecs: [],
                    cypressSpecs: [],
                    userFlows: [],
                    coverageStatus: 'uncovered',
                },
                {
                    familyId: 'login',
                    featureId: 'login.sso',
                    priority: 'P1',
                    changedFiles: ['src/login/sso.ts'],
                    playwrightSpecs: [],
                    cypressSpecs: [],
                    userFlows: [],
                    coverageStatus: 'uncovered',
                },
            ],
            unboundFiles: [],
            warnings: [],
        };

        const provider = makeMockProvider(validAIResponse);

        const result = await enrichImpactWithAI({
            deterministicImpact,
            diffs: new Map(),
            provider,
            specList: [],
        });

        // Both features should be present
        assert.equal(result.enrichedFeatures.length, 2, 'Both deterministic features should be in the result');

        // The search feature (not mentioned by AI) should have empty ai* fields
        const searchFeature = result.enrichedFeatures.find((f) => f.featureId === 'search.basic');
        assert.ok(searchFeature, 'Search feature should be present');
        assert.deepEqual(searchFeature.aiReasons, [], 'Non-AI feature should have empty aiReasons');
        assert.deepEqual(searchFeature.aiMissingScenarios, [], 'Non-AI feature should have empty aiMissingScenarios');

        // The SSO feature (mentioned by AI) should have ai* fields populated
        const ssoFeature = result.enrichedFeatures.find((f) => f.featureId === 'login.sso');
        assert.ok(ssoFeature, 'SSO feature should be present');
        assert.ok(ssoFeature.aiReasons.length > 0, 'AI-mentioned feature should have aiReasons');
    });

    test('Test 5: Markdown-fenced JSON response is parsed correctly', async () => {
        const markdownFencedResponse = `\`\`\`json
{
  "impactedFlows": [
    {
      "id": "search.basic",
      "name": "Basic Search",
      "priority": "P0",
      "reasons": ["Component updated"],
      "coveredBy": [],
      "missingScenarios": ["Edge case A"]
    }
  ],
  "unboundFileAnalysis": []
}
\`\`\``;

        const deterministicImpact = makeDeterministicImpact();
        const provider = makeMockProvider(markdownFencedResponse);

        const result = await enrichImpactWithAI({
            deterministicImpact,
            diffs: new Map(),
            provider,
            specList: [],
        });

        // Should parse successfully — no warnings about parse failure
        const parseWarnings = result.warnings.filter((w) => w.toLowerCase().includes('parse') || w.toLowerCase().includes('json'));
        assert.equal(parseWarnings.length, 0, 'Should not have parse warnings for markdown-fenced JSON');
        assert.ok(result.enrichedFeatures.length > 0, 'Should have enriched features from markdown-fenced response');
    });

    test('Test 6: Manifest summary included when provided', async () => {
        // We verify no error is thrown when manifestSummary is provided
        const validAIResponse = JSON.stringify({
            impactedFlows: [],
            unboundFileAnalysis: [],
        });

        const provider = makeMockProvider(validAIResponse);
        const deterministicImpact = makeDeterministicImpact();

        // Should not throw
        const result = await enrichImpactWithAI({
            deterministicImpact,
            diffs: new Map(),
            provider,
            specList: [],
            manifestSummary: 'This app has 42 route families covering messaging and collaboration.',
        });

        assert.ok(result, 'Should return a result when manifestSummary is provided');
        assert.equal(result.providerName, 'mock');
    });
});
