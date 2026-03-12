#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const DEFAULT_REVIEW_FILE = '.e2e-ai-agents/local-impact-review.md';
const DEFAULT_APPROVAL_FILE = '.e2e-ai-agents/local-impact-approval.json';

interface ParsedArgs {
    command: string;
    extra: string[];
    testsRoot?: string;
    configPath?: string;
    reviewPath?: string;
    approvalPath?: string;
    decision?: string;
    by: string;
    note?: string;
    force: boolean;
    help: boolean;
}

function usage() {
    console.log([
        'Usage:',
        '  node scripts/local-impact-workflow.js <command> [options]',
        '',
        'Commands:',
        '  suggest     Run suggest and write local review + pending approval artifact',
        '  approve     Mark local approval as approved/rejected for current run',
        '  generate    Require approved artifact, then run gap pipeline generation',
        '  status      Print current local impact/approval status',
        '',
        'Common options:',
        '  --config <path>      Path to e2e-ai-agents config JSON',
        '  --tests-root <path>  Tests root (where .e2e-ai-agents lives)',
        '  --review <path>      Override review markdown output path',
        '  --approval <path>    Override approval JSON path',
        '',
        'Approve options:',
        '  --decision <value>   approve | reject',
        '  --by <name>          Approver identity (default: $USER)',
        '  --note <text>        Optional note',
        '',
        'Generate options:',
        '  --force              Ignore runId mismatch between approval and plan',
        '',
        'Pass-through:',
        '  Additional flags are passed to e2e-ai-agents suggest/approve-and-generate.',
        '',
        'Examples:',
        '  node scripts/local-impact-workflow.js suggest --config ./e2e-ai-agents.config.json --since master',
        '  node scripts/local-impact-workflow.js approve --config ./e2e-ai-agents.config.json --decision approve --note "LGTM for generation"',
        '  node scripts/local-impact-workflow.js generate --config ./e2e-ai-agents.config.json --since master --pipeline-dry-run',
        '  node scripts/local-impact-workflow.js status --config ./e2e-ai-agents.config.json',
    ].join('\n'));
}

function parseArgs(argv: string[]): ParsedArgs {
    const parsed: ParsedArgs = {
        command: argv[0],
        extra: [],
        testsRoot: undefined,
        configPath: undefined,
        reviewPath: undefined,
        approvalPath: undefined,
        decision: undefined,
        by: process.env.USER || 'unknown',
        note: undefined,
        force: false,
        help: false,
    };

    for (let i = 1; i < argv.length; i += 1) {
        const arg = argv[i];
        const next = argv[i + 1];

        if (arg === '--help' || arg === '-h') {
            parsed.help = true;
            continue;
        }
        if (arg === '--force') {
            parsed.force = true;
            continue;
        }
        if (arg === '--tests-root' && next) {
            parsed.testsRoot = path.resolve(next);
            parsed.extra.push(arg, next);
            i += 1;
            continue;
        }
        if (arg === '--config' && next) {
            parsed.configPath = path.resolve(next);
            parsed.extra.push(arg, next);
            i += 1;
            continue;
        }
        if (arg === '--review' && next) {
            parsed.reviewPath = path.resolve(next);
            i += 1;
            continue;
        }
        if (arg === '--approval' && next) {
            parsed.approvalPath = path.resolve(next);
            i += 1;
            continue;
        }
        if (arg === '--decision' && next) {
            parsed.decision = next;
            i += 1;
            continue;
        }
        if (arg === '--by' && next) {
            parsed.by = next;
            i += 1;
            continue;
        }
        if (arg === '--note' && next) {
            parsed.note = next;
            i += 1;
            continue;
        }
        parsed.extra.push(arg);
    }

    return parsed;
}

