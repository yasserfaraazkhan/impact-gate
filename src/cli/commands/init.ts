// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, writeFileSync} from 'fs';
import {join} from 'path';
import * as readline from 'readline';

import {detectFramework, detectTestsRoot, detectGitDefaultBranch} from '../defaults.js';

const CONFIG_FILENAME = 'e2e-ai-agents.config.json';

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

function printNextSteps(): void {
    console.log('');
    console.log('  Next steps:');
    console.log('    1. Start with impact analysis:  npx e2e-ai-agents impact --path .');
    console.log('    2. Build a coverage plan:      npx e2e-ai-agents plan --path .');
    console.log('    3. Optional AI setup:          export ANTHROPIC_API_KEY=sk-ant-...');
    console.log('    4. Verify provider health:     npx e2e-ai-agents llm-health');
    console.log('');
}

export async function runInitCommand(yes = false): Promise<void> {
    const targetDir = process.cwd();
    const configPath = join(targetDir, CONFIG_FILENAME);

    if (existsSync(configPath)) {
        console.error(`${CONFIG_FILENAME} already exists in this directory.`);
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

        const config = buildConfig(answers);
        const json = JSON.stringify(config, null, 2) + '\n';
        writeFileSync(configPath, json, 'utf-8');
        console.log(`Created ${CONFIG_FILENAME}`);
        printNextSteps();
        return;
    }

    console.log('');
    console.log('  e2e-ai-agents init');
    console.log('  ==================');
    console.log('');
    console.log('  This will create an e2e-ai-agents.config.json in the current directory.');
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
        printNextSteps();
    } finally {
        rl.close();
    }
}
