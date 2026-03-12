// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Shared types extracted from the legacy analysis module.
 * Kept for backward compatibility with pipeline and plan systems.
 */

import type {AudienceRole, FlagState} from './config.js';

export type FlowPriority = 'P0' | 'P1' | 'P2';

export type FlagSource = 'featureFlag' | 'configFlag' | 'testGate';

export interface FlagHit {
    name: string;
    source: FlagSource;
    defaultState: FlagState;
}

export interface BlastRadius {
    audience: AudienceRole[];
    flags: FlagHit[];
    summary: string;
    scoreDelta: number;
}

export interface FlowImpact {
    id: string;
    name: string;
    kind: 'screen' | 'flow';
    score: number;
    priority: FlowPriority;
    reasons: string[];
    keywords: string[];
    files: string[];
    audience?: AudienceRole[];
    flags?: FlagHit[];
    blastRadius?: BlastRadius;
    priorityFloor?: FlowPriority;
    subsystemRiskBoost?: number;
    subsystemRiskRules?: string[];
    existingTests?: string[];
    missingScenarios?: string[];
}

export interface FlowCoverage {
    flowId: string;
    flowName: string;
    coveredBy: string[];
}
