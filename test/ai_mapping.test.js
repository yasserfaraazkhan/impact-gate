import assert from 'assert';
import test from 'node:test';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';

import {mapAITestsToFlows} from '../dist/agent/ai_mapping.js';

const BASE_CONFIG = {
    enabled: true,
    provider: 'anthropic',
    contextFiles: ['CLAUDE.OPTIONAL.md'],
    maxFlowsPerRequest: 10,
    maxCandidateTests: 50,
    maxTokens: 1000,
    temperature: 0,
};

test('ai mapping returns disabled state when feature flag is off', async () => {
    const result = await mapAITestsToFlows(
        '/tmp/app',
        '/tmp/tests',
        {...BASE_CONFIG, enabled: false},
        [],
        [],
    );

    assert.equal(result.enabled, false);
    assert.equal(result.used, false);
    assert.equal(result.coverage.length, 0);
});

test('ai mapping degrades gracefully when Anthropic key is missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-mapping-missing-key-'));
    const appRoot = join(root, 'app');
    const testsRoot = join(root, 'tests');
    mkdirSync(appRoot, {recursive: true});
    mkdirSync(join(testsRoot, 'specs'), {recursive: true});
    writeFileSync(join(testsRoot, 'CLAUDE.OPTIONAL.md'), '# Test context\nUse system console E2E patterns.', 'utf-8');

    const previousKey = process.env.ANTHROPIC_API_KEY;
    try {
        delete process.env.ANTHROPIC_API_KEY;
        const result = await mapAITestsToFlows(
            appRoot,
            testsRoot,
            BASE_CONFIG,
            [
                {
                    id: 'system.analytics',
                    name: 'System Analytics',
                    kind: 'flow',
                    score: 10,
                    priority: 'P0',
                    reasons: ['Changed analytics panel'],
                    keywords: ['analytics'],
                    files: ['channels/src/components/analytics/system_analytics/system_analytics.tsx'],
                },
            ],
            [
                {
                    path: 'specs/functional/system_console/system_analytics.spec.ts',
                    content: null,
                },
            ],
        );

        assert.equal(result.enabled, true);
        assert.equal(result.used, false);
        assert.equal(result.coverage.length, 0);
        assert(
            result.warnings.some((warning) => warning.includes('AI mapping unavailable')),
            `expected missing-key warning, got: ${result.warnings.join(' | ')}`,
        );
    } finally {
        if (previousKey) {
            process.env.ANTHROPIC_API_KEY = previousKey;
        } else {
            delete process.env.ANTHROPIC_API_KEY;
        }
        rmSync(root, {recursive: true, force: true});
    }
});

test('ai mapping skips ambiguous single-keyword candidate pools', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-mapping-ambiguous-'));
    const appRoot = join(root, 'app');
    const testsRoot = join(root, 'tests');
    mkdirSync(appRoot, {recursive: true});
    mkdirSync(join(testsRoot, 'specs'), {recursive: true});

    const result = await mapAITestsToFlows(
        appRoot,
        testsRoot,
        BASE_CONFIG,
        [
            {
                id: 'search_messages',
                name: 'Search Messages',
                kind: 'flow',
                score: 7,
                priority: 'P0',
                reasons: ['Changed search UI'],
                keywords: ['search'],
                files: ['channels/src/components/new_search/new_search.tsx'],
            },
        ],
        [
            {
                path: 'specs/functional/channels/search/search_box_clear_button.spec.ts',
                content: null,
            },
            {
                path: 'specs/functional/channels/search/search_box_suggestions.spec.ts',
                content: null,
            },
        ],
    );

    assert.equal(result.enabled, true);
    assert.equal(result.used, false);
    assert.equal(result.coverage.length, 0);
    assert(
        result.warnings.some((warning) => warning.includes('withheld weak path-only candidates for search_messages')),
        `expected weak-candidate warning, got: ${result.warnings.join(' | ')}`,
    );
    assert(
        result.warnings.some((warning) => warning.includes('AI mapping skipped: no prioritized flows or path-aligned candidate tests were available.')),
        `expected skip warning, got: ${result.warnings.join(' | ')}`,
    );

    rmSync(root, {recursive: true, force: true});
});

