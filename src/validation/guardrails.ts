// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {RouteFamilyManifest} from '../knowledge/route_families.js';

export interface EvidenceCheck {
    hasRouteFamily: boolean;
    hasSpecificRoute: boolean;
    hasPageObject: boolean;
    hasUserAction: boolean;
    hasExistingSpecCited: boolean;
    /** Historical failure correlation boost (0-20) from failure_history */
    historyBoost?: number;
}

export type ConfidenceClass = 'high' | 'medium' | 'low';

export const EVIDENCE_THRESHOLDS = {
    minConfidenceForAction: 40,
    minConfidenceForGeneration: 60,
    cannotDetermineBelow: 30,
    highConfidenceAbove: 75,
} as const;

export function computeConfidence(check: EvidenceCheck): number {
    let score = 0;
    if (check.hasRouteFamily) {
        score += 25;
    }
    if (check.hasSpecificRoute) {
        score += 15;
    }
    if (check.hasPageObject) {
        score += 20;
    }
    if (check.hasUserAction) {
        score += 25;
    }
    if (check.hasExistingSpecCited) {
        score += 15;
    }
    // Historical failure correlation: if this file historically causes test failures,
    // we're more confident it needs testing now
    if (check.historyBoost) {
        score += check.historyBoost;
    }
    return Math.min(100, score);
}

export function classifyConfidence(confidence: number): ConfidenceClass {
    if (confidence >= EVIDENCE_THRESHOLDS.highConfidenceAbove) {
        return 'high';
    }
    if (confidence >= EVIDENCE_THRESHOLDS.minConfidenceForAction) {
        return 'medium';
    }
    return 'low';
}

export function shouldForceCannotDetermine(confidence: number): boolean {
    return confidence < EVIDENCE_THRESHOLDS.cannotDetermineBelow;
}

export function validateRouteAgainstManifest(
    route: string,
    familyId: string,
    manifest: RouteFamilyManifest,
): boolean {
    const family = manifest.families.find((f) => f.id === familyId);
    if (!family) {
        return false;
    }
    // Check family-level routes
    for (const pattern of family.routes) {
        if (routeMatchesPattern(route, pattern)) {
            return true;
        }
    }
    // Check feature-level routes
    if (family.features) {
        for (const feature of family.features) {
            if (feature.routes) {
                for (const pattern of feature.routes) {
                    if (routeMatchesPattern(route, pattern)) {
                        return true;
                    }
                }
            }
        }
    }
    return false;
}

function routeMatchesPattern(route: string, pattern: string): boolean {
    // Convert route pattern like /{team}/channels/{channel} to regex
    const regexStr = pattern
        .replace(/\{[^}]+\}/g, '[^/]+')
        .replace(/\//g, '\\/');
    try {
        const regex = new RegExp(`^${regexStr}$`);
        return regex.test(route);
    } catch {
        return route === pattern || route.startsWith(pattern);
    }
}

export function computeCannotDetermineRatio(
    decisions: Array<{action: string}>,
): number {
    if (decisions.length === 0) {
        return 0;
    }
    const cannotDetermineCount = decisions.filter((d) => d.action === 'cannot_determine').length;
    return cannotDetermineCount / decisions.length;
}

export function computeOverallConfidence(
    decisions: Array<{confidence: number; action: string}>,
): ConfidenceClass {
    if (decisions.length === 0) {
        return 'low';
    }
    const actionable = decisions.filter((d) => d.action !== 'cannot_determine');
    if (actionable.length === 0) {
        return 'low';
    }
    const avgConfidence = actionable.reduce((sum, d) => sum + d.confidence, 0) / actionable.length;
    return classifyConfidence(avgConfidence);
}

// Re-export spec verification from its new home in the pipeline layer
export type {CompileCheckResult, SmokeRunResult} from '../pipeline/spec_verifier.js';
export {compileCheckSpec, smokeRunSpec} from '../pipeline/spec_verifier.js';
