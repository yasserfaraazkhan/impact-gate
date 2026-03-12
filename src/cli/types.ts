// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {AnalysisProfile, FrameworkType} from '../agent/config.js';

export type Command =
    'impact'
    | 'plan'
    | 'heal'
    | 'suggest'
    | 'generate'
    | 'finalize-generated-tests'
    | 'feedback'
    | 'traceability-capture'
    | 'traceability-ingest'
    | 'analyze'
    | 'llm-health';

export interface ParsedArgs {
    command?: Command;
    configPath?: string;
    path?: string;
    profile?: AnalysisProfile;
    testsRoot?: string;
    framework?: FrameworkType;
    timeLimitMinutes?: number;
    budgetUSD?: number;
    budgetTokens?: number;
    llmProvider?: string;
    testPatterns?: string[];
    flowPatterns?: string[];
    flowExclude?: string[];
    flowCatalogPath?: string;
    specPDF?: string;
    gitSince?: string;
    allowFallback?: boolean;
    pipeline?: boolean;
    pipelineScenarios?: number;
    pipelineOutput?: string;
    pipelineBaseUrl?: string;
    pipelineBrowser?: 'chrome' | 'chromium' | 'firefox' | 'webkit';
    pipelineHeadless?: boolean;
    pipelineProject?: string;
    pipelineParallel?: boolean;
    pipelineDryRun?: boolean;
    pipelineMcp?: boolean;
    pipelineMcpAllowFallback?: boolean;
    pipelineMcpOnly?: boolean;
    pipelineMcpTimeoutMs?: number;
    pipelineMcpRetries?: number;
    policyMinConfidence?: number;
    policySafeMergeConfidence?: number;
    policyWarningsThreshold?: number;
    policyRiskyPatterns?: string[];
    policyEnforcementMode?: 'advisory' | 'warn' | 'block';
    policyBlockActions?: Array<'run-now' | 'must-add-tests' | 'safe-to-merge'>;
    ciCommentPath?: string;
    githubOutputPath?: string;
    failOnMustAddTests?: boolean;
    feedbackInputPath?: string;
    traceabilityReportPath?: string;
    traceabilityCaptureOutputPath?: string;
    traceabilityCoverageMapPath?: string;
    traceabilityChangedFilesPath?: string;
    traceabilityInputPath?: string;
    traceabilityMinHits?: number;
    traceabilityMaxFilesPerTest?: number;
    traceabilityMaxAgeDays?: number;
    branch?: string;
    commitMessage?: string;
    createPr?: boolean;
    prTitle?: string;
    prBody?: string;
    prBase?: string;
    dryRun?: boolean;
    apply: boolean;
    help: boolean;
    analyzeGenerate?: boolean;
    analyzeGenerateOutputDir?: string;
    analyzeHeal?: boolean;
    analyzeHealReport?: string;
    noAi?: boolean;
    maxAttempts?: number;
    generateScenarios?: string;
}
