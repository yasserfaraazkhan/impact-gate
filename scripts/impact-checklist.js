#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const RUN_SETS = new Set(['smoke', 'targeted', 'full']);
const ACTIONS = new Set(['run-now', 'must-add-tests', 'safe-to-merge']);
const PRIORITIES = new Set(['P0', 'P1', 'P2']);

function usage() {
    console.log([
        'Usage:',
        '  node scripts/impact-checklist.js [options]',
        '',
        'Options:',
        '  --root <path>       Root where .e2e-ai-agents lives (default: cwd)',
        '  --impact <path>     Path to impact.json (default: <root>/.e2e-ai-agents/impact.json)',
        '  --plan <path>       Path to plan.json (default: <root>/.e2e-ai-agents/plan.json)',
        '  --out <path>        Output path for checklist report (default: <root>/.e2e-ai-agents/impact-checklist.json)',
        '  --strict            Exit non-zero on warnings',
        '  --help              Show help',
    ].join('\n'));
}

function parseArgs(argv) {
    const args = {
        root: process.cwd(),
        strict: false,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        const next = argv[i + 1];
        if (arg === '--help' || arg === '-h') {
            args.help = true;
            continue;
        }
        if (arg === '--strict') {
            args.strict = true;
            continue;
        }
        if (arg === '--root' && next) {
            args.root = path.resolve(next);
            i += 1;
            continue;
        }
        if (arg === '--impact' && next) {
            args.impactPath = path.resolve(next);
            i += 1;
            continue;
        }
        if (arg === '--plan' && next) {
            args.planPath = path.resolve(next);
            i += 1;
            continue;
        }
        if (arg === '--out' && next) {
            args.outPath = path.resolve(next);
            i += 1;
            continue;
        }
    }

    return args;
}

function readJson(filePath) {
    if (!fs.existsSync(filePath)) {
        return {ok: false, error: `File not found: ${filePath}`};
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return {ok: true, value: parsed};
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {ok: false, error: `Invalid JSON in ${filePath}: ${message}`};
    }
}

function flowCounts(flows) {
    const counts = {P0: 0, P1: 0, P2: 0};
    for (const flow of flows || []) {
        if (counts[flow.priority] !== undefined) {
            counts[flow.priority] += 1;
        }
    }
    return counts;
}

