// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {PytestAdapter} from '../dist/adapters/pytest.js';
import {SupertestAdapter} from '../dist/adapters/supertest.js';
import {detectFramework, detectTestMode} from '../dist/adapters/framework_adapter.js';

import type {KnowledgeGraph} from '../dist/knowledge/kg_types.js';

describe('adapters', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adapters-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, {recursive: true, force: true});
    });

    describe('PytestAdapter', () => {
        it('has correct specGlob', () => {
            const adapter = new PytestAdapter();
            assert.equal(adapter.specGlob, '**/test_*.py');
        });

        it('has an extractTestPattern regex', () => {
            const adapter = new PytestAdapter();
            const source = 'def test_login():\n    pass\ndef test_logout():\n    pass';
            const matches = [...source.matchAll(adapter.extractTestPattern)];
            assert.equal(matches.length, 2);
            assert.equal(matches[0][1], 'test_login');
            assert.equal(matches[1][1], 'test_logout');
        });

        it('buildRunCommand returns a RunCommand', () => {
            const adapter = new PytestAdapter();
            const cmd = adapter.buildRunCommand('tests/test_auth.py');
            assert.equal(cmd.executable, 'python');
            assert.ok(cmd.args.includes('-m'));
            assert.ok(cmd.args.includes('pytest'));
            assert.ok(cmd.args.includes('tests/test_auth.py'));
            assert.ok(cmd.args.includes('-v'));
        });

        it('buildRunCommand includes timeout when provided', () => {
            const adapter = new PytestAdapter();
            const cmd = adapter.buildRunCommand('tests/test_auth.py', {timeout: 30000});
            assert.ok(cmd.args.some((a) => a.startsWith('--timeout=')));
        });
    });

    describe('SupertestAdapter', () => {
        it('has correct specGlob', () => {
            const adapter = new SupertestAdapter();
            assert.equal(adapter.specGlob, '**/*.{test,spec}.{ts,js}');
        });

        it('buildRunCommand defaults to vitest', () => {
            const adapter = new SupertestAdapter();
            const cmd = adapter.buildRunCommand('tests/api.test.ts');
            assert.equal(cmd.executable, 'npx');
            assert.ok(cmd.args.includes('vitest'));
            assert.ok(cmd.args.includes('run'));
            assert.ok(cmd.args.includes('tests/api.test.ts'));
        });

        it('buildRunCommand uses jest runner when configured', () => {
            const adapter = new SupertestAdapter('jest');
            const cmd = adapter.buildRunCommand('tests/api.test.ts');
            assert.equal(cmd.executable, 'npx');
            assert.ok(cmd.args.includes('jest'));
            assert.ok(!cmd.args.includes('vitest'));
        });

        it('buildRunCommand includes timeout for vitest', () => {
            const adapter = new SupertestAdapter('vitest');
            const cmd = adapter.buildRunCommand('test.ts', {timeout: 5000});
            assert.ok(cmd.args.some((a) => a.startsWith('--testTimeout=')));
        });

        it('buildRunCommand includes timeout for jest', () => {
            const adapter = new SupertestAdapter('jest');
            const cmd = adapter.buildRunCommand('test.ts', {timeout: 5000});
            assert.ok(cmd.args.some((a) => a.startsWith('--testTimeout=')));
        });
    });

    describe('detectFramework', () => {
        it('returns playwright by default when no package.json', () => {
            const adapter = detectFramework(tmpDir);
            assert.equal(adapter.name, 'playwright');
        });

        it('returns playwright by default with empty package.json', () => {
            fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({dependencies: {}}));
            const adapter = detectFramework(tmpDir);
            assert.equal(adapter.name, 'playwright');
        });
    });

    describe('detectTestMode', () => {
        it('returns api when KG has supertest framework', () => {
            const kg: KnowledgeGraph = {
                version: '1.0',
                project: {name: 'API', frameworks: ['supertest'], languages: ['typescript']},
                nodes: [],
                edges: [],
            };
            assert.equal(detectTestMode(tmpDir, kg), 'api');
        });

        it('returns ui when KG has playwright framework', () => {
            const kg: KnowledgeGraph = {
                version: '1.0',
                project: {name: 'UI', frameworks: ['playwright'], languages: ['typescript']},
                nodes: [],
                edges: [],
            };
            assert.equal(detectTestMode(tmpDir, kg), 'ui');
        });

        it('returns both when KG has both UI and API frameworks', () => {
            const kg: KnowledgeGraph = {
                version: '1.0',
                project: {name: 'Full', frameworks: ['playwright', 'supertest'], languages: ['typescript']},
                nodes: [],
                edges: [],
            };
            assert.equal(detectTestMode(tmpDir, kg), 'both');
        });

        it('returns ui by default with no KG and no package.json', () => {
            assert.equal(detectTestMode(tmpDir), 'ui');
        });
    });
});
