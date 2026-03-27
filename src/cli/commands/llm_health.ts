// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {AnthropicProvider} from '../../anthropic_provider.js';
import {OpenAIProvider} from '../../openai_provider.js';
import {OllamaProvider} from '../../ollama_provider.js';
import {LLMProviderError} from '../../provider_interface.js';

interface HealthResult {
    provider: string;
    model: string;
    ok: boolean;
    response?: string;
    error?: string;
}

async function checkAnthropic(): Promise<HealthResult | null> {
    if (!process.env.ANTHROPIC_API_KEY) {
        return null;
    }
    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';
    try {
        const provider = new AnthropicProvider({apiKey: process.env.ANTHROPIC_API_KEY, model});
        const response = await provider.generateText('Reply with OK.', {maxTokens: 8, timeout: 15000});
        return {provider: 'Anthropic', model, ok: true, response: response.text.trim()};
    } catch (error) {
        const message = error instanceof LLMProviderError || error instanceof Error ? error.message : String(error);
        return {provider: 'Anthropic', model, ok: false, error: message};
    }
}

async function checkOpenAI(): Promise<HealthResult | null> {
    if (!process.env.OPENAI_API_KEY) {
        return null;
    }
    const model = process.env.OPENAI_MODEL || 'gpt-4o';
    try {
        const provider = new OpenAIProvider({apiKey: process.env.OPENAI_API_KEY, model});
        const response = await provider.generateText('Reply with OK.', {maxTokens: 8, timeout: 15000});
        return {provider: 'OpenAI', model, ok: true, response: response.text.trim()};
    } catch (error) {
        const message = error instanceof LLMProviderError || error instanceof Error ? error.message : String(error);
        return {provider: 'OpenAI', model, ok: false, error: message};
    }
}

async function checkOllama(): Promise<HealthResult | null> {
    const baseUrl = process.env.OLLAMA_HOST || 'http://localhost:11434';
    const model = process.env.OLLAMA_MODEL || 'llama3';
    try {
        const provider = new OllamaProvider({baseUrl, model});
        const response = await provider.generateText('Reply with OK.', {maxTokens: 8, timeout: 15000});
        return {provider: 'Ollama', model, ok: true, response: response.text.trim()};
    } catch (error) {
        const message = error instanceof LLMProviderError || error instanceof Error ? error.message : String(error);
        return {provider: 'Ollama', model, ok: false, error: message};
    }
}

export async function runLlmHealth(): Promise<void> {
    const checks = await Promise.allSettled([checkAnthropic(), checkOpenAI(), checkOllama()]);
    const results: HealthResult[] = [];

    for (const check of checks) {
        if (check.status === 'fulfilled' && check.value) {
            results.push(check.value);
        }
    }

    if (results.length === 0) {
        console.error('No LLM providers configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OLLAMA_HOST.');
        process.exit(1);
    }

    let anyFailed = false;
    for (const r of results) {
        if (r.ok) {
            console.log(`${r.provider} OK (${r.model}) -> ${r.response}`);
        } else {
            console.error(`${r.provider} failed (${r.model}): ${r.error}`);
            anyFailed = true;
        }
    }

    if (anyFailed) {
        process.exit(1);
    }
}
