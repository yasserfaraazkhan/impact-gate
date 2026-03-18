// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, existsSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';

import {buildCrewMarkdown, appendCrewToSummary, writeCrewArtifacts} from '../dist/cli/commands/plan_crew.js';
import type {CrewPlanInsights} from '../dist/agent/plan.js';

function makeCrewInsights(overrides: Partial<CrewPlanInsights> = {}): CrewPlanInsights {
    return {
        workflow: 'quick-check',
        providerOverride: 'auto',
        summary: {
            impactedFlows: 3,
            strategyEntries: 2,
            testDesigns: 1,
            crossImpacts: 2,
            highRiskCrossImpacts: 1,
            regressionRisks: 1,
            findings: 1,
            generatedSpecs: 0,
            manualReviewEntries: 0,
            totalCostUSD: 0.0042,
            totalTokens: 1500,
        },
        impactedFlows: [],
        strategyEntries: [
            {
                flowId: 'f1',
                flowName: 'Create Channel',
                priority: 'P0',
                approach: 'full-test',
                rationale: 'critical path',
                testCategories: ['happy-path'],
                crossImpactRisk: 'high',
            },
            {
                flowId: 'f2',
                flowName: 'Search',
                priority: 'P1',
                approach: 'smoke-test',
                rationale: 'secondary',
                testCategories: ['edge-case'],
                crossImpactRisk: 'low',
            },
        ],
        testDesigns: [
            {
                flowId: 'f1',
                flowName: 'Create Channel',
                testCases: [
                    {
                        name: 'should create channel',
                        type: 'happy-path',
                        preconditions: ['logged in'],
                        steps: ['click create', 'fill name', 'submit'],
                        expectedOutcome: 'channel created',
                        priority: 'P0',
                        rationale: 'core flow',
                    },
                ],
            },
        ],
        crossImpacts: [
            {sourceFamily: 'channels', affectedFamily: 'threads', sharedDependency: 'post_component', riskLevel: 'high', evidence: 'shared'},
            {sourceFamily: 'channels', affectedFamily: 'search', sharedDependency: 'sidebar', riskLevel: 'low', evidence: 'indirect'},
        ],
        regressionRisks: [
            {familyId: 'channels', filePattern: 'src/channel*.tsx', riskScore: 0.8, reason: 'frequent changes', historicalFailures: 5},
        ],
        findings: [
            {id: 'F1', type: 'gap', severity: 'high', source: 'strategist', summary: 'Missing permission test', details: 'No RBAC tests', relatedFlows: ['f1']},
        ],
        warnings: ['Manifest not found', 'Low confidence on search flow'],
        timings: {understand: 1200, strategize: 800},
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// buildCrewMarkdown
// ---------------------------------------------------------------------------

describe('buildCrewMarkdown', () => {
    it('should include header and summary metrics', () => {
        const md = buildCrewMarkdown(makeCrewInsights());
        assert.ok(md.includes('### Crew Insights'));
        assert.ok(md.includes('Workflow: `quick-check`'));
        assert.ok(md.includes('Impacted flows: **3**'));
        assert.ok(md.includes('Strategy entries: **2**'));
        assert.ok(md.includes('Structured test designs: **1**'));
        assert.ok(md.includes('Cross-impacts: **2** (1 high risk)'));
        assert.ok(md.includes('Findings: **1**'));
        assert.ok(md.includes('$0.0042'));
    });

    it('should include top strategy recommendations', () => {
        const md = buildCrewMarkdown(makeCrewInsights());
        assert.ok(md.includes('Top Strategy Recommendations:'));
        assert.ok(md.includes('Create Channel'));
        assert.ok(md.includes('full-test'));
        assert.ok(md.includes('high cross-impact risk'));
    });

    it('should include structured test designs', () => {
        const md = buildCrewMarkdown(makeCrewInsights());
        assert.ok(md.includes('Structured Test Designs:'));
        assert.ok(md.includes('Create Channel: 1 designed test case(s)'));
    });

    it('should include high-risk cross-impacts', () => {
        const md = buildCrewMarkdown(makeCrewInsights());
        assert.ok(md.includes('High-Risk Cross-Impacts:'));
        assert.ok(md.includes('channels -> threads: post_component'));
        // Should NOT include the low-risk one in the high-risk section
        assert.ok(!md.includes('channels -> search: sidebar'));
    });

    it('should include findings', () => {
        const md = buildCrewMarkdown(makeCrewInsights());
        assert.ok(md.includes('Crew Findings:'));
        assert.ok(md.includes('high gap: Missing permission test'));
    });

    it('should include warnings', () => {
        const md = buildCrewMarkdown(makeCrewInsights());
        assert.ok(md.includes('Crew Warnings:'));
        assert.ok(md.includes('Manifest not found'));
        assert.ok(md.includes('Low confidence on search flow'));
    });

    it('should omit empty sections', () => {
        const md = buildCrewMarkdown(makeCrewInsights({
            strategyEntries: [],
            testDesigns: [],
            crossImpacts: [],
            findings: [],
            warnings: [],
        }));
        assert.ok(!md.includes('Top Strategy Recommendations:'));
        assert.ok(!md.includes('Structured Test Designs:'));
        assert.ok(!md.includes('High-Risk Cross-Impacts:'));
        assert.ok(!md.includes('Crew Findings:'));
        assert.ok(!md.includes('Crew Warnings:'));
    });

    it('should truncate strategy entries at 5', () => {
        const entries = Array.from({length: 8}, (_, i) => ({
            flowId: `f${i}`,
            flowName: `Flow ${i}`,
            priority: 'P1' as const,
            approach: 'smoke-test' as const,
            rationale: 'r',
            testCategories: [] as any[],
            crossImpactRisk: 'low' as const,
        }));
        const md = buildCrewMarkdown(makeCrewInsights({strategyEntries: entries}));
        // Should show only first 5
        assert.ok(md.includes('Flow 4'));
        assert.ok(!md.includes('Flow 5'));
    });
});

// ---------------------------------------------------------------------------
// appendCrewToSummary
// ---------------------------------------------------------------------------

describe('appendCrewToSummary', () => {
    it('should append crew markdown after separator', () => {
        const base = '## Plan Summary\nAll good.';
        const result = appendCrewToSummary(base, makeCrewInsights());
        assert.ok(result.startsWith('## Plan Summary'));
        assert.ok(result.includes('---'));
        assert.ok(result.includes('### Crew Insights'));
    });

    it('should preserve base markdown', () => {
        const base = '## Plan Summary\nAll good.';
        const result = appendCrewToSummary(base, makeCrewInsights());
        assert.ok(result.includes('## Plan Summary\nAll good.'));
    });
});

// ---------------------------------------------------------------------------
// writeCrewArtifacts
// ---------------------------------------------------------------------------

describe('writeCrewArtifacts', () => {
    it('should write JSON and markdown files', () => {
        const tmpDir = mkdtempSync(join(tmpdir(), 'crew-test-'));
        const crew = makeCrewInsights();
        const {crewSummaryPath, crewMarkdownPath} = writeCrewArtifacts(tmpDir, crew);

        assert.ok(existsSync(crewSummaryPath));
        assert.ok(existsSync(crewMarkdownPath));

        // JSON should be valid and round-trip
        const json = JSON.parse(readFileSync(crewSummaryPath, 'utf-8'));
        assert.equal(json.workflow, 'quick-check');
        assert.equal(json.summary.impactedFlows, 3);

        // Markdown should contain crew insights
        const md = readFileSync(crewMarkdownPath, 'utf-8');
        assert.ok(md.includes('### Crew Insights'));
    });

    it('should create output directory if missing', () => {
        const tmpDir = mkdtempSync(join(tmpdir(), 'crew-test-'));
        const nested = join(tmpDir, 'deep', 'nested');
        // nested doesn't exist yet — writeCrewArtifacts should handle it
        // Actually, writeCrewArtifacts writes to <root>/.e2e-ai-agents/
        const {crewSummaryPath} = writeCrewArtifacts(tmpDir, makeCrewInsights());
        assert.ok(existsSync(crewSummaryPath));
    });

    it('should write to .e2e-ai-agents subdirectory', () => {
        const tmpDir = mkdtempSync(join(tmpdir(), 'crew-test-'));
        const {crewSummaryPath, crewMarkdownPath} = writeCrewArtifacts(tmpDir, makeCrewInsights());
        assert.ok(crewSummaryPath.includes('.e2e-ai-agents'));
        assert.ok(crewMarkdownPath.includes('.e2e-ai-agents'));
        assert.ok(crewSummaryPath.endsWith('crew-summary.json'));
        assert.ok(crewMarkdownPath.endsWith('crew-summary.md'));
    });
});
