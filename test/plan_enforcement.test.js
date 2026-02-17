import assert from 'assert';
import test from 'node:test';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {appendPlanMetrics, buildPlanFromImpactReport} from '../dist/agent/plan.js';

function createBaseImpactReport() {
    return {
        mode: 'impact',
        changedFiles: ['channels/src/actions/websocket_actions.ts'],
        flows: [
            {
                id: 'messaging.realtime',
                name: 'Realtime Messaging',
                kind: 'flow',
                score: 10,
                priority: 'P0',
                reasons: ['Path match'],
                keywords: ['realtime'],
                files: ['channels/src/actions/websocket_actions.ts'],
            },
        ],
        coverage: [],
        gaps: [
            {
                id: 'messaging.realtime',
                name: 'Realtime Messaging',
                kind: 'flow',
                score: 10,
                priority: 'P0',
                reasons: ['No matching tests'],
                keywords: ['realtime'],
                files: ['channels/src/actions/websocket_actions.ts'],
            },
        ],
        dataTestIds: [],
        framework: 'playwright',
        testPatterns: ['specs/**/*.spec.ts'],
        warnings: [],
        runMetadata: {
            runId: 'impact-local-test',
            startedAt: '2026-02-17T00:00:00.000Z',
            completedAt: '2026-02-17T00:00:01.000Z',
            durationMs: 1000,
            sinceRef: 'HEAD',
            appPath: '/tmp/app',
            testsRoot: '/tmp/tests',
        },
    };
}

test('buildPlanFromImpactReport supports advisory vs block enforcement modes', () => {
    const impact = createBaseImpactReport();
    const blockPlan = buildPlanFromImpactReport(impact, {
        enforcementMode: 'block',
        blockOnActions: ['must-add-tests'],
    });
    assert.equal(blockPlan.decision.action, 'must-add-tests');
    assert.equal(blockPlan.enforcement.mode, 'block');
    assert.equal(blockPlan.enforcement.shouldFail, true);

    const advisoryPlan = buildPlanFromImpactReport(impact, {
        enforcementMode: 'advisory',
        blockOnActions: ['must-add-tests'],
    });
    assert.equal(advisoryPlan.decision.action, 'must-add-tests');
    assert.equal(advisoryPlan.enforcement.mode, 'advisory');
    assert.equal(advisoryPlan.enforcement.shouldFail, false);
});

test('appendPlanMetrics writes events and summary aggregates', () => {
    const root = mkdtempSync(join(tmpdir(), 'plan-metrics-'));
    try {
        const impact = createBaseImpactReport();
        const plan = buildPlanFromImpactReport(impact, {
            enforcementMode: 'warn',
            blockOnActions: ['must-add-tests'],
        });
        const output = appendPlanMetrics(root, plan);
        assert.equal(existsSync(output.eventsPath), true);
        assert.equal(existsSync(output.summaryPath), true);

        const summary = JSON.parse(readFileSync(output.summaryPath, 'utf-8'));
        assert.equal(summary.totalRuns, 1);
        assert.equal(summary.byAction['must-add-tests'], 1);
        assert.equal(summary.byRunSet.full, 1);
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});
