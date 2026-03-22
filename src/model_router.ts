// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Model Router — routes agent tasks to appropriate models based on task complexity.
 *
 * Classification/extraction tasks → cheap model (Haiku)
 * Generation/reasoning tasks → capable model (Sonnet)
 */

export type TaskComplexity = 'classification' | 'extraction' | 'generation' | 'reasoning';

export interface ModelRoutingConfig {
    classification?: string;
    extraction?: string;
    generation?: string;
    reasoning?: string;
}

const AGENT_COMPLEXITY: Record<string, TaskComplexity> = {
    'impact-analyst': 'classification',
    'coverage-evaluator': 'classification',
    'cross-impact': 'extraction',
    'regression-advisor': 'extraction',
    'strategist': 'classification',
    'test-designer': 'generation',
    'generator': 'generation',
    'executor': 'generation',
    'healer': 'reasoning',
    'explorer': 'reasoning',
};

const DEFAULT_MODELS: Record<string, Record<TaskComplexity, string>> = {
    anthropic: {
        classification: 'claude-haiku-4-5-20251001',
        extraction: 'claude-haiku-4-5-20251001',
        generation: 'claude-sonnet-4-5-20250514',
        reasoning: 'claude-sonnet-4-5-20250514',
    },
    openai: {
        classification: 'gpt-4o-mini',
        extraction: 'gpt-4o-mini',
        generation: 'gpt-4o',
        reasoning: 'gpt-4o',
    },
};

export class ModelRouter {
    private overrides: ModelRoutingConfig;
    private providerType: string;

    constructor(providerType: string, overrides?: ModelRoutingConfig) {
        this.providerType = providerType;
        this.overrides = overrides || {};
    }

    /**
     * Get the recommended model for a given agent role.
     * Returns undefined if no routing recommendation (use provider default).
     */
    getModel(role: string): string | undefined {
        const complexity = AGENT_COMPLEXITY[role];
        if (!complexity) return undefined;

        // Check user overrides first
        const override = this.overrides[complexity];
        if (override) return override;

        // Check provider defaults
        const defaults = DEFAULT_MODELS[this.providerType];
        if (defaults) return defaults[complexity];

        // No recommendation — use provider's default model
        return undefined;
    }

    /**
     * Get the task complexity for an agent role.
     */
    getComplexity(role: string): TaskComplexity {
        return AGENT_COMPLEXITY[role] || 'generation';
    }
}
