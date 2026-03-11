import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {buildPlanFromImpact, renderCiSummaryMarkdown} from '../dist/engine/plan_builder.js';

function makeImpactResult(overrides = {}) {
    return {
        changedFiles: ['webapp/channels/src/components/search_bar.tsx'],
        expandedFiles: [],
        impactedFeatures: [
            {
                familyId: 'channels',
                featureId: 'channels/search',
                priority: 'P0',
                changedFiles: ['webapp/channels/src/components/search_bar.tsx'],
                playwrightSpecs: ['specs/functional/channels/search/search.spec.ts'],
                cypressSpecs: ['../cypress/tests/integration/channels/search/search_spec.js'],
                userFlows: ['Search for messages', 'Filter search results'],
                coverageStatus: 'covered',
            },
        ],
        unboundFiles: [],
        warnings: [],
        ...overrides,
    };
}

describe('plan_builder', () => {
    it('builds plan with safe-to-merge for fully covered features', () => {
        const impact = makeImpactResult();
        const plan = buildPlanFromImpact(impact);
        assert.equal(plan.schemaVersion, '1.0.0');
        assert.equal(plan.source, 'impact');
        assert.equal(plan.decision.action, 'run-now');
        assert.equal(plan.gapDetails.length, 0);
        assert.equal(plan.coveredFlows.length, 1);
        assert.ok(plan.confidence >= 90);
    });

    it('detects gaps for uncovered P0/P1 features', () => {
        const impact = makeImpactResult({
            impactedFeatures: [
                {
                    familyId: 'auth',
                    priority: 'P0',
                    changedFiles: ['webapp/channels/src/components/login.tsx'],
                    playwrightSpecs: [],
                    cypressSpecs: [],
                    userFlows: ['Log in with email', 'Reset password'],
                    coverageStatus: 'uncovered',
                },
            ],
        });
        const plan = buildPlanFromImpact(impact);
        assert.equal(plan.decision.action, 'must-add-tests');
        assert.equal(plan.gapDetails.length >= 1, true);
        assert.equal(plan.metrics.uncoveredP0P1Flows, 1);
    });

    it('sets confidence to 100 when all files are bound and covered', () => {
        const impact = makeImpactResult();
        const plan = buildPlanFromImpact(impact);
        assert.equal(plan.confidence, 100);
    });

    it('reduces confidence for unbound files', () => {
        const impact = makeImpactResult({
            unboundFiles: ['some/random/file.ts', 'another/file.ts'],
        });
        const plan = buildPlanFromImpact(impact);
        assert.ok(plan.confidence < 100);
    });

    it('includes recommended tests from Playwright specs', () => {
        const impact = makeImpactResult();
        const plan = buildPlanFromImpact(impact);
        assert.ok(plan.recommendedTests.length > 0);
        assert.ok(plan.recommendedTests[0].includes('search.spec.ts'));
    });

    it('includes userFlows as missingScenarios in gap details', () => {
        const impact = makeImpactResult({
            impactedFeatures: [
                {
                    familyId: 'auth',
                    priority: 'P0',
                    changedFiles: ['webapp/channels/src/components/login.tsx'],
                    playwrightSpecs: [],
                    cypressSpecs: [],
                    userFlows: ['Log in with email', 'Reset password'],
                    coverageStatus: 'uncovered',
                },
            ],
        });
        const plan = buildPlanFromImpact(impact);
        const gap = plan.gapDetails.find((g) => g.id === 'auth');
        assert.ok(gap);
        assert.ok(gap.missingScenarios);
        assert.ok(gap.missingScenarios.includes('Log in with email'));
    });

    it('reports partial coverage in gap details', () => {
        const impact = makeImpactResult({
            impactedFeatures: [
                {
                    familyId: 'channels',
                    featureId: 'channels/search',
                    priority: 'P0',
                    changedFiles: ['webapp/channels/src/components/search_bar.tsx'],
                    playwrightSpecs: ['specs/functional/channels/search/search.spec.ts'],
                    cypressSpecs: [],
                    userFlows: ['Search for messages'],
                    coverageStatus: 'partial',
                },
            ],
        });
        const plan = buildPlanFromImpact(impact);
        // Partial gaps are advisory
        const partialGap = plan.gapDetails.find((g) => g.name.includes('partial'));
        assert.ok(partialGap);
    });

    it('handles empty changed files gracefully', () => {
        const impact = makeImpactResult({
            changedFiles: [],
            impactedFeatures: [],
        });
        const plan = buildPlanFromImpact(impact);
        assert.equal(plan.decision.action, 'safe-to-merge');
        assert.equal(plan.metrics.changedFiles, 0);
    });

    it('applies policy overrides', () => {
        const impact = makeImpactResult();
        const plan = buildPlanFromImpact(impact, {enforcementMode: 'block'});
        assert.equal(plan.policy.applied.enforcementMode, 'block');
    });

    it('triggers full run set when risky files are detected', () => {
        const impact = makeImpactResult({
            changedFiles: ['server/auth/login_handler.go'],
            impactedFeatures: [
                {
                    familyId: 'auth',
                    priority: 'P0',
                    changedFiles: ['server/auth/login_handler.go'],
                    playwrightSpecs: ['specs/auth.spec.ts'],
                    cypressSpecs: ['tests/auth.js'],
                    userFlows: ['Log in'],
                    coverageStatus: 'covered',
                },
            ],
        });
        const plan = buildPlanFromImpact(impact);
        assert.equal(plan.runSet, 'full');
        assert.ok(plan.policy.triggeredRules.includes('risky-files'));
    });

    it('correctly counts priority metrics', () => {
        const impact = makeImpactResult({
            impactedFeatures: [
                {familyId: 'a', priority: 'P0', changedFiles: ['a.ts'], playwrightSpecs: ['a.spec.ts'], cypressSpecs: ['a.js'], userFlows: [], coverageStatus: 'covered'},
                {familyId: 'b', priority: 'P0', changedFiles: ['b.ts'], playwrightSpecs: ['b.spec.ts'], cypressSpecs: ['b.js'], userFlows: [], coverageStatus: 'covered'},
                {familyId: 'c', priority: 'P1', changedFiles: ['c.ts'], playwrightSpecs: ['c.spec.ts'], cypressSpecs: ['c.js'], userFlows: [], coverageStatus: 'covered'},
                {familyId: 'd', priority: 'P2', changedFiles: ['d.ts'], playwrightSpecs: ['d.spec.ts'], cypressSpecs: ['d.js'], userFlows: [], coverageStatus: 'covered'},
            ],
        });
        const plan = buildPlanFromImpact(impact);
        assert.equal(plan.metrics.p0Flows, 2);
        assert.equal(plan.metrics.p1Flows, 1);
        assert.equal(plan.metrics.p2Flows, 1);
    });
});

describe('renderCiSummaryMarkdown', () => {
    it('renders must-add-tests summary with gap details', () => {
        const impact = makeImpactResult({
            impactedFeatures: [
                {
                    familyId: 'auth',
                    priority: 'P0',
                    changedFiles: ['login.tsx'],
                    playwrightSpecs: [],
                    cypressSpecs: [],
                    userFlows: ['Log in with email'],
                    coverageStatus: 'uncovered',
                },
            ],
        });
        const plan = buildPlanFromImpact(impact);
        const md = renderCiSummaryMarkdown(plan);
        assert.ok(md.includes('Must add tests'));
        assert.ok(md.includes('auth'));
        assert.ok(md.includes('Log in with email'));
    });

    it('renders covered flows', () => {
        const impact = makeImpactResult();
        const plan = buildPlanFromImpact(impact);
        const md = renderCiSummaryMarkdown(plan);
        assert.ok(md.includes('Covered flows'));
        assert.ok(md.includes('channels/search'));
    });
});
