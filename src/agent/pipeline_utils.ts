// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {basename} from 'path';
import type {FlowImpact} from './types.js';
import type {NativeSpecStrategy, PipelineResult, PipelineSummary} from './pipeline_types.js';
import {baseNameWithoutExt, normalizePath, titleCase, tokenize, uniqueTokens} from './utils.js';
import type {SpecHealTarget} from './pipeline_types.js';

export function createMcpStatus(
    backend: 'playwright-agents' | 'e2e-test-gen' | 'package-native' | 'unknown',
    requested: boolean,
): NonNullable<PipelineSummary['mcp']> {
    return {
        requested,
        active: requested && (backend === 'e2e-test-gen' || backend === 'playwright-agents'),
        backend,
    };
}

export function classifyPipelineFailure(result: PipelineResult): PipelineResult {
    if (result.failureCategory || result.failureCode) {
        return result;
    }
    if (!result.error) {
        return result;
    }
    const errorText = result.error.toLowerCase();
    if (errorText.includes('etimedout') || errorText.includes('timed out')) {
        return {...result, failureCategory: 'environment', failureCode: 'mcp_timeout'};
    }
    if (errorText.includes('outside testsroot')) {
        return {...result, failureCategory: 'path-safety', failureCode: 'path_outside_tests_root'};
    }
    if (errorText.includes('playwright binary') || errorText.includes('not found')) {
        return {...result, failureCategory: 'environment', failureCode: 'dependency_missing'};
    }
    if (errorText.includes('compile validation')) {
        return {...result, failureCategory: 'validation', failureCode: 'compile_validation_failed'};
    }
    if (errorText.includes('runtime validation') || errorText.includes('playwright test failed')) {
        return {...result, failureCategory: 'runtime', failureCode: 'runtime_validation_failed'};
    }
    if (errorText.includes('quality checks failed') || errorText.includes('invalid test content')) {
        return {...result, failureCategory: 'quality', failureCode: 'quality_guard_failed'};
    }
    if (errorText.includes('generate failed') || errorText.includes('did not produce expected test file')) {
        return {...result, failureCategory: 'generation', failureCode: 'generation_failed'};
    }
    return {...result, failureCategory: 'unknown', failureCode: 'unknown'};
}

export function finalizePipelineSummary(summary: PipelineSummary): PipelineSummary {
    return {
        ...summary,
        results: summary.results.map(classifyPipelineFailure),
    };
}

export function toSafeSlug(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'flow';
}

export function stripSpecSuffix(value: string): string {
    return value.replace(/\.(spec|test)\.[^.]+$/i, '').replace(/\.[^.]+$/, '');
}

export function buildSyntheticFlowFromSpecTarget(relativeSpecPath: string, target: SpecHealTarget): FlowImpact {
    const normalizedSpecPath = normalizePath(relativeSpecPath);
    const noSuffix = stripSpecSuffix(normalizedSpecPath);
    const flowId = toSafeSlug(noSuffix.replace(/\//g, '.'));
    const base = baseNameWithoutExt(stripSpecSuffix(basename(normalizedSpecPath)));
    const flowName = titleCase(base.replace(/[._-]+/g, ' ')) || 'Recovered Spec';
    const keywords = uniqueTokens(tokenize(noSuffix.replace(/[/.]/g, ' ')));
    const reasons = [
        `Playwright report marked this spec as ${target.status || 'unstable'}.`,
        target.reason || `Auto-heal target: ${normalizedSpecPath}`,
    ];
    return {
        id: flowId,
        name: flowName,
        kind: 'flow',
        score: target.status === 'failed' ? 12 : 9,
        priority: target.status === 'failed' ? 'P0' : 'P1',
        reasons,
        keywords,
        files: [normalizedSpecPath],
    };
}

export function firstFlowFiles(flow: FlowImpact): string[] {
    return (flow.files || []).filter(Boolean).slice(0, 5);
}

export function buildNativeStrategyOrder(flow: FlowImpact): NativeSpecStrategy[] {
    const flowId = (flow.id || '').toLowerCase();
    const haystack = [
        flow.id,
        flow.name,
        ...(flow.files || []),
        ...(flow.reasons || []),
        ...(flow.keywords || []),
    ].join(' ').toLowerCase();

    const strategies: NativeSpecStrategy[] = [];
    if (flowId.includes('search')) {
        strategies.push('search-baseline');
    }
    if (flowId.includes('threads') || flowId.includes('thread')) {
        strategies.push('thread-reply');
    }
    if (flowId.includes('channels.lifecycle')) {
        strategies.push('lifecycle-channel');
    }
    if (flowId.includes('channels.settings')) {
        strategies.push('channel-settings');
    }
    if (flowId.includes('channels.switch')) {
        strategies.push('channel-switch');
    }
    if (flowId.includes('messaging.markdown')) {
        strategies.push('markdown-post');
    }
    if (flowId.includes('messaging.mentions')) {
        strategies.push('mentions-post');
    }
    if (flowId.includes('messaging.realtime')) {
        strategies.push('realtime-post');
    }
    if (/(thread|reply|rhs|sidebar[_-]?right)/.test(haystack)) {
        strategies.push('thread-reply');
    }
    if (/(create|join|leave|invite)/.test(haystack)) {
        strategies.push('lifecycle-channel');
    }
    if (/(settings|preferences)/.test(haystack)) {
        strategies.push('channel-settings');
    }
    if (/(switch|quick\\s*switch)/.test(haystack)) {
        strategies.push('channel-switch');
    }
    if (/(markdown|format)/.test(haystack)) {
        strategies.push('markdown-post');
    }
    if (/(mention|@)/.test(haystack)) {
        strategies.push('mentions-post');
    }
    if (/(realtime|websocket|presence)/.test(haystack)) {
        strategies.push('realtime-post');
    }
    if (/(search|find|spotlight)/.test(haystack)) {
        strategies.push('search-baseline');
    }
    if (/(message|post|realtime|websocket|chat)/.test(haystack)) {
        strategies.push('message-post');
    }
    if (/(channel|navigation|sidebar|switch)/.test(haystack)) {
        strategies.push('channel-baseline');
    }
    strategies.push('generic-baseline');
    return Array.from(new Set(strategies));
}
