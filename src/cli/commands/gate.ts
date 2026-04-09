// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * CLI command: gate — CI coverage gate that exits 1 if coverage is below threshold.
 *
 * Runs deterministic impact analysis (no LLM required) and checks what
 * percentage of impacted features have test coverage.
 *
 * Usage:
 *   impact-gate gate --threshold 80 --path . --since origin/main
 */

import {resolveConfig} from '../../agent/config.js';
import {getChangedFiles} from '../../agent/git.js';
import {analyzeImpact} from '../../engine/impact_engine.js';
import type {ParsedArgs} from '../types.js';

export async function runGateCommand(args: ParsedArgs, autoConfig: string | undefined): Promise<void> {
    if (!args.path && !autoConfig) {
        console.error('Error: --path is required for gate command');
        process.exit(1);
    }

    let threshold = args.gateThreshold ?? 80;
    if (threshold > 0 && threshold <= 1) {
        threshold = threshold * 100;
    }

    const {config} = resolveConfig(process.cwd(), autoConfig, {
        path: args.path,
        profile: args.profile,
        testsRoot: args.testsRoot,
        mode: 'impact',
        gitSince: args.gitSince,
    });
    const testsRoot = config.testsRoot || config.path;
    const gitSince = args.gitSince || config.git.since;

    // Get changed files
    const result = await getChangedFiles(config.path, gitSince);
    const changedFiles = result.files;
    if (changedFiles.length === 0) {
        console.log('No changed files detected. Gate passes.');
        process.exit(0);
    }

    // Run deterministic impact analysis
    const impact = analyzeImpact(changedFiles, {
        testsRoot,
        routeFamilies: config.routeFamilies,
    });

    const totalFeatures = impact.impactedFeatures.length;
    if (totalFeatures === 0) {
        console.log('No impacted features detected. Gate passes.');
        process.exit(0);
    }

    const coveredFeatures = impact.impactedFeatures.filter(
        (f) => f.coverageStatus === 'covered' || f.coverageStatus === 'partial',
    ).length;
    const coveragePercent = Math.round((coveredFeatures / totalFeatures) * 100);

    // Output
    if (args.jsonOutput) {
        console.log(JSON.stringify({
            threshold,
            coveragePercent,
            totalFeatures,
            coveredFeatures,
            passed: coveragePercent >= threshold,
            uncoveredFeatures: impact.impactedFeatures
                .filter((f) => f.coverageStatus === 'uncovered')
                .map((f) => ({id: f.featureId || f.familyId, priority: f.priority})),
        }, null, 2));
    } else {
        console.log(`Coverage gate: ${coveragePercent}% (${coveredFeatures}/${totalFeatures} features covered)`);
        console.log(`Threshold: ${threshold}%`);

        if (coveragePercent < threshold) {
            console.log(`\nFAILED — coverage ${coveragePercent}% is below ${threshold}% threshold`);
            const uncovered = impact.impactedFeatures.filter((f) => f.coverageStatus === 'uncovered');
            if (uncovered.length > 0) {
                console.log('\nUncovered features:');
                for (const f of uncovered.slice(0, 10)) {
                    console.log(`  ${f.priority || 'P2'} ${f.featureId || f.familyId}`);
                }
                if (uncovered.length > 10) {
                    console.log(`  ... and ${uncovered.length - 10} more`);
                }
            }
        } else {
            console.log('\nPASSED');
        }
    }

    process.exit(coveragePercent >= threshold ? 0 : 1);
}
