// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {AnthropicProvider} from '../../anthropic_provider.js';
import {LLMProviderError} from '../../provider_interface.js';

export async function runLlmHealth(): Promise<void> {
    if (!process.env.ANTHROPIC_API_KEY) {
        console.error('ANTHROPIC_API_KEY is required for llm-health.');
        process.exit(1);
    }

    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';
    const provider = new AnthropicProvider({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model,
    });

    try {
        const response = await provider.generateText('Reply with OK.', {maxTokens: 8, timeout: 15000});
        const text = response.text.trim();
        console.log(`Anthropic OK (${model}) -> ${text}`);
    } catch (error) {
        if (error instanceof LLMProviderError) {
            console.error(`Anthropic failed: ${error.message}`);
            if (error.cause instanceof Error) {
                console.error(`Cause: ${error.cause.message}`);
            }
        } else if (error instanceof Error) {
            console.error(`Anthropic failed: ${error.message}`);
        } else {
            console.error(`Anthropic failed: ${String(error)}`);
        }
        process.exit(1);
    }
}
