// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {inferSubsystemFromTestPath} from './test_path.js';

export interface RecommendationFeedbackEntry {
    timestamp: string;
    runSet: 'smoke' | 'targeted' | 'full';
    recommendedTests: string[];
    executedTests: string[];
    failedTests: string[];
    escapedFailures?: string[];
}

export interface CalibrationSummary {
    schemaVersion: '1.1.0';
    generatedAt: string;
    samples: number;
    overall: {
        precision: number;
        recall: number;
        falseNegativeRate: number;
    };
    recent7d: {
        precision: number;
        recall: number;
        falseNegativeRate: number;
        samples: number;
    };
    recent30d: {
        precision: number;
        recall: number;
        falseNegativeRate: number;
        samples: number;
    };
    bySubsystem: Record<
    string,
    {
        precision: number;
        recall: number;
        falseNegativeRate: number;
        samples: number;
        recent7d: {
            precision: number;
            recall: number;
            falseNegativeRate: number;
            samples: number;
        };
        recent30d: {
            precision: number;
            recall: number;
            falseNegativeRate: number;
            samples: number;
        };
    }
    >;
}

interface FeedbackStore {
    schemaVersion: '1.0.0';
    entries: RecommendationFeedbackEntry[];
}

interface FlakySummary {
    schemaVersion: '1.1.0';
    generatedAt: string;
    tests: Array<{
        test: string;
        subsystem: string;
        owners: string[];
        flakeRate: number;
        flakeRate7d: number;
        flakeRate30d: number;
        trend: 'up' | 'down' | 'stable';
        quarantine: boolean;
        quarantineState: 'none' | 'active' | 'retire-candidate';
        lastFailureAt?: string;
        samples: number;
        samples7d: number;
        samples30d: number;
    }>;
}

interface SubsystemOwnersManifest {
    schemaVersion?: string;
    ownersBySubsystem?: Record<string, string[]>;
    subsystems?: Record<string, string[]>;
}

function readJson<T>(path: string): T | null {
    if (!existsSync(path)) {
        return null;
    }
    try {
        return JSON.parse(readFileSync(path, 'utf-8')) as T;
    } catch {
        return null;
    }
}

function normalizeTestName(test: string): string {
    return test.replace(/ \(flags:.*\)$/, '').trim();
}

function asSet(values: string[]): Set<string> {
    return new Set(values.map(normalizeTestName).filter(Boolean));
}

function ratio(numerator: number, denominator: number): number {
    if (denominator <= 0) {
        return 0;
    }
    return Number((numerator / denominator).toFixed(4));
}

function subsystemForTest(test: string): string {
    return inferSubsystemFromTestPath(test);
}

function parseTimestamp(value: string): number | null {
    const time = Date.parse(value);
    if (Number.isNaN(time)) {
        return null;
    }
    return time;
}

function filterRecent(entries: RecommendationFeedbackEntry[], days: number): RecommendationFeedbackEntry[] {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return entries.filter((entry) => {
        const time = parseTimestamp(entry.timestamp);
        return time !== null && time >= cutoff;
    });
}

interface Metrics {
    precision: number;
    recall: number;
    falseNegativeRate: number;
    samples: number;
}

function aggregateMetrics(entries: RecommendationFeedbackEntry[]): Metrics {
    let truePositives = 0;
    let recommendedTotal = 0;
    let failuresTotal = 0;
    let escapedTotal = 0;

    for (const entry of entries) {
        const recommended = asSet(entry.recommendedTests || []);
        const failed = asSet(entry.failedTests || []);
        const escaped = asSet(entry.escapedFailures || []);
        const tp = Array.from(recommended).filter((test) => failed.has(test)).length;

        truePositives += tp;
        recommendedTotal += recommended.size;
        failuresTotal += failed.size;
        escapedTotal += escaped.size;
    }

    return {
        precision: ratio(truePositives, recommendedTotal),
        recall: ratio(truePositives, failuresTotal),
        falseNegativeRate: ratio(escapedTotal, failuresTotal + escapedTotal),
        samples: entries.length,
    };
}

