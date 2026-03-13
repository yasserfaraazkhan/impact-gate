// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {spawnSync} from 'child_process';

import {logger} from '../../logger.js';
import type {QAConfig} from '../types.js';

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

export function submitFeedback(config: QAConfig): void {
    const args = ['e2e-ai-agents', 'feedback'];

    if (config.testsRoot) {
        args.push('--tests-root', config.testsRoot);
    }

    logger.info('Submitting feedback to calibration system');

    const result = spawnSync('npx', args, {
        cwd: config.testsRoot || process.cwd(),
        encoding: 'utf-8',
        timeout: 30_000,
        env: safeEnv(),
    });

    if (result.status !== 0) {
        logger.warn('Feedback submission failed', {
            status: result.status,
            stderr: (result.stderr || '').slice(0, 200),
        });
    }
}
