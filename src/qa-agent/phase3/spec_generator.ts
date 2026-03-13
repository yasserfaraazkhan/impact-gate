// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {spawnSync} from 'child_process';
import {mkdirSync, writeFileSync} from 'fs';
import {join} from 'path';

import {logger} from '../../logger.js';
import type {Finding, QAConfig} from '../types.js';

function safeEnv(): NodeJS.ProcessEnv {
    return {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_PATH: process.env.NODE_PATH,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        LLM_PROVIDER: process.env.LLM_PROVIDER,
        LOG_LEVEL: process.env.LOG_LEVEL,
        LANG: process.env.LANG,
        npm_config_prefix: process.env.npm_config_prefix,
        NVM_DIR: process.env.NVM_DIR,
        NVM_BIN: process.env.NVM_BIN,
    };
}

interface ScenarioInput {
    title: string;
    flow: string;
    steps: string[];
    expected: string;
    priority: string;
}

export function generateSpecsForFindings(
    findings: Finding[],
    config: QAConfig,
): string[] {
    // Only generate specs for bugs and gaps (not visual/UX issues)
    const actionable = findings.filter(
        (f) => f.type === 'bug' || f.type === 'gap',
    );

    if (actionable.length === 0) {
        logger.info('No actionable findings for spec generation');
        return [];
    }

    const scenarios: ScenarioInput[] = actionable.map((f) => ({
        title: `Verify: ${f.summary}`,
        flow: f.flow,
        steps: f.evidence.reproSteps,
        expected: `The issue "${f.summary}" should not occur`,
        priority: f.severity === 'critical' || f.severity === 'high' ? 'P0' : 'P1',
    }));

    // Write scenarios to a temp file
    const outputDir = config.outputDir || '.e2e-ai-agents';
    mkdirSync(outputDir, {recursive: true});
    const scenariosPath = join(outputDir, 'qa-findings-scenarios.json');
    writeFileSync(scenariosPath, JSON.stringify(scenarios, null, 2), 'utf-8');

    // Call e2e-ai-agents generate with the scenarios
    const args = [
        'e2e-ai-agents', 'generate',
        '--scenarios', scenariosPath,
    ];
    if (config.testsRoot) {
        args.push('--tests-root', config.testsRoot);
    }
    if (config.baseUrl) {
        args.push('--pipeline-base-url', config.baseUrl);
    }

    logger.info('Generating specs for findings', {count: scenarios.length});

    const result = spawnSync('npx', args, {
        cwd: config.testsRoot || process.cwd(),
        encoding: 'utf-8',
        timeout: 300_000,
        maxBuffer: 4 * 1024 * 1024,
        env: safeEnv(),
    });

    if (result.status !== 0) {
        logger.warn('Spec generation exited with non-zero', {
            status: result.status,
            stderr: (result.stderr || '').slice(0, 500),
        });
    }

    // Parse generated spec paths from output
    const generatedPaths: string[] = [];
    const lines = (result.stdout || '').split('\n');
    for (const line of lines) {
        const match = line.match(/generated.*?:\s*(.+\.spec\.ts)/i);
        if (match) {
            generatedPaths.push(match[1].trim());
        }
    }

    return generatedPaths;
}
