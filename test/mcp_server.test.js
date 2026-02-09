const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {E2EAgentsMCPServer} = require('../dist/mcp-server.js');

const repoRoot = path.resolve(__dirname, '..');

function parse(result) {
    return JSON.parse(result);
}

test('read_file blocks path traversal', async () => {
    const server = new E2EAgentsMCPServer(repoRoot);
    const result = await server.callTool('read_file', {path: '../package.json'});
    const parsed = parse(result);
    assert.equal(parsed.error, 'Access denied');
});

test('discover_tests rejects invalid glob patterns', async () => {
    const server = new E2EAgentsMCPServer(repoRoot);
    const result = await server.callTool('discover_tests', {pattern: '../**/*.spec.ts'});
    const parsed = parse(result);
    assert.equal(parsed.error, 'Invalid pattern format');
});

test('get_git_changes rejects invalid refs', async () => {
    const server = new E2EAgentsMCPServer(repoRoot);
    const result = await server.callTool('get_git_changes', {since: '--bad-ref'});
    const parsed = parse(result);
    assert.equal(parsed.error, 'Invalid git reference format');
});

test('run_tests rejects invalid browsers without spawning', async () => {
    const server = new E2EAgentsMCPServer(repoRoot);
    const result = await server.callTool('run_tests', {pattern: '**/*.spec.ts', browsers: ['safari']});
    const parsed = parse(result);
    assert.equal(parsed.error, 'Invalid browser specification');
});

test('get_repository_context returns allowed files', async () => {
    const server = new E2EAgentsMCPServer(repoRoot);
    const result = await server.callTool('get_repository_context', {include: ['package.json']});
    const parsed = parse(result);
    assert.ok(parsed['package.json']);
});
