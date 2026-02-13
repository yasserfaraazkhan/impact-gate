// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * TinyDancer-Style Model Router
 *
 * Intelligently routes test generation tasks to appropriate LLM models based on complexity:
 * - Simple tasks (healing, validation): Claude Haiku ($0.25/1M tokens) - 40-60% cost reduction
 * - Moderate tasks (test generation): Claude Sonnet ($3/1M tokens) - balanced quality/cost
 * - Complex tasks (critical failures): Claude Opus ($15/1M tokens) - best quality
 *
 * This achieves 40-60% cost reduction by using cheaper models for simple operations.
 */

export interface TaskComplexity {
    type: 'simple' | 'moderate' | 'complex' | 'critical';
    confidence: number; // 0-100, how confident we are in complexity classification
    reasoning: string; // Why we classified it this way
}

export interface TaskContext {
    operation: 'explore' | 'generate' | 'heal' | 'validate' | 'score';
    attemptNumber?: number; // For healing: 1, 2, or 3
    codeSize?: number; // Number of lines to analyze
    uiMapCoverage?: number; // 0-100, % of UI covered
    errorType?: string; // Type of error encountered
    previousFailures?: number; // How many times has this failed
}

export interface ModelConfig {
    simpleModel: string;
    moderateModel: string;
    complexModel: string;
    criticalModel: string;
}

const MODEL_RATES = {
    'claude-haiku-4-0-20250430': 0.25 / 1_000_000,
    'claude-sonnet-4-5-20250929': 3 / 1_000_000,
    'claude-opus-4-6-20250820': 15 / 1_000_000,
};

export class ModelRouter {
    private modelConfig: ModelConfig;

    constructor(config: Partial<ModelConfig> = {}) {
        this.modelConfig = {
            simpleModel: config.simpleModel || 'claude-haiku-4-0-20250430',
            moderateModel: config.moderateModel || 'claude-sonnet-4-5-20250929',
            complexModel: config.complexModel || 'claude-opus-4-6-20250820',
            criticalModel: config.criticalModel || 'claude-opus-4-6-20250820',
        };
    }

    /**
     * Classify task complexity based on operation, attempt number, and context
     */
    classifyTask(context: TaskContext): TaskComplexity {
        // Healing: Haiku for attempts 1-2, Sonnet for attempt 3
        if (context.operation === 'heal') {
            if (context.attemptNumber && context.attemptNumber <= 2) {
                // First two healing attempts use simple classification
                return {
                    type: 'simple',
                    confidence: 95,
                    reasoning: `Healing attempt ${context.attemptNumber}/3 - re-exploration with targeted fixes`,
                };
            }
            // Final healing attempt is more complex
            return {
                type: 'moderate',
                confidence: 90,
                reasoning: 'Final healing attempt - may need comprehensive refactoring',
            };
        }

        // Validation: Always simple (use Haiku)
        if (context.operation === 'validate') {
            return {
                type: 'simple',
                confidence: 100,
                reasoning: 'Selector/code validation is lightweight',
            };
        }

        // Scoring: Simple (quick analysis)
        if (context.operation === 'score') {
            return {
                type: 'simple',
                confidence: 95,
                reasoning: 'Test quality scoring via static analysis',
            };
        }

        // Exploration: Simple (just navigation and snapshot)
        if (context.operation === 'explore') {
            return {
                type: 'simple',
                confidence: 90,
                reasoning: 'UI exploration is mostly navigation',
            };
        }

        // Generation: Varies by UI map coverage
        if (context.operation === 'generate') {
            // Strong signal: Use Sonnet but can optimize
            if (context.uiMapCoverage && context.uiMapCoverage >= 75) {
                return {
                    type: 'moderate',
                    confidence: 90,
                    reasoning: `Strong UI signal (${context.uiMapCoverage}% coverage) - moderate complexity generation`,
                };
            }

            // Moderate signal: Use Sonnet
            if (context.uiMapCoverage && context.uiMapCoverage >= 50) {
                return {
                    type: 'moderate',
                    confidence: 75,
                    reasoning: `Moderate UI signal (${context.uiMapCoverage}% coverage) - standard generation`,
                };
            }

            // Weak signal: Complex task (need better reasoning)
            if (context.uiMapCoverage && context.uiMapCoverage < 50) {
                return {
                    type: 'complex',
                    confidence: 70,
                    reasoning: `Weak UI signal (${context.uiMapCoverage}% coverage) - requires advanced reasoning`,
                };
            }

            // Unknown coverage: Assume moderate
            return {
                type: 'moderate',
                confidence: 50,
                reasoning: 'Generation with unknown UI coverage - use standard model',
            };
        }

        // Default to moderate
        return {
            type: 'moderate',
            confidence: 50,
            reasoning: 'Unknown operation - defaulting to moderate complexity',
        };
    }

    /**
     * Select appropriate model based on task complexity
     */
    selectModel(complexity: TaskComplexity): string {
        switch (complexity.type) {
            case 'simple':
                return this.modelConfig.simpleModel;
            case 'moderate':
                return this.modelConfig.moderateModel;
            case 'complex':
                return this.modelConfig.complexModel;
            case 'critical':
                return this.modelConfig.criticalModel;
        }
    }

    /**
     * Get estimated cost for a task
     */
    estimateCost(complexity: TaskComplexity, estimatedTokens: number = 5000): number {
        const model = this.selectModel(complexity);
        const rate = (MODEL_RATES as Record<string, number>)[model] || 0.003 / 1_000_000;
        return estimatedTokens * rate;
    }

    /**
     * Get cost savings vs always using Sonnet
     */
    estimateSavings(
        complexity: TaskComplexity,
        estimatedTokens: number = 5000,
    ): {
        savedCost: number;
        savingsPercent: number;
    } {
        const selectedModel = this.selectModel(complexity);
        const selectedRate = (MODEL_RATES as Record<string, number>)[selectedModel] || 0.003 / 1_000_000;
        const sonnetRate = MODEL_RATES['claude-sonnet-4-5-20250929'];

        const selectedCost = estimatedTokens * selectedRate;
        const sonnetCost = estimatedTokens * sonnetRate;
        const savedCost = sonnetCost - selectedCost;
        const savingsPercent = (savedCost / sonnetCost) * 100;

        return {savedCost, savingsPercent};
    }

    /**
     * Format complexity for logging
     */
    formatComplexity(complexity: TaskComplexity, tokensUsed?: number): string {
        const model = this.selectModel(complexity);
        const modelShort = model.includes('haiku') ? 'Haiku' : model.includes('sonnet') ? 'Sonnet' : 'Opus';
        const confidence = `${complexity.confidence}%`;
        const cost = tokensUsed
            ? ` ($${(tokensUsed * ((MODEL_RATES as Record<string, number>)[model] || 0)).toFixed(4)})`
            : '';
        return `${complexity.type.toUpperCase()}/${modelShort}/${confidence}${cost} - ${complexity.reasoning}`;
    }
}