function validateImpactReport(impact, checks) {
    if (!impact || typeof impact !== 'object') {
        checks.push({id: 'impact-object', area: 'outputs', status: 'fail', message: 'impact.json must be an object.'});
        return;
    }

    if (impact.mode !== 'impact') {
        checks.push({id: 'impact-mode', area: 'outputs', status: 'fail', message: `impact.mode must be "impact", got "${impact.mode}".`});
    } else {
        checks.push({id: 'impact-mode', area: 'outputs', status: 'pass', message: 'impact.mode is valid.'});
    }

    if (!Array.isArray(impact.changedFiles)) {
        checks.push({id: 'impact-changed-files', area: 'inputs', status: 'fail', message: 'impact.changedFiles must be an array.'});
    } else if (impact.changedFiles.length === 0) {
        checks.push({id: 'impact-changed-files', area: 'inputs', status: 'warn', message: 'No changed files were captured.'});
    } else {
        checks.push({id: 'impact-changed-files', area: 'inputs', status: 'pass', message: `Captured ${impact.changedFiles.length} changed file(s).`});
    }

    if (!Array.isArray(impact.flows)) {
        checks.push({id: 'impact-flows', area: 'outputs', status: 'fail', message: 'impact.flows must be an array.'});
    } else if (impact.flows.length === 0) {
        checks.push({id: 'impact-flows', area: 'outputs', status: 'fail', message: 'impact.flows is empty; no impact surface was identified.'});
    } else {
        checks.push({id: 'impact-flows', area: 'outputs', status: 'pass', message: `Captured ${impact.flows.length} impacted flow(s).`});
    }

    if (!Array.isArray(impact.warnings)) {
        checks.push({id: 'impact-warnings-shape', area: 'outputs', status: 'fail', message: 'impact.warnings must be an array.'});
    } else if (impact.warnings.length > 0) {
        checks.push({id: 'impact-warnings', area: 'inputs', status: 'warn', message: `${impact.warnings.length} warning(s) emitted by impact analysis.`});
    } else {
        checks.push({id: 'impact-warnings', area: 'inputs', status: 'pass', message: 'No impact warnings detected.'});
    }

    if (!impact.runMetadata || typeof impact.runMetadata !== 'object') {
        checks.push({id: 'impact-run-metadata', area: 'inputs', status: 'warn', message: 'impact.runMetadata is missing.'});
    } else {
        const requiredMetadata = ['runId', 'startedAt', 'completedAt', 'durationMs', 'sinceRef', 'appPath', 'testsRoot'];
        const missing = requiredMetadata.filter((key) => impact.runMetadata[key] === undefined || impact.runMetadata[key] === null || impact.runMetadata[key] === '');
        if (missing.length > 0) {
            checks.push({
                id: 'impact-run-metadata',
                area: 'inputs',
                status: 'warn',
                message: `impact.runMetadata is missing fields: ${missing.join(', ')}`,
            });
        } else {
            checks.push({id: 'impact-run-metadata', area: 'inputs', status: 'pass', message: 'Run metadata fields are populated.'});
        }
    }

    const invalidFlows = (impact.flows || []).filter((flow) => (
        !flow || typeof flow.id !== 'string' || !PRIORITIES.has(flow.priority) || typeof flow.score !== 'number' || !Array.isArray(flow.files)
    ));
    if (invalidFlows.length > 0) {
        checks.push({
            id: 'impact-flow-shape',
            area: 'scoring',
            status: 'fail',
            message: `${invalidFlows.length} flow(s) are missing required scoring fields.`,
        });
    } else if (Array.isArray(impact.flows) && impact.flows.length > 0) {
        checks.push({id: 'impact-flow-shape', area: 'scoring', status: 'pass', message: 'Flow scoring fields are populated.'});
    }

    if (!impact.impactModel || typeof impact.impactModel !== 'object') {
        checks.push({id: 'impact-model', area: 'inputs', status: 'warn', message: 'impact.impactModel metadata is missing.'});
        return;
    }

    if (impact.impactModel.schemaVersion !== '1.0.0') {
        checks.push({id: 'impact-model-version', area: 'outputs', status: 'warn', message: `impactModel.schemaVersion expected "1.0.0", got "${impact.impactModel.schemaVersion}".`});
    } else {
        checks.push({id: 'impact-model-version', area: 'outputs', status: 'pass', message: 'impactModel schema version is valid.'});
    }

    if (impact.impactModel.flowMapping === 'heuristic') {
        checks.push({id: 'impact-flow-mapping', area: 'inputs', status: 'warn', message: 'Flow mapping is heuristic (no catalog mapping).'});
    } else {
        checks.push({id: 'impact-flow-mapping', area: 'inputs', status: 'pass', message: `Flow mapping source is ${impact.impactModel.flowMapping}.`});
    }

    if (impact.impactModel.testMapping === 'heuristic') {
        checks.push({id: 'impact-test-mapping', area: 'inputs', status: 'warn', message: 'Test mapping is heuristic (no catalog/traceability mapping).'});
    } else {
        checks.push({id: 'impact-test-mapping', area: 'inputs', status: 'pass', message: `Test mapping source is ${impact.impactModel.testMapping}.`});
    }

    const traceability = impact.impactModel.traceability;
    if (traceability && traceability.enabled) {
        if (!traceability.manifestFound) {
            checks.push({id: 'traceability-manifest', area: 'inputs', status: 'warn', message: 'Traceability is enabled but manifest was not found.'});
        } else {
            checks.push({id: 'traceability-manifest', area: 'inputs', status: 'pass', message: 'Traceability manifest was found.'});
        }
        if (typeof traceability.coverageRatio === 'number' && traceability.coverageRatio < 0.4) {
            checks.push({
                id: 'traceability-coverage',
                area: 'inputs',
                status: 'warn',
                message: `Traceability coverage is low (${traceability.coverageRatio}).`,
            });
        } else if (typeof traceability.coverageRatio === 'number') {
            checks.push({
                id: 'traceability-coverage',
                area: 'inputs',
                status: 'pass',
                message: `Traceability coverage ratio is ${traceability.coverageRatio}.`,
            });
        }
    }

    const dependencyGraph = impact.impactModel.dependencyGraph;
    if (dependencyGraph && dependencyGraph.enabled && dependencyGraph.truncated) {
        checks.push({id: 'dependency-graph-truncated', area: 'inputs', status: 'warn', message: 'Dependency graph expansion was truncated.'});
    } else if (dependencyGraph && dependencyGraph.enabled) {
        checks.push({id: 'dependency-graph-truncated', area: 'inputs', status: 'pass', message: 'Dependency graph expansion completed without truncation.'});
    }
}

