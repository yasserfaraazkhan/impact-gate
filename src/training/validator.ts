// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {execFileSync} from 'child_process';
import {resolve} from 'path';

import {bindFilesToFamilies} from '../knowledge/route_families.js';
import type {RouteFamilyManifest} from '../knowledge/route_families.js';

import type {CommitValidation, ValidationReport} from './types.js';

export function parseGitLog(log: string): Array<{hash: string; message: string; files: string[]}> {
    const commits: Array<{hash: string; message: string; files: string[]}> = [];
    let current: {hash: string; message: string; files: string[]} | null = null;

    for (const line of log.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) {
            if (current) {
                commits.push(current);
                current = null;
            }
            continue;
        }

        if (trimmed.includes('|') && /^[0-9a-f]{7,40}\|/.test(trimmed)) {
            if (current) {
                commits.push(current);
            }
            const [hash, ...rest] = trimmed.split('|');
            current = {hash, message: rest.join('|'), files: []};
        } else if (current) {
            current.files.push(trimmed);
        }
    }
    if (current) {
        commits.push(current);
    }

    return commits;
}

export function getCommitFiles(projectRoot: string, since: string): Array<{hash: string; message: string; files: string[]}> {
    const resolved = resolve(projectRoot);
    let log: string;
    try {
        log = execFileSync('git', ['log', '--name-only', '--pretty=format:%H|%s', `${since}..HEAD`], {
            cwd: resolved,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            maxBuffer: 10 * 1024 * 1024,
        });
    } catch (error) {
        console.warn(`[train] git log failed: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    }

    return parseGitLog(log);
}

export function validateCommit(
    manifest: RouteFamilyManifest,
    files: string[],
    hash: string,
    message: string,
): CommitValidation {
    // Filter out non-source files
    const sourceFiles = files.filter((f) => {
        return !f.endsWith('.md') && !f.endsWith('.json') && !f.endsWith('.yml') && !f.endsWith('.yaml') &&
               !f.startsWith('.') && !f.includes('node_modules/');
    });

    if (sourceFiles.length === 0) {
        return {hash, message, changedFiles: [], boundFiles: 0, unboundFiles: [], familiesHit: []};
    }

    const bindings = bindFilesToFamilies(sourceFiles, manifest);
    const bound = bindings.filter((b) => b.bindings.length > 0);
    const unbound = bindings.filter((b) => b.bindings.length === 0);
    const familiesHit = new Set<string>();
    for (const b of bound) {
        for (const binding of b.bindings) {
            familiesHit.add(binding.family);
        }
    }

    return {
        hash,
        message,
        changedFiles: sourceFiles,
        boundFiles: bound.length,
        unboundFiles: unbound.map((b) => b.file),
        familiesHit: Array.from(familiesHit),
    };
}

export function buildValidationReport(
    commits: CommitValidation[],
    manifest: RouteFamilyManifest,
): ValidationReport {
    let totalFiles = 0;
    let boundFiles = 0;
    let unboundFiles = 0;
    const familyHits: Record<string, number> = {};
    const unboundCounts: Record<string, number> = {};

    for (const commit of commits) {
        totalFiles += commit.changedFiles.length;
        boundFiles += commit.boundFiles;
        unboundFiles += commit.unboundFiles.length;
        for (const fam of commit.familiesHit) {
            familyHits[fam] = (familyHits[fam] || 0) + 1;
        }
        for (const uf of commit.unboundFiles) {
            unboundCounts[uf] = (unboundCounts[uf] || 0) + 1;
        }
    }

    const allFamilyIds = manifest.families.map((f) => f.id);
    const hitFamilyIds = new Set(Object.keys(familyHits));
    const neverHitFamilies = allFamilyIds.filter((id) => !hitFamilyIds.has(id));

    // Cluster unbound files by directory
    const dirCounts: Record<string, number> = {};
    for (const [file, count] of Object.entries(unboundCounts)) {
        const dir = file.split('/').slice(0, -1).join('/');
        dirCounts[dir] = (dirCounts[dir] || 0) + count;
    }

    const unboundFileClusters = Object.entries(dirCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 20)
        .map(([pattern, count]) => ({
            pattern: `${pattern}/*`,
            count,
            suggestedFamily: pattern.split('/').pop() || 'unknown',
        }));

    return {
        totalCommits: commits.length,
        totalFiles,
        boundFiles,
        unboundFiles,
        coveragePercent: totalFiles > 0 ? Math.round((boundFiles / totalFiles) * 100) : 100,
        commits,
        familyHits,
        neverHitFamilies,
        unboundFileClusters,
    };
}

export function formatValidationReport(report: ValidationReport): string {
    const lines: string[] = [];
    lines.push(`Validated against ${report.totalCommits} commits`);
    lines.push('');
    lines.push(`Coverage: ${report.coveragePercent}% of files bound (${report.boundFiles}/${report.totalFiles})`);
    lines.push('');

    // Family hit distribution
    const sorted = Object.entries(report.familyHits).sort(([, a], [, b]) => b - a);
    if (sorted.length > 0) {
        lines.push('Family hit distribution:');
        const maxHits = sorted[0][1];
        for (const [family, hits] of sorted) {
            const bar = '\u2588'.repeat(Math.max(1, Math.round((hits / maxHits) * 12)));
            lines.push(`  ${family.padEnd(20)} ${bar} ${hits} commits`);
        }
        if (report.neverHitFamilies.length > 0) {
            lines.push(`  (never hit)${' '.repeat(8)}${report.neverHitFamilies.join(', ')}`);
        }
        lines.push('');
    }

    // Unbound file clusters
    if (report.unboundFileClusters.length > 0) {
        lines.push(`Unbound files (${report.unboundFiles} files across ${report.totalCommits} commits):`);
        for (const cluster of report.unboundFileClusters.slice(0, 10)) {
            lines.push(`  ${cluster.pattern.padEnd(50)} — ${cluster.count} commits (suggest: ${cluster.suggestedFamily})`);
        }
        lines.push('');
    }

    return lines.join('\n');
}
