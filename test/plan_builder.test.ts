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
                    playwrightSpecDetails: [],
                cypressSpecs: ['../cypress/tests/integration/channels/search/search_spec.js'],
                    cypressSpecDetails: [],
                userFlows: ['Search for messages', 'Filter search results'],
                coverageStatus: 'covered',
            },
        ],
        unboundFiles: [],
        warnings: [],
        prIncludedTestFiles: [],
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
                    playwrightSpecDetails: [],
                    cypressSpecs: [],
                    cypressSpecDetails: [],
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
                    playwrightSpecDetails: [],
                    cypressSpecs: [],
                    cypressSpecDetails: [],
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
                    playwrightSpecDetails: [],
                    cypressSpecs: [],
                    cypressSpecDetails: [],
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
                    playwrightSpecDetails: [],
                    cypressSpecs: ['tests/auth.js'],
                    cypressSpecDetails: [],
                    userFlows: ['Log in'],
                    coverageStatus: 'covered',
                },
            ],
        });
        const plan = buildPlanFromImpact(impact);
        assert.equal(plan.runSet, 'full');
        assert.ok(plan.policy.triggeredRules.includes('risky-files'));
    });

    it('softens to run-now when PR includes Cypress E2E specs alongside gaps', () => {
        const impact = makeImpactResult({
            impactedFeatures: [
                {
                    familyId: 'post',
                    priority: 'P0',
                    changedFiles: ['webapp/channels/src/components/message_attachment.tsx'],
                    playwrightSpecs: [],
                    playwrightSpecDetails: [],
                    cypressSpecs: [],
                    cypressSpecDetails: [],
                    userFlows: ['View attachments'],
                    coverageStatus: 'uncovered',
                },
            ],
            prIncludedTestFiles: [
                {file: 'e2e-tests/cypress/tests/integration/channels/attachment_spec.ts', type: 'cypress'},
            ],
        });
        const plan = buildPlanFromImpact(impact);
        assert.equal(plan.decision.action, 'run-now');
        assert.ok(plan.decision.summary.includes('E2E'));
    });

    it('softens to run-now when PR includes Playwright specs alongside gaps', () => {
        const impact = makeImpactResult({
            impactedFeatures: [
                {
                    familyId: 'auth',
                    priority: 'P0',
                    changedFiles: ['webapp/channels/src/components/login.tsx'],
                    playwrightSpecs: [],
                    playwrightSpecDetails: [],
                    cypressSpecs: [],
                    cypressSpecDetails: [],
                    userFlows: ['Log in'],
                    coverageStatus: 'uncovered',
                },
            ],
            prIncludedTestFiles: [
                {file: 'e2e-tests/playwright/specs/auth/login.spec.ts', type: 'playwright'},
            ],
        });
        const plan = buildPlanFromImpact(impact);
        assert.equal(plan.decision.action, 'run-now');
    });

    it('still blocks when PR has only unit tests (not E2E) alongside gaps', () => {
        const impact = makeImpactResult({
            impactedFeatures: [
                {
                    familyId: 'auth',
                    priority: 'P0',
                    changedFiles: ['webapp/channels/src/components/login.tsx'],
                    playwrightSpecs: [],
                    playwrightSpecDetails: [],
                    cypressSpecs: [],
                    cypressSpecDetails: [],
                    userFlows: ['Log in'],
                    coverageStatus: 'uncovered',
                },
            ],
            prIncludedTestFiles: [
                {file: 'server/channels/api4/auth_test.go', type: 'unit'},
                {file: 'webapp/channels/src/components/__snapshots__/login.test.tsx.snap', type: 'snapshot'},
            ],
        });
        const plan = buildPlanFromImpact(impact);
        assert.equal(plan.decision.action, 'must-add-tests');
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
                    playwrightSpecDetails: [],
                    cypressSpecs: [],
                    cypressSpecDetails: [],
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
        assert.ok(md.includes('Flows with associated specs'));
        assert.ok(md.includes('channels/search'));
    });
});

describe('decision mapping wording', () => {
    for (const statuses of [['uncovered'], ['covered', 'partial', 'uncovered'], ['covered']]) {
        it(`reports exact mapped/partial/uncovered facts for ${statuses.join('/')}`, () => {
            const features = statuses.map((status, i) => ({...makeImpactResult().impactedFeatures[0], familyId: `family${i}`, featureId: `family${i}`, priority: 'P2', coverageStatus: status}));
            const plan = buildPlanFromImpact(makeImpactResult({impactedFeatures: features}));
            const covered = statuses.filter((s) => s === 'covered').length;
            const partial = statuses.filter((s) => s === 'partial').length;
            const uncovered = statuses.filter((s) => s === 'uncovered').length;
            assert.ok(plan.decision.summary.includes(`${covered} mapped, ${partial} partial, ${uncovered} uncovered`), plan.decision.summary);
            assert.ok(!plan.decision.summary.includes('have test coverage'));
        });
    }
});


