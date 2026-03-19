import {describe, it, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, rmSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';

import {analyzeImpact} from '../dist/engine/impact_engine.js';
import {clearManifestCache} from '../dist/knowledge/route_families.js';

function createTestEnvironment() {
    const root = join(tmpdir(), `impact-determinism-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const testsRoot = join(root, 'playwright');
    const cypressRoot = join(root, 'cypress');

    // Create directory structure
    mkdirSync(join(testsRoot, '.e2e-ai-agents'), {recursive: true});
    mkdirSync(join(testsRoot, 'specs', 'functional', 'channels', 'search'), {recursive: true});
    mkdirSync(join(testsRoot, 'specs', 'functional', 'channels', 'center_view'), {recursive: true});
    mkdirSync(join(testsRoot, 'specs', 'functional', 'messaging', 'threads'), {recursive: true});
    mkdirSync(join(cypressRoot, 'tests', 'integration', 'channels', 'search'), {recursive: true});
    mkdirSync(join(cypressRoot, 'tests', 'integration', 'channels', 'messaging'), {recursive: true});

    // Create spec files
    writeFileSync(join(testsRoot, 'specs', 'functional', 'channels', 'search', 'search.spec.ts'), 'test("search works", () => {});');
    writeFileSync(join(testsRoot, 'specs', 'functional', 'channels', 'center_view', 'post.spec.ts'), 'test("post renders", () => {});');
    writeFileSync(join(testsRoot, 'specs', 'functional', 'messaging', 'threads', 'thread.spec.ts'), 'test("thread opens", () => {});');
    writeFileSync(join(cypressRoot, 'tests', 'integration', 'channels', 'search', 'search_spec.js'), 'it("MM-T100 search", () => {});');
    writeFileSync(join(cypressRoot, 'tests', 'integration', 'channels', 'messaging', 'post_spec.js'), 'it("MM-T200 post", () => {});');

    // Write manifest with multiple families/features at varying priorities
    const manifest = {
        families: [
            {
                id: 'channels',
                routes: ['/{team}/channels/{channel}'],
                webappPaths: ['webapp/channels/src/components/channel_*', 'webapp/channels/src/components/post*'],
                serverPaths: [],
                specDirs: ['specs/functional/channels/center_view/'],
                cypressSpecDirs: ['../cypress/tests/integration/channels/messaging/'],
                priority: 'P0',
                userFlows: ['Send messages', 'View posts'],
                features: [
                    {
                        id: 'channels/search',
                        webappPaths: ['webapp/channels/src/components/search*'],
                        specDirs: ['specs/functional/channels/search/'],
                        cypressSpecDirs: ['../cypress/tests/integration/channels/search/'],
                        priority: 'P0',
                        userFlows: ['Search for messages', 'Filter search results'],
                    },
                    {
                        id: 'channels/emoji',
                        webappPaths: ['webapp/channels/src/components/emoji*'],
                        specDirs: [],
                        cypressSpecDirs: [],
                        priority: 'P1',
                        userFlows: ['Add emoji reactions'],
                    },
                ],
            },
            {
                id: 'messaging',
                routes: ['/{team}/messages/{user}'],
                webappPaths: ['webapp/channels/src/components/dm_*', 'webapp/channels/src/components/thread*'],
                serverPaths: [],
                specDirs: ['specs/functional/messaging/threads/'],
                cypressSpecDirs: [],
                priority: 'P1',
                userFlows: ['Direct messages', 'Threaded replies'],
                features: [],
            },
            {
                id: 'auth',
                routes: ['/login'],
                webappPaths: ['webapp/channels/src/components/login*'],
                specDirs: [],
                cypressSpecDirs: [],
                priority: 'P0',
                userFlows: ['Log in with email'],
            },
        ],
    };
    writeFileSync(join(testsRoot, '.e2e-ai-agents', 'route-families.json'), JSON.stringify(manifest));

    return {root, testsRoot, cypressRoot};
}

describe('impact_determinism', () => {
    let env: ReturnType<typeof createTestEnvironment>;

    beforeEach(() => {
        clearManifestCache();
        env = createTestEnvironment();
    });

    afterEach(() => {
        clearManifestCache();
        try {
            rmSync(env.root, {recursive: true, force: true});
        } catch {
            // cleanup
        }
    });

    it('produces identical JSON output across 5 runs with the same inputs', () => {
        const changedFiles = [
            'webapp/channels/src/components/search_bar.tsx',
            'webapp/channels/src/components/emoji_picker.tsx',
            'webapp/channels/src/components/login_form.tsx',
            'webapp/channels/src/components/thread_viewer.tsx',
            'unrelated/file.ts',
        ];
        const options = {testsRoot: env.testsRoot, cypressRoot: env.cypressRoot};

        const results: string[] = [];
        for (let i = 0; i < 5; i++) {
            clearManifestCache();
            const result = analyzeImpact(changedFiles, options);
            results.push(JSON.stringify(result));
        }

        for (let i = 1; i < results.length; i++) {
            assert.equal(results[i], results[0], `Run ${i + 1} differs from run 1`);
        }
    });

    it('sorts impacted features by priority (P0 before P1)', () => {
        const changedFiles = [
            'webapp/channels/src/components/search_bar.tsx',   // P0 channels/search
            'webapp/channels/src/components/emoji_picker.tsx',  // P1 channels/emoji
            'webapp/channels/src/components/thread_viewer.tsx', // P1 messaging
            'webapp/channels/src/components/login_form.tsx',    // P0 auth
        ];
        const result = analyzeImpact(changedFiles, {testsRoot: env.testsRoot, cypressRoot: env.cypressRoot});

        const priorities = result.impactedFeatures.map((f) => f.priority);
        // All P0 entries should come before all P1 entries
        const lastP0Index = priorities.lastIndexOf('P0');
        const firstP1Index = priorities.indexOf('P1');
        if (lastP0Index !== -1 && firstP1Index !== -1) {
            assert.ok(lastP0Index < firstP1Index, `P0 features should precede P1 features. Got: ${priorities.join(', ')}`);
        }
    });

    it('returns changedFiles in a stable order', () => {
        const changedFiles = [
            'webapp/channels/src/components/search_results.tsx',
            'webapp/channels/src/components/search_bar.tsx',
        ];
        const options = {testsRoot: env.testsRoot, cypressRoot: env.cypressRoot};

        const results: string[][] = [];
        for (let i = 0; i < 3; i++) {
            clearManifestCache();
            const result = analyzeImpact(changedFiles, options);
            // changedFiles on the feature that binds both
            const feature = result.impactedFeatures.find((f) => f.featureId === 'channels/search');
            assert.ok(feature, 'Should find channels/search feature');
            results.push(feature.changedFiles);
        }

        assert.deepStrictEqual(results[0], results[1], 'Run 1 and 2 changedFiles order should match');
        assert.deepStrictEqual(results[1], results[2], 'Run 2 and 3 changedFiles order should match');
    });

    it('produces identical unboundFiles across runs', () => {
        const changedFiles = [
            'unrelated/zeta.ts',
            'unrelated/alpha.ts',
            'webapp/channels/src/components/search_bar.tsx',
        ];
        const options = {testsRoot: env.testsRoot, cypressRoot: env.cypressRoot};

        const results: string[][] = [];
        for (let i = 0; i < 3; i++) {
            clearManifestCache();
            const result = analyzeImpact(changedFiles, options);
            results.push(result.unboundFiles);
        }

        assert.deepStrictEqual(results[0], results[1], 'Run 1 and 2 unboundFiles should match');
        assert.deepStrictEqual(results[1], results[2], 'Run 2 and 3 unboundFiles should match');
    });
});
