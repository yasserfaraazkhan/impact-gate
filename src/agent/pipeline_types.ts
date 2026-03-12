// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

export interface PipelineResult {
    flowId: string;
    flowName: string;
    generatedDir: string;
    generateStatus: 'success' | 'skipped' | 'failed';
    healStatus?: 'success' | 'skipped' | 'failed';
    error?: string;
    failureCategory?: 'config' | 'environment' | 'generation' | 'validation' | 'runtime' | 'quality' | 'path-safety' | 'unknown';
    failureCode?: string;
}

export interface PipelineSummary {
    runner: 'playwright-agents' | 'e2e-test-gen' | 'package-native' | 'unknown';
    results: PipelineResult[];
    warnings: string[];
    mcp?: {
        requested: boolean;
        active: boolean;
        backend: 'playwright-agents' | 'e2e-test-gen' | 'package-native' | 'unknown';
    };
}

export interface SpecHealTarget {
    specPath: string;
    status?: 'failed' | 'flaky';
    reason?: string;
}

export type NativeSpecStrategy =
    | 'thread-reply'
    | 'lifecycle-channel'
    | 'channel-settings'
    | 'channel-switch'
    | 'markdown-post'
    | 'mentions-post'
    | 'realtime-post'
    | 'message-post'
    | 'channel-baseline'
    | 'search-baseline'
    | 'generic-baseline';

export interface NativeSpecQualityIssue {
    code:
        | 'disallowed-describe'
        | 'disallowed-only'
        | 'missing-test'
        | 'missing-tag'
        | 'tag-array-disallowed'
        | 'unknown-api-surface'
        | 'fragile-system-console-visibility'
        | 'fragile-selector';
    message: string;
}

export interface CommandResult {
    status: number;
    stdout: string;
    stderr: string;
    error?: string;
}

export interface ValidationResult {
    status: 'passed' | 'failed' | 'skipped';
    detail?: string;
}

export interface ApiSurfaceCatalog {
    pwProps: Set<string>;
    pwNestedMethods: Map<string, Set<string>>;
    initSetupKeys: Set<string>;
    initSetupVariableMethods: Map<string, Set<string>>;
    testBrowserMethods: Set<string>;
    channelsPageMembers: Set<string>;
    sidebarRightMembers: Set<string>;
}

export interface InitSetupBinding {
    key: string;
    variable: string;
}
