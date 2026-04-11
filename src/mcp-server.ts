#!/usr/bin/env node
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * MCP Server for Impact Gate - SECURITY HARDENED
 * Exposes tools for Claude and Playwright agents to discover, generate, and heal tests
 */

import {spawnSync} from 'child_process';
import {readFileSync, writeFileSync, existsSync, realpathSync} from 'fs';
import {join, resolve, dirname} from 'path';
import {fileURLToPath} from 'url';
import {globSync} from 'glob';

interface Tool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

/**
 * SECURITY: Path validation helper
 * Prevents directory traversal attacks
 */
function validatePathIsWithinRoot(filePath: string, rootPath: string): boolean {
    try {
        const normalized = resolve(filePath);
        const normalizedRoot = resolve(rootPath);
        return normalized.startsWith(normalizedRoot + '/') || normalized === normalizedRoot;
    } catch {
        return false;
    }
}

/**
 * SECURITY: Input validation for shell arguments
 * Prevents command injection attacks
 */
function validatePlaywrightPattern(pattern: string): boolean {
    // Allow alphanumeric, dots, dashes, slashes, asterisks, underscores only
    return /^[a-zA-Z0-9_\-.*\/]+$/.test(pattern) && !pattern.includes('..') && pattern.length < 512;
}

/**
 * SECURITY: Validate git refs to prevent argument injection
 */
function validateGitRef(ref: string): boolean {
    // Allow standard git ref patterns: branches, tags, commit hashes
    // Blocks patterns that start with -- (options) or contain spaces
    return (
        /^[a-zA-Z0-9_\-./~^]+$/.test(ref) &&
        !ref.startsWith('--') &&
        ref.length < 256 &&
        !ref.includes('\n') &&
        !ref.includes('\0')
    );
}

/**
 * SECURITY: Validate browser names against allowlist
 */
function validateBrowsers(browsers: string[]): boolean {
    const allowedBrowsers = new Set(['chromium', 'firefox', 'webkit']);
    return browsers.length > 0 && browsers.length <= 3 && browsers.every((b) => allowedBrowsers.has(b));
}

/**
 * SECURITY: Glob pattern validation
 * Restricts to test-related patterns to prevent enumeration of sensitive files
 */
function validateGlobPattern(pattern: string): boolean {
    // Block attempts to enumerate sensitive patterns
    const blockedPatterns = [/\*\*\/\*\*/, /\.env/, /\.pem/, /\.key/, /aws|credentials|secret|password/i];

    if (pattern.length > 256) return false;
    if (blockedPatterns.some((p) => p.test(pattern))) return false;
    if (pattern.includes('..')) return false;
    return /^[a-zA-Z0-9_\-.*\/]+$/.test(pattern);
}

/**
 * SECURITY: Sanitize error messages to prevent information leakage
 */
function sanitizeError(error: unknown, operation: string): string {
    if (error instanceof Error) {
        // Only return safe error message, hide internal details
        if (error.message.includes('ENOENT')) {
            return `File not found (${operation})`;
        }
        if (error.message.includes('EACCES')) {
            return `Permission denied (${operation})`;
        }
        if (error.message.includes('EISDIR')) {
            return `Is a directory (${operation})`;
        }
        return `Operation failed: ${operation}`;
    }
    return 'An unexpected error occurred';
}

/**
 * SECURITY: Rate limiter helper
 */
class RateLimiter {
    private requests: number[] = [];
    private maxRequests: number;
    private windowMs: number;

    constructor(maxRequests: number = 100, windowMs: number = 60000) {
        this.maxRequests = maxRequests;
        this.windowMs = windowMs;
    }

    isAllowed(): boolean {
        const now = Date.now();
        this.requests = this.requests.filter((time) => now - time < this.windowMs);

        if (this.requests.length >= this.maxRequests) {
            return false;
        }

        this.requests.push(now);
        return true;
    }
}

/**
 * MCP Server for autonomous test discovery, generation, and healing
 * Provides tools for Claude to interact with test framework
 */
export class E2EAgentsMCPServer {
    private repoRoot: string;
    private tools: Tool[];
    private rateLimiter: RateLimiter;

