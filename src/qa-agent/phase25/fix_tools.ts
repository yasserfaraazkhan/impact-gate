// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {execFileSync} from 'child_process';
import {readFileSync, writeFileSync, existsSync} from 'fs';
import {resolve, relative, sep} from 'path';

import type Anthropic from '@anthropic-ai/sdk';

import type {AgentBrowser} from '../phase2/agent_browser.js';

// ---------------------------------------------------------------------------
// Tool definitions for the fix agent (Anthropic tool_use schema)
// ---------------------------------------------------------------------------

export const FIX_TOOL_DEFINITIONS: Anthropic.Tool[] = [
    {
        name: 'read_file',
        description: 'Read the contents of a source file. Use startLine/endLine for large files.',
        input_schema: {
            type: 'object' as const,
            properties: {
                path: {type: 'string', description: 'Relative path from project root'},
                start_line: {type: 'number', description: 'First line to read (1-based, optional)'},
                end_line: {type: 'number', description: 'Last line to read (inclusive, optional)'},
            },
            required: ['path'],
        },
    },
    {
        name: 'write_file',
        description: 'Write content to a file. For patches, read the file first, modify, and write back.',
        input_schema: {
            type: 'object' as const,
            properties: {
                path: {type: 'string', description: 'Relative path from project root'},
                content: {type: 'string', description: 'Full file content to write'},
            },
            required: ['path', 'content'],
        },
    },
    {
        name: 'search_code',
        description: 'Search for a pattern in the codebase using grep. Returns matching lines with file paths and line numbers.',
        input_schema: {
            type: 'object' as const,
            properties: {
                pattern: {type: 'string', description: 'Search pattern (regex supported)'},
                glob: {type: 'string', description: 'File glob to restrict search (e.g. "*.tsx", "src/**/*.ts")'},
            },
            required: ['pattern'],
        },
    },
    {
        name: 'run_command',
        description: 'Run an allowlisted shell command (e.g. type checking, build, lint). Not for arbitrary commands.',
        input_schema: {
            type: 'object' as const,
            properties: {
                command: {type: 'string', description: 'Command to run (must be allowlisted)'},
            },
            required: ['command'],
        },
    },
    {
        name: 'git_commit',
        description: 'Stage changed files and create an atomic commit.',
        input_schema: {
            type: 'object' as const,
            properties: {
                message: {type: 'string', description: 'Commit message (format: fix(qa): ISSUE-{id} — {description})'},
                files: {
                    type: 'array',
                    items: {type: 'string'},
                    description: 'Files to stage (relative paths)',
                },
            },
            required: ['message', 'files'],
        },
    },
    {
        name: 'git_revert',
        description: 'Revert the most recent commit (HEAD).',
        input_schema: {
            type: 'object' as const,
            properties: {},
            required: [],
        },
    },
    {
        name: 'git_restore',
        description: 'Discard all uncommitted changes in the working tree. Use this if validation fails BEFORE you have committed, to clean up your attempted edits.',
        input_schema: {
            type: 'object' as const,
            properties: {},
            required: [],
        },
    },
    {
        name: 'verify_in_browser',
        description: 'Navigate to a URL, take a screenshot, and report whether the fix resolved the issue. You MUST set fixed=true only if the original bug is no longer present. Set fixed=false if the bug still reproduces or if you cannot confirm.',
        input_schema: {
            type: 'object' as const,
            properties: {
                url: {type: 'string', description: 'URL to navigate to for verification'},
                label: {type: 'string', description: 'Label for the screenshot (e.g. "after-fix-001")'},
                fixed: {type: 'boolean', description: 'true if the original bug is gone, false if it still reproduces or uncertain'},
            },
            required: ['url', 'label', 'fixed'],
        },
    },
];

// ---------------------------------------------------------------------------
// Execution context
// ---------------------------------------------------------------------------

export interface FixToolContext {
    projectRoot: string;
    browser: AgentBrowser;
    baseUrl: string;
    screenshotDir: string;
    screenshotCounter: number;
    /** Commit hashes created by the fix loop. Only these can be reverted. */
    qaCommitHashes: Set<string>;
}

