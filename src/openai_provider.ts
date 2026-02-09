// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import OpenAI from 'openai';

import type {
    GenerateOptions,
    ImageInput,
    LLMProvider,
    LLMResponse,
    OpenAIConfig,
    ProviderCapabilities,
    ProviderUsageStats,
} from './provider_interface.js';
import {LLMProviderError, UnsupportedCapabilityError} from './provider_interface.js';

interface OpenAIUsage {
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    total_tokens?: number | null;
}

function validateApiKey(apiKey: string): boolean {
    // OpenAI API keys typically start with sk- and are reasonably long
    return /^sk-[a-zA-Z0-9_\-]{20,}$/.test(apiKey);
}

function validateAndSanitizeUrl(baseUrl: string | undefined): {valid: boolean; url?: string; warning?: string} {
    if (!baseUrl) {
        return {valid: true};
    }

    try {
        const url = new URL(baseUrl);
        const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';

        if (!isLocalhost && url.protocol !== 'https:') {
            return {
                valid: false,
                warning: `HTTPS required for remote URLs. Got: ${url.protocol}//${url.hostname}`,
            };
        }

        return {valid: true, url: baseUrl};
    } catch {
        return {valid: false};
    }
}

function sanitizeErrorMessage(error: unknown, context: string): string {
    if (error instanceof Error) {
        const msg = error.message.toLowerCase();

        if (msg.includes('401') || msg.includes('authentication')) {
            return `Authentication failed (${context})`;
        }
        if (msg.includes('429') || msg.includes('rate')) {
            return `Rate limit exceeded (${context})`;
        }
        if (msg.includes('timeout')) {
            return `Request timeout (${context})`;
        }
        if (msg.includes('network') || msg.includes('econnrefused')) {
            return `Connection failed (${context})`;
        }

        return `Operation failed (${context})`;
    }
    return 'An unexpected error occurred';
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number | undefined, context: string): Promise<T> {
    if (!timeoutMs) {
        return promise;
    }

    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Request timeout (${context})`)), timeoutMs);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

function inferVisionSupport(model: string): boolean {
    const lower = model.toLowerCase();
    return lower.includes('vision') || lower.includes('4o') || lower.includes('omni');
}

export class OpenAIProvider implements LLMProvider {
    name = 'openai';
    private client: OpenAI;
    private model: string;
    private stats: ProviderUsageStats;

    capabilities: ProviderCapabilities;

    constructor(config: OpenAIConfig) {
        if (!validateApiKey(config.apiKey)) {
            throw new Error('Invalid API key format. Expected sk-* format.');
        }

        if (config.baseUrl) {
            const validation = validateAndSanitizeUrl(config.baseUrl);
            if (!validation.valid) {
                throw new Error(`Invalid base URL: ${validation.warning}`);
            }
            if (validation.warning) {
                console.warn(`[SECURITY WARNING] ${validation.warning}`);
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

    async generateText(prompt: string, options?: GenerateOptions): Promise<LLMResponse> {
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
            const cost = this.calculateCost(usage);

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
            const cost = this.calculateCost(usage);

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

    getUsageStats(): ProviderUsageStats {
        return {...this.stats};
    }

    resetUsageStats(): void {
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

    private calculateCost(usage: {inputTokens: number; outputTokens: number}): number {
        const inputCost = (usage.inputTokens / 1_000_000) * this.capabilities.costPer1MInputTokens;
        const outputCost = (usage.outputTokens / 1_000_000) * this.capabilities.costPer1MOutputTokens;
        return inputCost + outputCost;
    }

    private updateStats(
        usage: {inputTokens: number; outputTokens: number; totalTokens: number},
        responseTime: number,
        cost: number,
    ): void {
        this.stats.requestCount++;
        this.stats.totalInputTokens += usage.inputTokens;
        this.stats.totalOutputTokens += usage.outputTokens;
        this.stats.totalTokens += usage.totalTokens;
        this.stats.totalCost += cost;

        const totalRequests = this.stats.requestCount;
        this.stats.averageResponseTimeMs =
            (this.stats.averageResponseTimeMs * (totalRequests - 1) + responseTime) / totalRequests;

        this.stats.lastUpdated = new Date();
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
