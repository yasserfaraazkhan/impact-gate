import assert from 'assert';
import test from 'node:test';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {spawnSync} from 'child_process';

import {resolveConfig} from '../dist/agent/config.js';
import {runImpact} from '../dist/agent/runner.js';

function git(cwd, args) {
    const result = spawnSync('git', args, {cwd, encoding: 'utf-8'});
    if (result.status !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
    }
}

test('mattermost profile enforces strict planning policy defaults', () => {
    const root = mkdtempSync(join(tmpdir(), 'mattermost-profile-config-'));
    try {
        const {config} = resolveConfig(root, undefined, {
            path: root,
            profile: 'mattermost',
            mode: 'impact',
            policy: {
                minConfidenceForTargeted: 60,
                safeMergeMinConfidence: 85,
                forceFullOnWarningsAtOrAbove: 5,
            },
        });

        assert.equal(config.profile, 'mattermost');
        assert.equal(config.impact.allowFallback, false);
        assert.equal(config.impact.traceability.enabled, true);
        assert.equal(config.impact.traceability.minSignalsPerTest >= 2, true);
        assert.equal(config.impact.aiFlow.enabled, true);
        assert.equal(config.impact.aiFlow.strict, true);
        assert.equal(config.impact.aiFlow.provider, 'anthropic');
        assert.equal(config.impact.aiMapping.enabled, true);
        assert.equal(config.impact.aiMapping.provider, 'anthropic');
        assert.equal(config.pipeline.mcp, true);
        assert.equal(config.pipeline.mcpOnly, true);
        assert.equal(config.pipeline.mcpAllowFallback, false);
        assert.equal(config.pipeline.mcpRetries >= 1, true);
        assert.equal(config.policy.minConfidenceForTargeted >= 75, true);
        assert.equal(config.policy.safeMergeMinConfidence >= 90, true);
        assert.equal(config.policy.forceFullOnWarningsAtOrAbove, 1);
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

test('mattermost profile rejects heuristic-only flow mapping when AI flow analysis is disabled', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mattermost-profile-impact-'));
    try {
        const appRoot = join(root, 'webapp');
        const testsRoot = join(root, 'e2e-tests', 'playwright');
        mkdirSync(join(appRoot, 'pages'), {recursive: true});
        mkdirSync(join(testsRoot, 'specs'), {recursive: true});

        const changedFile = join(appRoot, 'pages', 'home.tsx');
        writeFileSync(
            changedFile,
            `
                export function HomePage() {
                    return <button onClick={() => true}>Home</button>;
                }
            `,
            'utf-8',
        );
        writeFileSync(
            join(testsRoot, 'specs', 'home.spec.ts'),
            `test('home page', async () => { /* home flow */ });`,
            'utf-8',
        );

        git(appRoot, ['init']);
        git(appRoot, ['config', 'user.email', 'devnull@example.com']);
        git(appRoot, ['config', 'user.name', 'Dev Null']);
        git(appRoot, ['add', '.']);
        git(appRoot, ['commit', '-m', 'baseline']);
        writeFileSync(changedFile, `export const changed = true;\n`, 'utf-8');

        const {config} = resolveConfig(root, undefined, {
            path: appRoot,
            testsRoot,
            profile: 'mattermost',
            mode: 'impact',
            framework: 'playwright',
            testPatterns: ['specs/**/*.spec.ts'],
            gitSince: 'HEAD',
        });
        config.impact.aiFlow.enabled = false;
        config.impact.aiFlow.strict = false;
        config.impact.aiMapping.enabled = false;

        await assert.rejects(
            () => runImpact(config, {apply: false}),
            /AI or catalog flow mapping/,
        );
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});
