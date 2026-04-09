// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, mkdirSync, writeFileSync} from 'fs';
import {join, resolve} from 'path';
import * as readline from 'readline';

import {detectFramework, detectTestsRoot, detectGitDefaultBranch} from '../defaults.js';
import {scanProject} from '../../training/scanner.js';
import {inferUserFlows} from '../../training/flow_inferrer.js';
import type {ScannedFamily} from '../../training/types.js';
import type {RouteFamily} from '../../knowledge/route_families.js';

const CONFIG_FILENAME = 'impact-gate.config.json';
const LEGACY_CONFIG_FILENAMES = ['e2e-ai-agents.config.json', '.e2e-ai-agents.config.json'];

interface InitAnswers {
    path: string;
    testsRoot: string;
    framework: string;
    gitSince: string;
    provider: string;
    enableAi: boolean;
    enforcementMode: string;
}

function createInterface(): readline.Interface {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
}

function ask(rl: readline.Interface, question: string, defaultValue?: string): Promise<string> {
    const suffix = defaultValue ? ` (${defaultValue})` : '';
    return new Promise((resolve) => {
        rl.question(`${question}${suffix}: `, (answer) => {
            resolve(answer.trim() || defaultValue || '');
        });
    });
}

function buildConfig(answers: InitAnswers): Record<string, unknown> {
    const config: Record<string, unknown> = {
        path: answers.path,
        framework: answers.framework,
        git: {since: answers.gitSince},
        impact: {
            dependencyGraph: {enabled: true, maxDepth: 3},
            traceability: {enabled: true},
            aiFlow: {
                enabled: answers.enableAi,
                provider: answers.enableAi ? answers.provider : undefined,
            },
        },
        policy: {
            enforcementMode: answers.enforcementMode,
            blockOnActions: ['must-add-tests'],
        },
    };

    if (answers.testsRoot && answers.testsRoot !== '.' && answers.testsRoot !== answers.path) {
        config.testsRoot = answers.testsRoot;
    }

    return config;
}

function printNextSteps(hasScan: boolean): void {
    console.log('');
    console.log('  Next steps:');
    if (hasScan) {
        console.log('    1. Review .e2e-ai-agents/route-families.json and refine family mappings');
        console.log('    2. Run a PR review:            npx impact-gate review --path . --since origin/main');
        console.log('    3. Optional: enrich with LLM:  npx impact-gate train --path . --tests-root .');
    } else {
        console.log('    1. Scan for route families:    npx impact-gate init --scan -y');
        console.log('    2. Start with impact analysis: npx impact-gate impact --path .');
        console.log('    3. Build a coverage plan:      npx impact-gate plan --path .');
    }
    console.log('    Optional AI setup: export ANTHROPIC_API_KEY=sk-ant-...');
    console.log('');
}

