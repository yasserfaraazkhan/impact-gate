// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Sanitize strings before interpolating into LLM prompts.
 * Strips common prompt injection patterns while preserving useful content.
 */

const INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?previous\s+instructions/gi,
    /disregard\s+(all\s+)?(above|prior|previous)/gi,
    /system\s*:\s*/gi,
    /\[INST\]/gi,
    /<<SYS>>/gi,
    /<\|im_start\|>/gi,
    /\bHuman\s*:\s*/g,
    /\bAssistant\s*:\s*/g,
];

const MAX_FIELD_LENGTH = 2000;

export function sanitizeForPrompt(value: string): string {
    let sanitized = value.slice(0, MAX_FIELD_LENGTH);
    for (const pattern of INJECTION_PATTERNS) {
        sanitized = sanitized.replace(pattern, '[filtered]');
    }
    return sanitized;
}

export function sanitizeArray(values: string[]): string[] {
    return values.map((v) => sanitizeForPrompt(v));
}
