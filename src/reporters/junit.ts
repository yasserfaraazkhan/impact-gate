// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * JUnit XML reporter — maps crew results to JUnit format for Jenkins/GitLab CI.
 */

import type {CrewResults, Reporter} from './reporter.js';

function escapeXml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function buildTestCase(tc: {name: string; type: string; priority: string}, flowName: string): string {
    const className = escapeXml(flowName.replace(/\s+/g, '.'));
    const testName = escapeXml(tc.name);
    return `      <testcase classname="${className}" name="${testName}" status="${escapeXml(tc.priority)}">\n` +
           `        <properties>\n` +
           `          <property name="type" value="${escapeXml(tc.type)}" />\n` +
           `          <property name="priority" value="${escapeXml(tc.priority)}" />\n` +
           `        </properties>\n` +
           `      </testcase>`;
}

function buildFailureCase(finding: {title: string; severity: string; description: string}): string {
    const name = escapeXml(finding.title);
    return `      <testcase classname="findings" name="${name}">\n` +
           `        <failure message="${escapeXml(finding.title)}" type="${escapeXml(finding.severity)}">${escapeXml(finding.description)}</failure>\n` +
           `      </testcase>`;
}

export const junitReporter: Reporter = {
    name: 'junit',
    extension: '.xml',

    format(results: CrewResults): string {
        const suites: string[] = [];

        // Build a lookup from flowName -> test cases
        const designsByFlow = new Map<string, Array<{name: string; type: string; priority: string}>>();
        for (const design of results.testDesigns) {
            designsByFlow.set(design.flowName, design.testCases);
        }

        // High-severity findings as failure cases
        const highFindings = results.findings.filter((f) => f.severity === 'high');

        // Each strategy entry becomes a test suite
        for (const entry of results.strategyEntries) {
            const testCases = designsByFlow.get(entry.flowName) ?? [];
            const failures = highFindings.filter((f) => f.title.includes(entry.flowName));
            const totalTests = testCases.length + failures.length;

            const casesXml = testCases.map((tc) => buildTestCase(tc, entry.flowName)).join('\n');
            const failuresXml = failures.map((f) => buildFailureCase(f)).join('\n');
            const allCases = [casesXml, failuresXml].filter(Boolean).join('\n');

            // Warnings as system-out
            const warningsText = results.warnings.length > 0
                ? `      <system-out>${escapeXml(results.warnings.join('\n'))}</system-out>`
                : '';

            suites.push(
                `    <testsuite name="${escapeXml(entry.flowName)}" tests="${totalTests}" failures="${failures.length}" ` +
                `id="${escapeXml(entry.flowId)}">\n` +
                `      <properties>\n` +
                `        <property name="priority" value="${escapeXml(entry.priority)}" />\n` +
                `        <property name="approach" value="${escapeXml(entry.approach)}" />\n` +
                `        <property name="rationale" value="${escapeXml(entry.rationale)}" />\n` +
                `      </properties>\n` +
                (allCases ? allCases + '\n' : '') +
                (warningsText ? warningsText + '\n' : '') +
                `    </testsuite>`,
            );
        }

        // Remaining high findings not tied to a strategy entry
        const coveredFlowNames = new Set(results.strategyEntries.map((e) => e.flowName));
        const uncoveredFindings = highFindings.filter((f) => !Array.from(coveredFlowNames).some((name) => f.title.includes(name)));
        if (uncoveredFindings.length > 0) {
            const failureCases = uncoveredFindings.map((f) => buildFailureCase(f)).join('\n');
            suites.push(
                `    <testsuite name="findings" tests="${uncoveredFindings.length}" failures="${uncoveredFindings.length}">\n` +
                failureCases + '\n' +
                `    </testsuite>`,
            );
        }

        const totalTests = results.testDesigns.reduce((sum, d) => sum + d.testCases.length, 0) + highFindings.length;
        const totalFailures = highFindings.length;

        return `<?xml version="1.0" encoding="UTF-8"?>\n` +
               `<testsuites name="impact-gate: ${escapeXml(results.workflow)}" ` +
               `tests="${totalTests}" failures="${totalFailures}" ` +
               `time="0">\n` +
               `  <properties>\n` +
               `    <property name="changedFiles" value="${results.changedFiles}" />\n` +
               `    <property name="impactedFlows" value="${results.impactedFlows}" />\n` +
               `    <property name="cost" value="${results.cost}" />\n` +
               `    <property name="tokens" value="${results.tokens}" />\n` +
               `  </properties>\n` +
               suites.join('\n') + '\n' +
               `</testsuites>\n`;
    },
};
