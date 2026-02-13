// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {execFileSync} from 'child_process';
import {existsSync, readFileSync} from 'fs';
import {relative, resolve} from 'path';

interface GapAppliedData {
    patchedFiles?: string[];
    generatedTests?: string[];
    skippedTests?: string[];
}

interface GapPipelineResult {
    generatedDir?: string;
}

interface GapReport {
    applied?: GapAppliedData;
    pipeline?: {
        results?: GapPipelineResult[];
    };
}

export interface FinalizeGeneratedTestsOptions {
    appPath: string;
    testsRoot?: string;
    gapReportPath?: string;
    branch?: string;
    commitMessage?: string;
    createPr?: boolean;
    prTitle?: string;
    prBody?: string;
    baseBranch?: string;
    dryRun?: boolean;
}

export interface FinalizeGeneratedTestsResult {
    repoRoot: string;
    branch: string;
    stagedPaths: string[];
    committed: boolean;
    commitSha?: string;
    prUrl?: string;
}

function runCommand(
    bin: string,
    args: string[],
    cwd: string,
    opts: {allowFailure?: boolean} = {},
): {ok: boolean; stdout: string; stderr: string} {
    try {
        const stdout = execFileSync(bin, args, {cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe']});
        return {ok: true, stdout: stdout.trim(), stderr: ''};
    } catch (error) {
        if (opts.allowFailure) {
            const cause = error as {stdout?: Buffer | string; stderr?: Buffer | string; message?: string};
            const stdout = typeof cause.stdout === 'string' ? cause.stdout : cause.stdout?.toString('utf-8') || '';
            const stderr = typeof cause.stderr === 'string' ? cause.stderr : cause.stderr?.toString('utf-8') || cause.message || '';
            return {ok: false, stdout: stdout.trim(), stderr: stderr.trim()};
        }
        throw error;
    }
}

function normalizeBranchName(branch?: string): string | undefined {
    if (!branch || !branch.trim()) {
        return undefined;
    }
    const trimmed = branch.trim();
    if (trimmed.startsWith('codex/')) {
        return trimmed;
    }
    return `codex/${trimmed.replace(/^\/+/, '')}`;
}

function resolveRepoRoot(appPath: string): string {
    const abs = resolve(appPath);
    const result = runCommand('git', ['-C', abs, 'rev-parse', '--show-toplevel'], abs, {allowFailure: true});
    if (!result.ok || !result.stdout) {
        throw new Error(`Unable to find git repository root from ${abs}: ${result.stderr || 'git rev-parse failed'}`);
    }
    return result.stdout;
}

function readGapReport(path: string): GapReport {
    if (!existsSync(path)) {
        throw new Error(`Gap report not found: ${path}`);
    }
    try {
        return JSON.parse(readFileSync(path, 'utf-8')) as GapReport;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Unable to parse gap report at ${path}: ${message}`);
    }
}

function uniq(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean)));
}

function toRepoRelative(repoRoot: string, absoluteOrRelative: string): string {
    const absolute = resolve(absoluteOrRelative);
    return relative(repoRoot, absolute) || '.';
}

function isRepoRelativePathSafe(path: string): boolean {
    if (!path || path === '.') {
        return false;
    }
    if (path.startsWith('..') || path.includes('/../') || path.includes('\\..\\')) {
        return false;
    }
    return true;
}

function collectStageTargets(repoRoot: string, appPath: string, testsRoot: string, gap: GapReport): string[] {
    const targets: string[] = [];
    const applied = gap.applied || {};

    for (const patched of applied.patchedFiles || []) {
        targets.push(toRepoRelative(repoRoot, resolve(appPath, patched)));
    }
    for (const generated of applied.generatedTests || []) {
        targets.push(toRepoRelative(repoRoot, generated));
    }
    for (const result of gap.pipeline?.results || []) {
        if (result.generatedDir) {
            targets.push(toRepoRelative(repoRoot, result.generatedDir));
        }
    }

    const artifacts = ['gap.json', 'impact.json', 'plan.json', 'ci-summary.md', 'pr-comment.md'];
    for (const file of artifacts) {
        targets.push(toRepoRelative(repoRoot, resolve(testsRoot, '.e2e-ai-agents', file)));
    }

    return uniq(targets).filter((path) => isRepoRelativePathSafe(path) && existsSync(resolve(repoRoot, path)));
}

function ensureBranch(repoRoot: string, requestedBranch?: string, dryRun = false): string {
    const current = runCommand('git', ['branch', '--show-current'], repoRoot, {allowFailure: true});
    const currentBranch = current.stdout || 'HEAD';
    const normalized = normalizeBranchName(requestedBranch);
    if (!normalized) {
        return currentBranch;
    }
    if (currentBranch === normalized) {
        return currentBranch;
    }

    const exists = runCommand('git', ['rev-parse', '--verify', normalized], repoRoot, {allowFailure: true}).ok;
    if (!dryRun) {
        if (exists) {
            runCommand('git', ['checkout', normalized], repoRoot);
        } else {
            runCommand('git', ['checkout', '-b', normalized], repoRoot);
        }
    }
    return normalized;
}

function hasStagedChanges(repoRoot: string): boolean {
    const result = runCommand('git', ['diff', '--cached', '--name-only'], repoRoot, {allowFailure: true});
    if (!result.ok) {
        return false;
    }
    return result.stdout.trim().length > 0;
}

export function finalizeGeneratedTests(options: FinalizeGeneratedTestsOptions): FinalizeGeneratedTestsResult {
    const appPath = resolve(options.appPath);
    const testsRoot = resolve(options.testsRoot || options.appPath);
    const repoRoot = resolveRepoRoot(appPath);
    const gapReportPath = options.gapReportPath || resolve(testsRoot, '.e2e-ai-agents', 'gap.json');
    const gap = readGapReport(gapReportPath);
    const stageTargets = collectStageTargets(repoRoot, appPath, testsRoot, gap);
    const commitMessage = options.commitMessage || 'test(e2e): add generated coverage and healed specs';
    const dryRun = Boolean(options.dryRun);
    const branch = ensureBranch(repoRoot, options.branch, dryRun);

    if (stageTargets.length === 0) {
        return {
            repoRoot,
            branch,
            stagedPaths: [],
            committed: false,
        };
    }

    for (const path of stageTargets) {
        if (!dryRun) {
            runCommand('git', ['add', '--', path], repoRoot, {allowFailure: true});
        }
    }

    let committed = false;
    let commitSha: string | undefined;
    if (!dryRun && hasStagedChanges(repoRoot)) {
        runCommand('git', ['commit', '-m', commitMessage], repoRoot);
        committed = true;
        const head = runCommand('git', ['rev-parse', 'HEAD'], repoRoot, {allowFailure: true});
        if (head.ok) {
            commitSha = head.stdout;
        }
    }

    let prUrl: string | undefined;
    if (!dryRun && options.createPr) {
        const args = ['pr', 'create'];
        if (options.prTitle) {
            args.push('--title', options.prTitle);
        }
        if (options.prBody) {
            args.push('--body', options.prBody);
        }
        if (options.baseBranch) {
            args.push('--base', options.baseBranch);
        }
        if (!options.prTitle && !options.prBody) {
            args.push('--fill');
        }
        const result = runCommand('gh', args, repoRoot, {allowFailure: true});
        if (!result.ok) {
            throw new Error(`Failed to create PR via gh: ${result.stderr || 'unknown error'}`);
        }
        prUrl = result.stdout.split('\n').find((line) => line.startsWith('http')) || result.stdout;
    }

    return {
        repoRoot,
        branch,
        stagedPaths: stageTargets,
        committed,
        commitSha,
        prUrl,
    };
}