    constructor(repoRoot: string = process.cwd()) {
        this.repoRoot = repoRoot;
        this.tools = this.defineTools();
        this.rateLimiter = new RateLimiter(100, 60000); // 100 requests per minute
    }

    private defineTools(): Tool[] {
        return [
            {
                name: 'discover_tests',
                description: 'Discover tests that need to be written based on code changes',
                inputSchema: {
                    type: 'object',
                    properties: {
                        since: {
                            type: 'string',
                            description: 'Git ref to compare against (e.g., HEAD~5, main)',
                        },
                        pattern: {
                            type: 'string',
                            description: "Test file pattern to search (e.g., '**/*.spec.ts')",
                        },
                    },
                },
            },
            {
                name: 'read_file',
                description: 'Read a file from the repository',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: {
                            type: 'string',
                            description: 'File path relative to repo root',
                        },
                    },
                    required: ['path'],
                },
            },
            {
                name: 'write_file',
                description: 'Write or create a file in the repository',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: {
                            type: 'string',
                            description: 'File path relative to repo root',
                        },
                        content: {
                            type: 'string',
                            description: 'File content to write',
                        },
                    },
                    required: ['path', 'content'],
                },
            },
            {
                name: 'run_tests',
                description: 'Run Playwright tests matching a pattern',
                inputSchema: {
                    type: 'object',
                    properties: {
                        pattern: {
                            type: 'string',
                            description: "Test file pattern (e.g., 'tests/**/*.spec.ts')",
                        },
                        browsers: {
                            type: 'array',
                            items: {type: 'string'},
                            description: 'Browsers to test (chromium, firefox, webkit)',
                        },
                    },
                },
            },
            {
                name: 'get_git_changes',
                description: 'Get files changed since a git reference',
                inputSchema: {
                    type: 'object',
                    properties: {
                        since: {
                            type: 'string',
                            description: 'Git ref to compare against (e.g., HEAD~5, main)',
                        },
                    },
                },
            },
            {
                name: 'get_repository_context',
                description: 'Get repository structure and project metadata',
                inputSchema: {
                    type: 'object',
                    properties: {
                        include: {
                            type: 'array',
                            items: {type: 'string'},
                            description: 'What to include (package.json, tsconfig, playwright.config, tests)',
                        },
                    },
                },
            },
        ];
    }

    /**
     * Handle tool calls from Claude/Playwright agents
     * SECURITY: Rate limiting enforced
     */
    async callTool(name: string, args: Record<string, unknown>): Promise<string> {
        // SECURITY: Rate limiting
        if (!this.rateLimiter.isAllowed()) {
            return JSON.stringify({error: 'Rate limit exceeded. Too many requests.'});
        }

        switch (name) {
            case 'discover_tests':
                return this.discoverTests(args as {since?: string; pattern?: string});
            case 'read_file':
                return this.readFile(args as {path: string});
            case 'write_file':
                return this.writeFile(args as {path: string; content: string});
            case 'run_tests':
                return this.runTests(args as {pattern?: string; browsers?: string[]});
            case 'get_git_changes':
                return this.getGitChanges(args as {since?: string});
            case 'get_repository_context':
                return this.getRepositoryContext(args as {include?: string[]});
            default:
                return JSON.stringify({error: 'Unknown tool'});
        }
    }

    private discoverTests(args: {since?: string; pattern?: string}): string {
        try {
            const since = args.since || 'HEAD~5';
            const pattern = args.pattern || '**/*.spec.ts';

            // SECURITY: Validate inputs
            if (!validateGitRef(since)) {
                return JSON.stringify({error: 'Invalid git reference format'});
            }
            if (!validateGlobPattern(pattern)) {
                return JSON.stringify({error: 'Invalid pattern format'});
            }

            // Get changed files
            const changedFiles = this.getChangedFiles(since);

            // Find test files that might need updating
            const testFiles = globSync(pattern, {cwd: this.repoRoot});

            return JSON.stringify({
                changedFiles,
                existingTests: testFiles,
                recommendedTests: this.analyzeChangesForTests(changedFiles, testFiles),
            });
        } catch (error) {
            return JSON.stringify({error: sanitizeError(error, 'discover_tests')});
        }
    }

    private readFile(args: {path: string}): string {
        try {
            // SECURITY: Path traversal prevention
            const filePath = resolve(this.repoRoot, args.path);
            if (!validatePathIsWithinRoot(filePath, this.repoRoot)) {
                return JSON.stringify({error: 'Access denied'});
            }

            if (!existsSync(filePath)) {
                return JSON.stringify({error: 'File not found'});
            }

            const content = readFileSync(filePath, 'utf-8');
            return JSON.stringify({path: args.path, content});
        } catch (error) {
            return JSON.stringify({error: sanitizeError(error, 'read_file')});
        }
    }

    private writeFile(args: {path: string; content: string}): string {
        try {
            // SECURITY: Path traversal prevention
            const filePath = resolve(this.repoRoot, args.path);
            if (!validatePathIsWithinRoot(filePath, this.repoRoot)) {
                return JSON.stringify({error: 'Access denied'});
            }

            // SECURITY: Symlink resolution — resolve the real path to prevent symlink escape.
            // Only check if the parent directory exists (file itself may not exist yet).
            const parentDir = resolve(filePath, '..');
            if (existsSync(parentDir)) {
                const realParent = realpathSync(parentDir);
                if (!validatePathIsWithinRoot(realParent, this.repoRoot)) {
                    return JSON.stringify({error: 'Access denied'});
                }
            }

            // SECURITY: Restrict writes to test-related paths only.
            // Allowed: specs/, .e2e-ai-agents/, and files matching *.spec.ts / *.test.ts
            const relPath = args.path.replace(/\\/g, '/');
            const isTestSpec = /\.(spec|test)\.(ts|js|tsx|jsx)$/.test(relPath);
            const isAllowedDir = relPath.startsWith('specs/') || relPath.startsWith('.e2e-ai-agents/');
            if (!isTestSpec && !isAllowedDir) {
                return JSON.stringify({error: 'Access denied: writes restricted to test specs and .e2e-ai-agents/'});
            }

            // SECURITY: Size limit to prevent resource exhaustion
            if (args.content.length > 10 * 1024 * 1024) {
                // 10MB limit
                return JSON.stringify({error: 'File too large'});
            }

            writeFileSync(filePath, args.content, 'utf-8');
            return JSON.stringify({success: true, path: args.path});
        } catch (error) {
            return JSON.stringify({error: sanitizeError(error, 'write_file')});
        }
    }

    private runTests(args: {pattern?: string; browsers?: string[]}): string {
        try {
            const pattern = args.pattern || '**/*.spec.ts';
            const browsers = args.browsers || ['chromium'];

            // SECURITY: Validate inputs
            if (!validatePlaywrightPattern(pattern)) {
                return JSON.stringify({error: 'Invalid test pattern'});
            }
            if (!validateBrowsers(browsers as string[])) {
                return JSON.stringify({error: 'Invalid browser specification'});
            }
            const projectArgs = (browsers as string[]).flatMap((browser) => ['--project', browser]);

            // SECURITY: Use -- to separate playwright options from test args
            const result = spawnSync(
                'npx',
                [
                    'playwright',
                    'test',
                    ...projectArgs,
                    '--',
                    pattern,
                ],
                {
                    cwd: this.repoRoot,
                    encoding: 'utf-8',
                    timeout: 300000, // 5 minute timeout
                    maxBuffer: 1024 * 1024, // 1MB output limit
                }
            );

            if (result.error) {
                return JSON.stringify({
                    success: false,
                    error: 'Test execution failed',
                });
            }

            // SECURITY: Don't leak full stdout/stderr, summarize instead
            const stdout = result.stdout ? result.stdout.substring(0, 5000) : '';
            const stderr = result.stderr ? result.stderr.substring(0, 5000) : '';

            return JSON.stringify({
                success: result.status === 0,
                summary: `Exit code: ${result.status}`,
                testsPassed: stdout.includes('passed'),
                testsFailed: stdout.includes('failed'),
            });
        } catch (error) {
            return JSON.stringify({
                success: false,
                error: 'Test execution error',
            });
        }
    }

    private getGitChanges(args: {since?: string}): string {
        try {
            const since = args.since || 'HEAD~5';

            // SECURITY: Validate git ref
            if (!validateGitRef(since)) {
                return JSON.stringify({error: 'Invalid git reference format'});
            }

            const result = spawnSync('git', ['diff', '--name-only', `${since}..HEAD`], {
                cwd: this.repoRoot,
                encoding: 'utf-8',
                timeout: 30000,
            });

            if (result.error) {
                return JSON.stringify({error: 'Git operation failed'});
            }

            const changedFiles = result.stdout.trim().split('\n').filter((f) => f);
            return JSON.stringify({changedFiles});
        } catch (error) {
            return JSON.stringify({error: 'Git operation error'});
        }
    }

    private getRepositoryContext(args: {include?: string[]}): string {
        try {
            const defaultInclude = ['package.json', 'tsconfig.json', 'playwright.config.ts', 'playwright.config.js'];
            const include = args.include || defaultInclude;

            // SECURITY: Limit to allowed filenames
            const allowedFiles = new Set([
                'package.json',
                'tsconfig.json',
                'tsconfig.base.json',
                'playwright.config.ts',
                'playwright.config.js',
                'jest.config.js',
                '.npmrc',
                'README.md',
            ]);

            const context: Record<string, unknown> = {};

            for (const file of include) {
                // SECURITY: Validate each path
                if (!allowedFiles.has(file)) {
                    continue; // Skip non-allowed files
                }

                const filePath = resolve(this.repoRoot, file);
                if (!validatePathIsWithinRoot(filePath, this.repoRoot)) {
                    continue;
                }

                if (existsSync(filePath)) {
                    try {
                        context[file] = readFileSync(filePath, 'utf-8');
                    } catch {
                        // Ignore read errors for individual files
                    }
                }
            }

            // Add test structure with safe globbing
            const testFiles = globSync('**/*.spec.ts', {
                cwd: this.repoRoot,
                ignore: 'node_modules/**',
                maxDepth: 5,
            });
            context.testFiles = testFiles.slice(0, 100); // Limit to 100 files

            return JSON.stringify(context);
        } catch (error) {
            return JSON.stringify({error: sanitizeError(error, 'get_repository_context')});
        }
    }

    private getChangedFiles(since: string): string[] {
        try {
            // SECURITY: Validate git ref before use
            if (!validateGitRef(since)) {
                return [];
            }

            const result = spawnSync('git', ['diff', '--name-only', `${since}..HEAD`], {
                cwd: this.repoRoot,
                encoding: 'utf-8',
                timeout: 30000,
            });

            if (result.error) {
                return [];
            }

            return result.stdout.trim().split('\n').filter((f) => f);
        } catch {
            return [];
        }
    }

    private analyzeChangesForTests(changedFiles: string[], existingTests: string[]): string[] {
        // Simple heuristic: if a source file changed, suggest a test for it
        return changedFiles
            .filter((f) => !f.endsWith('.spec.ts') && !f.endsWith('.test.ts'))
            .slice(0, 10) // Limit results
            .map((f) => {
                const testFile = f.replace(/\.(ts|js)$/, '.spec.ts');
                return testFile;
            });
    }

    /**
     * Get all available tools
     */
    getTools(): Tool[] {
        return this.tools;
    }
}