function readJson(jsonPath: string): any {
    if (!fs.existsSync(jsonPath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid JSON at ${jsonPath}: ${message}`);
    }
}

function writeJson(jsonPath: string, value: any) {
    ensureParent(jsonPath);
    fs.writeFileSync(jsonPath, JSON.stringify(value, null, 2), 'utf-8');
}

function ensureParent(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), {recursive: true});
}

function resolveTestsRoot(parsed: ParsedArgs): string {
    if (parsed.testsRoot) {
        return parsed.testsRoot;
    }
    if (!parsed.configPath) {
        return process.cwd();
    }
    const config = readJson(parsed.configPath);
    if (!config || typeof config !== 'object') {
        return process.cwd();
    }
    const configDir = path.dirname(parsed.configPath);
    if (typeof config.testsRoot === 'string' && config.testsRoot.trim().length > 0) {
        return path.resolve(configDir, config.testsRoot);
    }
    if (typeof config.path === 'string' && config.path.trim().length > 0) {
        return path.resolve(configDir, config.path);
    }
    return process.cwd();
}

function cliPath(): string {
    const p = path.resolve(__dirname, '..', 'dist', 'cli.js');
    if (!fs.existsSync(p)) {
        throw new Error(`CLI build not found at ${p}. Run "npm run build" first.`);
    }
    return p;
}

function runCli(subcommand: string, extraArgs: string[]) {
    const result = spawnSync(process.execPath, [cliPath(), subcommand, ...extraArgs], {
        stdio: 'inherit',
    });
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

function stripFlagsSuffix(testPath: string): string {
    return String(testPath || '').replace(/ \(flags:.*\)$/, '');
}

function resolveSeedSpec(testsRoot: string): string | null {
    const preferred = path.join(testsRoot, 'specs', 'seed.spec.ts');
    return fs.existsSync(preferred) ? preferred : null;
}

function loadArtifacts(testsRoot: string) {
    const artifactRoot = path.join(testsRoot, '.e2e-ai-agents');
    const impactPath = path.join(artifactRoot, 'impact.json');
    const planPath = path.join(artifactRoot, 'plan.json');
    const gapPath = path.join(artifactRoot, 'gap.json');
    const impact = readJson(impactPath);
    const plan = readJson(planPath);
    const gap = readJson(gapPath);

    if (!impact) {
        throw new Error(`Missing impact artifact: ${impactPath}`);
    }
    if (!plan) {
        throw new Error(`Missing plan artifact: ${planPath}`);
    }
    return {artifactRoot, impactPath, planPath, gapPath, impact, plan, gap};
}

function priorityRank(priority: string): number {
    if (priority === 'P0') {
        return 0;
    }
    if (priority === 'P1') {
        return 1;
    }
    if (priority === 'P2') {
        return 2;
    }
    return 3;
}

function buildReviewMarkdown(testsRoot: string, artifact: any, reviewPath: string, approvalPath: string) {
    const impact = artifact.impact || {};
    const plan = artifact.plan || {};
    const gap = artifact.gap || {};
    const decision = plan?.decision?.action || 'unknown';
    const confidence = plan.confidence ?? 'n/a';
    const runId = plan.runId || impact?.runMetadata?.runId || 'unknown';
    const runSet = plan.runSet || 'unknown';
    const flowMapping = impact?.impactModel?.flowMapping || 'unknown';
    const testMapping = impact?.impactModel?.testMapping || 'unknown';
    const reasonList = Array.isArray(plan.reasons) ? plan.reasons : [];
    const policyTriggers = Array.isArray(plan?.policy?.triggeredRules) ? plan.policy.triggeredRules : [];
    const traceability = impact?.impactModel?.traceability;

    const recommended = Array.isArray(plan.recommendedTests)
        ? plan.recommendedTests.map(stripFlagsSuffix)
        : [];
    const requiredNew = Array.isArray(plan.requiredNewTests) ? plan.requiredNewTests : [];
    const suggestedNew = Array.isArray(gap.suggestedNewTests) ? gap.suggestedNewTests : [];
    const seedSpec = resolveSeedSpec(testsRoot);
    const suggestedSorted = suggestedNew
        .slice()
        .sort((a: any, b: any) => priorityRank(a.priority) - priorityRank(b.priority));
    const coverageRows = Array.isArray(impact.coverage) ? impact.coverage : [];
    const topCoverage = coverageRows
        .slice()
        .sort((a: any, b: any) => priorityRank(a.priority) - priorityRank(b.priority))
        .slice(0, 15);
    const contextCandidates = [
        path.join(testsRoot, 'CLAUDE.OPTIONAL.md'),
        path.join(testsRoot, '.claude', 'CLAUDE.OPTIONAL.md'),
        path.join(path.dirname(testsRoot), 'CLAUDE.OPTIONAL.md'),
        path.join(path.dirname(testsRoot), '.claude', 'CLAUDE.OPTIONAL.md'),
    ];
    const foundContext = Array.from(new Set(contextCandidates.filter((candidate) => fs.existsSync(candidate))));
    const generatedAt = new Date().toISOString();

    const lines: string[] = [];
    lines.push('## E2E Impact Approval (Local)');
    lines.push('');
    lines.push(`- Status: \`${decision === 'must-add-tests' ? 'pending-approval' : 'review-required'}\``);
    lines.push(`- Decision: \`${decision}\``);
    lines.push(`- Run set: \`${runSet}\` (confidence \`${confidence}\`)`);
    lines.push(`- Mapping: flow=\`${flowMapping}\`, test=\`${testMapping}\``);
    lines.push(`- Generated at: \`${generatedAt}\``);
    lines.push(`- Source runId: \`${runId}\``);
    lines.push(`- Tests root: \`${testsRoot}\``);
    if (traceability && traceability.enabled) {
        lines.push(`- Traceability: manifestFound=\`${Boolean(traceability.manifestFound)}\`, coverageRatio=\`${traceability.coverageRatio ?? 0}\``);
    }
    if (reasonList.length > 0) {
        lines.push(`- Decision reasons: ${reasonList.join(' | ')}`);
    }
    if (policyTriggers.length > 0) {
        lines.push(`- Policy triggers: ${policyTriggers.join(', ')}`);
    }
    lines.push('');

    lines.push('### Existing Tests To Run');
    lines.push(`- Count: \`${recommended.length}\``);
    if (recommended.length === 0) {
        lines.push('- None');
    } else {
        for (const testPath of recommended) {
            lines.push(`- ${testPath}`);
        }
    }
    lines.push('');

    lines.push('### New Scenario Suggestions');
    lines.push(`- Count: \`${suggestedSorted.length}\``);
    if (suggestedNew.length === 0 && requiredNew.length === 0) {
        lines.push('- None');
    } else {
        for (const suggestion of suggestedSorted) {
            const relPath = suggestion.suggestedTestPath
                ? path.relative(testsRoot, suggestion.suggestedTestPath)
                : 'unknown';
            lines.push(`- [${suggestion.priority || 'P?'}] ${suggestion.flowName || suggestion.flowId || 'unknown flow'} -> ${relPath}`);
            if (suggestion.rationale) {
                lines.push(`  - Why: ${suggestion.rationale}`);
            }
            if (Array.isArray(suggestion.sourceFiles) && suggestion.sourceFiles.length > 0) {
                lines.push(`  - Source files: ${suggestion.sourceFiles.join(', ')}`);
            }
        }
        if (requiredNew.length > 0) {
            lines.push('');
            lines.push('Uncovered flow IDs (plan.requiredNewTests):');
            for (const flow of requiredNew) {
                lines.push(`- ${flow}`);
            }
        }
    }
    lines.push('');

    lines.push('### Flow To Existing-Test Mapping Snapshot');
    if (topCoverage.length === 0) {
        lines.push('- No flow coverage mapping rows found.');
    } else {
        for (const row of topCoverage) {
            const tests = Array.isArray(row.coveredBy) ? row.coveredBy.join(', ') : '';
            lines.push(`- [${row.priority || 'P?'}] ${row.flowId}: ${tests || 'no mapped tests'}`);
        }
    }
    lines.push('');

    lines.push('### Context Quality');
    lines.push(`- Seed spec: ${seedSpec || 'not found under specs/seed.spec.ts'}`);
    if (foundContext.length === 0) {
        lines.push('- Optional context files: none found (CLAUDE.OPTIONAL.md / .claude/CLAUDE.OPTIONAL.md)');
    } else {
        lines.push(`- Optional context files: ${foundContext.join(', ')}`);
    }
    lines.push('');

    lines.push('### Approval Gate');
    lines.push(`- Approval file: ${approvalPath}`);
    lines.push('- Step 1 (approve/reject):');
    lines.push('```bash');
    lines.push(`node scripts/local-impact-workflow.js approve --tests-root "${testsRoot}" --decision approve --note "reviewed by dev/qa"`);
    lines.push('```');
    lines.push('- Step 2 (generate after approval):');
    lines.push('```bash');
    lines.push(`node scripts/local-impact-workflow.js generate --tests-root "${testsRoot}" --pipeline`);
    lines.push('# Runs MCP-only AI generation/healing by default.');
    lines.push('```');
    lines.push('');

    ensureParent(reviewPath);
    fs.writeFileSync(reviewPath, `${lines.join('\n')}\n`, 'utf-8');
}

function normalizeApprovalDecision(value: string): string | null {
    if (value === 'approve' || value === 'approved') {
        return 'approved';
    }
    if (value === 'reject' || value === 'rejected') {
        return 'rejected';
    }
    return null;
}

function loadOrCreateApproval(approvalPath: string, sourceRunId: string | null) {
    const existing = readJson(approvalPath);
    if (existing && typeof existing === 'object') {
        return existing;
    }
    return {
        schemaVersion: '1.0.0',
        status: 'pending',
        sourceRunId: sourceRunId || null,
        createdAt: new Date().toISOString(),
    };
}

function ensureFlag(extraArgs: string[], flag: string) {
    if (!extraArgs.includes(flag)) {
        extraArgs.push(flag);
    }
}

function hasFlag(extraArgs: string[], flag: string): boolean {
    return extraArgs.includes(flag);
}

function commandSuggest(parsed: ParsedArgs, testsRoot: string, reviewPath: string, approvalPath: string) {
    runCli('suggest', parsed.extra);
    const artifact = loadArtifacts(testsRoot);
    buildReviewMarkdown(testsRoot, artifact, reviewPath, approvalPath);

    const approval = loadOrCreateApproval(approvalPath, artifact.plan.runId || artifact.impact?.runMetadata?.runId);
    approval.status = 'pending';
    approval.sourceRunId = artifact.plan.runId || artifact.impact?.runMetadata?.runId || approval.sourceRunId || null;
    approval.updatedAt = new Date().toISOString();
    approval.lastReviewPath = reviewPath;
    writeJson(approvalPath, approval);

    console.log(`Local review: ${reviewPath}`);
    console.log(`Approval file reset to pending: ${approvalPath}`);
}

function commandApprove(parsed: ParsedArgs, approvalPath: string, currentPlanRunId: string | undefined) {
    const decision = normalizeApprovalDecision(parsed.decision!);
    if (!decision) {
        throw new Error('approve command requires --decision approve|reject');
    }
    const approval = loadOrCreateApproval(approvalPath, currentPlanRunId || null);
    approval.status = decision;
    approval.sourceRunId = currentPlanRunId || approval.sourceRunId || null;
    approval.updatedAt = new Date().toISOString();
    approval.approvedBy = parsed.by || approval.approvedBy || 'unknown';
    if (parsed.note) {
        approval.note = parsed.note;
    }
    writeJson(approvalPath, approval);
    console.log(`Approval status: ${decision}`);
    console.log(`Approval file: ${approvalPath}`);
}

function commandGenerate(parsed: ParsedArgs, approvalPath: string, currentPlanRunId: string | undefined) {
    const approval = readJson(approvalPath);
    if (!approval) {
        throw new Error(`Approval file not found: ${approvalPath}. Run suggest first.`);
    }
    if (approval.status !== 'approved') {
        throw new Error(`Approval status is "${approval.status}". Run approve --decision approve first.`);
    }
    if (!parsed.force && approval.sourceRunId && currentPlanRunId && approval.sourceRunId !== currentPlanRunId) {
        throw new Error(
            `Approval runId (${approval.sourceRunId}) does not match current plan runId (${currentPlanRunId}). Re-run suggest+approve or pass --force.`,
        );
    }

    ensureFlag(parsed.extra, '--pipeline');
    if (!hasFlag(parsed.extra, '--pipeline-mcp')) {
        parsed.extra.push('--pipeline-mcp');
    }
    if (!hasFlag(parsed.extra, '--pipeline-mcp-only')) {
        parsed.extra.push('--pipeline-mcp-only');
    }
    runCli('gap', parsed.extra);
}

function commandStatus(approvalPath: string, testsRoot: string) {
    const artifact = loadArtifacts(testsRoot);
    const approval = readJson(approvalPath);
    const output = {
        testsRoot,
        runId: artifact.plan.runId || artifact.impact?.runMetadata?.runId || null,
        decision: artifact.plan?.decision?.action || null,
        runSet: artifact.plan?.runSet || null,
        confidence: artifact.plan?.confidence ?? null,
        impactModel: artifact.impact?.impactModel || null,
        recommendedTests: Array.isArray(artifact.plan?.recommendedTests) ? artifact.plan.recommendedTests.length : 0,
        uncoveredFlows: Array.isArray(artifact.impact?.gaps) ? artifact.impact.gaps.length : 0,
        approval: approval || null,
    };
    console.log(JSON.stringify(output, null, 2));
}

function main() {
    const parsed = parseArgs(process.argv.slice(2));
    if (!parsed.command || parsed.help || parsed.command === 'help' || parsed.command === '--help' || parsed.command === '-h') {
        usage();
        return;
    }

    if (!['suggest', 'approve', 'generate', 'status'].includes(parsed.command)) {
        throw new Error(`Unknown command: ${parsed.command}`);
    }

    const testsRoot = resolveTestsRoot(parsed);
    const reviewPath = parsed.reviewPath || path.join(testsRoot, DEFAULT_REVIEW_FILE);
    const approvalPath = parsed.approvalPath || path.join(testsRoot, DEFAULT_APPROVAL_FILE);
    const currentPlan = readJson(path.join(testsRoot, '.e2e-ai-agents', 'plan.json'));
    const currentPlanRunId = currentPlan?.runId;

    if (parsed.command === 'suggest') {
        commandSuggest(parsed, testsRoot, reviewPath, approvalPath);
        return;
    }
    if (parsed.command === 'approve') {
        commandApprove(parsed, approvalPath, currentPlanRunId);
        return;
    }
    if (parsed.command === 'generate') {
        commandGenerate(parsed, approvalPath, currentPlanRunId);
        return;
    }
    if (parsed.command === 'status') {
        commandStatus(approvalPath, testsRoot);
    }
}

try {
    main();
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
}
