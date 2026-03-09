// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

export interface ContextDocument {
    name: string;
    path: string;
    content: string;
}

export interface LoadedContext {
    documents: ContextDocument[];
    warnings: string[];
}

const MAX_CHARS_PER_DOC = 15000;
const MAX_TOTAL_CHARS = 40000;

const DEFAULT_CONTEXT_FILES = [
    'CLAUDE.OPTIONAL.md',
    '.claude/CLAUDE.OPTIONAL.md',
    'README.md',
];

export function loadContextDocuments(
    testsRoot: string,
    appRoot?: string,
    additionalFiles?: string[],
): LoadedContext {
    const warnings: string[] = [];
    const documents: ContextDocument[] = [];
    let totalChars = 0;

    const files = [...DEFAULT_CONTEXT_FILES, ...(additionalFiles || [])];
    const seen = new Set<string>();

    for (const file of files) {
        if (totalChars >= MAX_TOTAL_CHARS) {
            break;
        }

        const candidates = [
            join(testsRoot, file),
            ...(appRoot && appRoot !== testsRoot ? [join(appRoot, file)] : []),
        ];

        let found = false;
        for (const candidate of candidates) {
            const normalized = candidate.replace(/\\/g, '/');
            if (seen.has(normalized)) {
                continue;
            }
            seen.add(normalized);

            if (!existsSync(candidate)) {
                continue;
            }

            try {
                const raw = readFileSync(candidate, 'utf-8').trim();
                if (!raw) {
                    continue;
                }
                const remaining = MAX_TOTAL_CHARS - totalChars;
                const content = raw.slice(0, Math.min(MAX_CHARS_PER_DOC, remaining));
                documents.push({
                    name: file,
                    path: normalized,
                    content,
                });
                totalChars += content.length;
                found = true;
                break;
            } catch {
                continue;
            }
        }

        if (!found && DEFAULT_CONTEXT_FILES.includes(file)) {
            // Only warn for default files, not user-provided ones
        }
    }

    if (documents.length === 0) {
        warnings.push('No context documents found (CLAUDE.OPTIONAL.md, README.md). AI agents will have reduced context.');
    }

    return {documents, warnings};
}

export function formatContextForPrompt(context: LoadedContext): string {
    if (context.documents.length === 0) {
        return 'No repository context documents available.';
    }
    return context.documents
        .map((doc) => `### Context: ${doc.name}\n${doc.content}`)
        .join('\n\n');
}

export function loadSpecFileContent(testsRoot: string, relativePath: string, maxChars = 20000): string | null {
    const fullPath = join(testsRoot, relativePath);
    if (!existsSync(fullPath)) {
        return null;
    }
    try {
        const content = readFileSync(fullPath, 'utf-8');
        return content.slice(0, maxChars);
    } catch {
        return null;
    }
}
