// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Shared provider creation for crew agents — ensures consistent provider
 * instantiation and prevents usage stats fragmentation.
 */

import {LLMProviderFactory} from '../provider_factory.js';
import type {LLMProvider} from '../provider_interface.js';

export async function getCrewProvider(providerOverride?: string): Promise<LLMProvider> {
    if (providerOverride) {
        return LLMProviderFactory.createFromString(providerOverride);
    }
    return LLMProviderFactory.createFromEnv();
}
