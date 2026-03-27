// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {spawnSync} from 'child_process';

import {logger} from '../../logger.js';
import {safeEnv} from '../safe_env.js';
import type {QAConfig} from '../types.js';

export function submitFeedback(config: QAConfig): void {
    const args = ['impact-gate', 'feedback'];

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

    if (result.error) {
        logger.warn('Feedback submission spawn failed', {
            error: result.error.message,
        });
    } else if (result.signal) {
        logger.warn('Feedback submission killed by signal', {
            signal: result.signal,
        });
    } else if (result.status !== 0) {
        logger.warn('Feedback submission failed', {
            status: result.status,
            stderr: (result.stderr || '').slice(0, 200),
        });
    }
}
