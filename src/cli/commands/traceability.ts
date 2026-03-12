// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {readFileSync} from 'fs';

import {resolveConfig} from '../../agent/config.js';
import {captureTraceabilityInput} from '../../agent/traceability_capture.js';
import {ingestTraceabilityInput} from '../../agent/traceability_ingest.js';

import type {ParsedArgs} from '../types.js';

export function runTraceabilityCaptureCommand(args: ParsedArgs, autoConfig: string | undefined): void {
    if (!args.path && !autoConfig) {
        console.error('Error: --path is required for traceability-capture command');
        process.exit(1);
    }
    if (!args.traceabilityReportPath) {
        console.error('Error: --traceability-report <path> is required for traceability-capture command');
        process.exit(1);
    }

    const {config} = resolveConfig(process.cwd(), autoConfig, {
        path: args.path,
        profile: args.profile,
        testsRoot: args.testsRoot,
        mode: 'impact',
        gitSince: args.gitSince,
        llmProvider: args.llmProvider,
    });
    const reportRoot = config.testsRoot || config.path;
    const output = captureTraceabilityInput({
        appPath: config.path,
        testsRoot: reportRoot,
        reportPath: args.traceabilityReportPath,
        sinceRef: args.gitSince || config.git.since,
        outputPath: args.traceabilityCaptureOutputPath,
        coverageMapPath: args.traceabilityCoverageMapPath,
        changedFilesPath: args.traceabilityChangedFilesPath,
    });
    console.log(`Traceability input: ${output.outputPath}`);
    console.log(`Traceability tests seen: ${output.testsSeen}`);
    console.log(`Traceability runs generated: ${output.runsGenerated}`);
    console.log(`Traceability changed files used: ${output.changedFilesUsed}`);
    if (output.warnings.length > 0) {
        console.log(`Traceability warnings: ${output.warnings.join(' | ')}`);
    }
}

export function runTraceabilityIngestCommand(args: ParsedArgs, autoConfig: string | undefined): void {
    if (!args.path && !autoConfig) {
        console.error('Error: --path is required for traceability-ingest command');
        process.exit(1);
    }
    if (!args.traceabilityInputPath) {
        console.error('Error: --traceability-input <path> is required for traceability-ingest command');
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
    const raw = JSON.parse(readFileSync(args.traceabilityInputPath, 'utf-8')) as unknown;
    const output = ingestTraceabilityInput(
        reportRoot,
        config.impact.traceability,
        raw,
        {
            minHits: args.traceabilityMinHits,
            maxFilesPerTest: args.traceabilityMaxFilesPerTest,
            maxAgeDays: args.traceabilityMaxAgeDays,
        },
    );
    console.log(`Traceability manifest: ${output.manifestPath}`);
    console.log(`Traceability state: ${output.statePath}`);
    console.log(`Traceability ingested entries: ${output.entriesIngested}`);
    console.log(`Traceability tracked tests: ${output.testsTracked}`);
    console.log(`Traceability tracked edges: ${output.edgesTracked}`);
    if (output.warnings.length > 0) {
        console.log(`Traceability warnings: ${output.warnings.join(' | ')}`);
    }
}
