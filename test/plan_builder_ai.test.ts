// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {buildPlanFromImpact, renderCiSummaryMarkdown} from '../dist/engine/plan_builder.js';

function makeImpactResult(overrides = {}) {
    return {
        changedFiles: ['webapp/channels/src/components/login.tsx'],
        expandedFiles: [],
        impactedFeatures: [
            {
                familyId: 'auth',
                featureId: 'auth/login',
                priority: 'P0',
                changedFiles: ['webapp/channels/src/components/login.tsx'],
                playwrightSpecs: [],
                    playwrightSpecDetails: [],
                cypressSpecs: [],
                    cypressSpecDetails: [],
                userFlows: ['Log in with email', 'Reset password'],
                coverageStatus: 'uncovered',
            },
        ],
        unboundFiles: [],
        warnings: [],
        prIncludedTestFiles: [],
        ...overrides,
    };
}

function makeAIEnrichment(overrides = {}) {
    return {
        enrichedFeatures: [
            {
                familyId: 'auth',
                featureId: 'auth/login',
                priority: 'P0',
                changedFiles: ['webapp/channels/src/components/login.tsx'],
                coverageStatus: 'uncovered',
                playwrightSpecs: [],
                    playwrightSpecDetails: [],
                cypressSpecs: [],
                    cypressSpecDetails: [],
                userFlows: ['Log in with email', 'Reset password'],
                aiReasons: ['Login component refactored — authentication flow may break', 'SSO path changed'],
                aiMissingScenarios: ['Test SSO login flow', 'Test MFA challenge', 'Test password reset email'],
                aiCoveredBy: [],
            },
        ],
        unboundFileInsights: [],
        warnings: [],
        providerName: 'test-provider',
        tokenUsage: {input: 100, output: 50},
        ...overrides,
    };
}

