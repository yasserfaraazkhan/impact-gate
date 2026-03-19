// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {
    GenerateOptions,
    ImageInput,
    LLMProvider,
    LLMResponse,
    ProviderCapabilities,
    ProviderUsageStats,
} from './provider_interface.js';
import {withRetry} from './resilience/retry.js';
import {CircuitBreaker} from './resilience/circuit_breaker.js';
import type {BudgetLedger} from './budget_ledger.js';

/**
 * Abstract base class for all LLM providers
 * Eliminates 240+ lines of duplicate stats management code
 * Provides common functionality for token tracking, cost calculation, and stats management
 */
export class BudgetExceededError extends Error {
    constructor(public currentCost: number, public budgetUSD: number) {
        super(`Budget exceeded: $${currentCost.toFixed(4)} >= $${budgetUSD} limit`);
        this.name = 'BudgetExceededError';
    }
}

export abstract class BaseProvider implements LLMProvider {
    abstract name: string;
    abstract capabilities: ProviderCapabilities;

    /**
     * Shared circuit breakers keyed by provider name (e.g., "anthropic", "openai").
     * All instances of the same provider type share one breaker, so if Anthropic is
     * down, ALL agents discover it after 3 total failures instead of 3 × N.
     */
    private static readonly _sharedBreakers = new Map<string, CircuitBreaker>();

    protected stats!: ProviderUsageStats;
    private _budgetUSD: number | undefined;
    private _ledger: BudgetLedger | undefined;
    /** Tracks the current in-flight budget reservation for this provider instance. */
    private _activeReservation = 0;

    constructor() {
        this.initializeStats();
    }

    /** Lazily get-or-create a circuit breaker shared across all instances of this provider type. */
    protected get circuitBreaker(): CircuitBreaker {
        let cb = BaseProvider._sharedBreakers.get(this.name);
        if (!cb) {
            cb = new CircuitBreaker({
                shouldCount: (error: unknown) => {
                    if (error instanceof BudgetExceededError) return false;
                    if (!(error instanceof Error)) return true;
                    const msg = error.message.toLowerCase();
                    return msg.includes('429') || msg.includes('rate limit') ||
                        msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504') ||
                        msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('etimedout') ||
                        msg.includes('overloaded') || msg.includes('socket hang up') || msg.includes('network error');
                },
            });
            BaseProvider._sharedBreakers.set(this.name, cb);
        }
        return cb;
    }

    /**
     * Set a hard budget limit. Once totalCost reaches this value,
     * subsequent calls will throw BudgetExceededError.
     */
    setBudget(usd: number | undefined): void {
        this._budgetUSD = usd;
    }

    get budgetUSD(): number | undefined {
        return this._budgetUSD;
    }

    /**
     * Attach a shared budget ledger so aggregate cost across all providers
     * in a crew run is checked before each LLM call.
     */
    setBudgetLedger(ledger: BudgetLedger | undefined): void {
        this._ledger = ledger;
    }

    /**
     * Check budget and pre-reserve estimated cost for the upcoming LLM call.
     *
     * When a shared ledger exists, reserves an estimate derived from the provider's
     * output token cost × maxTokens (default 4096). This blocks parallel agents from
     * spending into the same headroom — like a credit card authorization hold.
     *
     * Self-healing: if a prior call failed without reaching updateStats(), the stale
     * reservation is released here before placing the new one.
     */
    protected checkBudget(): void {
        if (this._ledger) {
            // Release stale reservation from a prior failed call that never hit updateStats
            if (this._activeReservation > 0) {
                this._ledger.release(this._activeReservation);
                this._activeReservation = 0;
            }

            // Reserve estimated cost for the upcoming call
            const estimate = this.estimateCallCost();
            this._ledger.reserve(estimate);
            this._activeReservation = estimate;

            try {
                this._ledger.check();
            } catch (err) {
                // Budget exceeded — release reservation immediately so it doesn't leak
                this._ledger.release(estimate);
                this._activeReservation = 0;
                throw err;
            }
            return;
        }
        if (this._budgetUSD !== undefined && this.stats.totalCost >= this._budgetUSD) {
            throw new BudgetExceededError(this.stats.totalCost, this._budgetUSD);
        }
    }

