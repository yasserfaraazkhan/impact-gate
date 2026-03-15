// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {execFileSync} from 'child_process';
import {existsSync, mkdirSync, renameSync, writeFileSync} from 'fs';
import {dirname, join, resolve} from 'path';
import * as readline from 'readline';

import {resolveConfig} from '../../agent/config.js';
import {loadRouteFamilyManifest} from '../../knowledge/route_families.js';
import type {RouteFamilyManifest} from '../../knowledge/route_families.js';
import {LLMProviderFactory} from '../../provider_factory.js';
import {logger, LogLevel} from '../../logger.js';

import type {ParsedArgs} from '../types.js';

import {scanProject} from '../../training/scanner.js';
import {mergeFamilies, detectStaleFamilies} from '../../training/merger.js';
import {enrichFamilies} from '../../training/enricher.js';
import {getCommitFiles, validateCommit, buildValidationReport, formatValidationReport} from '../../training/validator.js';
import type {TrainOptions} from '../../training/types.js';

class TrainError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TrainError';
    }
}

const MAX_BUDGET_USD = 10;

/**
 * Resolves train-specific options from CLI args.
 * Unlike other commands (analyze, plan, heal) that use the shared resolveConfig()
 * for full pipeline configuration, train only needs appPath and testsRoot.
 * We call resolveConfig() solely to extract testsRoot from the config file.
 */
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

    // Validate --pr is a positive integer
    if (args.trainPr !== undefined && (!Number.isInteger(args.trainPr) || args.trainPr <= 0)) {
        throw new TrainError('--pr must be a positive integer');
    }

    // Validate --pr and --since are mutually exclusive
    if (args.trainPr && args.gitSince) {
        throw new TrainError('--pr and --since are mutually exclusive.');
    }

    // Validate --since format (reject leading '-' to prevent git flag injection)
    const since = args.gitSince || 'HEAD~20';
    if (/^-/.test(since) || !/^[a-zA-Z0-9_.~^@\/-]+$/.test(since)) {
        throw new TrainError(`Invalid git ref: ${since}`);
    }

    // Validate budget bounds
    const budget = args.budgetUSD || 0.50;
    if (budget <= 0) {
        throw new TrainError('--budget-usd must be a positive number');
    }
    if (budget > MAX_BUDGET_USD) {
        throw new TrainError(`Budget exceeds maximum of $${MAX_BUDGET_USD}. Use a lower --budget-usd value.`);
    }

    const resolvedAppPath = resolve(appPath);
    const resolvedTestsRoot = resolve(testsRoot);
    const resolvedOutputPath = resolve(outputPath);

    // Validate --path is a real project
    if (!existsSync(resolvedAppPath)) {
        throw new TrainError(`Project root not found: ${resolvedAppPath}`);
    }

    // Validate --output is within project boundary (append separator to prevent prefix attacks)
    const inApp = resolvedOutputPath === resolvedAppPath || resolvedOutputPath.startsWith(resolvedAppPath + '/');
    const inTests = resolvedOutputPath === resolvedTestsRoot || resolvedOutputPath.startsWith(resolvedTestsRoot + '/');
    if (!inApp && !inTests) {
        throw new TrainError(`Output path must be within the project root or tests root: ${resolvedOutputPath}`);
    }

    // Discover git repo root for monorepo-aware scanning and validation
    let gitRepoRoot: string | undefined;
    try {
        gitRepoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
            cwd: resolvedAppPath,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
    } catch {
        // Not a git repo or git not available
    }

    // Resolve serverRoot: explicit flag, or auto-detect from git repo root
    let serverRoot = args.serverPath;
    if (!serverRoot && gitRepoRoot) {
        const serverDir = join(gitRepoRoot, 'server');
        if (existsSync(serverDir)) {
            serverRoot = serverDir;
        }
    }
    const resolvedServerRoot = serverRoot ? resolve(serverRoot) : undefined;

    return {
        appPath: resolvedAppPath,
        testsRoot: resolvedTestsRoot,
        serverRoot: resolvedServerRoot,
        gitRepoRoot: gitRepoRoot ? resolve(gitRepoRoot) : undefined,
        enrich: args.trainEnrich !== false,
        validate: args.trainValidate || false,
        since,
        pr: args.trainPr,
        outputPath: resolvedOutputPath,
        dryRun: args.dryRun || false,
        yes: args.trainYes || false,
        budgetUSD: budget,
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
            // Remove undefined/empty optional fields for clean JSON
            const cleaned = {...f};
            const optionalArrays = ['pageObjects', 'components', 'webappPaths', 'serverPaths', 'specDirs', 'cypressSpecDirs', 'tags', 'userFlows', 'features'] as const;
            for (const key of optionalArrays) {
                if (!cleaned[key] || (Array.isArray(cleaned[key]) && (cleaned[key] as unknown[]).length === 0)) {
                    delete cleaned[key];
                }
            }
            if (!cleaned.priority) delete cleaned.priority;
            return cleaned;
        }),
    };
    return JSON.stringify(output, null, 2) + '\n';
}

