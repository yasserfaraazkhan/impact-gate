// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * MCP Server for E2E Agents
 * Exposes tools for Claude and Playwright agents to discover, generate, and heal tests
 */

import {spawnSync} from 'child_process';
import {readFileSync, writeFileSync, existsSync} from 'fs';
import {join} from 'path';
import {globSync} from 'glob';

interface Tool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

/**
 * MCP Server for autonomous test discovery, generation, and healing
 * Provides tools for Claude to interact with test framework
 */
export class E2EAgentsMCPServer {
    private repoRoot: string;
    private tools: Tool[];

    constructor(repoRoot: string = process.cwd()) {
        this.repoRoot = repoRoot;
        this.tools = this.defineTools();
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
                            description:
                                'What to include (package.json, tsconfig, playwright.config, tests)',
                        },
                    },
                },
            },
        ];
    }

    /**
     * Handle tool calls from Claude/Playwright agents
     */
    async callTool(name: string, args: Record<string, unknown>): Promise<string> {
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
                throw new Error(`Unknown tool: ${name}`);
        }
    }

    private discoverTests(args: {since?: string; pattern?: string}): string {
        try {
            const since = args.since || 'HEAD~5';
            const pattern = args.pattern || '**/*.spec.ts';

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
            return JSON.stringify({error: String(error)});
        }
    }

    private readFile(args: {path: string}): string {
        try {
            const filePath = join(this.repoRoot, args.path);
            if (!existsSync(filePath)) {
                return JSON.stringify({error: `File not found: ${args.path}`});
            }
            const content = readFileSync(filePath, 'utf-8');
            return JSON.stringify({path: args.path, content});
        } catch (error) {
            return JSON.stringify({error: String(error)});
        }
    }

    private writeFile(args: {path: string; content: string}): string {
        try {
            const filePath = join(this.repoRoot, args.path);
            writeFileSync(filePath, args.content, 'utf-8');
            return JSON.stringify({success: true, path: args.path});
        } catch (error) {
            return JSON.stringify({error: String(error)});
        }
    }

    private runTests(args: {pattern?: string; browsers?: string[]}): string {
        try {
            const pattern = args.pattern || '**/*.spec.ts';
            const browsers = args.browsers?.join(',') || 'chromium';

            const result = spawnSync('npx', ['playwright', 'test', pattern, `--project=${browsers}`], {
                cwd: this.repoRoot,
                encoding: 'utf-8',
            });

            if (result.error) {
                return JSON.stringify({success: false, error: String(result.error)});
            }

            return JSON.stringify({
                success: result.status === 0,
                stdout: result.stdout,
                stderr: result.stderr,
            });
        } catch (error) {
            return JSON.stringify({
                success: false,
                error: String(error),
                hint: 'Make sure Playwright is installed',
            });
        }
    }

    private getGitChanges(args: {since?: string}): string {
        try {
            const since = args.since || 'HEAD~5';
            const result = spawnSync('git', ['diff', '--name-only', `${since}..HEAD`], {
                cwd: this.repoRoot,
                encoding: 'utf-8',
            });

            if (result.error) {
                return JSON.stringify({error: String(result.error)});
            }

            const changedFiles = result.stdout.trim().split('\n').filter((f) => f);
            return JSON.stringify({changedFiles});
        } catch (error) {
            return JSON.stringify({error: String(error), hint: 'Make sure you are in a git repository'});
        }
    }

    private getRepositoryContext(args: {include?: string[]}): string {
        try {
            const include = args.include || ['package.json', 'playwright.config'];
            const context: Record<string, unknown> = {};

            for (const file of include) {
                const filePath = join(this.repoRoot, file);
                if (existsSync(filePath)) {
                    context[file] = readFileSync(filePath, 'utf-8');
                }
            }

            // Add test structure
            const testFiles = globSync('**/*.spec.ts', {cwd: this.repoRoot, ignore: 'node_modules/**'});
            context.testFiles = testFiles;

            return JSON.stringify(context);
        } catch (error) {
            return JSON.stringify({error: String(error)});
        }
    }

    private getChangedFiles(since: string): string[] {
        try {
            const result = spawnSync('git', ['diff', '--name-only', `${since}..HEAD`], {
                cwd: this.repoRoot,
                encoding: 'utf-8',
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
 * Start MCP server
 * Usage: node dist/mcp-server.js
 */
if (require.main === module) {
    const server = new E2EAgentsMCPServer();
    console.log('E2E Agents MCP Server started');
    console.log('Tools:', server.getTools().map((t) => t.name).join(', '));
}

export default E2EAgentsMCPServer;
