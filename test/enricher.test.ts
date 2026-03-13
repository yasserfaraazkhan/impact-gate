// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {parseEnrichResponse} from '../dist/training/enricher.js';

describe('parseEnrichResponse', () => {
    it('parses a valid JSON array', () => {
        const input = '[{"id": "channels", "priority": "P0", "userFlows": ["Create channel"]}]';
        const result = parseEnrichResponse(input);
        assert.equal(result.length, 1);
        assert.equal(result[0].id, 'channels');
        assert.equal(result[0].priority, 'P0');
        assert.deepEqual(result[0].userFlows, ['Create channel']);
    });

    it('parses JSON wrapped in markdown fences', () => {
        const input = '```json\n[{"id": "auth", "priority": "P1"}]\n```';
        const result = parseEnrichResponse(input);
        assert.equal(result.length, 1);
        assert.equal(result[0].id, 'auth');
        assert.equal(result[0].priority, 'P1');
    });

    it('returns empty array for completely invalid response', () => {
        const input = 'I cannot help with that';
        const result = parseEnrichResponse(input);
        assert.deepEqual(result, []);
    });

    it('returns empty array for partial/malformed JSON', () => {
        const input = 'Here is the result: [{"id": "broken"';
        const result = parseEnrichResponse(input);
        assert.deepEqual(result, []);
    });

    it('strips invalid priority values', () => {
        const input = '[{"id": "x", "priority": "CRITICAL"}]';
        const result = parseEnrichResponse(input);
        assert.equal(result.length, 1);
        assert.equal(result[0].id, 'x');
        assert.equal(result[0].priority, undefined);
    });

    it('filters out entries missing id', () => {
        const input = '[{"priority": "P0"}, {"id": "valid"}]';
        const result = parseEnrichResponse(input);
        assert.equal(result.length, 1);
        assert.equal(result[0].id, 'valid');
    });

    it('filters out routes with excessively long strings (>=200 chars)', () => {
        const longRoute = '/' + 'a'.repeat(300);
        const input = JSON.stringify([{id: 'x', routes: [longRoute, '/short']}]);
        const result = parseEnrichResponse(input);
        assert.equal(result.length, 1);
        assert.deepEqual(result[0].routes, ['/short']);
    });

    it('returns empty array for empty JSON array', () => {
        const input = '[]';
        const result = parseEnrichResponse(input);
        assert.deepEqual(result, []);
    });

    it('greedy fallback regex matches outermost array brackets', () => {
        // The fallback regex /\[[\s\S]*\]/ is greedy to handle nested arrays.
        // With two separate arrays, it captures the span between first [ and last ],
        // which is not valid JSON, so it returns empty.
        const input = 'Some text [{"id": "first"}] more text [{"id": "second"}]';
        const result = parseEnrichResponse(input);
        assert.deepEqual(result, []);
    });

    it('greedy fallback regex handles nested arrays in JSON', () => {
        // This is the key case: nested arrays like routes: ["/foo"] inside the outer array
        const input = 'Here is the result: [{"id": "test", "routes": ["/foo", "/bar"]}]';
        const result = parseEnrichResponse(input);
        assert.equal(result.length, 1);
        assert.equal(result[0].id, 'test');
        assert.deepEqual(result[0].routes, ['/foo', '/bar']);
    });

    it('parses JSON wrapped in markdown fences without language tag', () => {
        const input = '```\n[{"id": "nolang", "priority": "P2"}]\n```';
        const result = parseEnrichResponse(input);
        assert.equal(result.length, 1);
        assert.equal(result[0].id, 'nolang');
        assert.equal(result[0].priority, 'P2');
    });
});
