// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Secret scanning and sanitization utilities.
 * Prevents API keys and credentials from leaking into artifacts, logs, and output.
 */

const SECRET_PATTERNS = [
    // Anthropic API keys
    /sk-ant-[a-zA-Z0-9_-]{20,}/g,
    // OpenAI API keys
    /sk-[a-zA-Z0-9]{20,}/g,
    // Generic API key patterns
    /(?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token)['":\s=]+['"]?([a-zA-Z0-9_\-./]{20,})['"]?/gi,
    // Bearer tokens
    /Bearer\s+[a-zA-Z0-9_\-./]{20,}/g,
    // AWS keys
    /AKIA[0-9A-Z]{16}/g,
    // GitHub tokens
    /gh[ps]_[a-zA-Z0-9]{36,}/g,
    /github_pat_[a-zA-Z0-9_]{22,}/g,
];

/**
 * Sanitize a string by replacing detected secrets with [REDACTED].
 */
export function sanitizeSecrets(text: string): string {
    let result = text;
    for (const pattern of SECRET_PATTERNS) {
        // Reset lastIndex for global patterns
        pattern.lastIndex = 0;
        result = result.replace(pattern, '[REDACTED]');
    }
    return result;
}

/**
 * Check if a string contains any detectable secrets.
 */
export function containsSecrets(text: string): boolean {
    for (const pattern of SECRET_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(text)) return true;
    }
    return false;
}

/**
 * Deep-sanitize a JSON-serializable object.
 * Recursively walks all string values and sanitizes them.
 */
export function sanitizeObject<T>(obj: T): T {
    if (typeof obj === 'string') return sanitizeSecrets(obj) as T;
    if (Array.isArray(obj)) return obj.map(sanitizeObject) as T;
    if (obj !== null && typeof obj === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = sanitizeObject(value);
        }
        return result as T;
    }
    return obj;
}