describe('buildPlanFromImpact with AI enrichment', () => {
    it('behaves identically to before when aiEnrichment is undefined', () => {
        const impact = makeImpactResult();
        const plan = buildPlanFromImpact(impact);
        assert.equal(plan.source, 'impact');
        assert.equal(plan.decision.action, 'must-add-tests');
        assert.equal(plan.gapDetails.length, 1);
        assert.equal(plan.gapDetails[0].source, 'deterministic');
        // reasons should only contain the base deterministic reason
        assert.equal(plan.gapDetails[0].reasons.length, 1);
        assert.ok(plan.gapDetails[0].reasons[0].includes('No E2E tests found'));
        // missingScenarios fall back to userFlows
        assert.ok(plan.gapDetails[0].missingScenarios);
        assert.ok(plan.gapDetails[0].missingScenarios.includes('Log in with email'));
    });

    it('behaves identically when aiEnrichment is undefined and policyOverride is provided', () => {
        const impact = makeImpactResult();
        const plan = buildPlanFromImpact(impact, {enforcementMode: 'block'});
        assert.equal(plan.source, 'impact');
        assert.equal(plan.policy.applied.enforcementMode, 'block');
        assert.equal(plan.gapDetails[0].source, 'deterministic');
    });

    it('overlays aiReasons onto gap reasons when aiEnrichment is provided', () => {
        const impact = makeImpactResult();
        const ai = makeAIEnrichment();
        const plan = buildPlanFromImpact(impact, undefined, ai);

        assert.equal(plan.gapDetails.length, 1);
        const gap = plan.gapDetails[0];
        // Should have base reason + AI reasons
        assert.ok(gap.reasons.length > 1);
        assert.ok(gap.reasons[0].includes('No E2E tests found'));
        assert.ok(gap.reasons.includes('Login component refactored — authentication flow may break'));
        assert.ok(gap.reasons.includes('SSO path changed'));
    });

    it('sets gap source to ai+deterministic when AI enrichment matches', () => {
        const impact = makeImpactResult();
        const ai = makeAIEnrichment();
        const plan = buildPlanFromImpact(impact, undefined, ai);

        const gap = plan.gapDetails[0];
        assert.equal(gap.source, 'ai+deterministic');
    });

    it('sets plan source to ai+deterministic when aiEnrichment is provided', () => {
        const impact = makeImpactResult();
        const ai = makeAIEnrichment();
        const plan = buildPlanFromImpact(impact, undefined, ai);

        assert.equal(plan.source, 'ai+deterministic');
    });

    it('replaces missingScenarios with aiMissingScenarios when AI enrichment is provided', () => {
        const impact = makeImpactResult();
        const ai = makeAIEnrichment();
        const plan = buildPlanFromImpact(impact, undefined, ai);

        const gap = plan.gapDetails[0];
        assert.ok(gap.missingScenarios);
        assert.ok(gap.missingScenarios.includes('Test SSO login flow'));
        assert.ok(gap.missingScenarios.includes('Test MFA challenge'));
        // Should NOT fall back to userFlows when AI scenarios exist
        assert.ok(!gap.missingScenarios.includes('Log in with email'));
    });

    it('falls back to userFlows for missingScenarios when aiMissingScenarios is empty', () => {
        const impact = makeImpactResult();
        const ai = makeAIEnrichment({
            enrichedFeatures: [
                {
                    familyId: 'auth',
                    featureId: 'auth/login',
                    priority: 'P0',
                    changedFiles: ['webapp/channels/src/components/login.tsx'],
                    coverageStatus: 'uncovered',
                    playwrightSpecs: [],
                    playwrightSpecDetails: [],
                    cypressSpecs: [],
                    cypressSpecDetails: [],
                    userFlows: [],
                    aiReasons: ['Some reason'],
                    aiMissingScenarios: [],
                    aiCoveredBy: [],
                },
            ],
        });
        const plan = buildPlanFromImpact(impact, undefined, ai);

        const gap = plan.gapDetails[0];
        assert.ok(gap.missingScenarios);
        assert.ok(gap.missingScenarios.includes('Log in with email'));
    });

    it('keeps gap source as deterministic when no matching enriched feature exists', () => {
        const impact = makeImpactResult();
        const ai = makeAIEnrichment({
            enrichedFeatures: [
                {
                    familyId: 'channels',
                    featureId: 'channels/search',
                    priority: 'P1',
                    changedFiles: [],
                    coverageStatus: 'covered',
                    playwrightSpecs: ['search.spec.ts'],
                    playwrightSpecDetails: [],
                    cypressSpecs: [],
                    cypressSpecDetails: [],
                    userFlows: [],
                    aiReasons: ['Search updated'],
                    aiMissingScenarios: [],
                    aiCoveredBy: ['search.spec.ts'],
                },
            ],
        });
        const plan = buildPlanFromImpact(impact, undefined, ai);

        // The auth gap has no AI match — should remain deterministic
        const gap = plan.gapDetails.find((g) => g.id === 'auth/login' || g.id === 'auth');
        assert.ok(gap);
        assert.equal(gap.source, 'deterministic');
        assert.equal(gap.reasons.length, 1);
    });

    it('overlays aiReasons onto partial gap when aiEnrichment matches a partial-coverage feature', () => {
        const impact = makeImpactResult({
            impactedFeatures: [
                {
                    familyId: 'channels',
                    featureId: 'channels/messaging',
                    priority: 'P1',
                    changedFiles: ['webapp/channels/src/components/post.tsx'],
                    playwrightSpecs: ['tests/e2e/messaging.spec.ts'],
                    playwrightSpecDetails: [],
                    cypressSpecs: [],
                    cypressSpecDetails: [],
                    userFlows: ['Send a message', 'Edit a message'],
                    coverageStatus: 'partial',
                },
            ],
        });
        const ai = makeAIEnrichment({
            enrichedFeatures: [
                {
                    familyId: 'channels',
                    featureId: 'channels/messaging',
                    priority: 'P1',
                    changedFiles: ['webapp/channels/src/components/post.tsx'],
                    coverageStatus: 'partial',
                    playwrightSpecs: ['tests/e2e/messaging.spec.ts'],
                    playwrightSpecDetails: [],
                    cypressSpecs: [],
                    cypressSpecDetails: [],
                    userFlows: ['Send a message', 'Edit a message'],
                    aiReasons: ['Post component changed — Cypress coverage missing', 'Thread reply path affected'],
                    aiMissingScenarios: [],
                    aiCoveredBy: ['tests/e2e/messaging.spec.ts'],
                },
            ],
        });
        const plan = buildPlanFromImpact(impact, undefined, ai);

        // The partial gap should be present (no full gaps exist)
        assert.equal(plan.gapDetails.length, 1);
        const partialGap = plan.gapDetails[0];
        assert.ok(partialGap.name.includes('(partial)'));
        // Source should be ai+deterministic
        assert.equal(partialGap.source, 'ai+deterministic');
        // AI reasons should be overlaid
        assert.ok(partialGap.reasons.includes('Post component changed — Cypress coverage missing'));
        assert.ok(partialGap.reasons.includes('Thread reply path affected'));
        // Base partial reason should still be present
        assert.ok(partialGap.reasons[0].includes('Cypress only'));
    });

    it('matches enriched feature by featureId when available', () => {
        const impact = makeImpactResult();
        const ai = makeAIEnrichment({
            enrichedFeatures: [
                {
                    // Only keyed by featureId, not familyId
                    familyId: 'other-family',
                    featureId: 'auth/login',
                    priority: 'P0',
                    changedFiles: [],
                    coverageStatus: 'uncovered',
                    playwrightSpecs: [],
                    playwrightSpecDetails: [],
                    cypressSpecs: [],
                    cypressSpecDetails: [],
                    userFlows: [],
                    aiReasons: ['Matched by featureId'],
                    aiMissingScenarios: ['Test featureId match'],
                    aiCoveredBy: [],
                },
            ],
        });
        const plan = buildPlanFromImpact(impact, undefined, ai);

        const gap = plan.gapDetails[0];
        assert.equal(gap.source, 'ai+deterministic');
        assert.ok(gap.reasons.includes('Matched by featureId'));
    });
});

