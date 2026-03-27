// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {LLMProviderFactory} from '../../provider_factory.js';

export async function runLlmHealth(): Promise<void> {
    try {
        const provider = await LLMProviderFactory.createFromEnv();
        const health = await provider.checkHealth();
        if (!health.healthy) {
            console.error(`${provider.name} failed: ${health.message}`);
            process.exit(1);
        }
        console.log(`${provider.name} OK -> ${health.message}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`LLM health check failed: ${message}`);
        process.exit(1);
    }
}
