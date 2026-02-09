// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {
    CustomConfig,
    GenerateOptions,
    ImageInput,
    LLMResponse,
    ProviderCapabilities,
} from './provider_interface.js';
import {LLMProviderError, UnsupportedCapabilityError} from './provider_interface.js';
import {sanitizeErrorMessage, validateAndSanitizeUrl} from './provider_utils.js';
import {BaseProvider} from './base_provider.js';
import {logger} from './logger.js';

interface OpenAIResponse {
    choices?: Array<{message?: {content?: string}; finish_reason?: string}>;
    usage?: {prompt_tokens?: number; completion_tokens?: number; total_tokens?: number};
}

interface AnthropicResponse {
    content?: Array<{type: 'text'; text: string}>;
    stop_reason?: string;
    usage?: {input_tokens?: number; output_tokens?: number};
}


function normalizeUrl(baseUrl: string, pathSuffix: string): string {
    const trimmed = baseUrl.replace(/\/+$/, '');
    if (trimmed.endsWith(pathSuffix)) {
        return trimmed;
    }
    return `${trimmed}${pathSuffix}`;
}

async function postJson<T>(
    url: string,
    headers: Record<string, string>,
    body: unknown,
    timeoutMs: number | undefined,
    context: string,
): Promise<T> {
    const controller = new AbortController();
    const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...headers,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return (await response.json()) as T;
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`Request timeout (${context})`);
        }
        throw error;
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

export class CustomProvider extends BaseProvider {
    name = 'custom';
    private config: CustomConfig;

    capabilities: ProviderCapabilities;

    constructor(config: CustomConfig) {
        super();

        const validation = validateAndSanitizeUrl(config.baseUrl);
        if (!validation.valid) {
            throw new Error(`Invalid base URL: ${validation.warning}`);
        }
        if (validation.warning) {
            logger.warn(`HTTPS required for remote URLs: ${validation.warning}`);
        }

        this.config = config;

        this.capabilities = {
            vision: config.requestFormat !== 'custom',
            streaming: false,
            maxTokens: 0,
            costPer1MInputTokens: 0,
            costPer1MOutputTokens: 0,
            supportsTools: false,
            supportsPromptCaching: false,
            typicalResponseTimeMs: 0,
        };
    }

    async generateText(prompt: string, options?: GenerateOptions): Promise<LLMResponse> {
        const startTime = Date.now();

        try {
            if (prompt.length > 10 * 1024 * 1024) {
                throw new Error('Prompt exceeds maximum size (10MB)');
            }

            const response = await this.dispatchRequest(prompt, options);
            const responseTime = Date.now() - startTime;

            const text = response.text;
            const usage = response.usage;
            const cost = response.cost;

            this.updateStats(usage, responseTime, cost);

            return {
                text,
                usage,
                cost,
                metadata: response.metadata,
            };
        } catch (error) {
            this.stats.failedRequests++;
            throw new LLMProviderError(
                sanitizeErrorMessage(error, 'generateText'),
                this.name,
                undefined,
                error,
            );
        }
    }

    async analyzeImage(images: ImageInput[], prompt: string, options?: GenerateOptions): Promise<LLMResponse> {
        if (this.config.requestFormat === 'custom') {
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

            const response = await this.dispatchRequest(prompt, options, images);
            const responseTime = Date.now() - startTime;

            const text = response.text;
            const usage = response.usage;
            const cost = response.cost;

            this.updateStats(usage, responseTime, cost);

            return {
                text,
                usage,
                cost,
                metadata: response.metadata,
            };
        } catch (error) {
            this.stats.failedRequests++;
            throw new LLMProviderError(
                sanitizeErrorMessage(error, 'analyzeImage'),
                this.name,
                undefined,
                error,
            );
        }
    }

    private async dispatchRequest(
        prompt: string,
        options?: GenerateOptions,
        images?: ImageInput[],
    ): Promise<{text: string; usage: {inputTokens: number; outputTokens: number; totalTokens: number}; cost: number; metadata?: Record<string, unknown>}> {
        switch (this.config.requestFormat) {
            case 'openai':
                return this.requestOpenAI(prompt, options, images);
            case 'anthropic':
                return this.requestAnthropic(prompt, options, images);
            case 'custom':
                return this.requestCustom(prompt, options);
            default:
                throw new Error(`Unsupported request format: ${this.config.requestFormat}`);
        }
    }

