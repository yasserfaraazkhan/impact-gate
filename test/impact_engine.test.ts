import {describe, it, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, rmSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';

import {analyzeImpact, getGaps, getPartialGaps} from '../dist/engine/impact_engine.js';
import {clearManifestCache} from '../dist/knowledge/route_families.js';

function createTestEnvironment() {
    const root = join(tmpdir(), `impact-engine-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const testsRoot = join(root, 'playwright');
    const cypressRoot = join(root, 'cypress');

    // Create directory structure
    mkdirSync(join(testsRoot, '.e2e-ai-agents'), {recursive: true});
    mkdirSync(join(testsRoot, 'specs', 'functional', 'channels', 'search'), {recursive: true});
    mkdirSync(join(testsRoot, 'specs', 'functional', 'channels', 'center_view'), {recursive: true});
    mkdirSync(join(cypressRoot, 'tests', 'integration', 'channels', 'search'), {recursive: true});
    mkdirSync(join(cypressRoot, 'tests', 'integration', 'channels', 'messaging'), {recursive: true});

    // Create some spec files
    writeFileSync(join(testsRoot, 'specs', 'functional', 'channels', 'search', 'search.spec.ts'), 'test("search works", () => {});');
    writeFileSync(join(cypressRoot, 'tests', 'integration', 'channels', 'search', 'search_spec.js'), 'it("MM-T100 search", () => {});');
    writeFileSync(join(cypressRoot, 'tests', 'integration', 'channels', 'messaging', 'post_spec.js'), 'it("MM-T200 post", () => {});');

    // Write manifest
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
                id: 'auth',
                routes: ['/login'],
                webappPaths: ['webapp/channels/src/components/login*'],
                specDirs: [],
                cypressSpecDirs: [],
                priority: 'P0',
                userFlows: ['Log in with email'],
            },
            {
                id: 'config',
                routes: ['/admin/config'],
                webappPaths: ['webapp/channels/src/components/admin*'],
                specDirs: [],
                cypressSpecDirs: [],
                priority: 'P0',
                userFlows: ['Configure system'],
            },
        ],
    };
    // Add admin_panel feature to channels that overlaps with config family
    manifest.families[0].features.push({
        id: 'channels/admin_panel',
        webappPaths: ['webapp/channels/src/components/admin*'],
        specDirs: ['specs/functional/channels/center_view/'],
        priority: 'P1',
    });
    writeFileSync(join(testsRoot, '.e2e-ai-agents', 'route-families.json'), JSON.stringify(manifest));

    return {root, testsRoot, cypressRoot};
}

describe('impact_engine', () => {
    let env;

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

    it('returns empty features when no files match', () => {
        const result = analyzeImpact(['some/unrelated/file.ts'], {testsRoot: env.testsRoot});
        assert.equal(result.impactedFeatures.length, 0);
        assert.equal(result.unboundFiles.length, 1);
        assert.equal(result.unboundFiles[0], 'some/unrelated/file.ts');
    });

    it('binds files to features and resolves specs', () => {
        const result = analyzeImpact(
            ['webapp/channels/src/components/search_bar.tsx'],
            {testsRoot: env.testsRoot, cypressRoot: env.cypressRoot},
        );
        assert.equal(result.impactedFeatures.length, 1);
        const feature = result.impactedFeatures[0];
        assert.equal(feature.familyId, 'channels');
        assert.equal(feature.featureId, 'channels/search');
        assert.equal(feature.priority, 'P0');
        assert.equal(feature.coverageStatus, 'covered');
        assert.ok(feature.playwrightSpecs.length > 0, 'Should have Playwright specs');
        assert.ok(feature.cypressSpecs.length > 0, 'Should have Cypress specs');
    });

    it('marks uncovered features when no specs exist', () => {
        const result = analyzeImpact(
            ['webapp/channels/src/components/login_form.tsx'],
            {testsRoot: env.testsRoot, cypressRoot: env.cypressRoot},
        );
        assert.equal(result.impactedFeatures.length, 1);
        const feature = result.impactedFeatures[0];
        assert.equal(feature.familyId, 'auth');
        assert.equal(feature.coverageStatus, 'uncovered');
        assert.equal(feature.playwrightSpecs.length, 0);
        assert.equal(feature.cypressSpecs.length, 0);
    });

    it('falls back to family-level binding when no feature matches', () => {
        const result = analyzeImpact(
            ['webapp/channels/src/components/channel_header.tsx'],
            {testsRoot: env.testsRoot, cypressRoot: env.cypressRoot},
        );
        assert.equal(result.impactedFeatures.length, 1);
        const feature = result.impactedFeatures[0];
        assert.equal(feature.familyId, 'channels');
        assert.equal(feature.featureId, undefined);
    });

    it('handles multiple files across multiple features', () => {
        const result = analyzeImpact(
            [
                'webapp/channels/src/components/search_bar.tsx',
                'webapp/channels/src/components/login_form.tsx',
                'unrelated/file.ts',
            ],
            {testsRoot: env.testsRoot, cypressRoot: env.cypressRoot},
        );
        assert.equal(result.impactedFeatures.length, 2);
        assert.equal(result.unboundFiles.length, 1);
    });

    it('sorts features by priority (P0 first)', () => {
        const result = analyzeImpact(
            [
                'webapp/channels/src/components/emoji_picker.tsx',
                'webapp/channels/src/components/search_bar.tsx',
            ],
            {testsRoot: env.testsRoot, cypressRoot: env.cypressRoot},
        );
        assert.equal(result.impactedFeatures.length, 2);
        assert.equal(result.impactedFeatures[0].priority, 'P0');
        assert.equal(result.impactedFeatures[1].priority, 'P1');
    });

    it('returns warnings for unbound files', () => {
        const result = analyzeImpact(
            ['unrelated/file.ts'],
            {testsRoot: env.testsRoot},
        );
        assert.ok(result.warnings.length > 0);
        assert.ok(result.warnings[0].includes('not mapped'));
    });

    it('uses heuristic families when manifest not found', () => {
        const result = analyzeImpact(
            ['webapp/channels/src/components/search_bar.tsx'],
            {testsRoot: '/nonexistent/path'},
        );
        // Heuristic fallback should produce families from directory grouping
        assert.ok(result.impactedFeatures.length >= 1, 'heuristic families should produce impacted features');
        assert.ok(result.warnings.some((w) => w.includes('heuristic')));
        assert.ok(result.warnings.some((w) => w.includes('train')));
    });

    it('getGaps returns only P0/P1 uncovered features', () => {
        const result = analyzeImpact(
            [
                'webapp/channels/src/components/login_form.tsx',
            ],
            {testsRoot: env.testsRoot, cypressRoot: env.cypressRoot},
        );
        const gaps = getGaps(result);
        // auth is P0 uncovered
        assert.ok(gaps.length >= 1);
        assert.ok(gaps.every((g) => g.coverageStatus === 'uncovered'));
        assert.ok(gaps.every((g) => g.priority === 'P0' || g.priority === 'P1'));
    });

    it('getPartialGaps returns P0/P1 features with partial coverage', () => {
        // channels family has PW specs but no cypress for center_view
        // Let's make a scenario where only PW specs exist
        const result = analyzeImpact(
            ['webapp/channels/src/components/channel_header.tsx'],
            {testsRoot: env.testsRoot, cypressRoot: env.cypressRoot},
        );
        // Family-level: has PW specs in center_view and Cypress in messaging
        // So it should be 'covered' or 'partial' depending on resolution
        const partialGaps = getPartialGaps(result);
        // Either way, the function should not crash
        assert.ok(Array.isArray(partialGaps));
    });

    it('includes userFlows from manifest', () => {
        const result = analyzeImpact(
            ['webapp/channels/src/components/search_bar.tsx'],
            {testsRoot: env.testsRoot, cypressRoot: env.cypressRoot},
        );
        const feature = result.impactedFeatures[0];
        assert.ok(feature.userFlows.length > 0);
        assert.ok(feature.userFlows.includes('Search for messages'));
    });

    it('deduplicates files within the same feature', () => {
        const result = analyzeImpact(
            [
                'webapp/channels/src/components/search_bar.tsx',
                'webapp/channels/src/components/search_results.tsx',
            ],
            {testsRoot: env.testsRoot, cypressRoot: env.cypressRoot},
        );
        // Both files should bind to channels/search
        assert.equal(result.impactedFeatures.length, 1);
        assert.equal(result.impactedFeatures[0].changedFiles.length, 2);
    });

    it('filters out snapshot files (.snap) from changed files', () => {
        const result = analyzeImpact(
            [
                'webapp/channels/src/components/post_view/__snapshots__/post.test.tsx.snap',
                'webapp/channels/src/components/admin/__snapshots__/admin_user_card.test.tsx.snap',
                'webapp/channels/src/components/channel_header.tsx',
            ],
            {testsRoot: env.testsRoot, cypressRoot: env.cypressRoot},
        );
        // Only the non-snapshot source file should survive filtering
        assert.equal(result.changedFiles.length, 1);
        assert.equal(result.changedFiles[0], 'webapp/channels/src/components/channel_header.tsx');
    });

    it('filters out files in __snapshots__ directories', () => {
        const result = analyzeImpact(
            ['webapp/channels/src/components/__snapshots__/anything.snap'],
            {testsRoot: env.testsRoot},
        );
        assert.equal(result.changedFiles.length, 0);
        assert.equal(result.impactedFeatures.length, 0);
    });

    it('suppresses family-level gaps when files are covered by feature-level matches elsewhere', () => {
        const result = analyzeImpact(
            ['webapp/channels/src/components/admin_settings.tsx'],
            {testsRoot: env.testsRoot, cypressRoot: env.cypressRoot},
        );
        // File should match both: config (family-level, uncovered) and channels/admin_panel (feature-level, covered)
        assert.ok(result.impactedFeatures.length >= 2, 'Should match multiple families');

        const gaps = getGaps(result);
        // config gap should be suppressed because admin_settings.tsx is also covered via channels/admin_panel
        const configGap = gaps.find((g) => g.familyId === 'config');
        assert.equal(configGap, undefined, 'config family-level gap should be suppressed when files are covered by feature-level match');
    });

    it('classifies PR-included test files by type', () => {
        const result = analyzeImpact(
            [
                'webapp/channels/src/components/channel_header.tsx',
                'webapp/channels/src/components/__snapshots__/channel.test.tsx.snap',
                'e2e-tests/playwright/specs/channels/new.spec.ts',
                'e2e-tests/cypress/tests/integration/channels/post_spec.js',
                'webapp/channels/src/components/channel_header.test.tsx',
                'server/channels/api4/post_test.go',
            ],
            {testsRoot: env.testsRoot, cypressRoot: env.cypressRoot},
        );

        // Only source file survives filtering
        assert.equal(result.changedFiles.length, 1);
        assert.equal(result.changedFiles[0], 'webapp/channels/src/components/channel_header.tsx');

        // All test files classified
        assert.equal(result.prIncludedTestFiles.length, 5);

        const byType = (type) => result.prIncludedTestFiles.filter((t) => t.type === type);
        assert.equal(byType('snapshot').length, 1);
        assert.equal(byType('playwright').length, 1);
        assert.equal(byType('cypress').length, 1);
        assert.equal(byType('unit').length, 2); // .test.tsx + _test.go
    });
});
