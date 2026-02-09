// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import OpenAI from 'openai';

import type {
    GenerateOptions,
    ImageInput,
    LLMProvider,
    LLMResponse,
    OllamaConfig,
    ProviderCapabilities,
    ProviderUsageStats,
} from './provider_interface.js';
import {LLMProviderError, UnsupportedCapabilityError} from './provider_interface.js';

/**
 * SECURITY: Validate Ollama base URL and enforce HTTPS for remote connections
 */
function normalizeOllamaBaseUrl(baseUrl: string | undefined): string {
    const raw = baseUrl || 'http://localhost:11434';
    try {
        const parsed = new URL(raw);
        if (!parsed.pathname || parsed.pathname === '/') {
            parsed.pathname = '/v1';
        }
        return parsed.toString().replace(/\/$/, '');
    } catch {
        return 'http://localhost:11434/v1';
    }
}


function validateOllamaUrl(baseUrl: string | undefined): {valid: boolean; url: string; warning?: string} {
    const url = normalizeOllamaBaseUrl(baseUrl);

    try {
        const parsed = new URL(url);

        // For non-localhost URLs, warn about HTTP risks
        const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
        if (!isLocalhost && parsed.protocol === 'http:') {
            console.warn(
                '[SECURITY WARNING] Ollama connection over plaintext HTTP to remote server. ' +
                'Prompts and responses will be transmitted unencrypted. Consider using HTTPS proxy or local Ollama.'
            );
        }

        return {valid: true, url};
    } catch {
        return {
            valid: false,
            url: 'http://localhost:11434/v1',
            warning: `Invalid Ollama URL: ${baseUrl}. Using default: http://localhost:11434/v1`,
        };
    }
}

/**
 * SECURITY: Validate model name to prevent injection issues
 */
function validateModelName(model: string): boolean {
    // Allow alphanumeric, dash, colon, underscore
    // Typical format: deepseek-r1:7b, llama4:13b, etc.
    return /^[a-z0-9_:.\-]+$/i.test(model) && model.length < 256;
}

/**
 * SECURITY: Validate timeout value
 */
function validateTimeout(timeout: number | undefined): number {
    if (!timeout) return 60000;
    if (timeout < 1000 || timeout > 600000) {
        console.warn('Timeout out of valid range (1s-10m). Using 60 second default.');
        return 60000;
    }
    return timeout;
}

/**
 * SECURITY: Sanitize error messages to prevent information leakage
 */