export async function runInitCommand(yes = false, scan = false): Promise<void> {
    const targetDir = process.cwd();
    const configPath = join(targetDir, CONFIG_FILENAME);
    const existingLegacyConfig = LEGACY_CONFIG_FILENAMES.find((filename) => existsSync(join(targetDir, filename)));

    // Allow --scan even if config already exists (just regenerate the manifest)
    if (!scan && (existsSync(configPath) || existingLegacyConfig)) {
        const existingName = existsSync(configPath) ? CONFIG_FILENAME : existingLegacyConfig;
        console.error(`${existingName} already exists in this directory.`);
        console.error('Remove it first if you want to re-initialize.');
        process.exit(1);
    }

    // Non-interactive mode: auto-detect everything and write immediately
    if (yes) {
        const appPath = '.';
        const answers: InitAnswers = {
            path: appPath,
            testsRoot: detectTestsRoot(appPath) || '.',
            framework: detectFramework(appPath),
            gitSince: detectGitDefaultBranch(appPath),
            provider: 'auto',
            enableAi: true,
            enforcementMode: 'advisory',
        };

        if (!existsSync(configPath) && !existingLegacyConfig) {
            const config = buildConfig(answers);
            const json = JSON.stringify(config, null, 2) + '\n';
            writeFileSync(configPath, json, 'utf-8');
            console.log(`Created ${CONFIG_FILENAME}`);
        }

        if (scan) {
            runScanPhase(resolve(appPath), resolve(answers.testsRoot));
        }

        printNextSteps(scan);
        return;
    }

    console.log('');
    console.log('  impact-gate init');
    console.log('  ==================');
    console.log('');
    console.log('  This will create an impact-gate.config.json in the current directory.');
    console.log('  Legacy e2e-ai-agents config filenames are still supported during migration.');
    console.log('');

    const rl = createInterface();

    try {
        const appPath = await ask(rl, '  Path to your web app root', '.');
        const detectedFramework = detectFramework(appPath);
        const framework = await ask(rl, '  Test framework (auto | playwright | cypress | pytest | supertest | selenium)', detectedFramework);

        const detectedTestsRoot = detectTestsRoot(appPath);
        const testsRoot = await ask(
            rl,
            '  Path to tests root (relative to app root, "." if same)',
            detectedTestsRoot || '.',
        );

        const detectedBranch = detectGitDefaultBranch(appPath);
        const gitSince = await ask(rl, '  Git ref to diff against', detectedBranch);

        const providerAnswer = await ask(rl, '  LLM provider for AI features (anthropic | openai | ollama | auto)', 'auto');
        const enableAi = providerAnswer !== 'none';

        const enforcementMode = await ask(rl, '  Policy enforcement mode (advisory | warn | block)', 'advisory');

        const answers: InitAnswers = {
            path: appPath,
            testsRoot,
            framework,
            gitSince,
            provider: providerAnswer,
            enableAi,
            enforcementMode,
        };

        const config = buildConfig(answers);
        const json = JSON.stringify(config, null, 2) + '\n';

        console.log('');
        console.log('  Generated config:');
        console.log('');
        for (const line of json.split('\n')) {
            console.log(`    ${line}`);
        }

        const confirm = await ask(rl, '  Write this config? (Y/n)', 'Y');
        if (confirm.toLowerCase() !== 'y' && confirm !== '') {
            console.log('  Aborted.');
            process.exit(0);
        }

        writeFileSync(configPath, json, 'utf-8');
        console.log('');
        console.log(`  Created ${CONFIG_FILENAME}`);

        if (scan) {
            runScanPhase(resolve(answers.path), resolve(answers.testsRoot));
        }

        printNextSteps(scan);
    } finally {
        rl.close();
    }
}

// ─── Scan Phase ───

/** Convert ScannedFamily to RouteFamily with heuristic priority assignment */
function scannedToRouteFamilyWithPriority(scanned: ScannedFamily): RouteFamily {
    const family: RouteFamily = {
        id: scanned.id,
        routes: scanned.routes,
    };

    if (scanned.webappPaths.length > 0) family.webappPaths = scanned.webappPaths;
    if (scanned.serverPaths.length > 0) family.serverPaths = scanned.serverPaths;
    if (scanned.specDirs.length > 0) family.specDirs = scanned.specDirs;
    if (scanned.cypressSpecDirs.length > 0) family.cypressSpecDirs = scanned.cypressSpecDirs;
    if (scanned.tags.length > 0) family.tags = scanned.tags;

    if (scanned.features.length > 0) {
        family.features = scanned.features.map((f) => ({
            id: f.id,
            webappPaths: f.webappPaths.length > 0 ? f.webappPaths : undefined,
            serverPaths: f.serverPaths.length > 0 ? f.serverPaths : undefined,
            specDirs: f.specDirs.length > 0 ? f.specDirs : undefined,
        }));
    }

    // Heuristic priority:
    // P0: has both webapp + server paths (full-stack feature) or has server paths across multiple tiers
    // P1: has test specs (tested features are important)
    // P2: everything else
    const hasWebapp = scanned.webappPaths.length > 0;
    const hasServer = scanned.serverPaths.length > 0;
    const hasSpecs = scanned.specDirs.length > 0 || scanned.cypressSpecDirs.length > 0;

    if (hasWebapp && hasServer) {
        family.priority = 'P0';
    } else if (hasSpecs) {
        family.priority = 'P1';
    } else {
        family.priority = 'P2';
    }

    // Test type
    if (hasWebapp && hasServer) {
        family.testType = 'both';
    } else if (hasServer) {
        family.testType = 'api';
    } else {
        family.testType = 'ui';
    }

    return family;
}

