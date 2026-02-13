import assert from 'assert';
import test from 'node:test';
import {mkdtempSync, readFileSync, rmSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {buildGapTestSuggestions} from '../dist/agent/gap_suggestions.js';
import {writeReport} from '../dist/agent/report.js';

test('buildGapTestSuggestions resolves suggested paths under tests root', () => {
    const testsRoot = '/tmp/mattermost/e2e-tests/playwright';
    const suggestions = buildGapTestSuggestions(
        testsRoot,
        [
            {
                id: 'messaging.realtime',
                name: 'Realtime Messaging',
                kind: 'flow',
                score: 42,
                priority: 'P0',
                reasons: ['Path match: channels/src/actions/websocket_actions.ts'],
                keywords: ['messaging', 'realtime'],
                files: ['channels/src/actions/websocket_actions.ts'],
            },
        ],
        'playwright',
        ['specs/**/*.spec.ts'],
    );

    assert.equal(suggestions.length, 1);
    assert.equal(
        suggestions[0].suggestedTestPath,
        '/tmp/mattermost/e2e-tests/playwright/specs/messaging.realtime.spec.ts',
    );
});

test('writeReport emits suggestedNewTests alias in gap JSON', () => {
    const root = mkdtempSync(join(tmpdir(), 'gap-output-'));
    try {
        const suggestion = {
            flowId: 'messaging.realtime',
            flowName: 'Realtime Messaging',
            priority: 'P0',
            rationale: 'Path match',
            sourceFiles: ['channels/src/actions/websocket_actions.ts'],
            suggestedTestPath: '/tmp/mattermost/e2e-tests/playwright/specs/messaging.realtime.spec.ts',
            framework: 'playwright',
            skeleton: 'test skeleton',
        };

        const result = writeReport(
            root,
            {
                artifacts: {
                    mode: 'all',
                    specsDir: '.e2e-ai-agents/reports',
                },
            },
            {
                mode: 'gap',
                changedFiles: ['channels/src/actions/websocket_actions.ts'],
                flows: [],
                coverage: [],
                gaps: [],
                dataTestIds: [],
                framework: 'playwright',
                testPatterns: ['specs/**/*.spec.ts'],
                warnings: [],
                testSuggestions: [suggestion],
            },
        );

        const gapData = JSON.parse(readFileSync(result.jsonPath, 'utf-8'));
        assert.equal(Array.isArray(gapData.testSuggestions), true);
        assert.equal(Array.isArray(gapData.suggestedNewTests), true);
        assert.equal(gapData.testSuggestions.length, 1);
        assert.equal(gapData.suggestedNewTests.length, 1);
        assert.equal(gapData.suggestedNewTests[0].suggestedTestPath, suggestion.suggestedTestPath);
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});
