import assert from 'assert';
import test from 'node:test';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {spawnSync} from 'child_process';
import {getChangedFiles} from '../dist/agent/git.js';

function runGit(cwd, args) {
    const result = spawnSync('git', args, {cwd, encoding: 'utf-8'});
    if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
    }
}

test('getChangedFiles keeps full path for unstaged changes from git status porcelain', () => {
    const root = mkdtempSync(join(tmpdir(), 'git-changes-'));
    try {
        runGit(root, ['init']);
        runGit(root, ['config', 'user.email', 'test@example.com']);
        runGit(root, ['config', 'user.name', 'Test User']);

        const targetPath = join(root, 'webapp/channels/src/components/channel_header/channel_header.tsx');
        const parentDir = join(root, 'webapp/channels/src/components/channel_header');
        mkdirSync(parentDir, {recursive: true});
        writeFileSync(targetPath, 'export const marker = 1;\n', 'utf-8');
        runGit(root, ['add', '.']);
        runGit(root, ['commit', '-m', 'initial']);

        writeFileSync(targetPath, `${readFileSync(targetPath, 'utf-8')}// local edit\n`, 'utf-8');

        const result = getChangedFiles(join(root, 'webapp'), 'HEAD', {includeUncommitted: true});
        assert.equal(result.error, undefined);
        const hasExpectedPath = result.files.some((file) => file.endsWith('channels/src/components/channel_header/channel_header.tsx'));
        assert.equal(hasExpectedPath, true);
        assert.equal(result.files.some((file) => file.startsWith('ebapp/')), false);
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

test('omits only untracked tool artifacts, preserving new source and staged or tracked configuration', () => {
    const root = mkdtempSync(join(tmpdir(), 'git-artifacts-'));
    try {
        runGit(root, ['init']);
        runGit(root, ['config', 'user.email', 'test@example.com']);
        runGit(root, ['config', 'user.name', 'Test User']);
        writeFileSync(join(root, 'base.ts'), 'export const base = true;\n');
        writeFileSync(join(root, 'impact-gate.config.json'), '{}');
        mkdirSync(join(root, '.e2e-ai-agents'));
        writeFileSync(join(root, '.e2e-ai-agents/route-families.json'), '{}');
        runGit(root, ['add', '.']);
        runGit(root, ['commit', '-m', 'base']);
        writeFileSync(join(root, 'impact-gate.config.json'), '{"profile":"strict"}');
        writeFileSync(join(root, '.e2e-ai-agents/route-families.json'), '{"families":[]}');
        writeFileSync(join(root, 'new.ts'), 'export const newSource = true;\n');
        writeFileSync(join(root, '.e2e-ai-agents/plan.json'), '{}');
        mkdirSync(join(root, 'nested/.e2e-ai-agents'), {recursive: true});
        writeFileSync(join(root, 'nested/.e2e-ai-agents/metrics.jsonl'), '{}\n');
        writeFileSync(join(root, 'nested/impact-gate.config.json'), '{}');
        writeFileSync(join(root, '.impact-gate.config.json'), '{}');
        runGit(root, ['add', '.impact-gate.config.json']);
        const result = getChangedFiles(root, 'HEAD', {includeUncommitted: true});
        assert.equal(result.error, undefined);
        assert.deepEqual(result.files, ['.e2e-ai-agents/route-families.json', '.impact-gate.config.json', 'impact-gate.config.json', 'new.ts']);
        assert.deepEqual(result.ignoredUntrackedFiles, ['.e2e-ai-agents/plan.json', 'nested/.e2e-ai-agents/metrics.jsonl', 'nested/impact-gate.config.json']);
        runGit(root, ['add', '.']);
        runGit(root, ['commit', '-m', 'explicitly tracked artifacts']);
        const committed = getChangedFiles(root, 'HEAD~1');
        assert.equal(committed.error, undefined);
        for (const name of result.ignoredUntrackedFiles) assert.ok(committed.files.includes(name), name);
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});
