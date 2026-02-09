// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * SECURITY: Shared utility functions for all LLM providers
 * Eliminates code duplication and ensures consistent error handling
 */

/**
 * Pre-compiled regex patterns for API key validation
 * Compiled once and reused to avoid repeated regex compilation
 */
export const API_KEY_PATTERNS = {
    anthropic: /^sk-ant-[a-zA-Z0-9_\-]{20,}$/,
    openai: /^sk-[a-zA-Z0-9_\-]{20,}$/,
};

/**
 * SECURITY: Sanitize error messages to prevent information leakage
 * Maps specific API errors to safe, user-friendly messages
 * Prevents leaking stack traces, API keys, or internal details
 */
export function sanitizeErrorMessage(error: unknown, context: string): string {
    if (error instanceof Error) {
        const msg = error.message.toLowerCase();

        // Map specific API errors to safe messages
        if (msg.includes('401') || msg.includes('authentication')) {
            return `Authentication failed (${context})`;
        }
        if (msg.includes('429') || msg.includes('rate')) {
            return `Rate limit exceeded (${context})`;
        }
        if (msg.includes('timeout') || msg.includes('etimedout')) {
            return `Request timeout (${context})`;
        }
        if (msg.includes('network') || msg.includes('econnrefused')) {
            return `Connection failed (${context})`;
        }
        if (msg.includes('enotfound') || msg.includes('getaddrinfo')) {
            return `Host not found (${context})`;
        }

        // Don't leak stack traces, API keys, or internal details
        return `Operation failed (${context})`;
    }
    return 'An unexpected error occurred';
}

/**
 * Generic timeout wrapper for promises
 * Rejects with timeout error if promise doesn't resolve in time
 */
export function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number | undefined,
    context: string,
): Promise<T> {
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
 * Check if a hostname is localhost
 * Used by URL validation to allow HTTP for local development
 */
export function isLocalhost(hostname: string | undefined): boolean {
    if (!hostname) {
        return false;
    }
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

/**
 * SECURITY: Validate and enforce HTTPS for remote URLs
 * Allows HTTP only for localhost development
 * Returns validation result with optional warning message
 */
export function validateAndSanitizeUrl(
    baseUrl: string | undefined,
): {valid: boolean; url?: string; warning?: string} {
    if (!baseUrl) {
        return {valid: true};
    }

    try {
        const url = new URL(baseUrl);

        // For non-localhost URLs, require HTTPS
        if (!isLocalhost(url.hostname) && url.protocol !== 'https:') {
            return {
                valid: false,
                warning: `HTTPS required for remote URLs. Got: ${url.protocol}//${url.hostname}`,
            };
        }

        return {valid: true, url: baseUrl};
    } catch {
        return {valid: false};
    }
}