/**
 * Read the package version at runtime so the MCP initialize response
 * always reflects the installed version.
 */
function getPackageVersion(): string {
    try {
        const pkgPath = join(dirname(__dirname), 'package.json');
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {version?: string};
        return pkg.version || '0.0.0';
    } catch {
        return '0.0.0';
    }
}

/**
 * Encode a JSON-RPC message with Content-Length framing.
 * Exported for testability.
 */
export function encodeJsonRpcMessage(message: Record<string, unknown>): string {
    const body = JSON.stringify(message);
    return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

/**
 * Parse Content-Length framed JSON-RPC messages from a buffer.
 * Returns parsed messages and the remaining (unconsumed) buffer.
 * Exported for testability.
 */
export function parseJsonRpcFrames(input: Buffer): {messages: Array<{id?: unknown; method?: string; params?: Record<string, unknown>}>; remainder: Buffer<ArrayBuffer>} {
    const messages: Array<{id?: unknown; method?: string; params?: Record<string, unknown>}> = [];
    let buffer: Buffer<ArrayBuffer> = Buffer.from(input);

    while (true) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;

        const headerText = buffer.slice(0, headerEnd).toString('utf8');
        const match = headerText.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
            // Skip past this malformed header and try to find the next valid frame
            buffer = buffer.slice(headerEnd + 4);
            continue;
        }

        const contentLength = Number(match[1]);
        const messageEnd = headerEnd + 4 + contentLength;
        if (buffer.length < messageEnd) break;

        const body = buffer.slice(headerEnd + 4, messageEnd).toString('utf8');
        buffer = buffer.slice(messageEnd);

        try {
            messages.push(JSON.parse(body) as {id?: unknown; method?: string; params?: Record<string, unknown>});
        } catch {
            // Skip malformed JSON frames rather than crashing the parsing loop
            continue;
        }
    }

    return {messages, remainder: buffer};
}