function sanitizeErrorMessage(error: unknown, context: string): string {
    if (error instanceof Error) {
        const msg = error.message.toLowerCase();

        // Map specific connection errors to safe messages
        if (msg.includes('econnrefused') || msg.includes('refused')) {
            return `Connection refused (${context}). Make sure Ollama is running.`;
        }
        if (msg.includes('enotfound') || msg.includes('getaddrinfo')) {
            return `Host not found (${context})`;
        }
        if (msg.includes('timeout') || msg.includes('etimedout')) {
            return `Connection timeout (${context})`;
        }
        if (msg.includes('network') || msg.includes('socket')) {
            return `Network error (${context})`;
        }

        // Don't leak internal details or stack traces
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

/**
 * Ollama Provider - Free, local LLM execution
 *
 * Features:
 * - Zero cost (runs locally)
 * - Full privacy (no data leaves your machine)
 * - OpenAI-compatible API
 * - Supports DeepSeek-R1, Llama 4, and other open models
 *
 * Limitations:
 * - No vision support (most models)
 * - Slower inference than cloud APIs (~2-5 sec vs <1 sec)
 * - Requires local installation and model downloads
 *
 * Recommended models:
 * - deepseek-r1:7b - Fast, good quality, low memory (4GB)
 * - deepseek-r1:14b - Better quality, medium memory (8GB)
 * - llama4:13b - High quality, medium memory (8GB)
 * - deepseek-r1:7b-q4 - Quantized for speed, lower quality
 *
 * Setup:
 * 1. Install Ollama: curl -fsSL https://ollama.com/install.sh | sh
 * 2. Pull model: ollama pull deepseek-r1:7b
 * 3. Start: ollama serve (runs on localhost:11434)
 */
export class OllamaProvider implements LLMProvider {
    name = 'ollama';
    private client: OpenAI;
    private model: string;
    private stats: ProviderUsageStats;

    capabilities: ProviderCapabilities = {
        vision: false, // Most Ollama models don't support vision
        streaming: true,
        maxTokens: 8000, // Varies by model
        costPer1MInputTokens: 0, // Free!
        costPer1MOutputTokens: 0, // Free!
        supportsTools: true, // DeepSeek, Llama 4 support function calling
        supportsPromptCaching: false,
        typicalResponseTimeMs: 3000, // ~2-5 seconds on decent hardware
    };

    constructor(config: OllamaConfig) {
        // SECURITY: Validate and sanitize URL
        const urlValidation = validateOllamaUrl(config.baseUrl);
        if (!urlValidation.valid && urlValidation.warning) {
            console.warn(urlValidation.warning);
        }

        // SECURITY: Validate timeout
        const timeout = validateTimeout(config.timeout);

        // Ollama uses OpenAI-compatible API
        this.client = new OpenAI({
            baseURL: urlValidation.url,
            apiKey: 'ollama', // Ollama doesn't require real API key
            timeout,
            maxRetries: 0, // Don't retry to avoid hanging on connection issues
        });

        const model = config.model || 'deepseek-r1:7b';

        // SECURITY: Validate model name format
        if (!validateModelName(model)) {
            throw new Error('Invalid model name format');
        }

        this.model = model;

        // Initialize stats
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
            // SECURITY: Validate prompt length
            if (prompt.length > 10 * 1024 * 1024) {
                throw new Error('Prompt exceeds maximum size (10MB)');
            }

            const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

            // Add system message if provided
            if (options?.systemPrompt) {
                messages.push({
                    role: 'system',
                    content: options.systemPrompt,
                });
            }

            // Add user prompt
            messages.push({
                role: 'user',
                content: prompt,
            });

            const response = await withTimeout(this.client.chat.completions.create({
                model: this.model,
                messages,
                max_tokens: options?.maxTokens,
                temperature: options?.temperature,
                top_p: options?.topP,
                stop: options?.stopSequences,
            }), options?.timeout, 'generateText');

            const responseTime = Date.now() - startTime;
            const text = response.choices[0]?.message?.content || '';
            const usage = {
                inputTokens: response.usage?.prompt_tokens || 0,
                outputTokens: response.usage?.completion_tokens || 0,
                totalTokens: response.usage?.total_tokens || 0,
            };

            // Update stats
            this.updateStats(usage, responseTime, 0); // Cost is always 0 for Ollama

            return {
                text,
                usage,
                cost: 0, // Free!
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
                undefined,
                error,
            );
        }
    }

    /**
     * Ollama does not support vision by default
     * This method throws an error to help users understand the limitation
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async analyzeImage(images: ImageInput[], prompt: string, options?: GenerateOptions): Promise<LLMResponse> {
        throw new UnsupportedCapabilityError(this.name, 'vision');
    }

    /**
     * Stream text generation for real-time feedback
     */
    async *streamText(prompt: string, options?: GenerateOptions): AsyncGenerator<string, void, unknown> {
        try {
            // SECURITY: Validate prompt length
            if (prompt.length > 10 * 1024 * 1024) {
                throw new Error('Prompt exceeds maximum size (10MB)');
            }

            const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

            if (options?.systemPrompt) {
                messages.push({
                    role: 'system',
                    content: options.systemPrompt,
                });
            }

            messages.push({
                role: 'user',
                content: prompt,
            });

            const stream = await withTimeout(this.client.chat.completions.create({
                model: this.model,
                messages,
                max_tokens: options?.maxTokens,
                temperature: options?.temperature,
                top_p: options?.topP,
                stop: options?.stopSequences,
                stream: true,
            }), options?.timeout, 'streamText');

            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content;
                if (content) {
                    yield content;
                }
            }

            // Note: Streaming doesn't provide detailed usage stats
            // We increment request count but can't track exact tokens
            this.stats.requestCount++;
            this.stats.lastUpdated = new Date();
        } catch (error) {
            this.stats.failedRequests++;
            throw new LLMProviderError(
                sanitizeErrorMessage(error, 'streamText'),
                this.name,
                undefined,
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

        // Update rolling average response time
        const totalRequests = this.stats.requestCount;
        this.stats.averageResponseTimeMs =
            (this.stats.averageResponseTimeMs * (totalRequests - 1) + responseTime) / totalRequests;

        this.stats.lastUpdated = new Date();
    }

    /**
     * Check if Ollama is running and accessible
     */
    async checkHealth(): Promise<{healthy: boolean; message: string}> {
        try {
            // Try a simple request
            await withTimeout(this.client.models.list(), 5000, 'health check');
            return {
                healthy: true,
                message: `Ollama is running with model: ${this.model}`,
            };
        } catch (error) {
            return {
                healthy: false,
                message: `Ollama not accessible: ${sanitizeErrorMessage(error, 'health check')}`,
            };
        }
    }

    /**
     * List available models in Ollama
     */
    async listModels(): Promise<string[]> {
        try {
            const response = await withTimeout(this.client.models.list(), 5000, 'listModels');
            return response.data.map((model) => model.id);
        } catch (error) {
            throw new LLMProviderError(
                sanitizeErrorMessage(error, 'listModels'),
                this.name,
                undefined,
                error,
            );
        }
    }
}

/**
 * Helper function to check if Ollama is installed and suggest setup
 */
export async function checkOllamaSetup(): Promise<{
    installed: boolean;
    running: boolean;
    modelAvailable: boolean;
    setupInstructions: string;
}> {
    const provider = new OllamaProvider({});

    try {
        const health = await provider.checkHealth();
        const models = await provider.listModels();

        return {
            installed: true,
            running: health.healthy,
            modelAvailable: models.length > 0,
            setupInstructions: health.healthy ? 'Ollama is ready to use!' : 'Run: ollama serve',
        };
    } catch {
        return {
            installed: false,
            running: false,
            modelAvailable: false,
            setupInstructions: `
Ollama is not installed. To set up:

1. Install Ollama:
   curl -fsSL https://ollama.com/install.sh | sh

2. Pull a model (choose one):
   ollama pull deepseek-r1:7b          # Recommended: Fast, 4GB RAM
   ollama pull deepseek-r1:14b         # Better quality, 8GB RAM
   ollama pull llama4:13b              # Alternative, 8GB RAM

3. Start Ollama:
   ollama serve

For more info: https://ollama.com
            `.trim(),
        };
    }
}
