// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it, beforeEach} from 'node:test';
import assert from 'node:assert/strict';

import {PrometheusMetrics} from '../src/metrics/prometheus.js';

describe('PrometheusMetrics', () => {
    let metrics: PrometheusMetrics;

    beforeEach(() => {
        metrics = new PrometheusMetrics();
    });

    it('should export empty string for no metrics', () => {
        const output = metrics.export();
        assert.equal(output, '\n');
    });

    it('should record and export LLM request counter', () => {
        metrics.recordLLMRequest('anthropic', 'impact-analyst', 1500, 0.02, 1200);
        const output = metrics.export();

        assert.ok(output.includes('e2e_agents_llm_requests_total'));
        assert.ok(output.includes('provider="anthropic"'));
        assert.ok(output.includes('agent="impact-analyst"'));
        assert.ok(output.includes('e2e_agents_llm_tokens_total'));
        assert.ok(output.includes('e2e_agents_llm_cost_usd_total'));
    });

    it('should accumulate counter values', () => {
        metrics.recordLLMRequest('anthropic', 'strategist', 1000, 0.01, 500);
        metrics.recordLLMRequest('anthropic', 'strategist', 2000, 0.03, 1500);
        const output = metrics.export();

        // Total requests should be 2
        const requestLine = output.split('\n').find(
            (l) => l.startsWith('e2e_agents_llm_requests_total') && l.includes('strategist'),
        );
        assert.ok(requestLine);
        assert.ok(requestLine.endsWith(' 2'));
    });

    it('should export histogram with buckets', () => {
        metrics.recordLLMRequest('openai', 'test-designer', 3000, 0.05, 2000);
        const output = metrics.export();

        assert.ok(output.includes('e2e_agents_llm_request_duration_seconds_bucket'));
        assert.ok(output.includes('le="+Inf"'));
        assert.ok(output.includes('_sum'));
        assert.ok(output.includes('_count'));
    });

    it('should record crew run metrics', () => {
        metrics.recordCrewRun('quick-check', 3, 45000, 0.15);
        const output = metrics.export();

        assert.ok(output.includes('e2e_agents_crew_runs_total'));
        assert.ok(output.includes('workflow="quick-check"'));
        assert.ok(output.includes('e2e_agents_crew_families_processed_total'));
    });

    it('should record budget check metrics', () => {
        metrics.recordBudgetCheck(false, 0.30, 1.00);
        const output = metrics.export();

        assert.ok(output.includes('e2e_agents_budget_used_usd'));
        assert.ok(output.includes('e2e_agents_budget_limit_usd'));
    });

    it('should record cache results', () => {
        metrics.recordCacheResult(true, 'strategist');
        metrics.recordCacheResult(false, 'test-designer');
        const output = metrics.export();

        assert.ok(output.includes('result="hit"'));
        assert.ok(output.includes('result="miss"'));
    });

    it('should record circuit breaker state', () => {
        metrics.recordCircuitBreakerState('closed');
        let output = metrics.export();
        assert.ok(output.includes('e2e_agents_circuit_breaker_state'));
        assert.ok(output.includes(' 0'));

        metrics.recordCircuitBreakerState('open');
        output = metrics.export();
        assert.ok(output.includes(' 1'));
    });

    it('should reset all metrics', () => {
        metrics.recordLLMRequest('anthropic', 'strategist', 1000, 0.01, 500);
        metrics.reset();
        const output = metrics.export();
        assert.equal(output, '\n');
    });

    it('should produce valid Prometheus text format', () => {
        metrics.recordLLMRequest('anthropic', 'impact-analyst', 1500, 0.02, 1200);
        metrics.recordCrewRun('design-only', 5, 60000, 1.20);
        const output = metrics.export();

        // Every non-empty line should be a comment (# HELP/TYPE) or a metric line
        for (const line of output.split('\n')) {
            if (!line) continue;
            assert.ok(
                line.startsWith('#') || /^[a-z_]+/.test(line),
                `Invalid Prometheus line: ${line}`,
            );
        }
    });
});
