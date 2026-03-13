// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {RouteFamily, RouteFamilyManifest} from '../knowledge/route_families.js';

/** A source directory discovered by the scanner */
export interface DiscoveredDir {
    /** Absolute path to the directory */
    path: string;
    /** Relative path from project root */
    relativePath: string;
    /** Category: frontend source, backend source, or test */
    category: 'webapp' | 'server' | 'test' | 'cypress';
    /** Deepest meaningful directory name (e.g., 'channels' from 'src/channels/') */
    familyHint: string;
}

/** A family proposed by the deterministic scanner */
export interface ScannedFamily {
    id: string;
    routes: string[];
    webappPaths: string[];
    serverPaths: string[];
    specDirs: string[];
    cypressSpecDirs: string[];
    tags: string[];
    features: ScannedFeature[];
    /** True if routes are guesses (directory-name-based) */
    routesGuessed: boolean;
}

/** A nested feature proposed by the scanner */
export interface ScannedFeature {
    id: string;
    webappPaths: string[];
    serverPaths: string[];
    specDirs: string[];
}

/** Output of the deterministic scanner */
export interface ScanResult {
    families: ScannedFamily[];
    unmatchedSourceDirs: DiscoveredDir[];
    unmatchedTestDirs: DiscoveredDir[];
    stats: {
        totalSourceFiles: number;
        totalTestFiles: number;
        familyCount: number;
    };
}

/** Output of LLM enrichment */
export interface EnrichmentResult {
    enrichedFamilies: RouteFamily[];
    tokensUsed: number;
    costUSD: number;
    skippedFamilies: string[];
}

/** A single commit's validation result */
export interface CommitValidation {
    hash: string;
    message: string;
    changedFiles: string[];
    boundFiles: number;
    unboundFiles: string[];
    familiesHit: string[];
}

/** Output of validation mode */
export interface ValidationReport {
    totalCommits: number;
    totalFiles: number;
    boundFiles: number;
    unboundFiles: number;
    coveragePercent: number;
    commits: CommitValidation[];
    familyHits: Record<string, number>;
    neverHitFamilies: string[];
    unboundFileClusters: Array<{
        pattern: string;
        count: number;
        suggestedFamily: string;
    }>;
}

/** Output of smart merge */
export interface MergeResult {
    manifest: RouteFamilyManifest;
    newFamilies: string[];
    updatedFamilies: string[];
    staleFamilies: string[];
    summary: string;
}

/** Options for the train command */
export interface TrainOptions {
    /** Path to the application root */
    appPath: string;
    /** Path to tests root (may differ from appPath) */
    testsRoot: string;
    /** Enable LLM enrichment (default: true) */
    enrich: boolean;
    /** Run validation against git history */
    validate: boolean;
    /** Git ref for validation (e.g., 'HEAD~20') */
    since: string;
    /** GitHub PR number for validation */
    pr?: number;
    /** Output path for route-families.json */
    outputPath: string;
    /** Dry run — print without writing */
    dryRun: boolean;
    /** Non-interactive mode */
    yes: boolean;
    /** Max LLM spend in USD */
    budgetUSD: number;
}

/** Routes that look like bare "/<id>" are scanner-generated guesses */
export function isGuessedRoute(routes: string[]): boolean {
    return routes.every((r) => /^\/[a-z][a-z0-9_]*$/.test(r));
}
