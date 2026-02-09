// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {AgentConfig, AudienceRole} from './config.js';
import type {FileAnalysis, FlowImpact} from './analysis.js';
import {computeBlastRadius, mergeFlags, normalizeRoles} from './flags.js';

export function applyBlastRadius(flows: FlowImpact[], files: FileAnalysis[], config: AgentConfig): FlowImpact[] {
    if (flows.length === 0) {
        return flows;
    }

    const fileMap = new Map<string, FileAnalysis>();
    for (const file of files) {
        fileMap.set(file.relativePath, file);
    }

    return flows.map((flow) => {
        const collectedFlags = [...(flow.flags || [])];
        const collectedAudience: AudienceRole[] = [...(flow.audience || [])];

        for (const filePath of flow.files) {
            const file = fileMap.get(filePath);
            if (!file) {
                continue;
            }
            collectedFlags.push(...file.flags);
            collectedAudience.push(...file.audience);
        }

        const mergedFlags = mergeFlags(collectedFlags, config.flags.defaultState);
        const mergedAudience = normalizeRoles(collectedAudience, config.audience.defaultRoles as AudienceRole[]);
        const blastRadius = computeBlastRadius(mergedAudience, mergedFlags, config);

        return {
            ...flow,
            audience: mergedAudience,
            flags: mergedFlags,
            blastRadius,
            score: flow.score + blastRadius.scoreDelta,
        };
    });
}
