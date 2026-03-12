import assert from 'assert';
import test from 'node:test';
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {execFileSync} from 'child_process';
import {tmpdir} from 'os';

const CLI_PATH = join(__dirname, '..', 'dist', 'cli.js');

function makeTmpDir(): string {
    const dir = join(tmpdir(), `e2e-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, {recursive: true});
    return dir;
}

test('init --yes creates config with defaults', () => {
    const dir = makeTmpDir();
    try {
        execFileSync(process.execPath, [CLI_PATH, 'init', '--yes'], {
            cwd: dir,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const configPath = join(dir, 'e2e-ai-agents.config.json');
        assert(existsSync(configPath), 'config file should be created');

        const config = JSON.parse(readFileSync(configPath, 'utf-8'));
        assert.strictEqual(config.path, '.');
        assert.strictEqual(config.framework, 'auto');
        assert.strictEqual(config.git.since, 'origin/main');
        assert.strictEqual(config.impact.dependencyGraph.enabled, true);
        assert.strictEqual(config.impact.traceability.enabled, true);
        assert.strictEqual(config.impact.aiFlow.enabled, true);
        assert.strictEqual(config.policy.enforcementMode, 'advisory');
        assert.deepStrictEqual(config.policy.blockOnActions, ['must-add-tests']);
    } finally {
        rmSync(dir, {recursive: true, force: true});
    }
});

test('init --yes detects playwright from package.json', () => {
    const dir = makeTmpDir();
    try {
        writeFileSync(join(dir, 'package.json'), JSON.stringify({
            devDependencies: {'@playwright/test': '^1.40.0'},
        }));
        execFileSync(process.execPath, [CLI_PATH, 'init', '--yes'], {
            cwd: dir,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const config = JSON.parse(readFileSync(join(dir, 'e2e-ai-agents.config.json'), 'utf-8'));
        assert.strictEqual(config.framework, 'playwright');
    } finally {
        rmSync(dir, {recursive: true, force: true});
    }
});

test('init --yes detects cypress from package.json', () => {
    const dir = makeTmpDir();
    try {
        writeFileSync(join(dir, 'package.json'), JSON.stringify({
            devDependencies: {cypress: '^13.0.0'},
        }));
        execFileSync(process.execPath, [CLI_PATH, 'init', '--yes'], {
            cwd: dir,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const config = JSON.parse(readFileSync(join(dir, 'e2e-ai-agents.config.json'), 'utf-8'));
        assert.strictEqual(config.framework, 'cypress');
    } finally {
        rmSync(dir, {recursive: true, force: true});
    }
});

test('init --yes detects tests root directory', () => {
    const dir = makeTmpDir();
    try {
        mkdirSync(join(dir, 'e2e'), {recursive: true});
        execFileSync(process.execPath, [CLI_PATH, 'init', '--yes'], {
            cwd: dir,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const config = JSON.parse(readFileSync(join(dir, 'e2e-ai-agents.config.json'), 'utf-8'));
        assert.strictEqual(config.testsRoot, 'e2e');
    } finally {
        rmSync(dir, {recursive: true, force: true});
    }
});

test('init refuses if config already exists', () => {
    const dir = makeTmpDir();
    try {
        writeFileSync(join(dir, 'e2e-ai-agents.config.json'), '{}');
        assert.throws(() => {
            execFileSync(process.execPath, [CLI_PATH, 'init', '--yes'], {
                cwd: dir,
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
            });
        });
    } finally {
        rmSync(dir, {recursive: true, force: true});
    }
});

test('init -y is alias for --yes', () => {
    const dir = makeTmpDir();
    try {
        execFileSync(process.execPath, [CLI_PATH, 'init', '-y'], {
            cwd: dir,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        assert(existsSync(join(dir, 'e2e-ai-agents.config.json')), 'config should be created with -y');
    } finally {
        rmSync(dir, {recursive: true, force: true});
    }
});
