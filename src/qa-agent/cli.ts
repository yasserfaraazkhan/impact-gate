#!/usr/bin/env node
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {resolve, sep} from 'path';

import type {QAConfig, RunMode} from './types.js';
import {runQAAgent} from './orchestrator.js';

const MODES = new Set<RunMode>(['pr', 'hunt', 'fix', 'release']);
const KNOWN_FLAGS = new Set([
    '--base-url', '--since', '--phase', '--time', '--budget',
    '--headed', '--tests-root', '--project', '--output', '--help', '-h',
]);

function printUsage(): void {
    console.log(`
Usage: impact-gate-qa <mode> [options]

Modes:
  pr        Test changed features from a PR
  hunt      Deep-dive into a specific area
  fix       Verify healed tests and side effects
  release   Full regression + release readiness verdict

Options:
  --base-url <url>      Application URL (required)
  --since <ref>         Git ref for diff (default: origin/main)
  --phase <1|2|3>       Run only up to this phase
  --time <minutes>      Time limit (default: 15)
  --budget <usd>        LLM budget in USD (default: 2.00)
  --headed              Run browser in headed mode
  --tests-root <path>   Path to tests directory
  --project <name>      Playwright project name
  --output <dir>        Output directory (default: .e2e-ai-agents)
  --help                Show this help

Examples:
  impact-gate-qa pr --since origin/main --base-url http://localhost:8065
  impact-gate-qa hunt "channel settings" --base-url http://localhost:8065
  impact-gate-qa release --base-url http://localhost:8065 --time 30
  impact-gate-qa fix --base-url http://localhost:8065
`);
}

function parseCliArgs(argv: string[]): QAConfig | null {
    if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
        printUsage();
        return null;
    }

    const modeArg = argv[0];
    if (!MODES.has(modeArg as RunMode)) {
        console.error(`Unknown mode: ${modeArg}`);
        printUsage();
        return null;
    }

    const mode = modeArg as RunMode;
    let baseUrl = '';
    let since: string | undefined;
    let huntTarget: string | undefined;
    let phase: 1 | 2 | 3 | undefined;
    let timeLimitMinutes = mode === 'release' ? 30 : 15;
    let budgetUSD = 2.0;
    let headed = false;
    let testsRoot: string | undefined;
    let project: string | undefined;
    let outputDir: string | undefined;

    // For hunt mode, the second positional arg is the target
    let startFlags = 1;
    if (mode === 'hunt' && argv[1] && !argv[1].startsWith('--')) {
        huntTarget = argv[1];
        startFlags = 2;
    }

    for (let i = startFlags; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];

        switch (arg) {
        case '--base-url':
            baseUrl = next || '';
            i++;
            break;
        case '--since':
            since = next;
            i++;
            break;
        case '--phase': {
            const parsed = parseInt(next || '0', 10);
            if (parsed !== 1 && parsed !== 2 && parsed !== 3) {
                console.error(`Error: --phase must be 1, 2, or 3 (got "${next}")`);
                process.exit(1);
            }
            phase = parsed;
            i++;
            break;
        }
        case '--time': {
            const parsed = parseInt(next || '15', 10);
            if (!Number.isFinite(parsed) || parsed <= 0) {
                console.error(`Error: --time must be a positive number (got "${next}")`);
                process.exit(1);
            }
            timeLimitMinutes = parsed;
            i++;
            break;
        }
        case '--budget': {
            const parsed = parseFloat(next || '2.0');
            if (!Number.isFinite(parsed) || parsed <= 0) {
                console.error(`Error: --budget must be a positive number (got "${next}")`);
                process.exit(1);
            }
            budgetUSD = parsed;
            i++;
            break;
        }
        case '--headed':
            headed = true;
            break;
        case '--tests-root':
            testsRoot = next;
            i++;
            break;
        case '--project':
            project = next;
            i++;
            break;
        case '--output':
            outputDir = next;
            i++;
            break;
        default:
            if (arg.startsWith('--') && !KNOWN_FLAGS.has(arg)) {
                console.error(`Warning: unknown flag "${arg}" (ignored)`);
            }
            break;
        }
    }

    // Validate --since and hunt target against flag injection (must not start with -)
    if (since && since.startsWith('-')) {
        console.error(`Error: --since value "${since}" looks like a flag, not a git ref`);
        process.exit(1);
    }
    if (huntTarget && huntTarget.startsWith('-')) {
        console.error(`Error: hunt target "${huntTarget}" looks like a flag`);
        process.exit(1);
    }

    if (!baseUrl) {
        console.error('Error: --base-url is required');
        process.exit(1);
    }

    // Validate baseUrl is a proper HTTP(S) URL
    try {
        const parsed = new URL(baseUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            console.error(`Error: --base-url must use http or https (got "${parsed.protocol}")`);
            process.exit(1);
        }
        // Normalize: remove trailing slash
        baseUrl = parsed.origin + parsed.pathname.replace(/\/+$/, '');
    } catch {
        console.error(`Error: --base-url is not a valid URL ("${baseUrl}")`);
        process.exit(1);
    }

    // Validate --output stays within project directory
    if (outputDir) {
        const resolved = resolve(outputDir);
        const cwd = process.cwd();
        const normalizedCwd = cwd.endsWith(sep) ? cwd : cwd + sep;
        if (resolved !== cwd && !resolved.startsWith(normalizedCwd)) {
            console.error(`Error: --output "${outputDir}" resolves outside the project directory`);
            process.exit(1);
        }
    }

    return {
        mode,
        baseUrl,
        since: since || 'origin/main',
        huntTarget,
        phase,
        timeLimitMinutes,
        budgetUSD,
        headed,
        testsRoot,
        project,
        outputDir,
    };
}

async function main(): Promise<void> {
    const config = parseCliArgs(process.argv.slice(2));
    if (!config) {
        process.exit(0);
    }

    const report = await runQAAgent(config);

    // Exit code based on verdict
    switch (report.verdict.decision) {
    case 'go':
        process.exit(0);
        break;
    case 'conditional':
        process.exit(1);
        break;
    case 'no-go':
        process.exit(2);
        break;
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
