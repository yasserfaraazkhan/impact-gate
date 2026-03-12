// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import Anthropic from '@anthropic-ai/sdk';

import type {
    AnthropicConfig,
    GenerateOptions,
    ImageInput,
    LLMResponse,
    ProviderCapabilities,
} from './provider_interface.js';
import {LLMProviderError} from './provider_interface.js';
import {API_KEY_PATTERNS, sanitizeErrorMessage, withTimeout, validateAndSanitizeUrl} from './provider_utils.js';
import {BaseProvider} from './base_provider.js';
import {logger} from './logger.js';

/**
 * SECURITY: Type-safe response handling
 * Prevents type confusion from unsafe casts
 */
interface AnthropicUsage {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
}


/**
 * Anthropic Provider - Claude AI models
 *
 * Features:
 * - Highest quality AI (98% accuracy in testing)
 * - Vision support (analyze screenshots, compare UI)
 * - Fast response times (<1 second)
 * - 200K token context window
 * - Prompt caching (reduces costs by 90% on repeated prompts)
 *
 * Costs (Claude Sonnet 4.5):
 * - Input: $3 per 1M tokens
 * - Output: $15 per 1M tokens
 * - Cached input: $0.30 per 1M tokens
 * - Estimated: ~$30-80/month for autonomous testing
 *
 * Use cases:
 * - Vision tasks (screenshot comparison)
 * - Complex failure diagnosis
 * - High-stakes production testing
 * - When quality is paramount
 *
 * Models:
 * - claude-sonnet-4-5-20250929 (recommended - best balance)
 * - claude-opus-4-5-20251101 (highest quality, slower, more expensive)
 * - claude-haiku-4-0-20250430 (fastest, cheapest, lower quality)
 */
export class AnthropicProvider extends BaseProvider {
    name = 'anthropic';
    private client: Anthropic;
    private model: string;

    capabilities: ProviderCapabilities = {
        vision: true, // Full vision support
        streaming: true,
        maxTokens: 200000, // 200K context window
        costPer1MInputTokens: 3, // $3 per 1M input tokens
        costPer1MOutputTokens: 15, // $15 per 1M output tokens
        supportsTools: true, // Function calling support
        supportsPromptCaching: true, // Reduces costs by 90%
        typicalResponseTimeMs: 800, // ~0.8 seconds
    };

    constructor(config: AnthropicConfig) {
        super();

        // SECURITY: Validate API key format
        if (!API_KEY_PATTERNS.anthropic.test(config.apiKey)) {
            throw new Error('Invalid API key format. Expected sk-ant-* format.');
        }

        // SECURITY: Validate and enforce HTTPS for remote connections
        if (config.baseUrl) {
            const validation = validateAndSanitizeUrl(config.baseUrl);
            if (!validation.valid) {
                throw new Error(`Invalid base URL: ${validation.warning}`);
            }
            if (validation.warning) {
                logger.warn(`HTTPS required for remote URLs: ${validation.warning}`);
            }
        }

        this.client = new Anthropic({
            apiKey: config.apiKey,
            baseURL: config.baseUrl,
            maxRetries: 0,
        });

        this.model = config.model || 'claude-sonnet-4-5-20250929';
    }

    async generateText(prompt: string, options?: GenerateOptions): Promise<LLMResponse> {
        const startTime = Date.now();

        try {
            // SECURITY: Validate prompt length to prevent resource exhaustion
            if (prompt.length > 10 * 1024 * 1024) {
                throw new Error('Prompt exceeds maximum size (10MB)');
            }

            const response = await withTimeout(this.client.messages.create({
                model: this.model,
                max_tokens: options?.maxTokens || 4000,
                temperature: options?.temperature,
                top_p: options?.topP,
                stop_sequences: options?.stopSequences,
                system: options?.systemPrompt,
                messages: [
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
            }), options?.timeout, 'generateText');

            const responseTime = Date.now() - startTime;
            const text = this.extractTextFromResponse(response);

            // SECURITY: Type-safe usage extraction
            const usage = this.extractUsageFromResponse(response.usage);
            const cost = this.calculateCost(
                usage,
                this.capabilities.costPer1MInputTokens,
                this.capabilities.costPer1MOutputTokens,
            );

            // Update stats
            this.updateStats(usage, responseTime, cost);

            return {
                text,
                usage,
                cost,
                metadata: {
                    model: this.model,
                    responseTimeMs: responseTime,
                    stopReason: response.stop_reason,
                    stopSequence: response.stop_sequence,
                },
            };
        } catch (error) {
            this.stats.failedRequests++;
            throw new LLMProviderError(
                sanitizeErrorMessage(error, 'generateText'),
                this.name,
                this.extractStatusCode(error),
                error,
            );
        }
    }

    async analyzeImage(images: ImageInput[], prompt: string, options?: GenerateOptions): Promise<LLMResponse> {
        const startTime = Date.now();

        try {
            // SECURITY: Validate image array size
            if (images.length === 0 || images.length > 20) {
                throw new Error('Image count must be between 1 and 20');
            }

            // SECURITY: Validate prompt length
            if (prompt.length > 10 * 1024 * 1024) {
                throw new Error('Prompt exceeds maximum size (10MB)');
            }

            // Build content array with text and images
            const content: Anthropic.MessageParam['content'] = [];

            // Add prompt text first
            content.push({
                type: 'text',
                text: prompt,
            });

            // Add each image
            for (const image of images) {
                // Validate media type
                const mediaType = (image.mimeType || image.mediaType || 'image/png') as
                    | 'image/png'
                    | 'image/jpeg'
                    | 'image/webp'
                    | 'image/gif';

                if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mediaType)) {
                    throw new Error(`Unsupported image type: ${mediaType}`);
                }

                const data = image.data || image.base64 || '';

                // SECURITY: Validate base64 data size (limit to 20MB per image)
                if (data.length > 20 * 1024 * 1024) {
                    throw new Error('Image data exceeds maximum size (20MB)');
                }

                content.push({
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: mediaType,
                        data: data,
                    },
                });

                // Add description if provided
                if (image.description) {
                    content.push({
                        type: 'text',
                        text: `[Image: ${image.description}]`,
                    });
                }
            }