function aggregate(entries: RecommendationFeedbackEntry[]): CalibrationSummary {
    const subsystemAcc = new Map<string, {entries: RecommendationFeedbackEntry[]}>();

    for (const entry of entries) {
        const recommended = asSet(entry.recommendedTests || []);
        const failed = asSet(entry.failedTests || []);
        const escaped = asSet(entry.escapedFailures || []);

        const allSubsystems = new Set<string>([
            ...Array.from(recommended).map(subsystemForTest),
            ...Array.from(failed).map(subsystemForTest),
            ...Array.from(escaped).map(subsystemForTest),
        ]);

        for (const subsystem of allSubsystems) {
            const bucket = subsystemAcc.get(subsystem) || {entries: []};
            bucket.entries.push({
                ...entry,
                recommendedTests: Array.from(recommended).filter((test) => subsystemForTest(test) === subsystem),
                executedTests: (entry.executedTests || []).filter((test) => subsystemForTest(test) === subsystem),
                failedTests: Array.from(failed).filter((test) => subsystemForTest(test) === subsystem),
                escapedFailures: Array.from(escaped).filter((test) => subsystemForTest(test) === subsystem),
            });
            subsystemAcc.set(subsystem, bucket);
        }
    }

    const bySubsystem: CalibrationSummary['bySubsystem'] = {};
    for (const [subsystem, bucket] of subsystemAcc.entries()) {
        const all = aggregateMetrics(bucket.entries);
        const recent7d = aggregateMetrics(filterRecent(bucket.entries, 7));
        const recent30d = aggregateMetrics(filterRecent(bucket.entries, 30));
        bySubsystem[subsystem] = {
            precision: all.precision,
            recall: all.recall,
            falseNegativeRate: all.falseNegativeRate,
            samples: all.samples,
            recent7d,
            recent30d,
        };
    }

    const overall = aggregateMetrics(entries);
    const recent7d = aggregateMetrics(filterRecent(entries, 7));
    const recent30d = aggregateMetrics(filterRecent(entries, 30));

    return {
        schemaVersion: '1.1.0',
        generatedAt: new Date().toISOString(),
        samples: entries.length,
        overall,
        recent7d,
        recent30d,
        bySubsystem,
    };
}

function rateFor(runs: number, failed: number): number {
    return runs > 0 ? Number((failed / runs).toFixed(4)) : 0;
}

function trendFor(rate7d: number, rate30d: number): 'up' | 'down' | 'stable' {
    if (rate7d - rate30d >= 0.08) {
        return 'up';
    }
    if (rate30d - rate7d >= 0.08) {
        return 'down';
    }
    return 'stable';
}

function loadOwners(appRoot: string): Record<string, string[]> {
    const path = join(appRoot, '.e2e-ai-agents', 'subsystem-owners.json');
    const manifest = readJson<SubsystemOwnersManifest>(path);
    if (!manifest) {
        return {};
    }
    if (manifest.ownersBySubsystem) {
        return manifest.ownersBySubsystem;
    }
    if (manifest.subsystems) {
        return manifest.subsystems;
    }
    return {};
}

function daysSince(value?: string): number | null {
    if (!value) {
        return null;
    }
    const time = parseTimestamp(value);
    if (time === null) {
        return null;
    }
    return (Date.now() - time) / (24 * 60 * 60 * 1000);
}

