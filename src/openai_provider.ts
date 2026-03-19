// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import OpenAI from 'openai';

import type {
    GenerateOptions,
    ImageInput,
    LLMResponse,
    OpenAIConfig,
    ProviderCapabilities,
} from './provider_interface.js';
import {LLMProviderError, UnsupportedCapabilityError} from './provider_interface.js';
import {API_KEY_PATTERNS, sanitizeErrorMessage, withTimeout, validateAndSanitizeUrl} from './provider_utils.js';
import {BaseProvider} from './base_provider.js';
import {logger} from './logger.js';

interface OpenAIUsage {
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    total_tokens?: number | null;
}


function inferVisionSupport(model: string): boolean {
    const lower = model.toLowerCase();
    return lower.includes('vision') || lower.includes('4o') || lower.includes('omni');
}

export class OpenAIProvider extends BaseProvider {
    name = 'openai';
    private client: OpenAI;
    private model: string;

    capabilities: ProviderCapabilities;

    constructor(config: OpenAIConfig) {
        super();

        if (!API_KEY_PATTERNS.openai.test(config.apiKey)) {
            throw new Error('Invalid API key format. Expected sk-* format.');
        }

        if (config.baseUrl) {
            const validation = validateAndSanitizeUrl(config.baseUrl);
            if (!validation.valid) {
                throw new Error(`Invalid base URL: ${validation.warning}`);
            }
            if (validation.warning) {
                logger.warn(`HTTPS required for remote URLs: ${validation.warning}`);
            }
        }

        this.client = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.baseUrl,
            organization: config.organizationId,
        });

        this.model = config.model || 'gpt-4';

        const maxTokens = config.maxTokens || 128000;
        const costPer1MInputTokens = config.costPer1MInputTokens ?? 0;
        const costPer1MOutputTokens = config.costPer1MOutputTokens ?? 0;

        this.capabilities = {
            vision: inferVisionSupport(this.model),
            streaming: true,
            maxTokens,
            costPer1MInputTokens,
            costPer1MOutputTokens,
            supportsTools: true,
            supportsPromptCaching: false,
            typicalResponseTimeMs: 1200,
        };
    }

    async generateText(prompt: string, options?: GenerateOptions): Promise<LLMResponse> {
        this.checkBudget();
        const startTime = Date.now();

        try {
            if (prompt.length > 10 * 1024 * 1024) {
                throw new Error('Prompt exceeds maximum size (10MB)');
            }

            const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
            if (options?.systemPrompt) {
                messages.push({role: 'system', content: options.systemPrompt});
            }
            messages.push({role: 'user', content: prompt});

            const response = await withTimeout(
                this.client.chat.completions.create({
                    model: this.model,
                    messages,
                    max_tokens: options?.maxTokens,
                    temperature: options?.temperature,
                    top_p: options?.topP,
                    stop: options?.stopSequences,
                }),
                options?.timeout,
                'generateText',
            );

            const responseTime = Date.now() - startTime;
            const text = response.choices[0]?.message?.content || '';
            const usage = this.extractUsage(response.usage);
            const cost = this.calculateCost(
                usage,
                this.capabilities.costPer1MInputTokens,
                this.capabilities.costPer1MOutputTokens,
            );

            this.updateStats(usage, responseTime, cost);

            return {
                text,
                usage,
                cost,
                metadata: {
                    model: this.model,
                    responseTimeMs: responseTime,
                    finishReason: response.choices[0]?.finish_reason,
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
        if (!this.capabilities.vision) {
            throw new UnsupportedCapabilityError(this.name, 'vision');
        }

        const startTime = Date.now();

        try {
            if (images.length === 0 || images.length > 20) {
                throw new Error('Image count must be between 1 and 20');
            }
            if (prompt.length > 10 * 1024 * 1024) {
                throw new Error('Prompt exceeds maximum size (10MB)');
            }

            type ContentPart =
                | {type: 'text'; text: string}
                | {type: 'image_url'; image_url: {url: string}};

            const content: ContentPart[] = [{type: 'text', text: prompt}];

            for (const image of images) {
                const mediaType = (image.mimeType || image.mediaType || 'image/png') as
                    | 'image/png'
                    | 'image/jpeg'
                    | 'image/webp';

                if (!['image/png', 'image/jpeg', 'image/webp'].includes(mediaType)) {
                    throw new Error(`Unsupported image type: ${mediaType}`);
                }

                const data = image.data || image.base64 || '';
                if (data.length > 20 * 1024 * 1024) {
                    throw new Error('Image data exceeds maximum size (20MB)');
                }

                const url = `data:${mediaType};base64,${data}`;
                content.push({type: 'image_url', image_url: {url}});

                if (image.description) {
                    content.push({type: 'text', text: `[Image: ${image.description}]`});
                }
            }

            const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
            if (options?.systemPrompt) {
                messages.push({role: 'system', content: options.systemPrompt});
            }
            messages.push({role: 'user', content});

            const response = await withTimeout(
                this.client.chat.completions.create({
                    model: this.model,
                    messages,
                    max_tokens: options?.maxTokens,
                    temperature: options?.temperature,
                    top_p: options?.topP,
                    stop: options?.stopSequences,
                }),
                options?.timeout,
                'analyzeImage',
            );

            const responseTime = Date.now() - startTime;
            const text = response.choices[0]?.message?.content || '';
            const usage = this.extractUsage(response.usage);
            const cost = this.calculateCost(
                usage,
                this.capabilities.costPer1MInputTokens,
                this.capabilities.costPer1MOutputTokens,
            );

            this.updateStats(usage, responseTime, cost);

            return {
                text,
                usage,
                cost,
                metadata: {
                    model: this.model,
                    responseTimeMs: responseTime,
                    finishReason: response.choices[0]?.finish_reason,
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
            if (prompt.length > 10 * 1024 * 1024) {
                throw new Error('Prompt exceeds maximum size (10MB)');
            }

            const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
            if (options?.systemPrompt) {
                messages.push({role: 'system', content: options.systemPrompt});
            }
            messages.push({role: 'user', content: prompt});

            const stream = await withTimeout(
                this.client.chat.completions.create({
                    model: this.model,
                    messages,
                    max_tokens: options?.maxTokens,
                    temperature: options?.temperature,
                    top_p: options?.topP,
                    stop: options?.stopSequences,
                    stream: true,
                }),
                options?.timeout,
                'streamText',
            );

            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content;
                if (content) {
                    yield content;
                }
            }

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

    private extractUsage(usage: OpenAIUsage | null | undefined): {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
    } {
        return {
            inputTokens: usage?.prompt_tokens || 0,
            outputTokens: usage?.completion_tokens || 0,
            totalTokens: usage?.total_tokens || 0,
        };
    }

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

    async checkHealth(): Promise<{healthy: boolean; message: string}> {
        try {
            await withTimeout(
                this.client.chat.completions.create({
                    model: this.model,
                    max_tokens: 5,
                    messages: [{role: 'user', content: 'Hi'}],
                }),
                5000,
                'health check',
            );

            return {
                healthy: true,
                message: 'OpenAI API is accessible',
            };
        } catch (error) {
            return {
                healthy: false,
                message: `OpenAI API error: ${sanitizeErrorMessage(error, 'health check')}`,
            };
        }
    }
}

export async function checkOpenAISetup(apiKey: string): Promise<{
    valid: boolean;
    message: string;
}> {
    if (!apiKey) {
        return {
            valid: false,
            message: 'No API key provided',
        };
    }

    try {
        const provider = new OpenAIProvider({apiKey});
        const health = await provider.checkHealth();

        return {
            valid: health.healthy,
            message: health.message,
        };
    } catch (error) {
        return {
            valid: false,
            message: `Setup check failed: ${sanitizeErrorMessage(error, 'setup check')}`,
        };
    }
}