function evaluateExpectedRunSet(plan) {
    const triggers = plan?.policy?.triggeredRules;
    if (Array.isArray(triggers) && triggers.length > 0) {
        return 'full';
    }
    if (Array.isArray(plan?.recommendedTests) && plan.recommendedTests.length > 0) {
        return 'targeted';
    }
    return 'smoke';
}

function validatePlanReport(impact, plan, checks) {
    if (!plan || typeof plan !== 'object') {
        checks.push({id: 'plan-object', area: 'outputs', status: 'fail', message: 'plan.json must be an object.'});
        return;
    }

    if (plan.schemaVersion !== '1.0.0') {
        checks.push({id: 'plan-schema-version', area: 'outputs', status: 'fail', message: `plan.schemaVersion must be "1.0.0", got "${plan.schemaVersion}".`});
    } else {
        checks.push({id: 'plan-schema-version', area: 'outputs', status: 'pass', message: 'plan schema version is valid.'});
    }

    if (plan.source !== 'impact') {
        checks.push({id: 'plan-source', area: 'outputs', status: 'fail', message: `plan.source must be "impact", got "${plan.source}".`});
    } else {
        checks.push({id: 'plan-source', area: 'outputs', status: 'pass', message: 'plan source is impact.'});
    }

    if (!RUN_SETS.has(plan.runSet)) {
        checks.push({id: 'plan-run-set', area: 'test-selection', status: 'fail', message: `plan.runSet must be one of smoke|targeted|full, got "${plan.runSet}".`});
    } else {
        checks.push({id: 'plan-run-set', area: 'test-selection', status: 'pass', message: `plan.runSet is ${plan.runSet}.`});
    }

    if (!ACTIONS.has(plan?.decision?.action)) {
        checks.push({
            id: 'plan-decision-action',
            area: 'test-selection',
            status: 'fail',
            message: `plan.decision.action must be one of run-now|must-add-tests|safe-to-merge, got "${plan?.decision?.action}".`,
        });
    } else {
        checks.push({id: 'plan-decision-action', area: 'test-selection', status: 'pass', message: `plan.decision.action is ${plan.decision.action}.`});
    }

    const expectedRunSet = evaluateExpectedRunSet(plan);
    if (RUN_SETS.has(plan.runSet) && plan.runSet !== expectedRunSet) {
        checks.push({
            id: 'plan-run-set-rule',
            area: 'test-selection',
            status: 'fail',
            message: `plan.runSet expected "${expectedRunSet}" based on triggered rules/recommended tests, got "${plan.runSet}".`,
        });
    } else if (RUN_SETS.has(plan.runSet)) {
        checks.push({id: 'plan-run-set-rule', area: 'test-selection', status: 'pass', message: 'Run-set selection rule is internally consistent.'});
    }

    if (!Array.isArray(plan.recommendedTests)) {
        checks.push({id: 'plan-recommended-tests-shape', area: 'outputs', status: 'fail', message: 'plan.recommendedTests must be an array.'});
    }

    if (Array.isArray(plan.requiredNewTests) && Array.isArray(impact?.gaps) && plan.requiredNewTests.length !== impact.gaps.length) {
        checks.push({
            id: 'plan-required-tests-count',
            area: 'outputs',
            status: 'fail',
            message: `plan.requiredNewTests (${plan.requiredNewTests.length}) must match impact.gaps (${impact.gaps.length}).`,
        });
    } else if (Array.isArray(plan.requiredNewTests) && Array.isArray(impact?.gaps)) {
        checks.push({id: 'plan-required-tests-count', area: 'outputs', status: 'pass', message: 'requiredNewTests count matches impact gaps.'});
    }

    const impactRecommended = Array.isArray(impact?.recommendedTests) ? impact.recommendedTests : [];
    const planRecommended = Array.isArray(plan.recommendedTests) ? plan.recommendedTests : [];
    if (impactRecommended.length !== planRecommended.length) {
        checks.push({
            id: 'plan-recommended-tests-sync',
            area: 'outputs',
            status: 'warn',
            message: `recommendedTests count differs between impact (${impactRecommended.length}) and plan (${planRecommended.length}).`,
        });
    } else {
        checks.push({id: 'plan-recommended-tests-sync', area: 'outputs', status: 'pass', message: 'recommendedTests count matches impact report.'});
    }

    if (Array.isArray(impact?.gaps) && impact.gaps.length > 0 && plan?.decision?.action !== 'must-add-tests') {
        checks.push({
            id: 'plan-gap-action',
            area: 'test-selection',
            status: 'fail',
            message: 'Impact has P0/P1 gaps; decision.action must be "must-add-tests".',
        });
    } else if (Array.isArray(impact?.gaps) && impact.gaps.length > 0) {
        checks.push({id: 'plan-gap-action', area: 'test-selection', status: 'pass', message: 'Gap action is correctly set to must-add-tests.'});
    }

    if (plan?.decision?.action === 'safe-to-merge') {
        const safeConfidence = plan?.policy?.applied?.safeMergeMinConfidence;
        const validSafe =
            plan.runSet === 'smoke' &&
            typeof safeConfidence === 'number' &&
            typeof plan.confidence === 'number' &&
            plan.confidence >= safeConfidence &&
            Array.isArray(impact?.warnings) &&
            impact.warnings.length === 0 &&
            Array.isArray(impact?.gaps) &&
            impact.gaps.length === 0;
        if (!validSafe) {
            checks.push({
                id: 'plan-safe-to-merge-rule',
                area: 'test-selection',
                status: 'fail',
                message: 'safe-to-merge decision does not satisfy smoke/high-confidence/no-gap/no-warning policy conditions.',
            });
        } else {
            checks.push({id: 'plan-safe-to-merge-rule', area: 'test-selection', status: 'pass', message: 'safe-to-merge conditions are satisfied.'});
        }
    }

    if (plan?.policy?.triggeredRules?.includes('risky-files') && (!Array.isArray(plan?.policy?.riskyFiles) || plan.policy.riskyFiles.length === 0)) {
        checks.push({
            id: 'plan-risky-files-rule',
            area: 'test-selection',
            status: 'fail',
            message: 'Triggered rule "risky-files" requires at least one policy.riskyFiles entry.',
        });
    } else if (Array.isArray(plan?.policy?.triggeredRules) && plan.policy.triggeredRules.includes('risky-files')) {
        checks.push({id: 'plan-risky-files-rule', area: 'test-selection', status: 'pass', message: 'Risky-files trigger has matching risky file entries.'});
    }

    const metricsMatch = (
        plan?.metrics &&
        Array.isArray(impact?.flows) &&
        Array.isArray(impact?.gaps) &&
        Array.isArray(impact?.warnings) &&
        Array.isArray(impact?.changedFiles) &&
        plan.metrics.changedFiles === impact.changedFiles.length &&
        plan.metrics.impactedFlows === impact.flows.length &&
        plan.metrics.uncoveredP0P1Flows === impact.gaps.length &&
        plan.metrics.warnings === impact.warnings.length
    );
    if (!metricsMatch) {
        checks.push({
            id: 'plan-metrics-sync',
            area: 'outputs',
            status: 'warn',
            message: 'plan.metrics is not fully aligned with impact report totals.',
        });
    } else {
        checks.push({id: 'plan-metrics-sync', area: 'outputs', status: 'pass', message: 'plan.metrics aligns with impact totals.'});
    }
}