    /**
     * Conservative cost estimate for the upcoming call.
     * Uses maxTokens (or 4096 default) × output cost rate.
     * Overestimating is safe — the reservation is replaced with actual cost in updateStats.
     */
    private estimateCallCost(): number {
        const outputTokenEstimate = 4096;
        const costRate = this.capabilities?.costPer1MOutputTokens ?? 15; // default to ~Sonnet
        return (outputTokenEstimate / 1_000_000) * costRate;
    }

    /**
     * Initialize stats object with default values
     */
    protected initializeStats(): void {
        this.stats = {
            requestCount: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalTokens: 0,
            totalCost: 0,
            averageResponseTimeMs: 0,
            failedRequests: 0,
            startTime: new Date(),
            lastUpdated: new Date(),
        };
    }

    /**
     * Update stats with new usage data
     * Maintains rolling average for response time
     */
    protected updateStats(
        usage: {inputTokens: number; outputTokens: number; totalTokens: number},
        responseTime: number,
        cost: number,
    ): void {
        this.stats.requestCount++;
        this.stats.totalInputTokens += usage.inputTokens;
        this.stats.totalOutputTokens += usage.outputTokens;
        this.stats.totalTokens += usage.totalTokens;
        this.stats.totalCost += cost;
        if (this._ledger) {
            // Settle: release the estimate, record actual
            if (this._activeReservation > 0) {
                this._ledger.release(this._activeReservation);
                this._activeReservation = 0;
            }
            this._ledger.record(cost);
        }

        // Update rolling average response time
        const totalRequests = this.stats.requestCount;
        this.stats.averageResponseTimeMs =
            (this.stats.averageResponseTimeMs * (totalRequests - 1) + responseTime) / totalRequests;

        this.stats.lastUpdated = new Date();
    }

    /**
     * Get a copy of current usage stats
     */
    getUsageStats(): ProviderUsageStats {
        return {...this.stats};
    }

    /**
     * Reset all usage stats to initial state
     */
    resetUsageStats(): void {
        this.initializeStats();
    }

    /**
     * Wrap an async call with circuit breaker + retry logic.
     * Circuit breaker protects against cascading failures from a down provider;
     * retry handles transient failures within a healthy circuit.
     *
     * Non-transient errors (budget, auth, validation) are thrown directly and
     * bypass the circuit breaker so they don't incorrectly trip it.
     */
    protected retryCall<T>(fn: () => Promise<T>): Promise<T> {
        return this.circuitBreaker.call(
            () => withRetry(fn, {maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 10000, jitter: true}),
            () => { throw new Error(`${this.name} provider circuit open — too many consecutive failures`); },
        );
    }

    /**
     * Abstract methods that must be implemented by subclasses
     */
    abstract generateText(prompt: string, options?: GenerateOptions): Promise<LLMResponse>;
    abstract analyzeImage(images: ImageInput[], prompt: string, options?: GenerateOptions): Promise<LLMResponse>;
    abstract streamText(prompt: string, options?: GenerateOptions): AsyncGenerator<string, void, unknown>;
    abstract checkHealth(): Promise<{healthy: boolean; message: string}>;

    /**
     * Calculate cost for token usage, accounting for prompt caching discounts
     * Cached tokens cost 90% less than regular tokens
     */
    protected calculateCost(
        usage: {inputTokens: number; outputTokens: number; cachedTokens?: number},
        costPer1MInputTokens: number,
        costPer1MOutputTokens: number,
    ): number {
        // Calculate input token cost
        let inputCost = 0;

        // Cached tokens cost 90% less
        if (usage.cachedTokens) {
            const cachedCost = (usage.cachedTokens / 1_000_000) * (costPer1MInputTokens * 0.1);
            const uncachedInputTokens = usage.inputTokens - usage.cachedTokens;
            const uncachedCost = (uncachedInputTokens / 1_000_000) * costPer1MInputTokens;
            inputCost = cachedCost + uncachedCost;
        } else {
            inputCost = (usage.inputTokens / 1_000_000) * costPer1MInputTokens;
        }

        // Calculate output token cost
        const outputCost = (usage.outputTokens / 1_000_000) * costPer1MOutputTokens;

        return inputCost + outputCost;
    }
}
