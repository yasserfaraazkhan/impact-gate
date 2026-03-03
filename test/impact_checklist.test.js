import assert from 'assert';
import test from 'node:test';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {spawnSync} from 'child_process';

const SCRIPT_PATH = join(process.cwd(), 'scripts', 'impact-checklist.js');

function writeReportFiles(root, impact, plan) {
    const reportDir = join(root, '.e2e-ai-agents');
    mkdirSync(reportDir, {recursive: true});
    writeFileSync(join(reportDir, 'impact.json'), JSON.stringify(impact, null, 2), 'utf-8');
    writeFileSync(join(reportDir, 'plan.json'), JSON.stringify(plan, null, 2), 'utf-8');
}

function runChecklist(root) {
    return spawnSync('node', [SCRIPT_PATH, '--root', root], {
        encoding: 'utf-8',
    });
}

function createBaseImpact(root) {
    return {
        mode: 'impact',
        runMetadata: {
            runId: 'impact-local-abc123',
            startedAt: '2026-03-01T00:00:00.000Z',
            completedAt: '2026-03-01T00:00:02.000Z',
            durationMs: 2000,
            sinceRef: 'origin/master',
            appPath: join(root, 'webapp'),
            testsRoot: root,
        },
        changedFiles: ['channels/src/components/channel_header/channel_header.tsx'],
        flows: [
            {
                id: 'messaging.channel-header',
                name: 'Messaging Channel Header',
                kind: 'flow',
                score: 9,
                priority: 'P0',
                reasons: ['Screen-level change'],
                keywords: ['channel', 'header'],
                files: ['channels/src/components/channel_header/channel_header.tsx'],
            },
        ],
        coverage: [
            {
                flowId: 'messaging.channel-header',
                flowName: 'Messaging Channel Header',
                priority: 'P0',
                coveredBy: ['specs/channels/channel_header.spec.ts'],
                score: 2,
                source: 'traceability',
            },
        ],
        gaps: [],
        dataTestIds: [],
        framework: 'playwright',
        testPatterns: ['specs/**/*.spec.ts'],
        warnings: [],
        recommendedTests: ['specs/channels/channel_header.spec.ts'],
        impactModel: {
            schemaVersion: '1.0.0',
            flowMapping: 'catalog',
            testMapping: 'traceability',
            confidenceClass: 'high',
            traceability: {
                source: 'manifest',
                enabled: true,
                manifestPath: '.e2e-ai-agents/traceability.json',
                manifestFound: true,
                manifestTests: 30,
                manifestEdges: 120,
                matchedFlows: 1,
                totalFlows: 1,
                matchedTests: 1,
                coverageRatio: 1,
            },
            dependencyGraph: {
                source: 'static-dependency-graph',
                enabled: true,
                seedFiles: 1,
                expandedFiles: 4,
                analyzedFiles: 400,
                analyzedEdges: 1200,
                maxDepth: 3,
                truncated: false,
            },
        },
    };
}

function createBasePlan() {
    return {
        schemaVersion: '1.0.0',
        runId: 'plan-impact-local-abc123',
        sourceRunId: 'impact-local-abc123',
        generatedAt: '2026-03-01T00:00:03.000Z',
        source: 'impact',
        runSet: 'targeted',
        confidence: 90,
        reasons: ['Sufficient confidence for targeted run list.'],
        recommendedTests: ['specs/channels/channel_header.spec.ts'],
        requiredNewTests: [],
        policy: {
            riskyFiles: [],
            triggeredRules: [],
            applied: {
                minConfidenceForTargeted: 60,
                safeMergeMinConfidence: 85,
                forceFullOnWarningsAtOrAbove: 2,
                forceFullOnP0WithGaps: true,
                forceFullOnRiskyFiles: true,
                riskyFilePatterns: ['**/auth/**'],
                enforcementMode: 'advisory',
                blockOnActions: ['must-add-tests'],
            },
        },
        decision: {
            action: 'run-now',
            title: 'Run now',
            summary: 'Execute the targeted suite for this change set.',
        },
        enforcement: {
            mode: 'advisory',
            blockOnActions: ['must-add-tests'],
            matchedAction: false,
            shouldFail: false,
            summary: 'Advisory mode active: recommendations do not fail CI by default.',
        },
        metrics: {
            changedFiles: 1,
            impactedFlows: 1,
            p0Flows: 1,
            p1Flows: 0,
            p2Flows: 0,
            uncoveredP0P1Flows: 0,
            warnings: 0,
        },
    };
}

test('impact checklist passes for consistent impact/plan reports', () => {
    const root = mkdtempSync(join(tmpdir(), 'impact-checklist-pass-'));
    try {
        const impact = createBaseImpact(root);
        const plan = createBasePlan();
        writeReportFiles(root, impact, plan);

        const result = runChecklist(root);
        assert.equal(result.status, 0, result.stderr || result.stdout);

        const report = JSON.parse(readFileSync(join(root, '.e2e-ai-agents', 'impact-checklist.json'), 'utf-8'));
        assert.equal(report.status, 'pass');
        assert.equal(report.summary.fail, 0);
        assert.equal(report.summary.warn, 0);
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

test('impact checklist fails for invalid run-set policy consistency', () => {
    const root = mkdtempSync(join(tmpdir(), 'impact-checklist-fail-'));
    try {
        const impact = createBaseImpact(root);
        const plan = createBasePlan();
        plan.policy.triggeredRules = ['low-confidence'];
        plan.runSet = 'targeted';
        writeReportFiles(root, impact, plan);

        const result = runChecklist(root);
        assert.equal(result.status, 1);

        const report = JSON.parse(readFileSync(join(root, '.e2e-ai-agents', 'impact-checklist.json'), 'utf-8'));
        assert.equal(report.status, 'fail');
        assert(report.summary.fail >= 1);
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});
