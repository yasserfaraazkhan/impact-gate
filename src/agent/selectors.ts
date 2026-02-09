// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {normalizePath} from './utils.js';

export interface DataTestIdSuggestion {
    file: string;
    line: number;
    tag: string;
    testId: string;
    snippet: string;
}

const INTERACTIVE_TAGS = ['button', 'input', 'select', 'textarea', 'form', 'a'];
const INTERACTIVE_HINT = /(onClick|onSubmit|onChange|type=['"]submit['"]|role=['"]button['"])/;

export function findDataTestIdSuggestions(
    relativePath: string,
    content: string | null,
    flowId: string,
): DataTestIdSuggestion[] {
    if (!content) {
        return [];
    }

    const suggestions: DataTestIdSuggestion[] = [];
    const lines = content.split('\n');
    let counter = 1;

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed.startsWith('<')) {
            continue;
        }
        if (trimmed.includes('data-testid')) {
            continue;
        }

        const tagMatch = trimmed.match(/^<([a-z][a-z0-9-]*)\b/);
        if (!tagMatch) {
            continue;
        }

        const tag = tagMatch[1];
        if (!INTERACTIVE_TAGS.includes(tag)) {
            continue;
        }

        if (!INTERACTIVE_HINT.test(trimmed)) {
            continue;
        }

        const testId = `${flowId}-${tag}-${counter}`;
        counter += 1;

        suggestions.push({
            file: normalizePath(relativePath),
            line: i + 1,
            tag,
            testId,
            snippet: trimmed.slice(0, 200),
        });
    }

    return suggestions;
}

export function applyDataTestIdSuggestions(content: string, suggestions: DataTestIdSuggestion[]): string {
    if (suggestions.length === 0) {
        return content;
    }

    const lines = content.split('\n');
    const suggestionsByLine = new Map<number, DataTestIdSuggestion[]>();
    for (const suggestion of suggestions) {
        const bucket = suggestionsByLine.get(suggestion.line) || [];
        bucket.push(suggestion);
        suggestionsByLine.set(suggestion.line, bucket);
    }

    for (const [lineNumber, lineSuggestions] of suggestionsByLine.entries()) {
        const index = lineNumber - 1;
        if (index < 0 || index >= lines.length) {
            continue;
        }
        let line = lines[index];
        for (const suggestion of lineSuggestions) {
            const pattern = new RegExp(`<${suggestion.tag}(\\s|>)`);
            if (pattern.test(line) && !line.includes('data-testid')) {
                line = line.replace(pattern, `<${suggestion.tag} data-testid="${suggestion.testId}"$1`);
            }
        }
        lines[index] = line;
    }

    return lines.join('\n');
}