function summarizeChecks(checks) {
    const summary = {pass: 0, warn: 0, fail: 0};
    for (const check of checks) {
        if (check.status === 'pass') {
            summary.pass += 1;
        } else if (check.status === 'warn') {
            summary.warn += 1;
        } else {
            summary.fail += 1;
        }
    }
    return summary;
}

function overallStatus(summary) {
    if (summary.fail > 0) {
        return 'fail';
    }
    if (summary.warn > 0) {
        return 'warn';
    }
    return 'pass';
}

function normalizePathForOutput(filePath) {
    return filePath.replace(/\\/g, '/');
}

function run() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        usage();
        process.exit(0);
    }

    const baseDir = path.join(args.root, '.e2e-ai-agents');
    const impactPath = args.impactPath || path.join(baseDir, 'impact.json');
    const planPath = args.planPath || path.join(baseDir, 'plan.json');
    const outPath = args.outPath || path.join(baseDir, 'impact-checklist.json');

    const checks = [];

    const impact = readJson(impactPath);
    if (!impact.ok) {
        checks.push({id: 'impact-load', area: 'inputs', status: 'fail', message: impact.error});
    } else {
        checks.push({id: 'impact-load', area: 'inputs', status: 'pass', message: `Loaded impact report: ${normalizePathForOutput(impactPath)}`});
    }

    const plan = readJson(planPath);
    if (!plan.ok) {
        checks.push({id: 'plan-load', area: 'inputs', status: 'fail', message: plan.error});
    } else {
        checks.push({id: 'plan-load', area: 'inputs', status: 'pass', message: `Loaded plan report: ${normalizePathForOutput(planPath)}`});
    }

    if (impact.ok) {
        validateImpactReport(impact.value, checks);
    }
    if (impact.ok && plan.ok) {
        validatePlanReport(impact.value, plan.value, checks);
    }

    const summary = summarizeChecks(checks);
    const status = overallStatus(summary);
    const flows = impact.ok && Array.isArray(impact.value.flows) ? flowCounts(impact.value.flows) : {P0: 0, P1: 0, P2: 0};

    const report = {
        schemaVersion: '1.0.0',
        generatedAt: new Date().toISOString(),
        status,
        root: normalizePathForOutput(args.root),
        impactPath: normalizePathForOutput(impactPath),
        planPath: normalizePathForOutput(planPath),
        summary,
        metrics: {
            changedFiles: impact.ok && Array.isArray(impact.value.changedFiles) ? impact.value.changedFiles.length : 0,
            flows,
            gaps: impact.ok && Array.isArray(impact.value.gaps) ? impact.value.gaps.length : 0,
            warnings: impact.ok && Array.isArray(impact.value.warnings) ? impact.value.warnings.length : 0,
            recommendedTests: plan.ok && Array.isArray(plan.value.recommendedTests) ? plan.value.recommendedTests.length : 0,
            runSet: plan.ok ? plan.value.runSet : undefined,
            action: plan.ok && plan.value.decision ? plan.value.decision.action : undefined,
            confidence: plan.ok ? plan.value.confidence : undefined,
        },
        checks,
    };

    fs.mkdirSync(path.dirname(outPath), {recursive: true});
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');

    console.log(`Impact checklist status: ${status.toUpperCase()}`);
    console.log(`Pass: ${summary.pass}  Warn: ${summary.warn}  Fail: ${summary.fail}`);
    console.log(`Checklist report: ${normalizePathForOutput(outPath)}`);

    if (summary.fail > 0) {
        process.exit(1);
    }
    if (args.strict && summary.warn > 0) {
        process.exit(2);
    }
}

run();
