// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {resolveConfig} from '../../agent/config.js';
import {finalizeGeneratedTests} from '../../agent/handoff.js';

import type {ParsedArgs} from '../types.js';

export function runFinalizeCommand(args: ParsedArgs, autoConfig: string | undefined): void {
    if (!args.path && !autoConfig) {
        console.error('Error: --path is required for finalize-generated-tests command');
        process.exit(1);
    }
    const {config} = resolveConfig(process.cwd(), autoConfig, {
        path: args.path,
        profile: args.profile,
        testsRoot: args.testsRoot,
        mode: 'gap',
        llmProvider: args.llmProvider,
    });
    const result = finalizeGeneratedTests({
        appPath: config.path,
        testsRoot: config.testsRoot || config.path,
        branch: args.branch,
        commitMessage: args.commitMessage,
        createPr: args.createPr,
        prTitle: args.prTitle,
        prBody: args.prBody,
        baseBranch: args.prBase,
        dryRun: args.dryRun,
    });
    console.log(`Finalize repo root: ${result.repoRoot}`);
    console.log(`Finalize branch: ${result.branch}`);
    console.log(`Finalize staged paths: ${result.stagedPaths.join(', ') || 'none'}`);
    console.log(`Finalize commit: ${result.committed ? 'created' : 'skipped'}`);
    if (result.commitSha) {
        console.log(`Finalize commit sha: ${result.commitSha}`);
    }
    if (result.prUrl) {
        console.log(`Finalize PR: ${result.prUrl}`);
    }
}
