// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * CLI command: impact-gate review
 *
 * Unified PR review that combines impact analysis, coverage planning,
 * and defect prediction into a single human-readable report.
 *
 * Usage:
 *   impact-gate review --path . --since origin/main
 *   impact-gate review --path . --since origin/main --deep
 *   impact-gate review --path . --since origin/main --json
 *   impact-gate review --path . --since origin/main --ci-comment-path comment.md
 */

import {writeFileSync} from 'fs';

import type {resolveConfig} from '../../agent/config.js';
import {getChangedFiles} from '../../agent/git.js';
import {analyzeImpact} from '../../engine/impact_engine.js';
import {buildPlanFromImpact} from '../../engine/plan_builder.js';
import {predict, predictSync} from '../../prediction/index.js';
import {synthesizeReview} from '../../engine/review_synthesizer.js';
import {formatReviewText, formatReviewMarkdown, formatReviewJSON} from '../../engine/review_formatter.js';
import {LLMProviderFactory} from '../../provider_factory.js';

import type {ParsedArgs} from '../types.js';

export async function runReviewCommand(
    args: ParsedArgs,
    config: ReturnType<typeof resolveConfig>['config'],
): Promise<void> {
    const reportRoot = config.testsRoot || config.path;
    const baseRef = config.git.since || 'origin/main';

    console.log(`Reviewing: ${baseRef}...HEAD`);
    console.log(`Repository: ${config.path}`);
    console.log('');

    // Step 1: Get changed files
    const gitResult = getChangedFiles(config.path, baseRef, {
        includeUncommitted: config.git.includeUncommitted,
    });

    if (gitResult.files.length === 0) {
        console.log('No changed files detected. Nothing to review.');
        return;
    }

    // Step 2: Impact analysis
    const impact = analyzeImpact(gitResult.files, {
        testsRoot: reportRoot,
        routeFamilies: config.routeFamilies,
        filteredTestFiles: gitResult.filteredTestFiles,
    });

    // Step 3: Build plan (deterministic — no AI for the plan layer)
    const plan = buildPlanFromImpact(impact, config.policy);

    // Step 4: Defect prediction
    let prediction;
    const useDeep = args.deep === true;

    if (useDeep) {
        try {
            const provider = args.llmProvider
                ? LLMProviderFactory.createFromString(args.llmProvider)
                : await LLMProviderFactory.createFromEnv();

            prediction = await predict(config.path, baseRef, 'HEAD', {
                deep: true,
                provider,
                projectRoot: config.path,
                record: true,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`Deep prediction unavailable (${msg}), using deterministic fallback.`);
            prediction = predictSync(config.path, baseRef, 'HEAD');
        }
    } else {
        prediction = await predict(config.path, baseRef, 'HEAD', {
            projectRoot: config.path,
            record: true,
        });
    }

    // Step 5: Synthesize
    const report = synthesizeReview(impact, plan, prediction);

    // Step 6: Output
    if (args.jsonOutput) {
        console.log(JSON.stringify(formatReviewJSON(report), null, 2));
    } else {
        console.log(formatReviewText(report));
    }

    // Write markdown for CI comments if requested
    if (args.ciCommentPath) {
        const markdown = formatReviewMarkdown(report);
        writeFileSync(args.ciCommentPath, markdown, 'utf-8');
        console.log('');
        console.log(`PR comment written to ${args.ciCommentPath}`);
    }

    // Exit code based on enforcement
    if (plan.enforcement.shouldFail) {
        process.exit(2);
    }

    // Also check predict threshold if set
    const threshold = args.threshold ?? args.gateThreshold;
    if (typeof threshold === 'number' && prediction.score > threshold) {
        console.log('');
        console.log(`GATE FAILED: defect risk ${prediction.score.toFixed(2)} exceeds threshold ${threshold}`);
        process.exit(1);
    }
}