test('ai mapping keeps specific multi-keyword candidate pools available for AI selection', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-mapping-specific-'));
    const appRoot = join(root, 'app');
    const testsRoot = join(root, 'tests');
    mkdirSync(appRoot, {recursive: true});
    mkdirSync(join(testsRoot, 'specs'), {recursive: true});
    writeFileSync(join(testsRoot, 'CLAUDE.OPTIONAL.md'), '# Test context\nUse external link coverage only when evidence is specific.', 'utf-8');

    const previousKey = process.env.ANTHROPIC_API_KEY;
    try {
        delete process.env.ANTHROPIC_API_KEY;
        const result = await mapAITestsToFlows(
            appRoot,
            testsRoot,
            BASE_CONFIG,
            [
                {
                    id: 'external_links',
                    name: 'External Links',
                    kind: 'flow',
                    score: 8,
                    priority: 'P1',
                    reasons: ['Changed external link handling'],
                    keywords: ['external', 'links'],
                    files: ['channels/src/components/common/hooks/use_external_link.ts'],
                },
            ],
            [
                {
                    path: 'specs/functional/ai-assisted/external_links/external_links.spec.ts',
                    content: null,
                },
            ],
        );

        assert.equal(result.enabled, true);
        assert.equal(result.used, false);
        assert.equal(result.coverage.length, 0);
        assert(
            result.warnings.some((warning) => warning.includes('AI mapping unavailable')),
            `expected provider warning, got: ${result.warnings.join(' | ')}`,
        );
        assert(
            !result.warnings.some((warning) => warning.includes('withheld weak path-only candidates for external_links')),
            `did not expect weak-candidate warning, got: ${result.warnings.join(' | ')}`,
        );
        assert(
            !result.warnings.some((warning) => warning.includes('AI mapping skipped: no prioritized flows or path-aligned candidate tests were available.')),
            `did not expect skip warning, got: ${result.warnings.join(' | ')}`,
        );
    } finally {
        if (previousKey) {
            process.env.ANTHROPIC_API_KEY = previousKey;
        } else {
            delete process.env.ANTHROPIC_API_KEY;
        }
        rmSync(root, {recursive: true, force: true});
    }
});

test('ai mapping treats generic modal-to-details overlap as insufficient evidence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-mapping-modal-gap-'));
    const appRoot = join(root, 'app');
    const testsRoot = join(root, 'tests');
    mkdirSync(appRoot, {recursive: true});
    mkdirSync(join(testsRoot, 'specs'), {recursive: true});

    const result = await mapAITestsToFlows(
        appRoot,
        testsRoot,
        BASE_CONFIG,
        [
            {
                id: 'view_user_group_modal',
                name: 'View User Group Modal',
                kind: 'flow',
                score: 9,
                priority: 'P1',
                reasons: ['Changed low-traceability user group modal UI'],
                keywords: ['view', 'user', 'group', 'modal'],
                files: ['channels/src/components/view_user_group_modal/view_user_group_modal.tsx'],
            },
        ],
        [
            {
                path: 'specs/functional/ai-assisted/view_user_group_details/view_user_group_details.spec.ts',
                content: null,
            },
        ],
    );

    assert.equal(result.enabled, true);
    assert.equal(result.used, false);
    assert.equal(result.coverage.length, 0);
    assert(
        result.warnings.some((warning) => warning.includes('AI mapping skipped: no prioritized flows or path-aligned candidate tests were available.')),
        `expected skip warning, got: ${result.warnings.join(' | ')}`,
    );

    rmSync(root, {recursive: true, force: true});
});