/**
 * Handle a single JSON-RPC message against the server.
 * Returns the response message (or null for notifications).
 * Exported for testability.
 */
export async function handleJsonRpcMessage(
    server: E2EAgentsMCPServer,
    message: {id?: unknown; method?: string; params?: Record<string, unknown>},
): Promise<Record<string, unknown> | null> {
    const {id, method, params} = message;
    const version = getPackageVersion();

    if (method === 'initialize') {
        return {
            jsonrpc: '2.0',
            id,
            result: {
                protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05',
                capabilities: {tools: {}, resources: {}, prompts: {}},
                serverInfo: {name: 'impact-gate-mcp', version},
            },
        };
    }

    if (method === 'notifications/initialized' || method === 'initialized') {
        return null;
    }

    if (method === 'tools/list') {
        return {
            jsonrpc: '2.0',
            id,
            result: {
                tools: server.getTools().map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                })),
            },
        };
    }

    if (method === 'tools/call') {
        const resultText = await server.callTool(
            typeof params?.name === 'string' ? params.name : '',
            typeof params?.arguments === 'object' && params.arguments !== null ? params.arguments as Record<string, unknown> : {},
        );
        let isError = false;
        try {
            const parsed = JSON.parse(resultText) as {error?: unknown};
            isError = Boolean(parsed.error);
        } catch {
            isError = false;
        }

        return {
            jsonrpc: '2.0',
            id,
            result: {content: [{type: 'text', text: resultText}], isError},
        };
    }

    if (method === 'resources/list') {
        return {jsonrpc: '2.0', id, result: {resources: []}};
    }

    if (method === 'prompts/list') {
        return {jsonrpc: '2.0', id, result: {prompts: []}};
    }

    if (method === 'ping') {
        return {jsonrpc: '2.0', id, result: {}};
    }

    return {jsonrpc: '2.0', id, error: {code: -32601, message: `Method not found: ${method}`}};
}

