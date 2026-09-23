import {it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

it('packed package supports CJS, ESM, MCP imports and installed CLI symlinks', (t) => {
    const root = resolve(__dirname, '..');
    const temp = mkdtempSync(join(tmpdir(), 'impact-gate-package-'));
    t.after(() => rmSync(temp, {recursive: true, force: true}));
    const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temp, '--cache', join(temp, 'cache')], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000}));
    execFileSync('tar', ['-xzf', join(temp, packed[0].filename), '-C', temp]);
    const installed = join(temp, 'package');
    // Resolve runtime dependencies locally; no registry install or provider is needed.
    symlinkSync(join(root, 'node_modules'), join(installed, 'node_modules'), 'dir');
    const consumer = join(temp, 'consumer');
    mkdirSync(join(consumer, 'node_modules', '@yasserkhanorg'), {recursive: true});
    symlinkSync(installed, join(consumer, 'node_modules', '@yasserkhanorg', 'impact-gate'), 'dir');
    const run = (args: string[]) => {
        const result = spawnSync(process.execPath, args, {cwd: consumer, encoding: 'utf8', env: {PATH: process.env.PATH}, timeout: 15000});
        assert.equal(result.status, 0, result.stderr || String(result.error));
        return result.stdout;
    };
    const cjs = run(['-e', `const api = require('${metadata.name}'); const mcp = require('${metadata.name}/mcp'); console.log(typeof api.analyzeImpactDeterministic, typeof mcp.E2EAgentsMCPServer);`]);
    assert.equal(cjs.trim(), 'function function');
    const versionUrl = pathToFileURL(join(installed, 'dist/esm/version.js')).href;
    const esm = run(['--input-type=module', '-e', `
        import * as api from '${metadata.name}';
        import {E2EAgentsMCPServer, handleJsonRpcMessage} from '${metadata.name}/mcp';
        import {getVersion} from ${JSON.stringify(versionUrl)};
        const reply = await handleJsonRpcMessage(new E2EAgentsMCPServer(), {id: 1, method: 'initialize'});
        console.log(JSON.stringify({api: typeof api.analyzeImpactDeterministic, version: getVersion(), mcp: reply.result.serverInfo.version}));
    `]);
    assert.deepEqual(JSON.parse(esm), {api: 'function', version: metadata.version, mcp: metadata.version});
    const binDir = join(consumer, 'node_modules', '.bin');
    mkdirSync(binDir);
    for (const [name, entry] of Object.entries(metadata.bin) as [string, string][]) {
        const target = join(installed, entry);
        assert.ok(statSync(target).mode & 0o111, `${name} must be executable`);
        symlinkSync(target, join(binDir, name));
    }
    assert.match(run([join(binDir, 'impact-gate'), '--help']), /impact-gate <command>/);
    assert.match(run([join(binDir, 'impact-gate-qa'), '--help']), /Usage:/);
    assert.match(run([join(installed, 'dist/esm/cli.js'), 'install-skill', 'qa']), /Installed \/qa/);
    assert.equal(
        readFileSync(join(consumer, '.claude/skills/qa/SKILL.md'), 'utf8'),
        readFileSync(join(installed, 'skills/qa/SKILL.md'), 'utf8'),
        'ESM CLI must copy the packaged skill into the caller directory',
    );
    const mcpBin = spawnSync(process.execPath, [join(binDir, 'impact-gate-mcp')], {cwd: consumer, input: '', encoding: 'utf8', timeout: 5000});
    assert.equal(mcpBin.status, 0, mcpBin.stderr);
});
