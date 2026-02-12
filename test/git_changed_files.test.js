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