/**
 * Start MCP server over stdio using Content-Length framed JSON-RPC messages.
 */
const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB

export function startStdioServer(repoRoot: string = process.cwd()): void {
    const server = new E2EAgentsMCPServer(repoRoot);
    let buffer = Buffer.alloc(0);

    const sendMessage = (message: Record<string, unknown>): void => {
        process.stdout.write(encodeJsonRpcMessage(message));
    };

    const sendError = (id: unknown, code: number, msg: string): void => {
        sendMessage({jsonrpc: '2.0', id, error: {code, message: msg}});
    };

    const processBuffer = (): void => {
        try {
            const {messages, remainder} = parseJsonRpcFrames(buffer);
            buffer = remainder;

            for (const parsed of messages) {
                void handleJsonRpcMessage(server, parsed)
                    .then((response) => {
                        if (response) sendMessage(response);
                    })
                    .catch((error) => {
                        sendError(parsed.id ?? null, -32603, error instanceof Error ? error.message : String(error));
                    });
            }
        } catch {
            sendError(null, -32700, 'Parse error');
            buffer = Buffer.alloc(0);
        }
    };

    process.stdin.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > MAX_BUFFER_SIZE) {
            sendError(null, -32600, 'Request too large');
            buffer = Buffer.alloc(0);
            return;
        }
        processBuffer();
    });

    process.stdin.on('end', () => {
        process.exit(0);
    });
}

if (require.main === module) {
    startStdioServer();
}

export default E2EAgentsMCPServer;