it('W3 plan retains provenance and both framework candidates while unassessed paths force full', () => {
    const mappingProvenance = [{file: 'src/ledger.ts', kind: 'declared-traceability', tests: ['ledger.spec.ts'], origins: ['traceability-capture'], evidence: 'unverified'}];
    const evidence = {coverage: 'unavailable', measuredCoverageEdges: 0};
    const plan = buildPlanFromImpact(makeImpactResult({mappingProvenance, evidence, unassessedFiles: ['src/ledger.ts']}));
    assert.equal(plan.runSet, 'full');
    assert.deepEqual(plan.mappingProvenance, mappingProvenance);
    assert.deepEqual(plan.evidence, evidence);
    assert.ok(plan.recommendedTests.some((t) => t.endsWith('search_spec.js')));
    const markdown = renderCiSummaryMarkdown(plan);
    for (const label of ['declared-traceability', 'traceability-capture', 'unverified', 'Measured coverage unavailable']) assert.ok(markdown.includes(label), label);
});


it('describes Cypress-only declared and heuristic candidates as associations in plan and review renders', async () => {
    const {mkdtempSync, mkdirSync, writeFileSync, rmSync} = await import('node:fs');
    const {join} = await import('node:path');
    const {tmpdir} = await import('node:os');
    const {analyzeImpact} = await import('../dist/engine/impact_engine.js');
    const {synthesizeReview} = await import('../dist/engine/review_synthesizer.js');
    const {formatReviewText, formatReviewMarkdown} = await import('../dist/engine/review_formatter.js');
    const root = mkdtempSync(join(tmpdir(), 'cypress-candidate-wording-'));
    try {
        for (const dir of ['src', 'playwright', 'cypress']) mkdirSync(join(root, dir));
        writeFileSync(join(root, 'src/ledger.ts'), 'export const ledger = 1;');
        writeFileSync(join(root, 'cypress/ledger_spec.js'), 'it("ledger", () => {});');
        writeFileSync(join(root, 'playwright/trace.json'), JSON.stringify({schemaVersion: '1.0.0', tests: [{test: 'ledger_spec.js', touchedFiles: ['src/ledger.ts'], signalCount: 1, lastSeen: new Date().toISOString()}]}));
        for (const enabled of [true, false]) {
            const impact = analyzeImpact(['src/ledger.ts'], {testsRoot: join(root, 'playwright'), sourceRoot: root, traceability: {enabled, manifestPath: 'trace.json', minSignalsPerTest: 1}});
            assert.equal(impact.mappingProvenance[0].kind, enabled ? 'declared-traceability' : 'scanner-heuristic');
            assert.equal(impact.impactedFeatures[0].coverageStatus, 'partial');
            for (const ai of [undefined, {enrichedFeatures: [{familyId: impact.impactedFeatures[0].familyId, aiReasons: [], aiMissingScenarios: ['fixture scenario']}]}]) {
                const plan = buildPlanFromImpact(impact, undefined, ai);
                assert.equal(plan.runSet, 'full');
                const reasons = plan.gapDetails.flatMap((g) => g.reasons);
                // Cold-start families retain P2, which the existing partial-gap predicate omits.
                assert.equal(reasons.length, enabled ? (ai ? 2 : 1) : 0);
                const review = synthesizeReview(impact, plan, {level: 'low', score: 0.1, factors: [], metrics: {change: {}, complexity: {}}, recommendation: 'Review fixture'});
                for (const text of [...reasons, formatReviewText(review), formatReviewMarkdown(review)]) {
                    if (enabled) {
                        assert.ok(text.includes('associated Cypress specs'), text);
                        assert.ok(text.includes('no associated Playwright specs'), text);
                    }
                    assert.doesNotMatch(text, /is covered by Cypress|Cypress but no Playwright coverage/);
                }
                assert.doesNotMatch(renderCiSummaryMarkdown(plan), /is covered by Cypress|Cypress but no Playwright coverage/);
            }
        }
    } finally {rmSync(root, {recursive: true, force: true});}
});

it('exported plan schema permits the root fields emitted with ordinary provenance', () => {
    const schema = require('@yasserkhanorg/impact-gate/schemas/plan');
    const plan = JSON.parse(JSON.stringify(buildPlanFromImpact(makeImpactResult({
        mappingProvenance: [{file: 'src/ledger.ts', kind: 'declared-traceability', tests: ['ledger.spec.ts'], origins: ['legacy-import'], evidence: 'unverified'}],
        evidence: {coverage: 'unavailable', measuredCoverageEdges: 0},
    }))));
    assert.ok(plan.mappingProvenance);
    assert.ok(plan.evidence);
    assert.equal(schema.additionalProperties, false);
    // Root-key compatibility for actual serialized output, not full JSON Schema validation.
    assert.deepEqual(Object.keys(plan).filter((key) => !Object.hasOwn(schema.properties, key)), []);
});
