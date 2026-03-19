// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Reporter interface and shared types for output format plugins.
 */

export interface CrewResults {
    workflow: string;
    changedFiles: number;
    impactedFlows: number;
    strategyEntries: Array<{
        flowId: string;
        flowName: string;
        priority: string;
        approach: string;
        rationale: string;
    }>;
    testDesigns: Array<{
        flowName: string;
        testCases: Array<{
            name: string;
            type: string;
            priority: string;
        }>;
    }>;
    crossImpacts: Array<{
        sourceFamily: string;
        affectedFamily: string;
        riskLevel: string;
    }>;
    findings: Array<{
        title: string;
        severity: string;
        description: string;
    }>;
    warnings: string[];
    cost: number;
    tokens: number;
}

export interface Reporter {
    name: string;
    extension: string;
    format(results: CrewResults): string;
}
