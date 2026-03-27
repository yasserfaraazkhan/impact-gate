// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
    E2EAgentsMCPServer,
    encodeJsonRpcMessage,
    parseJsonRpcFrames,
    handleJsonRpcMessage,
} from '../dist/mcp-server.js';

const repoRoot = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// encodeJsonRpcMessage
// ---------------------------------------------------------------------------

describe('encodeJsonRpcMessage', () => {
    it('should produce valid Content-Length header', () => {
        const encoded = encodeJsonRpcMessage({jsonrpc: '2.0', id: 1, method: 'ping'});
        assert.ok(encoded.startsWith('Content-Length: '));
        assert.ok(encoded.includes('\r\n\r\n'));
    });

    it('should use byte length not string length for non-ASCII', () => {
        const msg = {jsonrpc: '2.0', id: 1, result: {text: '日本語'}};
        const encoded = encodeJsonRpcMessage(msg);
        const match = encoded.match(/Content-Length:\s*(\d+)/);
        assert.ok(match);
        const claimedLength = Number(match![1]);
        const body = encoded.slice(encoded.indexOf('\r\n\r\n') + 4);
        assert.equal(Buffer.byteLength(body, 'utf8'), claimedLength);
    });
});

// ---------------------------------------------------------------------------
// parseJsonRpcFrames
// ---------------------------------------------------------------------------

describe('parseJsonRpcFrames', () => {
    it('should parse a single complete frame', () => {
        const body = JSON.stringify({jsonrpc: '2.0', id: 1, method: 'ping'});
        const frame = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
        const {messages, remainder} = parseJsonRpcFrames(Buffer.from(frame));
        assert.equal(messages.length, 1);
        assert.equal(messages[0].method, 'ping');
        assert.equal(remainder.length, 0);
    });

    it('should parse multiple frames in one buffer', () => {
        const msg1 = JSON.stringify({jsonrpc: '2.0', id: 1, method: 'ping'});
        const msg2 = JSON.stringify({jsonrpc: '2.0', id: 2, method: 'tools/list'});
        const frame1 = `Content-Length: ${Buffer.byteLength(msg1)}\r\n\r\n${msg1}`;
        const frame2 = `Content-Length: ${Buffer.byteLength(msg2)}\r\n\r\n${msg2}`;
        const {messages, remainder} = parseJsonRpcFrames(Buffer.from(frame1 + frame2));
        assert.equal(messages.length, 2);
        assert.equal(messages[0].id, 1);
        assert.equal(messages[1].id, 2);
        assert.equal(remainder.length, 0);
    });

    it('should return remainder for incomplete frame', () => {
        const body = JSON.stringify({jsonrpc: '2.0', id: 1, method: 'ping'});
        const frame = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body.slice(0, 5)}`;
        const {messages, remainder} = parseJsonRpcFrames(Buffer.from(frame));
        assert.equal(messages.length, 0);
        assert.ok(remainder.length > 0);
    });

    it('should return remainder for partial header', () => {
        const {messages, remainder} = parseJsonRpcFrames(Buffer.from('Content-Le'));
        assert.equal(messages.length, 0);
        assert.ok(remainder.length > 0);
    });

    it('should handle empty buffer', () => {
        const {messages, remainder} = parseJsonRpcFrames(Buffer.alloc(0));
        assert.equal(messages.length, 0);
        assert.equal(remainder.length, 0);
    });

    it('should clear buffer on missing Content-Length header', () => {
        const {messages, remainder} = parseJsonRpcFrames(Buffer.from('Bad-Header: 5\r\n\r\nhello'));
        assert.equal(messages.length, 0);
        assert.equal(remainder.length, 0);
    });
});

// ---------------------------------------------------------------------------
// handleJsonRpcMessage
// ---------------------------------------------------------------------------

describe('handleJsonRpcMessage', () => {
    const server = new E2EAgentsMCPServer(repoRoot);

    it('should handle initialize with dynamic version', async () => {
        const response = await handleJsonRpcMessage(server, {
            id: 1,
            method: 'initialize',
            params: {protocolVersion: '2024-11-05'},
        });
        assert.ok(response);
        const result = response.result as Record<string, unknown>;
        assert.ok(result);
        const info = result.serverInfo as {name: string; version: string};
        assert.equal(info.name, 'impact-gate-mcp');
        // Version should not be hardcoded 1.0.0
        assert.ok(info.version);
        assert.notEqual(info.version, '1.0.0');
    });

    it('should advertise tools, resources, and prompts capabilities', async () => {
        const response = await handleJsonRpcMessage(server, {
            id: 1,
            method: 'initialize',
            params: {},
        });
        assert.ok(response);
        const result = response.result as Record<string, unknown>;
        const caps = result.capabilities as Record<string, unknown>;
        assert.ok(caps.tools);
        assert.ok(caps.resources);
        assert.ok(caps.prompts);
    });

    it('should return null for initialized notification', async () => {
        const response = await handleJsonRpcMessage(server, {method: 'notifications/initialized'});
        assert.equal(response, null);
    });

    it('should list tools', async () => {
        const response = await handleJsonRpcMessage(server, {id: 2, method: 'tools/list'});
        assert.ok(response);
        const result = response.result as {tools: Array<{name: string}>};
        assert.ok(result.tools.length >= 6);
        const names = result.tools.map((t) => t.name);
        assert.ok(names.includes('discover_tests'));
        assert.ok(names.includes('read_file'));
        assert.ok(names.includes('get_repository_context'));
    });

    it('should respond to tools/call', async () => {
        const response = await handleJsonRpcMessage(server, {
            id: 3,
            method: 'tools/call',
            params: {name: 'get_repository_context', arguments: {include: ['package.json']}},
        });
        assert.ok(response);
        const result = response.result as {content: Array<{text: string}>; isError: boolean};
        assert.ok(!result.isError);
        assert.ok(result.content[0].text.includes('impact-gate'));
    });

    it('should return empty resources list', async () => {
        const response = await handleJsonRpcMessage(server, {id: 4, method: 'resources/list'});
        assert.ok(response);
        const result = response.result as {resources: unknown[]};
        assert.deepEqual(result.resources, []);
    });

    it('should return empty prompts list', async () => {
        const response = await handleJsonRpcMessage(server, {id: 5, method: 'prompts/list'});
        assert.ok(response);
        const result = response.result as {prompts: unknown[]};
        assert.deepEqual(result.prompts, []);
    });

    it('should respond to ping', async () => {
        const response = await handleJsonRpcMessage(server, {id: 6, method: 'ping'});
        assert.ok(response);
        assert.deepEqual(response.result, {});
    });

    it('should return method-not-found for unknown methods', async () => {
        const response = await handleJsonRpcMessage(server, {id: 7, method: 'unknown/method'});
        assert.ok(response);
        const error = response.error as {code: number; message: string};
        assert.equal(error.code, -32601);
        assert.ok(error.message.includes('unknown/method'));
    });

    it('should mark tool errors via isError flag', async () => {
        const response = await handleJsonRpcMessage(server, {
            id: 8,
            method: 'tools/call',
            params: {name: 'read_file', arguments: {path: '../../../etc/passwd'}},
        });
        assert.ok(response);
        const result = response.result as {isError: boolean};
        assert.equal(result.isError, true);
    });
});
