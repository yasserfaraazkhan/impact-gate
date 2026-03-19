// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Secret scanning and sanitization utilities.
 * Prevents API keys and credentials from leaking into artifacts, logs, and output.
 *
 * Patterns are stored WITHOUT the global flag to avoid shared mutable lastIndex state.
 * New RegExp instances with /g are created per call for safe concurrent usage.
 */

const SECRET_PATTERNS: RegExp[] = [
    // Anthropic API keys (must be checked before generic sk- pattern)
    /sk-ant-[a-zA-Z0-9_-]{20,}/,
    // OpenAI API keys (negative lookahead to avoid matching Anthropic keys)
    /sk-(?!ant-)[a-zA-Z0-9]{20,}/,
    // Generic API key patterns
    /(?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token)['":\s=]+['"]?([a-zA-Z0-9_\-./]{20,})['"]?/i,
    // Bearer tokens
    /Bearer\s+[a-zA-Z0-9_\-./]{20,}/,
    // AWS keys
    /AKIA[0-9A-Z]{16}/,
    // GitHub tokens
    /gh[ps]_[a-zA-Z0-9]{36,}/,
    /github_pat_[a-zA-Z0-9_]{22,}/,
];

/**
 * Sanitize a string by replacing detected secrets with [REDACTED].
 */
export function sanitizeSecrets(text: string): string {
    let result = text;
    for (const pattern of SECRET_PATTERNS) {
        result = result.replace(new RegExp(pattern, 'gi'), '[REDACTED]');
    }
    return result;
}

/**
 * Check if a string contains any detectable secrets.
 */
export function containsSecrets(text: string): boolean {
    for (const pattern of SECRET_PATTERNS) {
        if (new RegExp(pattern, 'i').test(text)) return true;
    }
    return false;
}

/**
 * Deep-sanitize a JSON-serializable object.
 * Recursively walks all string values and sanitizes them.
 * Tracks seen objects to prevent stack overflow on circular references.
 */
export function sanitizeObject<T>(obj: T, _seen?: WeakSet<object>): T {
    if (typeof obj === 'string') return sanitizeSecrets(obj) as T;
    if (obj === null || typeof obj !== 'object') return obj;

    const seen = _seen ?? new WeakSet<object>();
    if (seen.has(obj as object)) return '[Circular]' as T;
    seen.add(obj as object);

    if (Array.isArray(obj)) return obj.map((item) => sanitizeObject(item, seen)) as T;

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
        result[key] = sanitizeObject(value, seen);
    }
    return result as T;
}
