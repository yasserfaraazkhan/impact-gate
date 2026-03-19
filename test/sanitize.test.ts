import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {sanitizeSecrets, containsSecrets, sanitizeObject} from '../dist/sanitize.js';

describe('sanitizeSecrets', () => {
    it('redacts Anthropic API keys', () => {
        const text = 'Key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz';
        assert.equal(sanitizeSecrets(text), 'Key: [REDACTED]');
    });

    it('redacts OpenAI API keys', () => {
        const text = 'Key: sk-abcdefghijklmnopqrstuvwxyz1234567890';
        assert.equal(sanitizeSecrets(text), 'Key: [REDACTED]');
    });

    it('does not redact short strings that start with sk-', () => {
        const text = 'Key: sk-short';
        assert.equal(sanitizeSecrets(text), 'Key: sk-short');
    });

    it('redacts generic api_key patterns', () => {
        const text = 'api_key="abcdefghijklmnopqrstuvwxyz"';
        assert.equal(containsSecrets(text), true);
        assert.ok(!sanitizeSecrets(text).includes('abcdefghijklmnopqrstuvwxyz'));
    });

    it('redacts Bearer tokens', () => {
        const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9abcdef';
        assert.equal(containsSecrets(text), true);
        assert.ok(!sanitizeSecrets(text).includes('eyJhbGci'));
    });

    it('redacts AWS access keys', () => {
        const text = 'AWS key: AKIAIOSFODNN7EXAMPLE';
        assert.equal(sanitizeSecrets(text), 'AWS key: [REDACTED]');
    });

    it('redacts GitHub personal access tokens', () => {
        const ghp = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl';
        assert.equal(sanitizeSecrets(`token: ${ghp}`), 'token: [REDACTED]');
    });

    it('redacts github_pat tokens', () => {
        const pat = 'github_pat_ABCDEFGHIJKLMNOPQRSTUVW';
        assert.equal(sanitizeSecrets(`pat: ${pat}`), 'pat: [REDACTED]');
    });

    it('redacts multiple secrets in the same string', () => {
        const text = 'key1=sk-ant-api03-abcdefghijklmnopqrstuvwxyz key2=AKIAIOSFODNN7EXAMPLE';
        const result = sanitizeSecrets(text);
        assert.ok(!result.includes('sk-ant'));
        assert.ok(!result.includes('AKIA'));
    });

    it('returns clean text unchanged', () => {
        const text = 'This is normal text with no secrets.';
        assert.equal(sanitizeSecrets(text), text);
    });

    it('is safe to call concurrently (no shared regex state)', () => {
        const texts = Array.from({length: 100}, (_, i) =>
            `Key ${i}: sk-ant-api03-abcdefghijklmnopqrst${i.toString().padStart(5, '0')}`,
        );
        const results = texts.map(sanitizeSecrets);
        for (const r of results) {
            assert.ok(!r.includes('sk-ant'), `Leaked secret in: ${r}`);
        }
    });
});

describe('containsSecrets', () => {
    it('returns true for strings with secrets', () => {
        assert.equal(containsSecrets('sk-ant-api03-abcdefghijklmnopqrstuvwxyz'), true);
    });

    it('returns false for clean strings', () => {
        assert.equal(containsSecrets('Hello world, no secrets here'), false);
    });
});

describe('sanitizeObject', () => {
    it('sanitizes string values in objects', () => {
        const obj = {key: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz', clean: 'hello'};
        const result = sanitizeObject(obj);
        assert.equal(result.key, '[REDACTED]');
        assert.equal(result.clean, 'hello');
    });

    it('sanitizes nested objects', () => {
        const obj = {outer: {inner: 'Bearer eyJhbGciOiJIUzI1NiJ9abcdef'}};
        const result = sanitizeObject(obj);
        assert.ok(!(result.outer.inner as string).includes('eyJhbGci'));
    });

    it('sanitizes arrays', () => {
        const arr = ['clean', 'AKIAIOSFODNN7EXAMPLE'];
        const result = sanitizeObject(arr);
        assert.equal(result[0], 'clean');
        assert.equal(result[1], '[REDACTED]');
    });

    it('handles null and non-objects gracefully', () => {
        assert.equal(sanitizeObject(null), null);
        assert.equal(sanitizeObject(42), 42);
        assert.equal(sanitizeObject(true), true);
        assert.equal(sanitizeObject(undefined), undefined);
    });

    it('handles deeply nested mixed structures', () => {
        const obj = {
            data: [
                {token: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl'},
                {clean: 'safe'},
            ],
            count: 2,
        };
        const result = sanitizeObject(obj);
        assert.equal(result.data[0].token, '[REDACTED]');
        assert.equal(result.data[1].clean, 'safe');
        assert.equal(result.count, 2);
    });

    it('handles circular references without stack overflow', () => {
        const obj: Record<string, unknown> = {key: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'};
        obj.self = obj; // circular reference
        const result = sanitizeObject(obj);
        assert.equal(result.key, '[REDACTED]');
        assert.equal(result.self, '[Circular]');
    });
});
