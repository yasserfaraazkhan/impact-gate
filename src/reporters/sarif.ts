// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * SARIF v2.1.0 reporter — maps crew results to Static Analysis Results
 * Interchange Format for GitHub Advanced Security / Azure DevOps.
 */

import type {CrewResults, Reporter} from './reporter.js';

type SarifLevel = 'error' | 'warning' | 'note' | 'none';

interface SarifResult {
    ruleId: string;
    level: SarifLevel;
    message: {text: string};
    properties?: Record<string, unknown>;
}

interface SarifRun {
    tool: {
        driver: {
            name: string;
            version: string;
            informationUri: string;
            rules: Array<{
                id: string;
                shortDescription: {text: string};
                defaultConfiguration: {level: SarifLevel};
            }>;
        };
    };
    results: SarifResult[];
    invocations: Array<{
        executionSuccessful: boolean;
        properties: Record<string, unknown>;
    }>;
}

function severityToLevel(severity: string): SarifLevel {
    switch (severity.toLowerCase()) {
        case 'high':
        case 'critical':
            return 'error';
        case 'medium':
            return 'warning';
        case 'low':
        case 'info':
            return 'note';
        default:
            return 'note';
    }
}

function riskToLevel(risk: string): SarifLevel {
    switch (risk.toLowerCase()) {
        case 'high':
            return 'warning';
        case 'medium':
            return 'note';
        default:
            return 'none';
    }
}

export const sarifReporter: Reporter = {
    name: 'sarif',
    extension: '.sarif',

    format(results: CrewResults): string {
        const rules: SarifRun['tool']['driver']['rules'] = [];
        const sarifResults: SarifResult[] = [];
        const ruleIds = new Set<string>();

        function ensureRule(id: string, description: string, level: SarifLevel): void {
            if (!ruleIds.has(id)) {
                ruleIds.add(id);
                rules.push({
                    id,
                    shortDescription: {text: description},
                    defaultConfiguration: {level},
                });
            }
        }

        // Findings -> results
        for (const finding of results.findings) {
            const level = severityToLevel(finding.severity);
            const ruleId = `finding/${finding.severity}`;
            ensureRule(ruleId, `Finding (${finding.severity})`, level);

            sarifResults.push({
                ruleId,
                level,
                message: {text: `${finding.title}: ${finding.description}`},
                properties: {
                    severity: finding.severity,
                },
            });
        }

        // Strategy entries without matching test designs -> coverage gap results
        const designedFlows = new Set(results.testDesigns.map((d) => d.flowName));
        for (const entry of results.strategyEntries) {
            if (!designedFlows.has(entry.flowName)) {
                const ruleId = 'coverage/gap';
                ensureRule(ruleId, 'Missing test coverage for impacted flow', 'warning');

                sarifResults.push({
                    ruleId,
                    level: 'warning',
                    message: {
                        text: `Flow "${entry.flowName}" (${entry.flowId}) has strategy but no test design. ` +
                              `Priority: ${entry.priority}, approach: ${entry.approach}.`,
                    },
                    properties: {
                        flowId: entry.flowId,
                        priority: entry.priority,
                    },
                });
            }
        }

        // High-risk cross-impacts -> warning results
        for (const impact of results.crossImpacts) {
            const level = riskToLevel(impact.riskLevel);
            if (level === 'none') {
                continue;
            }

            const ruleId = `cross-impact/${impact.riskLevel}`;
            ensureRule(ruleId, `Cross-impact (${impact.riskLevel} risk)`, level);

            sarifResults.push({
                ruleId,
                level,
                message: {
                    text: `Cross-impact: "${impact.sourceFamily}" affects "${impact.affectedFamily}" ` +
                          `with ${impact.riskLevel} risk.`,
                },
                properties: {
                    sourceFamily: impact.sourceFamily,
                    affectedFamily: impact.affectedFamily,
                    riskLevel: impact.riskLevel,
                },
            });
        }

        const run: SarifRun = {
            tool: {
                driver: {
                    name: 'e2e-agents',
                    version: '1.8.5',
                    informationUri: 'https://github.com/mattermost/e2e-agents',
                    rules,
                },
            },
            results: sarifResults,
            invocations: [
                {
                    executionSuccessful: true,
                    properties: {
                        workflow: results.workflow,
                        changedFiles: results.changedFiles,
                        impactedFlows: results.impactedFlows,
                        cost: results.cost,
                        tokens: results.tokens,
                        warnings: results.warnings,
                    },
                },
            ],
        };

        const sarif = {
            $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
            version: '2.1.0' as const,
            runs: [run],
        };

        return JSON.stringify(sarif, null, 2) + '\n';
    },
};
