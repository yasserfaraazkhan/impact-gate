// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync} from 'fs';
import {join} from 'path';
import {spawnSync} from 'child_process';
import type {PipelineConfig} from './config.js';
import type {CommandResult} from './pipeline_types.js';

export function resolvePlaywrightBinary(testsRoot: string): string | null {
    const unixPath = join(testsRoot, 'node_modules', '.bin', 'playwright');
    const windowsPath = join(testsRoot, 'node_modules', '.bin', 'playwright.cmd');
    if (existsSync(unixPath)) {
        return unixPath;
    }
    if (existsSync(windowsPath)) {
        return windowsPath;
    }
    return null;
}

export function summarizeCommandOutput(stdout: string, stderr: string): string {
    const combined = [stdout, stderr].filter(Boolean).join('\n').trim();
    if (!combined) {
        return '';
    }
    const lines = combined.split('\n').slice(-20);
    return lines.join('\n').slice(0, 2000);
}

export function runCommand(command: string, args: string[], cwd: string, timeoutMs = 60 * 60 * 1000): CommandResult {
    // When spawning `claude`, unset CLAUDECODE so nested invocations are allowed.
    // Claude Code sets this variable to block nested sessions; child processes
    // that spawn their own claude instance must run without it.
    let env: NodeJS.ProcessEnv | undefined;
    if (command === 'claude') {
        const {CLAUDECODE: _, ...rest} = process.env;
        env = rest;
    }
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf-8',
        timeout: timeoutMs,
        stdio: 'pipe',
        ...(env ? {env} : {}),
    });
    return {
        status: result.status ?? 1,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        error: result.error ? result.error.message : undefined,
    };
}

export function resolveMcpCommandTimeoutMs(pipeline: PipelineConfig): number {
    const value = pipeline.mcpCommandTimeoutMs;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 180000;
    }
    return Math.max(60000, Math.min(15 * 60 * 1000, Math.round(value)));
}

export function resolveMcpRetries(pipeline: PipelineConfig): number {
    const value = pipeline.mcpRetries;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 1;
    }
    return Math.max(0, Math.min(5, Math.round(value)));
}

export function isRetryableMcpFailure(result: CommandResult): boolean {
    const haystack = [result.error || '', result.stderr || '', result.stdout || ''].join('\n').toLowerCase();
    return haystack.includes('etimedout') ||
        haystack.includes('timed out') ||
        haystack.includes('econnreset') ||
        haystack.includes('429') ||
        haystack.includes('rate limit') ||
        haystack.includes('temporar');
}

export function runCommandWithRetries(
    command: string,
    args: string[],
    cwd: string,
    timeoutMs: number,
    retries: number,
): CommandResult {
    let result = runCommand(command, args, cwd, timeoutMs);
    for (let attempt = 1; attempt <= retries; attempt += 1) {
        if (result.status === 0) {
            return result;
        }
        if (!isRetryableMcpFailure(result)) {
            return result;
        }
        result = runCommand(command, args, cwd, timeoutMs);
    }
    return result;
}
