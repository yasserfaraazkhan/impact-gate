// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {resolveConfig} from '../../agent/config.js';
import {getChangedFiles} from '../../agent/git.js';
import {analyzeImpact as analyzeImpactV2} from '../../engine/impact_engine.js';

import type {ParsedArgs} from '../types.js';

export function runImpactCommand(args: ParsedArgs, config: ReturnType<typeof resolveConfig>['config']): void {
    const reportRoot = config.testsRoot || config.path;
    const gitResult = getChangedFiles(config.path, config.git.since, {includeUncommitted: config.git.includeUncommitted});
    const impactResult = analyzeImpactV2(gitResult.files, {
        testsRoot: reportRoot,
        routeFamilies: config.routeFamilies,
    });
    console.log(`Impact: ${impactResult.changedFiles.length} changed files → ${impactResult.impactedFeatures.length} features impacted`);
    console.log(`Unbound files: ${impactResult.unboundFiles.length}`);
    for (const f of impactResult.impactedFeatures) {
        const label = f.featureId || f.familyId;
        console.log(`  [${f.priority}] ${label}: ${f.coverageStatus} (PW=${f.playwrightSpecs.length}, Cy=${f.cypressSpecs.length})`);
    }
    if (impactResult.warnings.length > 0) {
        for (const w of impactResult.warnings) {
            console.warn(`  Warning: ${w}`);
        }
    }
}
