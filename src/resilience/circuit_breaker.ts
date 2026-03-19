// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Circuit Breaker — protects against cascading failures from unavailable LLM providers.
 *
 * States:
 * - CLOSED: normal operation, requests pass through
 * - OPEN: provider is down, all requests short-circuit to fallback
 * - HALF_OPEN: after cooldown, allows one test request through
 */

export interface CircuitBreakerConfig {
    failureThreshold: number;    // Consecutive failures to open circuit (default: 3)
    cooldownMs: number;          // Time in OPEN before trying HALF_OPEN (default: 60000)
    /** Optional predicate: only count errors where this returns true. Defaults to counting all errors. */
    shouldCount?: (error: unknown) => boolean;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
    failureThreshold: 3,
    cooldownMs: 60_000,
};

type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
    private state: CircuitState = 'closed';
    private failures = 0;
    private lastFailureTime = 0;
    private config: CircuitBreakerConfig;

    constructor(config: Partial<CircuitBreakerConfig> = {}) {
        this.config = {...DEFAULT_CONFIG, ...config};
    }

    /** Returns the derived state without mutating internal state. */
    get currentState(): CircuitState {
        if (this.state === 'open' && Date.now() - this.lastFailureTime >= this.config.cooldownMs) {
            return 'half-open';
        }
        return this.state;
    }

    get isOpen(): boolean {
        return this.currentState === 'open';
    }

    /**
     * Execute a function with circuit breaker protection.
     * If the circuit is open, the fallback is called instead.
     */
    async call<T>(fn: () => Promise<T>, fallback: () => T): Promise<T> {
        // Transition from open to half-open if cooldown has elapsed
        if (this.state === 'open') {
            if (Date.now() - this.lastFailureTime >= this.config.cooldownMs) {
                this.state = 'half-open';
            } else {
                return fallback();
            }
        }
        // At this point state is 'closed' or 'half-open'
        const stateBeforeCall = this.state;

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            const shouldCount = !this.config.shouldCount || this.config.shouldCount(error);
            if (shouldCount) {
                this.onFailure();
            }
            // In half-open state, a failure re-opens the circuit
            if (stateBeforeCall === 'half-open') {
                throw error;
            }
            // In closed state, if failures hit threshold the circuit opened
            if (shouldCount && this.failures >= this.config.failureThreshold) {
                return fallback();
            }
            throw error;
        }
    }

    private onSuccess(): void {
        this.failures = 0;
        this.state = 'closed';
    }

    private onFailure(): void {
        this.failures++;
        this.lastFailureTime = Date.now();
        if (this.failures >= this.config.failureThreshold) {
            this.state = 'open';
        }
    }

    /** Reset the circuit breaker to closed state */
    reset(): void {
        this.state = 'closed';
        this.failures = 0;
        this.lastFailureTime = 0;
    }
}
