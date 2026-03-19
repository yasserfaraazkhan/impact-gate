// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Prometheus-compatible metrics exporter for e2e-agents.
 *
 * Exports metrics in Prometheus text exposition format.
 * Can be served via HTTP or written to a file for node_exporter textfile collector.
 *
 * Usage:
 *   const metrics = new PrometheusMetrics();
 *   metrics.recordLLMRequest('anthropic', 'impact-analyst', 150, 0.02, 1200);
 *   metrics.recordCrewRun('quick-check', 3, 8500, 0.15);
 *   console.log(metrics.export());
 */

interface Counter {
    name: string;
    help: string;
    labels: Record<string, string>;
    value: number;
}

interface Histogram {
    name: string;
    help: string;
    labels: Record<string, string>;
    sum: number;
    count: number;
    buckets: Map<number, number>;
}

const DURATION_BUCKETS = [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];

export class PrometheusMetrics {
    private counters: Counter[] = [];
    private histograms: Histogram[] = [];

    /**
     * Record an LLM request.
     */
    recordLLMRequest(
        provider: string,
        agent: string,
        durationMs: number,
        costUSD: number,
        tokens: number,
    ): void {
        this.incrementCounter('e2e_agents_llm_requests_total', 'Total LLM requests', {provider, agent});
        this.incrementCounter('e2e_agents_llm_tokens_total', 'Total tokens consumed', {provider, agent}, tokens);
        this.incrementCounter('e2e_agents_llm_cost_usd_total', 'Total LLM cost in USD', {provider, agent}, costUSD);
        this.observeHistogram('e2e_agents_llm_request_duration_seconds', 'LLM request duration', {provider, agent}, durationMs / 1000);
    }

    /**
     * Record a crew workflow run.
     */
    recordCrewRun(
        workflow: string,
        families: number,
        durationMs: number,
        costUSD: number,
    ): void {
        this.incrementCounter('e2e_agents_crew_runs_total', 'Total crew workflow runs', {workflow});
        this.incrementCounter('e2e_agents_crew_families_processed_total', 'Total families processed', {workflow}, families);
        this.incrementCounter('e2e_agents_crew_cost_usd_total', 'Total crew cost in USD', {workflow}, costUSD);
        this.observeHistogram('e2e_agents_crew_duration_seconds', 'Crew workflow duration', {workflow}, durationMs / 1000);
    }

    /**
     * Record a budget check event.
     */
    recordBudgetCheck(exceeded: boolean, currentUSD: number, limitUSD: number): void {
        this.incrementCounter('e2e_agents_budget_checks_total', 'Total budget checks', {exceeded: String(exceeded)});
        this.setGauge('e2e_agents_budget_used_usd', 'Current budget usage in USD', {}, currentUSD);
        this.setGauge('e2e_agents_budget_limit_usd', 'Budget limit in USD', {}, limitUSD);
    }

    /**
     * Record a circuit breaker state change.
     */
    recordCircuitBreakerState(state: 'closed' | 'open' | 'half-open'): void {
        this.setGauge('e2e_agents_circuit_breaker_state', 'Circuit breaker state (0=closed, 1=open, 2=half-open)', {},
            state === 'closed' ? 0 : state === 'open' ? 1 : 2);
    }

    /**
     * Record a cache hit or miss.
     */
    recordCacheResult(hit: boolean, agent: string): void {
        this.incrementCounter('e2e_agents_cache_lookups_total', 'Total cache lookups', {result: hit ? 'hit' : 'miss', agent});
    }

    /**
     * Export all metrics in Prometheus text exposition format.
     */
    export(): string {
        const lines: string[] = [];
        const seenHelp = new Set<string>();

        // Export counters
        for (const counter of this.counters) {
            if (!seenHelp.has(counter.name)) {
                lines.push(`# HELP ${counter.name} ${counter.help}`);
                lines.push(`# TYPE ${counter.name} counter`);
                seenHelp.add(counter.name);
            }
            const labelStr = formatLabels(counter.labels);
            lines.push(`${counter.name}${labelStr} ${counter.value}`);
        }

        // Export histograms
        for (const hist of this.histograms) {
            if (!seenHelp.has(hist.name)) {
                lines.push(`# HELP ${hist.name} ${hist.help}`);
                lines.push(`# TYPE ${hist.name} histogram`);
                seenHelp.add(hist.name);
            }
            const labelStr = formatLabels(hist.labels);
            let cumulative = 0;
            for (const bucket of DURATION_BUCKETS) {
                cumulative += hist.buckets.get(bucket) || 0;
                lines.push(`${hist.name}_bucket${formatLabels({...hist.labels, le: String(bucket)})} ${cumulative}`);
            }
            lines.push(`${hist.name}_bucket${formatLabels({...hist.labels, le: '+Inf'})} ${hist.count}`);
            lines.push(`${hist.name}_sum${labelStr} ${hist.sum}`);
            lines.push(`${hist.name}_count${labelStr} ${hist.count}`);
        }

        return lines.join('\n') + '\n';
    }

    /**
     * Reset all metrics to zero.
     */
    reset(): void {
        this.counters = [];
        this.histograms = [];
    }

    private incrementCounter(name: string, help: string, labels: Record<string, string>, value = 1): void {
        const existing = this.counters.find((c) => c.name === name && labelsMatch(c.labels, labels));
        if (existing) {
            existing.value += value;
        } else {
            this.counters.push({name, help, labels, value});
        }
    }

    private setGauge(name: string, help: string, labels: Record<string, string>, value: number): void {
        const existing = this.counters.find((c) => c.name === name && labelsMatch(c.labels, labels));
        if (existing) {
            existing.value = value;
        } else {
            this.counters.push({name, help, labels, value});
        }
    }

    private observeHistogram(name: string, help: string, labels: Record<string, string>, value: number): void {
        let existing = this.histograms.find((h) => h.name === name && labelsMatch(h.labels, labels));
        if (!existing) {
            existing = {name, help, labels, sum: 0, count: 0, buckets: new Map()};
            this.histograms.push(existing);
        }
        existing.sum += value;
        existing.count++;
        for (const bucket of DURATION_BUCKETS) {
            if (value <= bucket) {
                existing.buckets.set(bucket, (existing.buckets.get(bucket) || 0) + 1);
            }
        }
    }
}

function escapeLabel(v: string): string {
    return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function formatLabels(labels: Record<string, string>): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) return '';
    return `{${entries.map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(',')}}`;
}

function labelsMatch(a: Record<string, string>, b: Record<string, string>): boolean {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((k) => a[k] === b[k]);
}
