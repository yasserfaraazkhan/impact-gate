// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, mkdirSync, writeFileSync} from 'fs';
import {dirname, join, resolve} from 'path';
import * as readline from 'readline';

import {resolveConfig} from '../../agent/config.js';
import {loadRouteFamilyManifest} from '../../knowledge/route_families.js';
import type {RouteFamilyManifest} from '../../knowledge/route_families.js';
import {LLMProviderFactory} from '../../provider_factory.js';

import type {ParsedArgs} from '../types.js';

import {scanProject} from '../../training/scanner.js';
import {mergeFamilies, detectStaleFamilies} from '../../training/merger.js';
import {enrichFamilies} from '../../training/enricher.js';
import {getCommitFiles, validateCommit, buildValidationReport, formatValidationReport} from '../../training/validator.js';
import type {TrainOptions} from '../../training/types.js';

function resolveTrainOptions(args: ParsedArgs, autoConfig?: string): TrainOptions {
    const appPath = args.path || '.';
    let testsRoot = args.testsRoot || appPath;

    // Try to resolve testsRoot from config
    if (autoConfig) {
        try {
            const {config} = resolveConfig(process.cwd(), autoConfig, {
                path: appPath,
                testsRoot: args.testsRoot,
            });
            testsRoot = config.testsRoot || config.path || appPath;
        } catch {
            // use defaults
        }
    }

    const outputPath = args.trainOutput ||
        join(testsRoot, '.e2e-ai-agents', 'route-families.json');

    return {
        appPath: resolve(appPath),
        testsRoot: resolve(testsRoot),
        enrich: args.trainEnrich !== false,
        validate: args.trainValidate || false,
        since: args.gitSince || 'HEAD~20',
        pr: args.trainPr,
        outputPath: resolve(outputPath),
        dryRun: args.dryRun || false,
        yes: args.trainYes || false,
        budgetUSD: args.budgetUSD || 0.50,
    };
}

function ask(rl: readline.Interface, question: string, defaultValue?: string): Promise<string> {
    const suffix = defaultValue ? ` (${defaultValue})` : '';
    return new Promise((res) => {
        rl.question(`${question}${suffix}: `, (answer) => {
            res(answer.trim() || defaultValue || '');
        });
    });
}

function serializeManifest(manifest: RouteFamilyManifest): string {
    const output = {
        families: manifest.families.map((f) => {
            const entry: Record<string, unknown> = {id: f.id, routes: f.routes};
            if (f.priority) entry.priority = f.priority;
            if (f.pageObjects && f.pageObjects.length > 0) entry.pageObjects = f.pageObjects;
            if (f.components && f.components.length > 0) entry.components = f.components;
            if (f.webappPaths && f.webappPaths.length > 0) entry.webappPaths = f.webappPaths;
            if (f.serverPaths && f.serverPaths.length > 0) entry.serverPaths = f.serverPaths;
            if (f.specDirs && f.specDirs.length > 0) entry.specDirs = f.specDirs;
            if (f.cypressSpecDirs && f.cypressSpecDirs.length > 0) entry.cypressSpecDirs = f.cypressSpecDirs;
            if (f.tags && f.tags.length > 0) entry.tags = f.tags;
            if (f.userFlows && f.userFlows.length > 0) entry.userFlows = f.userFlows;
            if (f.features && f.features.length > 0) entry.features = f.features;
            return entry;
        }),
    };
    return JSON.stringify(output, null, 2) + '\n';
}

