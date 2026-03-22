// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Shared JSON extraction from LLM text responses.
 * Handles fenced code blocks, bare JSON, and partial text.
 */

/**
 * Extract and parse JSON from LLM response text.
 * Tries fenced code blocks first, then raw text.
 * Returns null if no valid JSON found.
 *
 * @param text - Raw LLM response text
 * @param validate - Predicate to check if parsed object has the expected shape
 */
export function extractJsonFromResponse<T>(text: string, validate: (obj: unknown) => obj is T): T | null {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidates = fenced ? [fenced[1], text] : [text];

    for (const candidate of candidates) {
        const start = candidate.indexOf('{');
        const end = candidate.lastIndexOf('}');
        if (start < 0 || end <= start) {
            continue;
        }
        const raw = candidate.slice(start, end + 1);
        try {
            const parsed = JSON.parse(raw);
            if (validate(parsed)) {
                return parsed;
            }
        } catch {
            continue;
        }
    }
    return null;
}
