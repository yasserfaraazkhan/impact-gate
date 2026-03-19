import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {EXIT_CODES, CliError, classifyError} from '../dist/cli/errors.js';

describe('EXIT_CODES', () => {
    it('has expected values', () => {
        assert.equal(EXIT_CODES.SUCCESS, 0);
        assert.equal(EXIT_CODES.GENERAL_ERROR, 1);
        assert.equal(EXIT_CODES.BUDGET_EXCEEDED, 2);
        assert.equal(EXIT_CODES.PROVIDER_UNAVAILABLE, 3);
        assert.equal(EXIT_CODES.INVALID_CONFIG, 4);
    });
});

describe('CliError', () => {
    it('defaults to GENERAL_ERROR exit code', () => {
        const err = new CliError('something went wrong');
        assert.equal(err.exitCode, EXIT_CODES.GENERAL_ERROR);
        assert.equal(err.message, 'something went wrong');
        assert.equal(err.name, 'CliError');
    });

    it('accepts a custom exit code', () => {
        const err = new CliError('budget problem', EXIT_CODES.BUDGET_EXCEEDED);
        assert.equal(err.exitCode, EXIT_CODES.BUDGET_EXCEEDED);
    });

    it('is an instance of Error', () => {
        const err = new CliError('test');
        assert.ok(err instanceof Error);
    });
});

describe('classifyError', () => {
    it('returns CliError.exitCode for CliError instances', () => {
        const err = new CliError('custom', EXIT_CODES.INVALID_CONFIG);
        assert.equal(classifyError(err), EXIT_CODES.INVALID_CONFIG);
    });

    // Budget errors
    it('classifies "budget exceeded" messages', () => {
        assert.equal(classifyError(new Error('Budget exceeded: $1.50 >= $1.00 limit')), EXIT_CODES.BUDGET_EXCEEDED);
    });

    it('classifies "budget limit" messages', () => {
        assert.equal(classifyError(new Error('budget limit reached')), EXIT_CODES.BUDGET_EXCEEDED);
    });

    // Provider/auth errors
    it('classifies "api key" errors as PROVIDER_UNAVAILABLE', () => {
        assert.equal(classifyError(new Error('Invalid API key provided')), EXIT_CODES.PROVIDER_UNAVAILABLE);
    });

    it('classifies "authentication" errors', () => {
        assert.equal(classifyError(new Error('Authentication failed')), EXIT_CODES.PROVIDER_UNAVAILABLE);
    });

    it('classifies "unauthorized" errors', () => {
        assert.equal(classifyError(new Error('Unauthorized access')), EXIT_CODES.PROVIDER_UNAVAILABLE);
    });

    it('classifies "403" errors', () => {
        assert.equal(classifyError(new Error('HTTP 403 Forbidden')), EXIT_CODES.PROVIDER_UNAVAILABLE);
    });

    it('classifies "provider unavailable" errors', () => {
        assert.equal(classifyError(new Error('provider is unavailable')), EXIT_CODES.PROVIDER_UNAVAILABLE);
    });

    it('classifies ECONNREFUSED errors', () => {
        assert.equal(classifyError(new Error('connect ECONNREFUSED 127.0.0.1:11434')), EXIT_CODES.PROVIDER_UNAVAILABLE);
    });

    it('classifies ECONNRESET errors', () => {
        assert.equal(classifyError(new Error('read ECONNRESET')), EXIT_CODES.PROVIDER_UNAVAILABLE);
    });

    // Config/manifest errors
    it('classifies "manifest invalid" errors as INVALID_CONFIG', () => {
        assert.equal(classifyError(new Error('manifest is invalid')), EXIT_CODES.INVALID_CONFIG);
    });

    it('classifies "manifest not found" errors', () => {
        assert.equal(classifyError(new Error('manifest not found at path')), EXIT_CODES.INVALID_CONFIG);
    });

    it('classifies "manifest parse" errors', () => {
        assert.equal(classifyError(new Error('Failed to parse manifest')), EXIT_CODES.INVALID_CONFIG);
    });

    it('classifies "config invalid" errors', () => {
        assert.equal(classifyError(new Error('config is invalid')), EXIT_CODES.INVALID_CONFIG);
    });

    it('classifies "route-families invalid" errors', () => {
        assert.equal(classifyError(new Error('route-families file is invalid')), EXIT_CODES.INVALID_CONFIG);
    });

    // Default
    it('defaults to GENERAL_ERROR for unknown errors', () => {
        assert.equal(classifyError(new Error('something random happened')), EXIT_CODES.GENERAL_ERROR);
    });

    it('handles non-Error objects', () => {
        assert.equal(classifyError('budget exceeded string'), EXIT_CODES.BUDGET_EXCEEDED);
    });

    it('handles non-Error non-string objects', () => {
        assert.equal(classifyError(42), EXIT_CODES.GENERAL_ERROR);
    });
});