export async function runTrainCommand(args: ParsedArgs, autoConfig?: string): Promise<void> {
    const opts = resolveTrainOptions(args, autoConfig);
    const totalTimer = logger.timer('train-total');
    const timings: Record<string, number> = {};

    // Configure observability from CLI flags
    if (args.verbose) logger.setLevel(LogLevel.DEBUG);
    if (args.jsonOutput) logger.setJsonMode(true);

    logger.info('e2e-ai-agents train');
    logger.info('===================');

    // ---------- Phase 1: Deterministic scan ----------
    logger.info('Scanning project structure...');
    if (opts.serverRoot) {
        logger.info(`Server root: ${opts.serverRoot}`);
    }
    const scanTimer = logger.timer('scan');
    const scanResult = scanProject(
        opts.appPath,
        opts.testsRoot !== opts.appPath ? opts.testsRoot : undefined,
        opts.serverRoot,
        opts.gitRepoRoot,
    );
    timings.scan = scanTimer.end();
    logger.info(`Found ${scanResult.stats.totalSourceFiles} source files, ${scanResult.stats.totalTestFiles} test files`);
    logger.info(`Discovered ${scanResult.families.length} candidate families`);

    if (scanResult.families.length === 0) {
        logger.info('No families discovered. Make sure your project has recognizable');
        logger.info('source directories (src/, server/, app/) and test directories');
        logger.info('(tests/, e2e/, specs/) with matching names.');
        return;
    }

    // ---------- Phase 2: Merge with existing ----------
    const mergeTimer = logger.timer('merge');
    const existing = loadRouteFamilyManifest(opts.testsRoot);
    if (existing) {
        logger.info(`Found existing manifest with ${existing.families.length} families`);
    }

    let mergeResult = mergeFamilies(existing, scanResult.families);
    timings.merge = mergeTimer.end();
    logger.info(`Merge: ${mergeResult.summary}`);

    // ---------- Phase 3: Stale detection ----------
    if (mergeResult.manifest.families.length > 0) {
        const stale = detectStaleFamilies(mergeResult.manifest, opts.appPath, opts.testsRoot);
        if (stale.length > 0) {
            logger.info(`Stale families detected (${stale.length}):`);
            for (const id of stale) {
                logger.info(`  ${id} — paths no longer exist`);
            }

            if (!opts.yes && !opts.dryRun && process.stdin.isTTY) {
                const rl = readline.createInterface({input: process.stdin, output: process.stdout});
                try {
                    const answer = await ask(rl, '  Remove stale families? [y/N]', 'N');
                    if (answer.toLowerCase() === 'y') {
                        const staleSet = new Set(stale);
                        mergeResult.manifest.families = mergeResult.manifest.families.filter(
                            (f) => !staleSet.has(f.id),
                        );
                        mergeResult.staleFamilies = stale;
                        logger.info(`Removed ${stale.length} stale families`);
                    }
                } finally {
                    rl.close();
                }
            }
        }
    }

    // ---------- Phase 4: LLM Enrichment ----------
    let enrichTokens = 0;
    let enrichCost = 0;
    let enrichRequests = 0;
    let enrichAvgResponseMs = 0;
    if (opts.enrich) {
        logger.info('Enriching with LLM...');
        const enrichTimer = logger.timer('enrich');
        try {
            const provider = await LLMProviderFactory.createFromEnv();
            const enrichResult = await enrichFamilies(
                mergeResult.manifest.families,
                scanResult.families,
                opts.appPath,
                provider,
                opts.budgetUSD,
                opts.testsRoot !== opts.appPath ? opts.testsRoot : undefined,
            );
            mergeResult.manifest.families = enrichResult.enrichedFamilies;
            enrichTokens = enrichResult.tokensUsed;
            enrichCost = enrichResult.costUSD;
            enrichRequests = enrichResult.requestCount ?? 0;
            enrichAvgResponseMs = enrichResult.avgResponseMs ?? 0;
            logger.info(`Enriched ${enrichResult.enrichedFamilies.length} families`, {
                tokens: enrichResult.tokensUsed,
                cost: enrichResult.costUSD,
                requests: enrichRequests,
                avgResponseMs: enrichAvgResponseMs,
            });
            if (enrichResult.skippedFamilies.length > 0) {
                logger.info(`Skipped ${enrichResult.skippedFamilies.length} families (budget limit)`);
            }
        } catch (error) {
            logger.warn(`LLM enrichment failed: ${error instanceof Error ? error.message : String(error)}`);
            logger.warn('Continuing with deterministic results. Use --no-enrich to skip LLM.');
        }
        timings.enrich = enrichTimer.end();
    }

    // ---------- Phase 5: Write manifest ----------
    const json = serializeManifest(mergeResult.manifest);

    if (opts.dryRun) {
        logger.info('Dry run — proposed manifest:');
        console.log(json);
    } else {
        const dir = dirname(opts.outputPath);
        if (!existsSync(dir)) {
            mkdirSync(dir, {recursive: true});
        }
        const tmpPath = `${opts.outputPath}.tmp`;
        writeFileSync(tmpPath, json, 'utf-8');
        renameSync(tmpPath, opts.outputPath);
        logger.info(`Wrote ${opts.outputPath}`);
        logger.info(`${mergeResult.manifest.families.length} families`);
    }

    // ---------- Phase 6: Report unmatched ----------
    if (scanResult.unmatchedSourceDirs.length > 0 || scanResult.unmatchedTestDirs.length > 0) {
        logger.info('Unmatched (review manually):');
        for (const dir of scanResult.unmatchedSourceDirs.slice(0, 10)) {
            logger.info(`  source: ${dir.relativePath}`);
        }
        for (const dir of scanResult.unmatchedTestDirs.slice(0, 10)) {
            logger.info(`  test:   ${dir.relativePath}`);
        }
        if (scanResult.unmatchedSourceDirs.length + scanResult.unmatchedTestDirs.length > 20) {
            logger.info('  ... and more');
        }
    }

    // ---------- Phase 7: Validation (optional) ----------
    let validationReport;
    if (opts.validate) {
        const validateTimer = logger.timer('validate');
        if (opts.pr) {
            logger.info(`Validating against PR #${opts.pr}...`);

            // Check for gh CLI
            const {execFileSync} = await import('child_process');
            try {
                execFileSync('gh', ['--version'], {stdio: 'pipe'});
            } catch {
                throw new TrainError('--pr requires the GitHub CLI (gh). Install: https://cli.github.com/');
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
                throw new TrainError(`Error fetching PR #${opts.pr}: ${error instanceof Error ? error.message : String(error)}`);
            }

            if (prFiles.length === 0) {
                logger.info('No files found in PR.');
            } else {
                const validation = validateCommit(mergeResult.manifest, prFiles, `PR#${opts.pr}`, `PR #${opts.pr}`);
                validationReport = buildValidationReport([validation], mergeResult.manifest);
                logger.info(formatValidationReport(validationReport));
            }
        } else {
            logger.info(`Validating against git history (${opts.since})...`);

            const commits = getCommitFiles(opts.gitRepoRoot || opts.appPath, opts.since);
            if (commits.length === 0) {
                logger.info('No commits found in range.');
            } else {
                const validations = commits.map((c) =>
                    validateCommit(mergeResult.manifest, c.files, c.hash, c.message),
                );
                validationReport = buildValidationReport(validations, mergeResult.manifest);
                logger.info(formatValidationReport(validationReport));
            }
        }
        timings.validate = validateTimer.end();
    }

    timings.total = totalTimer.end();

    // ---------- Write train report ----------
    if (!opts.dryRun) {
        const reportDir = dirname(opts.outputPath);
        const trainReport = {
            timestamp: new Date().toISOString(),
            version: '1.7.0',
            timings,
            families: {
                total: mergeResult.manifest.families.length,
                new: mergeResult.newFamilies.length,
                updated: mergeResult.updatedFamilies.length,
                stale: mergeResult.staleFamilies.length,
            },
            coverage: validationReport ? {
                percent: validationReport.coveragePercent,
                boundFiles: validationReport.boundFiles,
                totalFiles: validationReport.totalFiles,
            } : undefined,
            llm: opts.enrich ? {
                tokensUsed: enrichTokens,
                costUSD: enrichCost,
                requests: enrichRequests,
                avgResponseMs: enrichAvgResponseMs,
            } : undefined,
        };
        const reportPath = join(reportDir, 'train-report.json');
        writeFileSync(reportPath, JSON.stringify(trainReport, null, 2) + '\n', 'utf-8');
        logger.debug('Wrote train report', {path: reportPath});
    }

    logger.info('Done.');
}