function runScanPhase(appPath: string, testsRoot: string): void {
    console.log('');
    console.log('Scanning project for route families...');

    // Detect server root for Go backend scanning
    const serverCandidates = ['server', 'api', 'cmd', 'internal'];
    let serverRoot: string | undefined;
    for (const candidate of serverCandidates) {
        if (existsSync(join(appPath, candidate))) {
            serverRoot = join(appPath, candidate);
            break;
        }
    }

    // Detect git repo root
    let gitRepoRoot: string | undefined;
    if (existsSync(join(appPath, '.git'))) {
        gitRepoRoot = appPath;
    }

    const scanResult = scanProject(appPath, testsRoot, serverRoot, gitRepoRoot);

    if (scanResult.families.length === 0) {
        console.log('No route families discovered. The scanner could not find recognizable source/test patterns.');
        console.log('Try running: npx impact-gate train --path . to use the full training pipeline.');
        return;
    }

    // Convert to RouteFamily format with priorities and inferred user flows
    console.log('Inferring user flows from test titles, API handlers, and component names...');
    const families = scanResult.families.map((scanned) => {
        const family = scannedToRouteFamilyWithPriority(scanned);
        const flows = inferUserFlows(scanned, appPath, testsRoot);
        if (flows.length > 0) {
            family.userFlows = flows;
        }
        return family;
    });

    // Sort: P0 first, then P1, then P2
    families.sort((a, b) => {
        const order = {P0: 0, P1: 1, P2: 2};
        return (order[a.priority || 'P2'] || 2) - (order[b.priority || 'P2'] || 2);
    });

    // Write manifest
    const outputDir = join(appPath, '.e2e-ai-agents');
    if (!existsSync(outputDir)) {
        mkdirSync(outputDir, {recursive: true});
    }
    const manifestPath = join(outputDir, 'route-families.json');
    const manifest = {families, source: 'init-scan'};
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    // Print summary
    const p0 = families.filter((f) => f.priority === 'P0').length;
    const p1 = families.filter((f) => f.priority === 'P1').length;
    const p2 = families.filter((f) => f.priority === 'P2').length;
    const withSpecs = families.filter((f) => (f.specDirs?.length || 0) > 0 || (f.cypressSpecDirs?.length || 0) > 0).length;

    console.log('');
    console.log(`Discovered ${families.length} families (${p0} P0, ${p1} P1, ${p2} P2):`);

    const withFlows = families.filter((f) => f.userFlows && f.userFlows.length > 0).length;

    for (const family of families.slice(0, 15)) {
        const specCount = (family.specDirs?.length || 0) + (family.cypressSpecDirs?.length || 0);
        const specLabel = specCount > 0 ? `${specCount} spec dir${specCount !== 1 ? 's' : ''}` : 'no specs';
        const flowCount = family.userFlows?.length || 0;
        console.log(`  [${family.priority || 'P2'}] ${family.id.padEnd(30)} ${specLabel}, ${flowCount} flow${flowCount !== 1 ? 's' : ''}`);
        if (family.userFlows && family.userFlows.length > 0) {
            const preview = family.userFlows.slice(0, 3).join(', ');
            const more = family.userFlows.length > 3 ? `, +${family.userFlows.length - 3} more` : '';
            console.log(`       ${preview}${more}`);
        }
    }

    if (families.length > 15) {
        console.log(`  ... and ${families.length - 15} more`);
    }

    console.log('');
    if (scanResult.unmatchedSourceDirs.length > 0) {
        console.log(`Unmatched source dirs: ${scanResult.unmatchedSourceDirs.length}`);
    }
    if (scanResult.unmatchedTestDirs.length > 0) {
        console.log(`Unmatched test dirs: ${scanResult.unmatchedTestDirs.length}`);
    }

    console.log(`Families with test coverage: ${withSpecs}/${families.length}`);
    console.log(`Families with user flows: ${withFlows}/${families.length}`);
    console.log('');
    console.log(`Wrote ${manifestPath} (${families.length} families)`);
}