    private async requestOpenAI(
        prompt: string,
        options?: GenerateOptions,
        images?: ImageInput[],
    ): Promise<{text: string; usage: {inputTokens: number; outputTokens: number; totalTokens: number}; cost: number; metadata?: Record<string, unknown>}> {
        const url = normalizeUrl(this.config.baseUrl, '/chat/completions');

        const messages: Array<{
            role: 'system' | 'user';
            content: string | Array<{type: 'text'; text: string} | {type: 'image_url'; image_url: {url: string}}>;
        }> = [];
        if (options?.systemPrompt) {
            messages.push({role: 'system', content: options.systemPrompt});
        }

        if (images && images.length > 0) {
            const content: Array<{type: 'text'; text: string} | {type: 'image_url'; image_url: {url: string}}> = [
                {type: 'text', text: prompt},
            ];

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

                content.push({
                    type: 'image_url',
                    image_url: {url: `data:${mediaType};base64,${data}`},
                });

                if (image.description) {
                    content.push({type: 'text', text: `[Image: ${image.description}]`});
                }
            }

            messages.push({role: 'user', content});
        } else {
            messages.push({role: 'user', content: prompt});
        }

        const body = {
            model: this.config.model,
            messages,
            max_tokens: options?.maxTokens,
            temperature: options?.temperature,
            top_p: options?.topP,
            stop: options?.stopSequences,
        };

        const response = await postJson<OpenAIResponse>(url, this.config.auth, body, options?.timeout, 'openai');

        const text = response.choices?.[0]?.message?.content || '';
        const usage = {
            inputTokens: response.usage?.prompt_tokens || 0,
            outputTokens: response.usage?.completion_tokens || 0,
            totalTokens: response.usage?.total_tokens || 0,
        };

        return {
            text,
            usage,
            cost: 0,
            metadata: {
                finishReason: response.choices?.[0]?.finish_reason,
            },
        };
    }

    private async requestAnthropic(
        prompt: string,
        options?: GenerateOptions,
        images?: ImageInput[],
    ): Promise<{text: string; usage: {inputTokens: number; outputTokens: number; totalTokens: number}; cost: number; metadata?: Record<string, unknown>}> {
        const url = normalizeUrl(this.config.baseUrl, '/messages');

        const content: Array<{type: 'text'; text: string} | {type: 'image'; source: {type: 'base64'; media_type: string; data: string}}> = [
            {type: 'text', text: prompt},
        ];

        if (images && images.length > 0) {
            for (const image of images) {
                const mediaType = (image.mimeType || image.mediaType || 'image/png') as
                    | 'image/png'
                    | 'image/jpeg'
                    | 'image/webp'
                    | 'image/gif';

                if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mediaType)) {
                    throw new Error(`Unsupported image type: ${mediaType}`);
                }

                const data = image.data || image.base64 || '';
                if (data.length > 20 * 1024 * 1024) {
                    throw new Error('Image data exceeds maximum size (20MB)');
                }

                content.push({
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: mediaType,
                        data,
                    },
                });

                if (image.description) {
                    content.push({type: 'text', text: `[Image: ${image.description}]`});
                }
            }
        }

        const body = {
            model: this.config.model,
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
        };

        const response = await postJson<AnthropicResponse>(url, this.config.auth, body, options?.timeout, 'anthropic');

        const text = (response.content || []).map((block) => block.text).join('\n');
        const usage = {
            inputTokens: response.usage?.input_tokens || 0,
            outputTokens: response.usage?.output_tokens || 0,
            totalTokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
        };

        return {
            text,
            usage,
            cost: 0,
            metadata: {
                stopReason: response.stop_reason,
            },
        };
    }

    private async requestCustom(
        prompt: string,
        options?: GenerateOptions,
    ): Promise<{text: string; usage: {inputTokens: number; outputTokens: number; totalTokens: number}; cost: number; metadata?: Record<string, unknown>}> {
        if (!this.config.transformRequest || !this.config.transformResponse) {
            throw new Error('Custom providers require transformRequest and transformResponse');
        }

        const body = this.config.transformRequest(prompt, options);
        const response = await postJson<unknown>(this.config.baseUrl, this.config.auth, body, options?.timeout, 'custom');
        const transformed = this.config.transformResponse(response);

        return {
            text: transformed.text,
            usage: transformed.usage,
            cost: transformed.cost,
            metadata: transformed.metadata,
        };
    }

    // CustomProvider doesn't support streaming
    async *streamText(): AsyncGenerator<string, void, unknown> {
        throw new Error('Streaming not supported for custom providers');
    }

    // CustomProvider doesn't have built-in health checks
    async checkHealth(): Promise<{healthy: boolean; message: string}> {
        return {
            healthy: true,
            message: 'Custom provider configured',
        };
    }

}
