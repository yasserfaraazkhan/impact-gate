// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {
    normalizeToClusterId,
    deriveClusterId,
    deriveClusterIdFromPath,
    SKIP_DIRS_WITH_TESTS,
} from '../dist/knowledge/cluster_utils.js';

describe('cluster_utils', () => {
    describe('normalizeToClusterId', () => {
        it('converts camelCase to snake_case', () => {
            assert.equal(normalizeToClusterId('channelSettings'), 'channel_settings');
        });

        it('converts snake_case as-is', () => {
            assert.equal(normalizeToClusterId('channel_settings'), 'channel_settings');
        });

        it('strips special characters', () => {
            // Trailing underscores are stripped by the regex
            assert.equal(normalizeToClusterId('my-comp!@#'), 'my_comp');
            const result = normalizeToClusterId('hello@world');
            assert.ok(!result.endsWith('_'));
            assert.equal(result, 'hello_world');
        });

        it('returns empty string for empty input', () => {
            assert.equal(normalizeToClusterId(''), '');
        });
    });

    describe('deriveClusterId', () => {
        it('uses filePath when present', () => {
            const node = {filePath: 'src/channels/index.ts', name: 'ChannelList'};
            const result = deriveClusterId(node);
            assert.equal(result, 'channels');
        });

        it('falls back to name when filePath is absent', () => {
            const node = {name: 'ChannelList'};
            const result = deriveClusterId(node);
            assert.equal(result, 'channel_list');
        });

        it('returns null for empty name with no filePath', () => {
            const node = {name: ''};
            assert.equal(deriveClusterId(node), null);
        });

        it('returns null for single-char normalized name', () => {
            const node = {name: 'x'};
            assert.equal(deriveClusterId(node), null);
        });
    });

    describe('deriveClusterIdFromPath', () => {
        it('skips default structural dirs', () => {
            assert.equal(deriveClusterIdFromPath('src/channels/index.ts'), 'channels');
            assert.equal(deriveClusterIdFromPath('app/messaging/list.tsx'), 'messaging');
        });

        it('skips file segments (containing dots)', () => {
            // If path is just a file, nothing matches
            assert.equal(deriveClusterIdFromPath('index.ts'), null);
        });

        it('uses custom skipDirs set', () => {
            const skip = new Set(['custom']);
            assert.equal(deriveClusterIdFromPath('custom/mymodule/file.ts', skip), 'mymodule');
        });

        it('returns null when no meaningful segment found', () => {
            assert.equal(deriveClusterIdFromPath('src/'), null);
        });
    });

    describe('SKIP_DIRS_WITH_TESTS', () => {
        it('includes test directories', () => {
            assert.ok(SKIP_DIRS_WITH_TESTS.has('test'));
            assert.ok(SKIP_DIRS_WITH_TESTS.has('tests'));
            assert.ok(SKIP_DIRS_WITH_TESTS.has('e2e'));
            assert.ok(SKIP_DIRS_WITH_TESTS.has('spec'));
            assert.ok(SKIP_DIRS_WITH_TESTS.has('specs'));
        });

        it('includes base structural dirs', () => {
            assert.ok(SKIP_DIRS_WITH_TESTS.has('src'));
            assert.ok(SKIP_DIRS_WITH_TESTS.has('app'));
            assert.ok(SKIP_DIRS_WITH_TESTS.has('lib'));
        });
    });
});
