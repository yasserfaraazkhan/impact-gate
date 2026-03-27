// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {
    LLMProvider,
    LLMResponse,
    GenerateOptions,
    ImageInput,
    ProviderCapabilities,
    ProviderUsageStats,
} from '../provider_interface.js';

import {ResponseCache, TTL} from './response_cache.js';
import type {CacheEntry} from './response_cache.js';

/**
 * Context that ties a cached provider to a specific agent + family scope.
 */
export interface CacheContext {
    /** The agent role performing the request (e.g. 'impact-analyst', 'generator') */
    agent: string;
    /** The route-family name being processed */
    family: string;
    /** Content hashes of the source files used in the prompt */
    fileHashes: string[];
}

/**
 * Decorator that adds transparent response caching to any LLMProvider.
 *
 * - `generateText()` checks the cache first and returns a cached response on hit.
 *   On a miss it delegates to the inner provider, stores the result, and returns it.
 * - All other methods (analyzeImage, streamText, capabilities, usage stats)
 *   delegate directly to the wrapped provider.
 *
 * The TTL is selected based on the agent role: agents whose name contains
 * "generat" use the shorter GENERATION TTL; all others use ANALYSIS.
 */
export class CachedProvider implements LLMProvider {
    readonly name: string;
    readonly capabilities: ProviderCapabilities;

    private readonly inner: LLMProvider;
    private readonly cache: ResponseCache;
    private readonly ctx: CacheContext;
    private readonly ttlMs: number;

    // Optional interface methods - wired in constructor based on inner provider
    analyzeImage?: (images: ImageInput[], prompt: string, options?: GenerateOptions) => Promise<LLMResponse>;
    streamText?: (prompt: string, options?: GenerateOptions) => AsyncGenerator<string, void, unknown>;

    constructor(inner: LLMProvider, cache: ResponseCache, cacheContext: CacheContext) {
        this.inner = inner;
        this.cache = cache;
        this.ctx = cacheContext;
        this.name = inner.name;
        this.capabilities = inner.capabilities;

        // Pick TTL based on agent role
        this.ttlMs = cacheContext.agent.toLowerCase().includes('generat')
            ? TTL.GENERATION
            : TTL.ANALYSIS;

        // Wire optional methods only when the inner provider supports them
        if (inner.analyzeImage) {
            this.analyzeImage = (images, prompt, options) => inner.analyzeImage!(images, prompt, options);
        }
        if (inner.streamText) {
            this.streamText = (prompt, options) => inner.streamText!(prompt, options);
        }
    }

    /**
     * Generate text with cache-through semantics.
     * On a cache hit the inner provider is never called, saving tokens and latency.
     */
    async generateText(prompt: string, options?: GenerateOptions): Promise<LLMResponse> {
        const {agent, family, fileHashes} = this.ctx;
        const model = this.inner.name;

        // Check cache
        const cached = this.cache.get(agent, family, fileHashes, model);
        if (cached) {
            return {
                text: cached.response,
                usage: {
                    inputTokens: cached.usage.inputTokens,
                    outputTokens: cached.usage.outputTokens,
                    totalTokens: cached.usage.inputTokens + cached.usage.outputTokens,
                    cachedTokens: cached.usage.inputTokens,
                },
                cost: 0, // No cost on cache hit
            };
        }

        // Cache miss - call inner provider
        const response = await this.inner.generateText(prompt, options);

        // Store in cache
        const key = ResponseCache.buildKey({agent, family, fileHashes, model});
        const entry: CacheEntry & {family: string} = {
            key,
            family,
            response: response.text,
            usage: {
                inputTokens: response.usage.inputTokens,
                outputTokens: response.usage.outputTokens,
                cost: response.cost,
            },
            createdAt: new Date().toISOString(),
            ttlMs: this.ttlMs,
        };
        this.cache.set(entry);

        return response;
    }

    getUsageStats(): ProviderUsageStats {
        return this.inner.getUsageStats();
    }

    resetUsageStats(): void {
        this.inner.resetUsageStats();
    }

    async checkHealth(): Promise<{healthy: boolean; message: string}> {
        return this.inner.checkHealth();
    }
}

// Re-export for convenience
export {ResponseCache, TTL} from './response_cache.js';
export type {CacheEntry} from './response_cache.js';
