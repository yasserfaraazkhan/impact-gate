// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Telemetry Collection System (Phase A2)
 *
 * Tracks costs, performance, and success metrics for test generation operations.
 * Provides visibility into:
 * - Cost per operation (input/output tokens * model rate)
 * - Model usage breakdown (Haiku, Sonnet, Opus)
 * - Success rate by operation
 * - Performance metrics (duration, tokens used)
 *
 * Data stored in: `.e2e-ai-agents/metrics/YYYY-MM-DD.json`
 */

import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'fs';
import {join} from 'path';
import {randomUUID} from 'crypto';

export interface GenerationMetric {
    id: string; // Unique ID for tracing
    timestamp: string; // ISO 8601 timestamp
    operation: 'explore' | 'generate' | 'heal' | 'validate' | 'score' | 'pdf-parse';
    model: string; // e.g., claude-haiku-4-5-20250929
    tokensInput: number; // Prompt tokens
    tokensOutput: number; // Completion tokens
    costUsd: number; // Calculated cost
    durationMs: number; // How long the operation took
    success: boolean;
    errorType?: string; // e.g., 'timeout', 'api_error'
    errorMessage?: string;
    metadata?: Record<string, unknown>;
}

export interface TelemetryReport {
    period: {start: string; end: string};
    summary: {
        totalOperations: number;
        successCount: number;
        failureCount: number;
        successRate: number; // 0-100%
        totalCost: number; // Total USD cost
        avgCost: number; // Per operation
        totalTokens: number;
        avgDuration: number; // In seconds
    };
    byModel: Record<
        string,
        {
            count: number;
            totalCost: number;
            avgCost: number;
            successRate: number;
        }
    >;
    byOperation: Record<
        string,
        {
            count: number;
            totalCost: number;
            avgDuration: number;
            successRate: number;
        }
    >;
}

const MODEL_RATES: Record<string, number> = {
    'claude-haiku-4-0-20250430': 0.25 / 1_000_000, // per input token
    'claude-sonnet-4-5-20250929': 3 / 1_000_000,
    'claude-opus-4-6-20250820': 15 / 1_000_000,
};

export class TelemetryCollector {
    private metricsDir: string;
    private metrics: Map<string, GenerationMetric[]> = new Map();

    constructor(metricsDir: string = '.e2e-ai-agents/metrics') {
        this.metricsDir = metricsDir;
        this.ensureMetricsDir();
        this.loadTodayMetrics();
    }

    /**
     * Ensure metrics directory exists
     */
    private ensureMetricsDir(): void {
        if (!existsSync(this.metricsDir)) {
            mkdirSync(this.metricsDir, {recursive: true});
        }
    }

    /**
     * Get today's metrics file path
     */
    private getTodayPath(): string {
        const now = new Date();
        const date = now.toISOString().split('T')[0]; // YYYY-MM-DD
        return join(this.metricsDir, `${date}.json`);
    }

    /**
     * Load metrics from disk
     */
    private loadTodayMetrics(): void {
        const path = this.getTodayPath();
        if (existsSync(path)) {
            try {
                const data = JSON.parse(readFileSync(path, 'utf-8'));
                this.metrics.set(path, data);
            } catch (error) {
                console.error(`Failed to load metrics from ${path}:`, error);
            }
        }
    }

    /**
     * Track a metric
     */
    track(metric: Omit<GenerationMetric, 'id'>): void {
        const fullMetric: GenerationMetric = {
            id: randomUUID().substring(0, 8),
            ...metric,
        };

        const path = this.getTodayPath();
        const metrics = this.metrics.get(path) || [];
        metrics.push(fullMetric);
        this.metrics.set(path, metrics);

        // Persist to disk
        this.saveMetrics();
    }

    /**
     * Save metrics to disk
     */
    private saveMetrics(): void {
        this.metrics.forEach((metrics, path) => {
            writeFileSync(path, JSON.stringify(metrics, null, 2), 'utf-8');
        });
    }

    /**
     * Calculate cost for a metric
     */
    static calculateCost(model: string, tokensInput: number, tokensOutput: number): number {
        const inputRate = MODEL_RATES[model] || 0.003 / 1_000_000; // Default estimate
        const outputRate = inputRate * 3; // Output usually 3x input cost
        return tokensInput * inputRate + tokensOutput * outputRate;
    }

