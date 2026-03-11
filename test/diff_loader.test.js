// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import assert from 'assert';
import test from 'node:test';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {spawnSync} from 'child_process';
import {loadDiffs, formatDiffsForPrompt} from '../dist/engine/diff_loader.js';

function runGit(cwd, args) {
    const result = spawnSync('git', args, {cwd, encoding: 'utf-8'});
    if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
    }
    return result.stdout;
}

function createGitRepo(root) {
    runGit(root, ['init']);
    runGit(root, ['config', 'user.email', 'test@example.com']);
    runGit(root, ['config', 'user.name', 'Test User']);
}

test('loadDiffs returns diff content for changed files', () => {
    const root = mkdtempSync(join(tmpdir(), 'diff-loader-'));
    try {
        createGitRepo(root);

        // Create initial file and commit
        writeFileSync(join(root, 'foo.ts'), 'const old = 1;\n', 'utf-8');
        runGit(root, ['add', '.']);
        runGit(root, ['commit', '-m', 'initial']);

        // Capture the SHA of the initial commit to use as `since`
        const since = runGit(root, ['rev-parse', 'HEAD']).trim();

        // Modify the file and commit
        writeFileSync(join(root, 'foo.ts'), 'const new_ = 2;\n', 'utf-8');
        runGit(root, ['add', '.']);
        runGit(root, ['commit', '-m', 'change']);

        const diffs = loadDiffs(root, since, ['foo.ts']);
        assert.ok(diffs instanceof Map, 'should return a Map');
        assert.ok(diffs.has('foo.ts'), 'should have diff for foo.ts');
        const diff = diffs.get('foo.ts');
        assert.ok(diff.includes('-const old'), 'diff should contain removed line');
        assert.ok(diff.includes('+const new_'), 'diff should contain added line');
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

test('loadDiffs returns empty map when no files given', () => {
    const root = mkdtempSync(join(tmpdir(), 'diff-loader-empty-'));
    try {
        createGitRepo(root);
        writeFileSync(join(root, 'bar.ts'), 'const x = 1;\n', 'utf-8');
        runGit(root, ['add', '.']);
        runGit(root, ['commit', '-m', 'initial']);

        const diffs = loadDiffs(root, 'HEAD', []);
        assert.ok(diffs instanceof Map, 'should return a Map');
        assert.strictEqual(diffs.size, 0, 'should be empty when no files given');
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

test('loadDiffs truncates large diffs', () => {
    const root = mkdtempSync(join(tmpdir(), 'diff-loader-large-'));
    try {
        createGitRepo(root);

        // Create initial file
        writeFileSync(join(root, 'big.ts'), 'const start = 0;\n', 'utf-8');
        runGit(root, ['add', '.']);
        runGit(root, ['commit', '-m', 'initial']);

        // Capture the SHA of the initial commit to use as `since`
        const since = runGit(root, ['rev-parse', 'HEAD']).trim();

        // Create a large file (5000 lines)
        const lines = [];
        for (let i = 0; i < 5000; i++) {
            lines.push(`const line${i} = ${i};`);
        }
        writeFileSync(join(root, 'big.ts'), lines.join('\n') + '\n', 'utf-8');
        runGit(root, ['add', '.']);
        runGit(root, ['commit', '-m', 'add large file']);

        const diffs = loadDiffs(root, since, ['big.ts']);
        assert.ok(diffs.has('big.ts'), 'should have diff for big.ts');
        const diff = diffs.get('big.ts');
        // Truncation limit is 8000 chars + possible truncation message
        assert.ok(diff.length <= 8200, `diff should be truncated, got ${diff.length} chars`);
        assert.ok(diff.includes('truncated'), 'diff should contain truncation notice');
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

test('formatDiffsForPrompt returns no-diffs message for empty map', () => {
    const result = formatDiffsForPrompt(new Map());
    assert.strictEqual(result, 'No diffs available.');
});

test('formatDiffsForPrompt formats diffs with file headers', () => {
    const diffs = new Map([
        ['foo.ts', 'diff content here'],
        ['bar.ts', 'other diff content'],
    ]);
    const result = formatDiffsForPrompt(diffs);
    assert.ok(result.includes('--- foo.ts ---'), 'should include foo.ts header');
    assert.ok(result.includes('--- bar.ts ---'), 'should include bar.ts header');
    assert.ok(result.includes('diff content here'), 'should include foo.ts content');
    assert.ok(result.includes('other diff content'), 'should include bar.ts content');
});