export async function runTrainCommand(args: ParsedArgs, autoConfig?: string): Promise<void> {
    const opts = resolveTrainOptions(args, autoConfig);

    console.log('');
    console.log('  e2e-ai-agents train');
    console.log('  ===================');
    console.log('');

    // ---------- Phase 1: Deterministic scan ----------
    console.log('  Scanning project structure...');
    const scanResult = scanProject(opts.appPath);
    console.log(`  Found ${scanResult.stats.totalSourceFiles} source files, ${scanResult.stats.totalTestFiles} test files`);
    console.log(`  Discovered ${scanResult.families.length} candidate families`);

    if (scanResult.families.length === 0) {
        console.log('');
        console.log('  No families discovered. Make sure your project has recognizable');
        console.log('  source directories (src/, server/, app/) and test directories');
        console.log('  (tests/, e2e/, specs/) with matching names.');
        return;
    }

    // ---------- Phase 2: Merge with existing ----------
    const existing = loadRouteFamilyManifest(opts.testsRoot);
    if (existing) {
        console.log(`  Found existing manifest with ${existing.families.length} families`);
    }

    let mergeResult = mergeFamilies(existing, scanResult.families);
    console.log(`  Merge: ${mergeResult.summary}`);

    // ---------- Phase 3: Stale detection ----------
    if (mergeResult.manifest.families.length > 0) {
        const stale = detectStaleFamilies(mergeResult.manifest, opts.appPath);
        if (stale.length > 0) {
            console.log('');
            console.log(`  Stale families detected (${stale.length}):`);
            for (const id of stale) {
                console.log(`    ${id} — paths no longer exist`);
            }

            if (!opts.yes && !opts.dryRun) {
                const rl = readline.createInterface({input: process.stdin, output: process.stdout});
                try {
                    const answer = await ask(rl, '  Remove stale families? [y/N]', 'N');
                    if (answer.toLowerCase() === 'y') {
                        const staleSet = new Set(stale);
                        mergeResult.manifest.families = mergeResult.manifest.families.filter(
                            (f) => !staleSet.has(f.id),
                        );
                        mergeResult.staleFamilies = stale;
                        console.log(`  Removed ${stale.length} stale families`);
                    }
                } finally {
                    rl.close();
                }
            }
        }
    }

    // ---------- Phase 4: LLM Enrichment ----------
    if (opts.enrich) {
        console.log('');
        console.log('  Enriching with LLM...');
        try {
            const provider = await LLMProviderFactory.createFromEnv();
            const enrichResult = await enrichFamilies(
                mergeResult.manifest.families,
                scanResult.families,
                opts.appPath,
                provider,
                opts.budgetUSD,
            );
            mergeResult.manifest.families = enrichResult.enrichedFamilies;
            console.log(`  Enriched ${enrichResult.enrichedFamilies.length} families (${enrichResult.tokensUsed} tokens, ~$${enrichResult.costUSD})`);
            if (enrichResult.skippedFamilies.length > 0) {
                console.log(`  Skipped ${enrichResult.skippedFamilies.length} families (budget limit)`);
            }
        } catch (error) {
            console.warn(`  LLM enrichment failed: ${error instanceof Error ? error.message : String(error)}`);
            console.warn('  Continuing with deterministic results. Use --no-enrich to skip LLM.');
        }
    }

    // ---------- Phase 5: Write manifest ----------
    console.log('');
    const json = serializeManifest(mergeResult.manifest);

    if (opts.dryRun) {
        console.log('  Dry run — proposed manifest:');
        console.log('');
        console.log(json);
    } else {
        const dir = dirname(opts.outputPath);
        if (!existsSync(dir)) {
            mkdirSync(dir, {recursive: true});
        }
        writeFileSync(opts.outputPath, json, 'utf-8');
        console.log(`  Wrote ${opts.outputPath}`);
        console.log(`  ${mergeResult.manifest.families.length} families`);
    }

    // ---------- Phase 6: Report unmatched ----------
    if (scanResult.unmatchedSourceDirs.length > 0 || scanResult.unmatchedTestDirs.length > 0) {
        console.log('');
        console.log('  Unmatched (review manually):');
        for (const dir of scanResult.unmatchedSourceDirs.slice(0, 10)) {
            console.log(`    source: ${dir.relativePath}`);
        }
        for (const dir of scanResult.unmatchedTestDirs.slice(0, 10)) {
            console.log(`    test:   ${dir.relativePath}`);
        }
        if (scanResult.unmatchedSourceDirs.length + scanResult.unmatchedTestDirs.length > 20) {
            console.log('    ... and more');
        }
    }

    // ---------- Phase 7: Validation (optional) ----------
    if (opts.validate) {
        // Mutual exclusivity check
        if (opts.pr && opts.since !== 'HEAD~20') {
            console.error('  Error: --pr and --since are mutually exclusive.');
            process.exit(1);
        }

        if (opts.pr) {
            console.log('');
            console.log(`  Validating against PR #${opts.pr}...`);

            // Check for gh CLI
            const {execFileSync} = await import('child_process');
            try {
                execFileSync('gh', ['--version'], {stdio: 'pipe'});
            } catch {
                console.error('');
                console.error('  Error: --pr requires the GitHub CLI (gh).');
                console.error('  Install: https://cli.github.com/');
                process.exit(1);
            }

            // Fetch PR changed files via gh CLI
            let prFiles: string[];
            try {
                const output = execFileSync('gh', ['pr', 'view', String(opts.pr), '--json', 'files', '-q', '.files[].path'], {
                    cwd: opts.appPath,
                    encoding: 'utf-8',
                    stdio: ['pipe', 'pipe', 'pipe'],
                });
                prFiles = output.trim().split('\n').filter(Boolean);
            } catch (error) {
                console.error(`  Error fetching PR #${opts.pr}: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }

            if (prFiles.length === 0) {
                console.log('  No files found in PR.');
            } else {
                const validation = validateCommit(mergeResult.manifest, prFiles, `PR#${opts.pr}`, `PR #${opts.pr}`);
                const report = buildValidationReport([validation], mergeResult.manifest);
                console.log('');
                console.log(formatValidationReport(report));
            }
        } else {
            console.log('');
            console.log(`  Validating against git history (${opts.since})...`);

            const commits = getCommitFiles(opts.appPath, opts.since);
            if (commits.length === 0) {
                console.log('  No commits found in range.');
            } else {
                const validations = commits.map((c) =>
                    validateCommit(mergeResult.manifest, c.files, c.hash, c.message),
                );
                const report = buildValidationReport(validations, mergeResult.manifest);
                console.log('');
                console.log(formatValidationReport(report));
            }
        }
    }

    console.log('');
}