    /**
     * Generate report for a date range
     */
    generateReport(since?: Date, until?: Date): TelemetryReport {
        const start = since || new Date(new Date().setDate(new Date().getDate() - 7)); // Default: last 7 days
        const end = until || new Date();

        // Collect all metrics in date range
        const allMetrics: GenerationMetric[] = [];
        this.metrics.forEach((metrics) => {
            metrics.forEach((m) => {
                const metricDate = new Date(m.timestamp);
                if (metricDate >= start && metricDate <= end) {
                    allMetrics.push(m);
                }
            });
        });

        // Calculate summary
        const successCount = allMetrics.filter((m) => m.success).length;
        const failureCount = allMetrics.length - successCount;
        const totalCost = allMetrics.reduce((sum, m) => sum + m.costUsd, 0);
        const avgCost = allMetrics.length > 0 ? totalCost / allMetrics.length : 0;
        const totalTokens = allMetrics.reduce((sum, m) => sum + (m.tokensInput + m.tokensOutput), 0);
        const avgDuration =
            allMetrics.length > 0 ? allMetrics.reduce((sum, m) => sum + m.durationMs, 0) / allMetrics.length / 1000 : 0;

        // By model
        const byModel: Record<string, any> = {};
        allMetrics.forEach((m) => {
            if (!byModel[m.model]) {
                byModel[m.model] = {count: 0, totalCost: 0, successCount: 0};
            }
            byModel[m.model].count += 1;
            byModel[m.model].totalCost += m.costUsd;
            if (m.success) byModel[m.model].successCount += 1;
        });

        Object.keys(byModel).forEach((model) => {
            const data = byModel[model];
            byModel[model] = {
                count: data.count,
                totalCost: data.totalCost,
                avgCost: data.totalCost / data.count,
                successRate: (data.successCount / data.count) * 100,
            };
        });

        // By operation
        const byOperation: Record<string, any> = {};
        allMetrics.forEach((m) => {
            if (!byOperation[m.operation]) {
                byOperation[m.operation] = {count: 0, totalCost: 0, totalDuration: 0, successCount: 0};
            }
            byOperation[m.operation].count += 1;
            byOperation[m.operation].totalCost += m.costUsd;
            byOperation[m.operation].totalDuration += m.durationMs;
            if (m.success) byOperation[m.operation].successCount += 1;
        });

        Object.keys(byOperation).forEach((op) => {
            const data = byOperation[op];
            byOperation[op] = {
                count: data.count,
                totalCost: data.totalCost,
                avgDuration: data.totalDuration / data.count / 1000,
                successRate: (data.successCount / data.count) * 100,
            };
        });

        return {
            period: {
                start: start.toISOString().split('T')[0],
                end: end.toISOString().split('T')[0],
            },
            summary: {
                totalOperations: allMetrics.length,
                successCount,
                failureCount,
                successRate: allMetrics.length > 0 ? (successCount / allMetrics.length) * 100 : 0,
                totalCost,
                avgCost,
                totalTokens,
                avgDuration,
            },
            byModel,
            byOperation,
        };
    }

    /**
     * Format report for console output
     */
    static formatReport(report: TelemetryReport): string {
        const lines: string[] = [
            '',
            '📊 Test Generation Metrics',
            `Period: ${report.period.start} to ${report.period.end}`,
            '═'.repeat(50),
            '',
            `Total Operations: ${report.summary.totalOperations}`,
            `Success Rate: ${report.summary.successRate.toFixed(1)}% (${report.summary.successCount}/${report.summary.totalOperations})`,
            `Total Cost: $${report.summary.totalCost.toFixed(2)}`,
            `Avg Cost/Op: $${report.summary.avgCost.toFixed(4)}`,
            `Avg Duration: ${report.summary.avgDuration.toFixed(1)}s`,
            `Total Tokens: ${report.summary.totalTokens.toLocaleString()}`,
            '',
            'Model Usage:',
        ];

        Object.entries(report.byModel).forEach(([model, data]) => {
            const shortName = model.includes('haiku') ? 'Haiku' : model.includes('sonnet') ? 'Sonnet' : 'Opus';
            lines.push(
                `  ${shortName}: ${data.count} ops - $${data.totalCost.toFixed(2)} (avg $${data.avgCost.toFixed(4)}, ${data.successRate.toFixed(0)}% success)`,
            );
        });

        lines.push('', 'By Operation:');
        Object.entries(report.byOperation).forEach(([op, data]) => {
            lines.push(
                `  ${op}: ${data.count} ops - $${data.totalCost.toFixed(2)} (${data.avgDuration.toFixed(1)}s avg, ${data.successRate.toFixed(0)}% success)`,
            );
        });

        lines.push('');
        return lines.join('\n');
    }

    /**
     * Export metrics as JSON
     */
    exportJson(filepath: string): void {
        const allMetrics: GenerationMetric[] = [];
        this.metrics.forEach((metrics) => {
            allMetrics.push(...metrics);
        });
        writeFileSync(filepath, JSON.stringify(allMetrics, null, 2), 'utf-8');
        console.log(`  ✓ Exported ${allMetrics.length} metrics to ${filepath}`);
    }
}
