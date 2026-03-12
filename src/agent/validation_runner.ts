// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {relative} from 'path';
import type {PipelineConfig} from './config.js';
import type {ValidationResult} from './pipeline_types.js';
import {normalizePath} from './utils.js';
import {runCommand, summarizeCommandOutput} from './process_runner.js';

export function runPlaywrightRuntimeValidation(
    testsRoot: string,
    testFile: string,
    pipeline: PipelineConfig,
    playwrightBinary: string | null,
): ValidationResult {
    if (!playwrightBinary) {
        return {
            status: 'failed',
            detail: 'Playwright binary not found; cannot execute runtime validation.',
        };
    }
    const relativeSpecPath = normalizePath(relative(testsRoot, testFile));
    if (relativeSpecPath.startsWith('../') || relativeSpecPath.startsWith('..\\')) {
        return {
            status: 'failed',
            detail: 'Generated spec path resolved outside testsRoot during runtime validation.',
        };
    }

    const args = ['test', relativeSpecPath, '--workers', '1', '--retries', '0', '--max-failures', '1', '--reporter', 'line'];
    if (pipeline.headless === false) {
        args.push('--headed');
    }
    if (pipeline.project) {
        args.push('--project', pipeline.project);
    }
    const commandResult = runCommand(playwrightBinary, args, testsRoot, 10 * 60 * 1000);
    if (commandResult.status === 0) {
        return {status: 'passed'};
    }
    const summary = summarizeCommandOutput(commandResult.stdout, commandResult.stderr);
    return {
        status: 'failed',
        detail: summary || commandResult.error || `playwright test failed with status ${commandResult.status}`,
    };
}

export function runPlaywrightListValidation(
    testsRoot: string,
    testFile: string,
    pipeline: PipelineConfig,
    playwrightBinary: string | null,
): ValidationResult {
    if (!playwrightBinary) {
        return {
            status: 'skipped',
            detail: 'Playwright binary not found under testsRoot/node_modules/.bin; runtime compile validation skipped.',
        };
    }
    const relativeSpecPath = normalizePath(relative(testsRoot, testFile));
    if (relativeSpecPath.startsWith('../') || relativeSpecPath.startsWith('..\\')) {
        return {
            status: 'failed',
            detail: 'Generated spec path resolved outside testsRoot during validation.',
        };
    }

    const args = ['test', '--list', relativeSpecPath];
    if (pipeline.headless === false) {
        args.push('--headed');
    }
    if (pipeline.project) {
        args.push('--project', pipeline.project);
    }
    const commandResult = runCommand(playwrightBinary, args, testsRoot);
    if (commandResult.error && /ENOENT/.test(commandResult.error)) {
        return {
            status: 'skipped',
            detail: 'Playwright binary was not executable; runtime compile validation skipped.',
        };
    }
    if (commandResult.status === 0) {
        return {status: 'passed'};
    }
    const summary = summarizeCommandOutput(commandResult.stdout, commandResult.stderr);
    return {
        status: 'failed',
        detail: summary || commandResult.error || `playwright --list failed with status ${commandResult.status}`,
    };
}
