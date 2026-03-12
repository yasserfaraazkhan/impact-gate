// Test for provider_utils.ts functions
import assert from 'assert';
import test from 'node:test';
import {
    API_KEY_PATTERNS,
    sanitizeErrorMessage,
    withTimeout,
    validateAndSanitizeUrl,
    isLocalhost,
} from '../dist/provider_utils.js';

test('API_KEY_PATTERNS validates anthropic keys', () => {
    assert(API_KEY_PATTERNS.anthropic.test('sk-ant-v1-abcdefghijk1234567890123'));
    assert(!API_KEY_PATTERNS.anthropic.test('sk-abcdefghijk'));
    assert(!API_KEY_PATTERNS.anthropic.test('invalid'));
});

test('API_KEY_PATTERNS validates openai keys', () => {
    assert(API_KEY_PATTERNS.openai.test('sk-abcdefghijk1234567890123'));
    assert(!API_KEY_PATTERNS.openai.test('sk-ant-v1-abcdefghijk'));
    assert(!API_KEY_PATTERNS.openai.test('invalid'));
});

test('sanitizeErrorMessage handles authentication errors', () => {
    const error = new Error('401 Unauthorized');
    const msg = sanitizeErrorMessage(error, 'test');
    assert(msg.includes('Authentication failed'));
    assert(!msg.includes('401'));
});

test('sanitizeErrorMessage handles rate limit errors', () => {
    const error = new Error('429 Too Many Requests');
    const msg = sanitizeErrorMessage(error, 'test');
    assert(msg.includes('Rate limit'));
});

test('sanitizeErrorMessage handles timeout errors', () => {
    const error = new Error('Request timeout exceeded');
    const msg = sanitizeErrorMessage(error, 'test');
    assert(msg.includes('timeout'));
});

test('sanitizeErrorMessage handles network errors', () => {
    const error = new Error('ECONNREFUSED');
    const msg = sanitizeErrorMessage(error, 'test');
    assert(msg.includes('Connection failed'));
});

test('sanitizeErrorMessage handles unknown errors safely', () => {
    const error = new Error('Some random error with API_KEY_LEAKED');
    const msg = sanitizeErrorMessage(error, 'test');
    assert(!msg.includes('API_KEY_LEAKED'));
    assert(msg.includes('Operation failed'));
});

test('sanitizeErrorMessage handles non-Error objects', () => {
    const msg = sanitizeErrorMessage({}, 'test');
    assert(msg.includes('unexpected'));
});

test('withTimeout resolves on successful promise', async () => {
    const promise = Promise.resolve('success');
    const result = await withTimeout(promise, 1000, 'test');
    assert.equal(result, 'success');
});

test('withTimeout rejects on timeout', async () => {
    const promise = new Promise((resolve) => {
        setTimeout(() => resolve('late'), 2000);
    });
    try {
        await withTimeout(promise, 100, 'test');
        assert.fail('Should have timed out');
    } catch (error) {
        assert(error instanceof Error);
        assert(error.message.includes('timeout'));
    }
});

test('withTimeout passes through if no timeout specified', async () => {
    const promise = Promise.resolve('success');
    const result = await withTimeout(promise, undefined, 'test');
    assert.equal(result, 'success');
});

test('isLocalhost detects localhost', () => {
    assert(isLocalhost('localhost'));
    assert(isLocalhost('127.0.0.1'));
    assert(isLocalhost('::1'));
    assert(!isLocalhost('example.com'));
    assert(!isLocalhost(''));
    assert(!isLocalhost(undefined));
});

test('validateAndSanitizeUrl requires HTTPS for remote', () => {
    const result = validateAndSanitizeUrl('http://example.com');
    assert(!result.valid);
    assert(result.warning?.includes('HTTPS'));
});

test('validateAndSanitizeUrl allows HTTP for localhost', () => {
    const result = validateAndSanitizeUrl('http://localhost:3000');
    assert(result.valid);
    assert(!result.warning);
});

test('validateAndSanitizeUrl allows HTTPS for remote', () => {
    const result = validateAndSanitizeUrl('https://example.com');
    assert(result.valid);
});

test('validateAndSanitizeUrl handles missing URL', () => {
    const result = validateAndSanitizeUrl(undefined);
    assert(result.valid);
});

test('validateAndSanitizeUrl rejects invalid URLs', () => {
    const result = validateAndSanitizeUrl('not a url');
    assert(!result.valid);
});