export interface FixToolResult {
    output: string;
    filesChanged?: string[];
    commitHash?: string;
    screenshotPath?: string;
    /** Explicit verification signal from verify_in_browser */
    verifiedFixed?: boolean;
}

// ---------------------------------------------------------------------------
// Security: path and command validation
// ---------------------------------------------------------------------------

const BLOCKED_PATHS = new Set(['.env', '.env.local', '.env.production', 'node_modules']);

function isPathSafe(projectRoot: string, filePath: string): boolean {
    const resolved = resolve(projectRoot, filePath);
    const rel = relative(projectRoot, resolved);

    // Must stay within project
    if (rel.startsWith('..') || rel.startsWith(sep)) {
        return false;
    }

    // Block sensitive files and directories
    const parts = rel.split(sep);
    for (const part of parts) {
        if (BLOCKED_PATHS.has(part)) {
            return false;
        }
    }

    return true;
}

const COMMAND_ALLOWLIST = [
    /^npx tsc\b/,
    /^npx eslint\b/,
    /^npm run (build|lint|typecheck|check)\b/,
    /^npx playwright test\b/,
];

function isCommandAllowed(command: string): boolean {
    return COMMAND_ALLOWLIST.some((re) => re.test(command.trim()));
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

export function executeFixTool(
    ctx: FixToolContext,
    name: string,
    input: Record<string, unknown>,
): FixToolResult {
    switch (name) {
    case 'read_file': {
        const filePath = String(input.path);
        if (!isPathSafe(ctx.projectRoot, filePath)) {
            return {output: `Blocked: "${filePath}" is outside the project or a restricted path.`};
        }
        const fullPath = resolve(ctx.projectRoot, filePath);
        if (!existsSync(fullPath)) {
            return {output: `File not found: ${filePath}`};
        }
        const content = readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        const startLine = Math.max(1, Number(input.start_line) || 1);
        const endLine = Math.min(lines.length, Number(input.end_line) || lines.length);
        const slice = lines.slice(startLine - 1, endLine);
        const numbered = slice.map((l, i) => `${startLine + i}: ${l}`).join('\n');
        return {output: numbered};
    }

    case 'write_file': {
        const filePath = String(input.path);
        if (!isPathSafe(ctx.projectRoot, filePath)) {
            return {output: `Blocked: "${filePath}" is outside the project or a restricted path.`};
        }
        const fullPath = resolve(ctx.projectRoot, filePath);
        writeFileSync(fullPath, String(input.content), 'utf-8');
        return {output: `Written: ${filePath}`, filesChanged: [filePath]};
    }

    case 'search_code': {
        const pattern = String(input.pattern);
        const glob = input.glob ? String(input.glob) : undefined;
        try {
            const args = ['-rn', '--max-count=20', pattern];
            if (glob) {
                args.push('--include', glob);
            }
            args.push('.');
            const result = execFileSync('grep', args, {
                cwd: ctx.projectRoot,
                encoding: 'utf-8',
                timeout: 10_000,
                maxBuffer: 1024 * 1024,
            });
            return {output: result.trim() || 'No matches found.'};
        } catch (err: unknown) {
            const error = err as {status?: number; stdout?: string};
            if (error.status === 1) {
                return {output: 'No matches found.'};
            }
            return {output: `Search error: ${String(err)}`};
        }
    }

    case 'run_command': {
        const command = String(input.command).trim();
        if (!isCommandAllowed(command)) {
            return {output: `Blocked: "${command}" is not in the allowlist. Allowed: npx tsc, npx eslint, npm run build/lint/typecheck/check, npx playwright test.`};
        }
        try {
            const parts = command.split(/\s+/);
            const result = execFileSync(parts[0], parts.slice(1), {
                cwd: ctx.projectRoot,
                encoding: 'utf-8',
                timeout: 60_000,
                maxBuffer: 2 * 1024 * 1024,
            });
            return {output: result.trim() || '(no output)'};
        } catch (err: unknown) {
            const error = err as {stdout?: string; stderr?: string};
            const stdout = error.stdout || '';
            const stderr = error.stderr || '';
            return {output: `Command failed:\n${stdout}\n${stderr}`.trim()};
        }
    }

    case 'git_commit': {
        const message = String(input.message);
        const files = Array.isArray(input.files) ? (input.files as unknown[]).map(String) : [];
        if (files.length === 0) {
            return {output: 'No files specified for commit.'};
        }
        // Validate all files are safe
        for (const f of files) {
            if (!isPathSafe(ctx.projectRoot, f)) {
                return {output: `Blocked: "${f}" is outside the project or a restricted path.`};
            }
        }
        try {
            execFileSync('git', ['add', ...files], {cwd: ctx.projectRoot, encoding: 'utf-8'});
            execFileSync('git', ['commit', '-m', message], {cwd: ctx.projectRoot, encoding: 'utf-8'});
            const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {cwd: ctx.projectRoot, encoding: 'utf-8'}).trim();
            ctx.qaCommitHashes.add(hash);
            return {output: `Committed: ${hash} — ${message}`, commitHash: hash, filesChanged: files};
        } catch (err: unknown) {
            const error = err as {stderr?: string};
            return {output: `Git commit failed: ${error.stderr || String(err)}`};
        }
    }

    case 'git_revert': {
        // Safety: only revert commits created by the fix loop
        const currentHead = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {cwd: ctx.projectRoot, encoding: 'utf-8'}).trim();
        if (!ctx.qaCommitHashes.has(currentHead)) {
            return {output: `Blocked: HEAD (${currentHead}) was not created by the fix loop. Refusing to revert a user commit.`};
        }
        try {
            execFileSync('git', ['revert', '--no-edit', 'HEAD'], {cwd: ctx.projectRoot, encoding: 'utf-8'});
            ctx.qaCommitHashes.delete(currentHead);
            const newHash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {cwd: ctx.projectRoot, encoding: 'utf-8'}).trim();
            return {output: `Reverted ${currentHead}. New HEAD: ${newHash}`, commitHash: newHash};
        } catch (err: unknown) {
            const error = err as {stderr?: string};
            return {output: `Git revert failed: ${error.stderr || String(err)}`};
        }
    }

    case 'git_restore': {
        try {
            execFileSync('git', ['checkout', '--', '.'], {cwd: ctx.projectRoot, encoding: 'utf-8'});
            return {output: 'Restored working tree to last commit state. All uncommitted edits discarded.'};
        } catch (err: unknown) {
            const error = err as {stderr?: string};
            return {output: `Git restore failed: ${error.stderr || String(err)}`};
        }
    }

    case 'verify_in_browser': {
        const url = String(input.url);
        const label = String(input.label || 'verify').replace(/[^a-zA-Z0-9_-]/g, '_');
        ctx.screenshotCounter++;
        const filename = `${String(ctx.screenshotCounter).padStart(3, '0')}-${label}.png`;
        const screenshotPath = `${ctx.screenshotDir}/${filename}`;

        ctx.browser.open(url.startsWith('http') ? url : `${ctx.baseUrl}${url}`);
        ctx.browser.screenshot(screenshotPath);

        // Capture console errors
        let consoleErrors = '';
        try {
            const raw = ctx.browser.evaluateInternal('JSON.stringify(window.__consoleErrors || [])');
            const errors = JSON.parse(raw);
            if (Array.isArray(errors) && errors.length > 0) {
                consoleErrors = `\nConsole errors: ${errors.slice(-5).join('; ')}`;
            }
        } catch {
            // Not available
        }

        const fixed = input.fixed === true;
        const verdict = fixed ? 'Bug appears resolved.' : 'Bug still reproduces or unconfirmed.';
        return {output: `Screenshot saved: ${screenshotPath}. ${verdict}${consoleErrors}`, screenshotPath, verifiedFixed: fixed};
    }

    default:
        return {output: `Unknown fix tool: ${name}`};
    }
}
