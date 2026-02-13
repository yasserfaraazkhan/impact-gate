// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, readFileSync} from 'fs';
import {join} from 'path';
import type {PlanReport} from './plan.js';
import type {CalibrationSummary} from './feedback.js';
import {inferSubsystemFromTestPath} from './test_path.js';

export interface FlakyTestRecord {
    test: string;
    flakeRate: number;
    flakeRate7d?: number;
    flakeRate30d?: number;
    trend?: 'up' | 'down' | 'stable';
    subsystem?: string;
    owners?: string[];
    quarantine?: boolean;
    quarantineState?: 'none' | 'active' | 'retire-candidate';
    lastFailureAt?: string;
}

export interface FlakyManifest {
    schemaVersion?: string;
    tests: FlakyTestRecord[];
}

export interface QualityGateRecord {
    name: string;
    status: 'pass' | 'warn' | 'fail';
    details?: string;
}

export interface QualityGateManifest {
    schemaVersion?: string;
    gates: QualityGateRecord[];
}

export interface OperationalInsights {
    flaky?: {
        highRiskRecommendedTests: FlakyTestRecord[];
        quarantinedRecommendedTests: string[];
        ownerMentions?: string[];
    };
    qualityGates?: {
        failed: QualityGateRecord[];
        warnings: QualityGateRecord[];
    };
    calibration?: CalibrationSummary['overall'];
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

function subsystemForTest(test: string): string {
    return inferSubsystemFromTestPath(test);
}

function riskyRate(entry: FlakyTestRecord): number {
    if (entry.flakeRate30d !== undefined) {
        return entry.flakeRate30d;
    }
    return entry.flakeRate;
}

function loadFlakyManifest(appRoot: string): FlakyManifest | null {
    const path = join(appRoot, '.e2e-ai-agents', 'flaky-tests.json');
    return readJson<FlakyManifest>(path);
}

function loadQualityGates(appRoot: string): QualityGateManifest | null {
    const path = join(appRoot, '.e2e-ai-agents', 'quality-gates.json');
    return readJson<QualityGateManifest>(path);
}

function loadCalibration(appRoot: string): CalibrationSummary | null {
    const path = join(appRoot, '.e2e-ai-agents', 'calibration.json');
    return readJson<CalibrationSummary>(path);
}

export function applyOperationalInsights(plan: PlanReport, appRoot: string): PlanReport {
    const enhanced = {...plan} as PlanReport;
    const insights: OperationalInsights = {};

    const flaky = loadFlakyManifest(appRoot);
    if (flaky && Array.isArray(flaky.tests)) {
        const recommended = new Set(plan.recommendedTests.map(normalizeTestName));
        const risky = flaky.tests
            .filter((entry) => recommended.has(normalizeTestName(entry.test)) && riskyRate(entry) >= 0.2)
            .sort((a, b) => riskyRate(b) - riskyRate(a))
            .slice(0, 10);
        const quarantined = risky.filter((entry) => entry.quarantine).map((entry) => entry.test);
        const owners = Array.from(
            new Set(
                risky
                    .flatMap((entry) => entry.owners || [])
                    .filter(Boolean),
            ),
        );
        insights.flaky = {
            highRiskRecommendedTests: risky,
            quarantinedRecommendedTests: quarantined,
            ownerMentions: owners,
        };
        if (quarantined.length > 0) {
            enhanced.reasons = [...enhanced.reasons, `Quarantined flaky tests in recommendation: ${quarantined.join(', ')}`];
        }
        if (owners.length > 0) {
            enhanced.reasons = [...enhanced.reasons, `Subsystem owners to notify for flaky risk: ${owners.join(', ')}`];
        }
    }

    const gates = loadQualityGates(appRoot);
    if (gates && Array.isArray(gates.gates)) {
        const failed = gates.gates.filter((gate) => gate.status === 'fail');
        const warnings = gates.gates.filter((gate) => gate.status === 'warn');
        insights.qualityGates = {failed, warnings};
        if (failed.length > 0 && enhanced.runSet !== 'full') {
            enhanced.runSet = 'full';
            enhanced.reasons = [...enhanced.reasons, `Quality gates failed: ${failed.map((gate) => gate.name).join(', ')}`];
            enhanced.policy.triggeredRules = [...new Set([...enhanced.policy.triggeredRules, 'quality-gate-failed'])];
            enhanced.decision = {
                action: 'run-now',
                title: 'Run now',
                summary: 'Quality gate failures detected. Full suite is required before merge.',
            };
        }
    }

    const calibration = loadCalibration(appRoot);
    if (calibration) {
        insights.calibration = calibration.overall;
        if (calibration.overall.falseNegativeRate >= 0.2 && enhanced.runSet !== 'full') {
            enhanced.runSet = 'full';
            enhanced.reasons = [...enhanced.reasons, 'Historical false-negative rate is high; escalating to full suite.'];
            enhanced.policy.triggeredRules = [...new Set([...enhanced.policy.triggeredRules, 'historical-fnr-high'])];
        }

        const recommendedSubsystems = Array.from(new Set(plan.recommendedTests.map(subsystemForTest)));
        const highRiskSubsystems = recommendedSubsystems
            .map((subsystem) => {
                const metric = calibration.bySubsystem[subsystem];
                if (!metric) {
                    return null;
                }
                if (metric.samples < 5) {
                    return null;
                }
                if (metric.recent30d.falseNegativeRate >= 0.2 || metric.falseNegativeRate >= 0.25) {
                    return {subsystem, fnr: metric.recent30d.falseNegativeRate || metric.falseNegativeRate};
                }
                return null;
            })
            .filter(Boolean) as Array<{subsystem: string; fnr: number}>;

        if (highRiskSubsystems.length > 0 && enhanced.runSet !== 'full') {
            enhanced.runSet = 'full';
            enhanced.reasons = [
                ...enhanced.reasons,
                `Historical subsystem false-negative risk is high: ${highRiskSubsystems.map((entry) => `${entry.subsystem}(${entry.fnr})`).join(', ')}`,
            ];
            enhanced.policy.triggeredRules = [...new Set([...enhanced.policy.triggeredRules, 'subsystem-fnr-high'])];
            enhanced.decision = {
                action: 'run-now',
                title: 'Run now',
                summary: 'Subsystem calibration risk is high. Full suite is required before merge.',
            };
        }
    }

    enhanced.insights = insights;
    return enhanced;
}
