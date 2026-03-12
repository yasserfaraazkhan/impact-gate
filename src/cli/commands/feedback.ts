// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {readFileSync} from 'fs';

import {resolveConfig} from '../../agent/config.js';
import {appendFeedbackAndRecompute, type RecommendationFeedbackEntry} from '../../agent/feedback.js';

import type {ParsedArgs} from '../types.js';

export function runFeedbackCommand(args: ParsedArgs, autoConfig: string | undefined): void {
    if (!args.path && !autoConfig) {
        console.error('Error: --path is required for feedback command');
        process.exit(1);
    }
    if (!args.feedbackInputPath) {
        console.error('Error: --feedback-input <path> is required for feedback command');
        process.exit(1);
    }

    const {config} = resolveConfig(process.cwd(), autoConfig, {
        path: args.path,
        profile: args.profile,
        testsRoot: args.testsRoot,
        mode: 'impact',
        llmProvider: args.llmProvider,
    });
    const reportRoot = config.testsRoot || config.path;
    const raw = JSON.parse(readFileSync(args.feedbackInputPath, 'utf-8')) as RecommendationFeedbackEntry;
    const payload: RecommendationFeedbackEntry = {
        timestamp: raw.timestamp || new Date().toISOString(),
        runSet: raw.runSet || 'targeted',
        recommendedTests: raw.recommendedTests || [],
        executedTests: raw.executedTests || [],
        failedTests: raw.failedTests || [],
        escapedFailures: raw.escapedFailures || [],
    };
    const output = appendFeedbackAndRecompute(reportRoot, payload);
    console.log(`Feedback data: ${output.feedbackPath}`);
    console.log(`Calibration data: ${output.calibrationPath}`);
    console.log(
        `Calibration overall: precision=${output.calibration.overall.precision}, recall=${output.calibration.overall.recall}, fnr=${output.calibration.overall.falseNegativeRate}`,
    );
}
