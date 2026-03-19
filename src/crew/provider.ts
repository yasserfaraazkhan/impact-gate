// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Shared provider creation for crew agents — ensures consistent provider
 * instantiation and prevents usage stats fragmentation.
 */

import {LLMProviderFactory} from '../provider_factory.js';
import type {LLMProvider} from '../provider_interface.js';
import {BaseProvider} from '../base_provider.js';
import {ModelRouter, type ModelRoutingConfig} from '../model_router.js';
import type {AgentRole} from './types.js';

export interface CrewProviderOptions {
    providerOverride?: string;
    budgetUSD?: number;
    agentRole?: AgentRole;
    modelRoutingProviderType?: string;
    modelRoutingOverrides?: Record<string, string>;
}

export async function getCrewProvider(providerOverride?: string, budgetUSD?: number, opts?: {
    agentRole?: AgentRole;
    modelRoutingProviderType?: string;
    modelRoutingOverrides?: Record<string, string>;
}): Promise<LLMProvider> {
    let effectiveOverride = providerOverride;

    // Apply model routing if configured and agent role is provided
    if (opts?.agentRole && opts?.modelRoutingProviderType) {
        const router = new ModelRouter(opts.modelRoutingProviderType, opts.modelRoutingOverrides as ModelRoutingConfig);
        const model = router.getModel(opts.agentRole);
        if (model) {
            // Override uses provider:model format (e.g., "anthropic:claude-haiku-4-5-20251001")
            effectiveOverride = `${opts.modelRoutingProviderType}:${model}`;
        }
    }

    const provider = effectiveOverride
        ? await LLMProviderFactory.createFromString(effectiveOverride)
        : await LLMProviderFactory.createFromEnv();

    if (budgetUSD !== undefined && provider instanceof BaseProvider) {
        provider.setBudget(budgetUSD);
    }

    return provider;
}
