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

/**
 * Abstract base class for all LLM providers
 * Eliminates 240+ lines of duplicate stats management code
 * Provides common functionality for token tracking, cost calculation, and stats management
 */
export abstract class BaseProvider implements LLMProvider {
    abstract name: string;
    abstract capabilities: ProviderCapabilities;

    protected stats!: ProviderUsageStats;

    constructor() {
        this.initializeStats();
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