describe('renderCiSummaryMarkdown with AI enrichment', () => {
    it('includes AI-enriched label and AI reasons in markdown when gap has ai+deterministic source', () => {
        const impact = makeImpactResult();
        const ai = makeAIEnrichment();
        const plan = buildPlanFromImpact(impact, undefined, ai);
        const md = renderCiSummaryMarkdown(plan);

        assert.ok(md.includes('AI-enriched'));
        // AI reasons are rendered inline (no "AI insight" label — they appear directly)
        assert.ok(md.includes('Login component refactored'));
        assert.ok(md.includes('Test SSO login flow'));
    });

    it('does not include AI labels when no aiEnrichment is provided', () => {
        const impact = makeImpactResult();
        const plan = buildPlanFromImpact(impact);
        const md = renderCiSummaryMarkdown(plan);

        assert.ok(!md.includes('AI-enriched'));
        assert.ok(!md.includes('AI insight'));
    });
});

describe('advisory scenarios for covered features', () => {
    function makeCoveredImpact() {
        return {
            changedFiles: ['webapp/channels/src/components/search_results.tsx'],
            expandedFiles: [],
            impactedFeatures: [
                {
                    familyId: 'channels',
                    featureId: 'channels/search',
                    priority: 'P0',
                    changedFiles: ['webapp/channels/src/components/search_results.tsx'],
                    playwrightSpecs: ['specs/functional/channels/search/search_results.spec.ts'],
                    playwrightSpecDetails: [],
                    cypressSpecs: [],
                    cypressSpecDetails: [],
                    userFlows: ['Search for messages'],
                    coverageStatus: 'covered',
                },
            ],
            unboundFiles: [],
            warnings: [],
            prIncludedTestFiles: [],
        };
    }

    function makeCoveredEnrichment(missingScenarios = ['Search result highlighting on match']) {
        return {
            enrichedFeatures: [
                {
                    familyId: 'channels',
                    featureId: 'channels/search',
                    priority: 'P0',
                    changedFiles: ['webapp/channels/src/components/search_results.tsx'],
                    coverageStatus: 'covered',
                    playwrightSpecs: ['specs/functional/channels/search/search_results.spec.ts'],
                    playwrightSpecDetails: [],
                    cypressSpecs: [],
                    cypressSpecDetails: [],
                    userFlows: ['Search for messages'],
                    aiReasons: ['Search results component updated — highlighting behavior changed'],
                    aiMissingScenarios: missingScenarios,
                    aiCoveredBy: ['specs/functional/channels/search/search_results.spec.ts'],
                },
            ],
            unboundFileInsights: [],
            warnings: [],
            providerName: 'test-provider',
            tokenUsage: {input: 100, output: 50},
        };
    }

    it('attaches advisoryScenarios to covered flow when AI returns new scenarios', () => {
        const impact = makeCoveredImpact();
        const ai = makeCoveredEnrichment();
        const plan = buildPlanFromImpact(impact, undefined, ai);

        assert.equal(plan.coveredFlows.length, 1);
        const flow = plan.coveredFlows[0];
        assert.ok(flow.advisoryScenarios);
        assert.ok(flow.advisoryScenarios.includes('Search result highlighting on match'));
    });

    it('does not attach advisoryScenarios when AI returns empty missingScenarios for covered flow', () => {
        const impact = makeCoveredImpact();
        const ai = makeCoveredEnrichment([]);
        const plan = buildPlanFromImpact(impact, undefined, ai);

        assert.equal(plan.coveredFlows.length, 1);
        const flow = plan.coveredFlows[0];
        assert.equal(flow.advisoryScenarios, undefined);
    });

    it('does not attach advisoryScenarios when no AI enrichment is provided', () => {
        const impact = makeCoveredImpact();
        const plan = buildPlanFromImpact(impact);

        assert.equal(plan.coveredFlows.length, 1);
        const flow = plan.coveredFlows[0];
        assert.equal(flow.advisoryScenarios, undefined);
    });

    it('renders advisory scenarios as 💡 hint in markdown under covered flow', () => {
        const impact = makeCoveredImpact();
        const ai = makeCoveredEnrichment(['Search result highlighting on match', 'Empty state shown when no results']);
        const plan = buildPlanFromImpact(impact, undefined, ai);
        const md = renderCiSummaryMarkdown(plan);

        assert.ok(md.includes('💡'));
        assert.ok(md.includes('Search result highlighting on match'));
        assert.ok(md.includes('Empty state shown when no results'));
    });

    it('does not render 💡 hints when covered flow has no advisory scenarios', () => {
        const impact = makeCoveredImpact();
        const ai = makeCoveredEnrichment([]);
        const plan = buildPlanFromImpact(impact, undefined, ai);
        const md = renderCiSummaryMarkdown(plan);

        assert.ok(!md.includes('💡'));
    });

    it('matches covered flow enrichment by featureId first', () => {
        const impact = makeCoveredImpact();
        const ai = {
            enrichedFeatures: [
                {
                    familyId: 'other-family', // different familyId
                    featureId: 'channels/search', // but correct featureId
                    priority: 'P0',
                    changedFiles: [],
                    coverageStatus: 'covered',
                    playwrightSpecs: [],
                    playwrightSpecDetails: [],
                    cypressSpecs: [],
                    cypressSpecDetails: [],
                    userFlows: [],
                    aiReasons: ['Matched by featureId'],
                    aiMissingScenarios: ['Advisory via featureId match'],
                    aiCoveredBy: [],
                },
            ],
            unboundFileInsights: [],
            warnings: [],
            providerName: 'test-provider',
            tokenUsage: {input: 0, output: 0},
        };
        const plan = buildPlanFromImpact(impact, undefined, ai);

        const flow = plan.coveredFlows[0];
        assert.ok(flow.advisoryScenarios);
        assert.ok(flow.advisoryScenarios.includes('Advisory via featureId match'));
    });
});
