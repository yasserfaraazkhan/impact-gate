// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {resolveConfig} from '../../agent/config.js';
import {getChangedFiles} from '../../agent/git.js';
import {analyzeImpact, type ImpactResult} from '../../engine/impact_engine.js';
import {runPlanCommand} from './plan.js';
import type {ParsedArgs} from '../types.js';

/** Spec presence is a mapping signal, not measured behavior coverage. */
export function evaluateGate(impact: ImpactResult, threshold: number) {
    const totalFeatures = impact.impactedFeatures.length;
    const coveredFeatures = impact.impactedFeatures.filter((f) => f.coverageStatus === 'covered').length;
    const partialFeatures = impact.impactedFeatures.filter((f) => f.coverageStatus === 'partial').length;
    const coveragePercent = totalFeatures ? (coveredFeatures / totalFeatures) * 100 : null;
    const unassessedFiles = [...new Set([...(impact.unassessedFiles ?? []), ...impact.unboundFiles])];
    const empty = impact.changedFiles.length === 0;
    const passed = empty || (unassessedFiles.length === 0 && coveragePercent !== null && coveragePercent >= threshold);
    return {threshold, coveragePercent, totalFeatures, coveredFeatures, partialFeatures, unassessedFiles,
        changedFiles: impact.changedFiles, diffStatus: empty ? 'empty' : 'changed',
        coverageBasis: 'manifest-spec-presence', measuredCoverage: 'unavailable', release: 'not-assessed', passed,
        reason: empty ? 'Valid empty Git diff.' : passed ? 'Spec-mapping threshold met; behavior coverage remains unmeasured.' : 'Incomplete or unassessed spec mapping; run the full suite.',
        uncoveredFeatures: impact.impactedFeatures.filter((f) => f.coverageStatus !== 'covered').map((f) => ({id: f.featureId || f.familyId, priority: f.priority})),
    };
}

export async function runGateCommand(args: ParsedArgs, autoConfig: string | undefined): Promise<void> {
    if (!args.path && !autoConfig) throw new Error('--path is required for gate command');
    let threshold = args.gateThreshold ?? 80;
    if (threshold > 0 && threshold <= 1) threshold *= 100;
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) throw new Error('Gate threshold must be between 0 and 100.');
    const {config} = resolveConfig(process.cwd(), autoConfig, {path: args.path, profile: args.profile, testsRoot: args.testsRoot, mode: 'impact', gitSince: args.gitSince});
    if (args.advisory) return runPlanCommand(args, autoConfig, config);
    const result = getChangedFiles(config.path, args.gitSince || config.git.since);
    if (result.error) throw new Error(result.error);
    const impact = analyzeImpact(result.files, {testsRoot: config.testsRoot || config.path, routeFamilies: config.routeFamilies});
    const report = evaluateGate(impact, threshold);
    if (args.jsonOutput) console.log(JSON.stringify(report, null, 2));
    else console.log(`${report.passed ? 'PASSED' : 'FAILED'}: ${report.reason}\nFully mapped features: ${report.coveredFeatures}/${report.totalFeatures}; partial: ${report.partialFeatures}; unassessed files: ${report.unassessedFiles.length}`);
    process.exitCode = report.passed ? 0 : 1;
}
