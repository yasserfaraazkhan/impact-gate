// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Regression Advisor Agent — identifies historically regression-prone areas
 * using traceability data and advises the Strategist on risk scores.
 * Mostly deterministic (traceability data analysis), with optional LLM enrichment.
 */

import {readCalibration, readFlakyTests} from '../agent/feedback.js';
import type {Agent, AgentTask, AgentResult} from '../crew/protocol.js';
import type {CrewContext} from '../crew/context.js';
import type {AgentRole, RegressionRisk} from '../crew/types.js';

export class RegressionAdvisorAgent implements Agent {
    readonly role: AgentRole = 'regression-advisor';

    async execute(_task: AgentTask, ctx: CrewContext): Promise<AgentResult> {
        const warnings: string[] = [];
        const risks: RegressionRisk[] = [];

        // Analyze calibration data for historical failure patterns
        const calibration = readCalibration(ctx.testsRoot);
        const flakyData = readFlakyTests(ctx.testsRoot);

        // Build risk from flaky test data
        if (flakyData && flakyData.tests.length > 0) {
            const flakyByFamily = new Map<string, number>();
            for (const test of flakyData.tests) {
                // Use subsystem field as family identifier
                if (test.subsystem) {
                    flakyByFamily.set(test.subsystem, (flakyByFamily.get(test.subsystem) || 0) + 1);
                }
            }

            for (const [familyId, count] of flakyByFamily) {
                const isImpacted = ctx.familyGroups.some((g) => g.familyId === familyId);
                if (isImpacted) {
                    risks.push({
                        familyId,
                        filePattern: '*',
                        riskScore: Math.min(100, count * 15),
                        reason: `${count} flaky test(s) historically in this family`,
                        historicalFailures: count,
                    });
                }
            }
        }

        // Build risk from calibration data (subsystem-level precision/recall)
        if (calibration && calibration.bySubsystem) {
            for (const [subsystem, metrics] of Object.entries(calibration.bySubsystem)) {
                const isImpacted = ctx.familyGroups.some((g) => g.familyId === subsystem);
                if (!isImpacted) continue;

                // Low precision means many false positives — the subsystem is noisy
                if (metrics.precision < 0.5 && metrics.samples >= 3) {
                    const existing = risks.find((r) => r.familyId === subsystem);
                    const lowPrecisionScore = Math.round((1 - metrics.precision) * 30);
                    if (existing) {
                        existing.riskScore = Math.min(100, existing.riskScore + lowPrecisionScore);
                        existing.reason += `; low calibration precision (${(metrics.precision * 100).toFixed(0)}%)`;
                    } else {
                        risks.push({
                            familyId: subsystem,
                            filePattern: '*',
                            riskScore: lowPrecisionScore,
                            reason: `Low calibration precision (${(metrics.precision * 100).toFixed(0)}%) — historically noisy subsystem`,
                            historicalFailures: metrics.samples,
                        });
                    }
                }
            }
        }

        // Analyze changed files for known regression-prone patterns
        for (const group of ctx.familyGroups) {
            const hasApiChange = group.files.some((f) =>
                f.path.includes('/api/') || f.path.includes('/actions/') || f.path.includes('/reducers/'),
            );
            const hasAuthChange = group.files.some((f) =>
                f.path.includes('auth') || f.path.includes('login') || f.path.includes('session'),
            );
            const hasDBChange = group.files.some((f) =>
                f.path.includes('/store/') || f.path.includes('/model/') || f.path.includes('migration'),
            );

            if (hasApiChange || hasAuthChange || hasDBChange) {
                const existing = risks.find((r) => r.familyId === group.familyId);
                const patterns = [
                    hasApiChange && 'API changes',
                    hasAuthChange && 'auth changes',
                    hasDBChange && 'data model changes',
                ].filter(Boolean).join(', ');

                if (existing) {
                    existing.riskScore = Math.min(100, existing.riskScore + 20);
                    existing.reason += `; regression-prone patterns: ${patterns}`;
                } else {
                    risks.push({
                        familyId: group.familyId,
                        filePattern: group.files.map((f) => f.path).join(', '),
                        riskScore: 30,
                        reason: `Regression-prone file patterns detected: ${patterns}`,
                        historicalFailures: 0,
                    });
                }
            }
        }

        ctx.regressionRisks = risks;

        if (risks.length === 0) {
            warnings.push('Regression advisor: no historical risk data found.');
        }

        return {
            role: this.role,
            status: risks.length > 0 ? 'success' : 'partial',
            output: risks,
            warnings,
        };
    }

    private extractFamilyFromPath(specPath: string, ctx: CrewContext): string | null {
        const normalized = specPath.replace(/\\/g, '/');
        for (const family of ctx.routeFamilies) {
            const specDirs = [...(family.specDirs || []), ...(family.cypressSpecDirs || [])];
            if (specDirs.some((dir) => normalized.includes(dir))) {
                return family.id;
            }
        }
        return null;
    }
}
