import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {CircuitBreaker} from '../dist/resilience/circuit_breaker.js';
import {withRetry} from '../dist/resilience/retry.js';

describe('CircuitBreaker', () => {
    it('starts in closed state', () => {
        const cb = new CircuitBreaker();
        assert.equal(cb.currentState, 'closed');
        assert.equal(cb.isOpen, false);
    });

    it('opens after 3 consecutive failures', async () => {
        const cb = new CircuitBreaker({failureThreshold: 3, cooldownMs: 60_000});

        const fail = () => Promise.reject(new Error('provider down'));
        const fallback = () => 'fallback-value';

        // First two failures: circuit stays closed, errors propagate
        for (let i = 0; i < 2; i++) {
            await assert.rejects(() => cb.call(fail, fallback), {message: 'provider down'});
        }
        assert.equal(cb.currentState, 'closed');

        // Third failure: circuit opens, fallback returned
        const result = await cb.call(fail, fallback);
        assert.equal(result, 'fallback-value');
        assert.equal(cb.currentState, 'open');
    });

    it('returns fallback when open', async () => {
        const cb = new CircuitBreaker({failureThreshold: 1, cooldownMs: 60_000});

        // Trip the circuit
        const result = await cb.call(
            () => Promise.reject(new Error('fail')),
            () => 'fallback',
        );
        assert.equal(result, 'fallback');
        assert.equal(cb.currentState, 'open');

        // Subsequent calls return fallback without invoking fn
        let fnCalled = false;
        const result2 = await cb.call(
            () => {
                fnCalled = true;
                return Promise.resolve('should-not-reach');
            },
            () => 'still-fallback',
        );
        assert.equal(result2, 'still-fallback');
        assert.equal(fnCalled, false);
    });

    it('transitions to half-open after cooldown', async () => {
        const cb = new CircuitBreaker({failureThreshold: 1, cooldownMs: 50});

        // Trip the circuit
        await cb.call(
            () => Promise.reject(new Error('fail')),
            () => 'fb',
        );
        assert.equal(cb.currentState, 'open');

        // Wait for cooldown
        await new Promise((resolve) => setTimeout(resolve, 60));
        assert.equal(cb.currentState, 'half-open');
    });

    it('closes again after successful call in half-open state', async () => {
        const cb = new CircuitBreaker({failureThreshold: 1, cooldownMs: 50});

        // Trip the circuit
        await cb.call(
            () => Promise.reject(new Error('fail')),
            () => 'fb',
        );
        assert.equal(cb.currentState, 'open');

        // Wait for cooldown to reach half-open
        await new Promise((resolve) => setTimeout(resolve, 60));
        assert.equal(cb.currentState, 'half-open');

        // Successful call closes the circuit
        const result = await cb.call(
            () => Promise.resolve('success'),
            () => 'fb',
        );
        assert.equal(result, 'success');
        assert.equal(cb.currentState, 'closed');
    });

    it('stays closed if failures are below threshold', async () => {
        const cb = new CircuitBreaker({failureThreshold: 3, cooldownMs: 60_000});

        // Two failures, then a success resets the count
        await assert.rejects(() => cb.call(
            () => Promise.reject(new Error('fail')),
            () => 'fb',
        ));
        await assert.rejects(() => cb.call(
            () => Promise.reject(new Error('fail')),
            () => 'fb',
        ));
        assert.equal(cb.currentState, 'closed');

        // Success resets failure counter
        await cb.call(
            () => Promise.resolve('ok'),
            () => 'fb',
        );
        assert.equal(cb.currentState, 'closed');

        // Two more failures still don't trip it
        await assert.rejects(() => cb.call(
            () => Promise.reject(new Error('fail')),
            () => 'fb',
        ));
        await assert.rejects(() => cb.call(
            () => Promise.reject(new Error('fail')),
            () => 'fb',
        ));
        assert.equal(cb.currentState, 'closed');
    });

    it('reset() returns to closed state', async () => {
        const cb = new CircuitBreaker({failureThreshold: 1, cooldownMs: 60_000});

        // Trip the circuit
        await cb.call(
            () => Promise.reject(new Error('fail')),
            () => 'fb',
        );
        assert.equal(cb.currentState, 'open');

        cb.reset();
        assert.equal(cb.currentState, 'closed');
        assert.equal(cb.isOpen, false);

        // Should work normally after reset
        const result = await cb.call(
            () => Promise.resolve('working'),
            () => 'fb',
        );
        assert.equal(result, 'working');
        assert.equal(cb.currentState, 'closed');
    });
});

describe('withRetry', () => {
    it('succeeds on first try without retrying', async () => {
        let callCount = 0;
        const result = await withRetry(async () => {
            callCount++;
            return 'success';
        }, {maxRetries: 2, baseDelayMs: 10, jitter: false});

        assert.equal(result, 'success');
        assert.equal(callCount, 1);
    });

    it('retries on retryable error and succeeds on 2nd try', async () => {
        let callCount = 0;
        const result = await withRetry(async () => {
            callCount++;
            if (callCount === 1) {
                throw new Error('429 Too Many Requests');
            }
            return 'success-after-retry';
        }, {maxRetries: 2, baseDelayMs: 10, jitter: false});

        assert.equal(result, 'success-after-retry');
        assert.equal(callCount, 2);
    });

    it('gives up after maxRetries and throws last error', async () => {
        let callCount = 0;
        await assert.rejects(
            () => withRetry(async () => {
                callCount++;
                throw new Error('503 Service Unavailable');
            }, {maxRetries: 2, baseDelayMs: 10, jitter: false}),
            {message: '503 Service Unavailable'},
        );

        // 1 initial + 2 retries = 3 total calls
        assert.equal(callCount, 3);
    });

    it('does NOT retry non-retryable errors', async () => {
        let callCount = 0;
        await assert.rejects(
            () => withRetry(async () => {
                callCount++;
                throw new Error('invalid API key');
            }, {maxRetries: 3, baseDelayMs: 10, jitter: false}),
            {message: 'invalid API key'},
        );

        // Should fail immediately without retrying
        assert.equal(callCount, 1);
    });

    it('respects maxRetries config', async () => {
        let callCount = 0;
        await assert.rejects(
            () => withRetry(async () => {
                callCount++;
                throw new Error('rate limit exceeded');
            }, {maxRetries: 1, baseDelayMs: 10, jitter: false}),
            {message: 'rate limit exceeded'},
        );

        // 1 initial + 1 retry = 2 total calls
        assert.equal(callCount, 2);
    });
});