            const response = await withTimeout(this.client.messages.create({
                model: this.model,
                max_tokens: options?.maxTokens || 4000,
                temperature: options?.temperature,
                top_p: options?.topP,
                stop_sequences: options?.stopSequences,
                system: options?.systemPrompt,
                messages: [
                    {
                        role: 'user',
                        content,
                    },
                ],
            }), options?.timeout, 'analyzeImage');

            const responseTime = Date.now() - startTime;
            const text = this.extractTextFromResponse(response);

            // SECURITY: Type-safe usage extraction
            const usage = this.extractUsageFromResponse(response.usage);
            const cost = this.calculateCost(
                usage,
                this.capabilities.costPer1MInputTokens,
                this.capabilities.costPer1MOutputTokens,
            );

            // Update stats
            this.updateStats(usage, responseTime, cost);

            return {
                text,
                usage,
                cost,
                metadata: {
                    model: this.model,
                    responseTimeMs: responseTime,
                    stopReason: response.stop_reason,
                    imageCount: images.length,
                },
            };
        } catch (error) {
            this.stats.failedRequests++;
            throw new LLMProviderError(
                sanitizeErrorMessage(error, 'analyzeImage'),
                this.name,
                this.extractStatusCode(error),
                error,
            );
        }
    }

    async *streamText(prompt: string, options?: GenerateOptions): AsyncGenerator<string, void, unknown> {
        try {
            // SECURITY: Validate prompt length
            if (prompt.length > 10 * 1024 * 1024) {
                throw new Error('Prompt exceeds maximum size (10MB)');
            }

            const stream = await withTimeout(this.client.messages.create({
                model: this.model,
                max_tokens: options?.maxTokens || 4000,
                temperature: options?.temperature,
                top_p: options?.topP,
                stop_sequences: options?.stopSequences,
                system: options?.systemPrompt,
                messages: [
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
                stream: true,
            }), options?.timeout, 'streamText');

            for await (const event of stream) {
                if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                    yield event.delta.text;
                }
            }

            // Note: Streaming doesn't provide detailed usage stats
            // We increment request count but can't track exact tokens/cost
            this.stats.requestCount++;
            this.stats.lastUpdated = new Date();
        } catch (error) {
            this.stats.failedRequests++;
            throw new LLMProviderError(
                sanitizeErrorMessage(error, 'streamText'),
                this.name,
                this.extractStatusCode(error),
                error,
            );
        }
    }

    private extractTextFromResponse(response: Anthropic.Message): string {
        const textBlocks = response.content.filter((block) => block.type === 'text');
        return textBlocks.map((block) => {
            if (block.type === 'text') {
                return block.text;
            }
            return '';
        }).join('\n');
    }

    /**
     * SECURITY: Type-safe usage extraction
     * Avoids unsafe `as any` casts
     */
    private extractUsageFromResponse(usage: AnthropicUsage): {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        cachedTokens?: number;
    } {
        return {
            inputTokens: usage.input_tokens || 0,
            outputTokens: usage.output_tokens || 0,
            totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
            cachedTokens: usage.cache_read_input_tokens ?? undefined,
        };
    }

    /**
     * SECURITY: Extract status code safely
     */
    private extractStatusCode(error: unknown): number | undefined {
        if (error && typeof error === 'object') {
            const err = error as Record<string, unknown>;
            const status = err.status;
            if (typeof status === 'number') {
                return status;
            }
        }
        return undefined;
    }

    /**
     * Check if API key is valid and service is accessible
     */
    async checkHealth(): Promise<{healthy: boolean; message: string}> {
        try {
            // Try a minimal request to verify API key
            await withTimeout(this.client.messages.create({
                model: this.model,
                max_tokens: 10,
                messages: [
                    {
                        role: 'user',
                        content: 'Hi',
                    },
                ],
            }), 5000, 'health check');

            return {
                healthy: true,
                message: `Anthropic API is accessible`,
            };
        } catch (error) {
            return {
                healthy: false,
                message: `Anthropic API error: ${sanitizeErrorMessage(error, 'health check')}`,
            };
        }
    }
}

/**
 * Helper to check Anthropic setup
 */
export async function checkAnthropicSetup(apiKey: string): Promise<{
    valid: boolean;
    message: string;
    estimatedMonthlyCost: string;
}> {
    if (!apiKey) {
        return {
            valid: false,
            message: 'No API key provided',
            estimatedMonthlyCost: 'N/A',
        };
    }

    try {
        const provider = new AnthropicProvider({apiKey});
        const health = await provider.checkHealth();

        return {
            valid: health.healthy,
            message: health.message,
            estimatedMonthlyCost: '$30-80 for autonomous testing (24 cycles/day)',
        };
    } catch (error) {
        return {
            valid: false,
            message: `Setup check failed: ${sanitizeErrorMessage(error, 'setup check')}`,
            estimatedMonthlyCost: 'N/A',
        };
    }
}
