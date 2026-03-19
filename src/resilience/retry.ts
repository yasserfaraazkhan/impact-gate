// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Retry with exponential backoff and jitter for LLM provider calls.
 */

export interface RetryConfig {
    maxRetries: number;      // Default: 2
    baseDelayMs: number;     // Default: 1000
    maxDelayMs: number;      // Default: 10000
    jitter: boolean;         // Default: true
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxRetries: 2,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    jitter: true,
};

/** Errors that should be retried (transient failures) */
function isRetryable(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const msg = error.message.toLowerCase();

    // Rate limits
    if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many requests')) return true;

    // Server errors
    if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) return true;
    if (msg.includes('internal server error') || msg.includes('bad gateway') || msg.includes('service unavailable')) return true;

    // Network errors
    if (msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('etimedout')) return true;
    if (msg.includes('socket hang up') || msg.includes('network error')) return true;

    // Overloaded
    if (msg.includes('overloaded') || msg.includes('capacity')) return true;

    return false;
}

function computeDelay(attempt: number, config: RetryConfig): number {
    const exponential = Math.min(config.baseDelayMs * Math.pow(2, attempt), config.maxDelayMs);
    if (!config.jitter) return exponential;
    // Full jitter: random between 0 and exponential
    return Math.floor(Math.random() * exponential);
}

export async function withRetry<T>(
    fn: () => Promise<T>,
    config: Partial<RetryConfig> = {},
): Promise<T> {
    const cfg = {...DEFAULT_RETRY_CONFIG, ...config};
    let lastError: unknown;

    for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt >= cfg.maxRetries || !isRetryable(error)) {
                throw error;
            }
            const delay = computeDelay(attempt, cfg);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }

    throw lastError;
}
