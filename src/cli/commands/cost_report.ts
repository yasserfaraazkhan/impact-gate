// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * CLI command: cost-report — displays LLM cost breakdown from metrics.
 */

import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import type {ParsedArgs} from '../types.js';

interface CrewMetricEvent {
    type: 'crew-run';
    timestamp: string;
    workflow: string;
    totalCost: number;
    totalTokens: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    agentUsage: Array<{
        agent: string;
        family?: string;
        inputTokens: number;
        outputTokens: number;
        cost: number;
        durationMs: number;
    }>;
}

function parseMetricsFile(filePath: string): CrewMetricEvent[] {
    if (!existsSync(filePath)) {
        return [];
    }
    const lines = readFileSync(filePath, 'utf-8').split('\n');
    const events: CrewMetricEvent[] = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed.type === 'crew-run') {
                events.push(parsed as CrewMetricEvent);
            }
        } catch {
            continue;
        }
    }
    return events;
}

function filterByDays(events: CrewMetricEvent[], days: number): CrewMetricEvent[] {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return events.filter((e) => new Date(e.timestamp).getTime() >= cutoff);
}

export function runCostReportCommand(args: ParsedArgs): void {
    const reportRoot = args.path || args.testsRoot || process.cwd();
    const metricsPath = join(reportRoot, '.e2e-ai-agents', 'metrics.jsonl');
    const days = 30; // Default; could be added as a CLI flag later

    const allEvents = parseMetricsFile(metricsPath);
    const events = filterByDays(allEvents, days);

    if (events.length === 0) {
        console.log('No crew metrics found.');
        if (!existsSync(metricsPath)) {
            console.log(`Metrics file not found at: ${metricsPath}`);
        } else {
            console.log('Run `impact-gate crew` to generate cost data.');
        }
        return;
    }

    // JSON output
    if (args.jsonOutput) {
        const report = buildReport(events, days);
        console.log(JSON.stringify(report, null, 2));
        return;
    }

    // Human-readable output
    const totalCost = events.reduce((sum, e) => sum + e.totalCost, 0);
    const totalRuns = events.length;

    console.log(`Impact Gate Cost Report (last ${days} days)`);
    console.log('='.repeat(45));
    console.log(`\nTotal: $${totalCost.toFixed(2)} across ${totalRuns} runs\n`);

    // By workflow
    const byWorkflow = new Map<string, {runs: number; cost: number}>();
    for (const e of events) {
        const entry = byWorkflow.get(e.workflow) || {runs: 0, cost: 0};
        entry.runs++;
        entry.cost += e.totalCost;
        byWorkflow.set(e.workflow, entry);
    }

    console.log('By workflow:');
    for (const [workflow, data] of [...byWorkflow.entries()].sort((a, b) => b[1].cost - a[1].cost)) {
        const avg = data.cost / data.runs;
        console.log(`  ${workflow.padEnd(14)} | ${String(data.runs).padStart(3)} runs | $${data.cost.toFixed(2).padStart(6)} | avg $${avg.toFixed(2)}/run`);
    }

    // By agent (top 5)
    const byAgent = new Map<string, number>();
    for (const e of events) {
        for (const au of e.agentUsage) {
            byAgent.set(au.agent, (byAgent.get(au.agent) || 0) + au.cost);
        }
    }

    const sortedAgents = [...byAgent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (sortedAgents.length > 0) {
        console.log('\nBy agent (top 5):');
        for (const [agent, cost] of sortedAgents) {
            const pct = totalCost > 0 ? ((cost / totalCost) * 100).toFixed(0) : '0';
            console.log(`  ${agent.padEnd(20)} | $${cost.toFixed(2).padStart(6)} | ${pct.padStart(3)}%`);
        }
    }
}

function buildReport(events: CrewMetricEvent[], days: number) {
    const totalCost = events.reduce((sum, e) => sum + e.totalCost, 0);

    const byWorkflow: Record<string, {runs: number; cost: number}> = {};
    const byAgent: Record<string, number> = {};

    for (const e of events) {
        if (!byWorkflow[e.workflow]) {
            byWorkflow[e.workflow] = {runs: 0, cost: 0};
        }
        byWorkflow[e.workflow].runs++;
        byWorkflow[e.workflow].cost += e.totalCost;

        for (const au of e.agentUsage) {
            byAgent[au.agent] = (byAgent[au.agent] || 0) + au.cost;
        }
    }

    return {
        days,
        totalRuns: events.length,
        totalCost,
        byWorkflow,
        byAgent,
    };
}