function aggregateFlaky(entries: RecommendationFeedbackEntry[], appRoot: string): FlakySummary {
    const acc = new Map<string, {runs: number; failed: number; runs7d: number; failed7d: number; runs30d: number; failed30d: number; lastFailureAt?: string}>();
    const cutoff7 = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const cutoff30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const ownersBySubsystem = loadOwners(appRoot);

    for (const entry of entries) {
        const executed = asSet(entry.executedTests || []);
        const failed = asSet(entry.failedTests || []);
        const time = parseTimestamp(entry.timestamp);
        for (const test of executed) {
            const bucket = acc.get(test) || {
                runs: 0,
                failed: 0,
                runs7d: 0,
                failed7d: 0,
                runs30d: 0,
                failed30d: 0,
                lastFailureAt: undefined,
            };
            bucket.runs += 1;
            if (time !== null && time >= cutoff7) {
                bucket.runs7d += 1;
            }
            if (time !== null && time >= cutoff30) {
                bucket.runs30d += 1;
            }
            if (failed.has(test)) {
                bucket.failed += 1;
                bucket.lastFailureAt = entry.timestamp;
                if (time !== null && time >= cutoff7) {
                    bucket.failed7d += 1;
                }
                if (time !== null && time >= cutoff30) {
                    bucket.failed30d += 1;
                }
            }
            acc.set(test, bucket);
        }
    }

    const tests = Array.from(acc.entries())
        .map(([test, bucket]) => {
            const flakeRate = rateFor(bucket.runs, bucket.failed);
            const flakeRate7d = rateFor(bucket.runs7d, bucket.failed7d);
            const flakeRate30d = rateFor(bucket.runs30d, bucket.failed30d);
            const trend = trendFor(flakeRate7d, flakeRate30d);
            const quarantine = (bucket.runs30d >= 5 && flakeRate30d >= 0.35) || (bucket.runs >= 8 && flakeRate >= 0.4);
            const daysFromLastFailure = daysSince(bucket.lastFailureAt);
            const quarantineState: 'none' | 'active' | 'retire-candidate' =
                quarantine
                    ? (daysFromLastFailure !== null && daysFromLastFailure >= 14 && flakeRate7d <= 0.05 ? 'retire-candidate' : 'active')
                    : 'none';
            const subsystem = subsystemForTest(test);
            const owners = ownersBySubsystem[subsystem] || [];
            return {
                test,
                subsystem,
                owners,
                flakeRate,
                flakeRate7d,
                flakeRate30d,
                trend,
                quarantine,
                quarantineState,
                lastFailureAt: bucket.lastFailureAt,
                samples: bucket.runs,
                samples7d: bucket.runs7d,
                samples30d: bucket.runs30d,
            };
        })
        .filter((entry) => entry.flakeRate > 0)
        .sort((a, b) => (b.flakeRate30d || b.flakeRate) - (a.flakeRate30d || a.flakeRate));

    return {
        schemaVersion: '1.1.0',
        generatedAt: new Date().toISOString(),
        tests,
    };
}

export function appendFeedbackAndRecompute(
    appRoot: string,
    input: RecommendationFeedbackEntry,
): {feedbackPath: string; calibrationPath: string; calibration: CalibrationSummary} {
    const baseDir = join(appRoot, '.e2e-ai-agents');
    mkdirSync(baseDir, {recursive: true});

    const feedbackPath = join(baseDir, 'feedback.json');
    const existing = readJson<FeedbackStore>(feedbackPath) || {schemaVersion: '1.0.0', entries: []};
    existing.entries.push({
        ...input,
        recommendedTests: input.recommendedTests || [],
        executedTests: input.executedTests || [],
        failedTests: input.failedTests || [],
        escapedFailures: input.escapedFailures || [],
    });
    writeFileSync(feedbackPath, JSON.stringify(existing, null, 2), 'utf-8');

    const calibration = aggregate(existing.entries);
    const calibrationPath = join(baseDir, 'calibration.json');
    writeFileSync(calibrationPath, JSON.stringify(calibration, null, 2), 'utf-8');

    const flaky = aggregateFlaky(existing.entries, appRoot);
    const flakyPath = join(baseDir, 'flaky-tests.json');
    writeFileSync(flakyPath, JSON.stringify(flaky, null, 2), 'utf-8');

    return {feedbackPath, calibrationPath, calibration};
}

export function readCalibration(appRoot: string): CalibrationSummary | null {
    return readJson<CalibrationSummary>(join(appRoot, '.e2e-ai-agents', 'calibration.json'));
}
