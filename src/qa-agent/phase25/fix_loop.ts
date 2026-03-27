// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import Anthropic from '@anthropic-ai/sdk';

import {logger} from '../../logger.js';
import type {Finding, FixResult, FixStatus, HealthScore, Phase25Result, QAConfig} from '../types.js';
import type {AgentBrowser} from '../phase2/agent_browser.js';
import {computeHealthScore} from '../health_score.js';
import {isFixable} from '../finding_taxonomy.js';
import {FIX_TOOL_DEFINITIONS, executeFixTool} from './fix_tools.js';
import type {FixToolContext} from './fix_tools.js';
import {WTFTracker} from './wtf_heuristic.js';

const MAX_ITERATIONS_PER_FIX = 15;

// Pricing per 1M tokens by model prefix
const MODEL_PRICING: Record<string, {input: number; output: number}> = {
    'claude-sonnet': {input: 3, output: 15},
    'claude-haiku': {input: 0.25, output: 1.25},
    'claude-opus': {input: 15, output: 75},
};

function getPricing(model: string): {input: number; output: number} {
    for (const [prefix, pricing] of Object.entries(MODEL_PRICING)) {
        if (model.startsWith(prefix)) return pricing;
    }
    return {input: 3, output: 15};
}

function buildFixSystemPrompt(finding: Finding, baseUrl: string): string {
    const evidence = finding.evidence;
    return `You are a bug-fix engineer. Fix the following QA finding with the MINIMAL code change needed.

## Finding
- **ID:** ${finding.id}
- **Type:** ${finding.type}
- **Severity:** ${finding.severity}
- **Summary:** ${finding.summary}
- **URL:** ${evidence.url}
- **Expected:** ${evidence.expectedBehavior || 'Not specified'}
- **Actual:** ${evidence.actualBehavior || 'Not specified'}
- **Repro steps:** ${evidence.reproSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}
${evidence.consoleErrors?.length ? `- **Console errors:** ${evidence.consoleErrors.join('; ')}` : ''}

## Workflow
1. Use search_code to find the responsible source file(s)
2. Use read_file to understand the code
3. Use write_file to make the minimal fix
4. Use run_command to check types (npx tsc --noEmit) or lint
5. Use git_commit to create an atomic commit: fix(qa): ${finding.id} — {description}
6. Use verify_in_browser to navigate to ${evidence.url} and check the fix worked

## Rules
- Make the SMALLEST change that fixes the issue. Do NOT refactor surrounding code.
- Only modify files directly related to the bug.
- If you can't find the source after 3 search attempts, report that the fix is not possible.
- If type checking or lint fails BEFORE you commit, use git_restore to discard your edits, then report the fix is not possible.
- If you already committed and verification fails, use git_revert to undo the commit.
- NEVER leave uncommitted edits behind. Always either commit or restore.
- The base URL is ${baseUrl}.
- When done, respond with text only (no tool use) explaining the result.`;
}

export async function runFixLoop(
    config: QAConfig,
    findings: Finding[],
    browser: AgentBrowser,
    projectRoot: string,
): Promise<Phase25Result> {
    const startTime = Date.now();
    const tier = config.fixTier || 'standard';
    const fixes: FixResult[] = [];
    const wtf = new WTFTracker();
    let tokensUsed = 0;
    let costUSD = 0;

    // Budget: 40% of remaining total budget
    const budgetUSD = config.budgetUSD * 0.4;

    const healthScoreBefore = computeHealthScore(findings);

    // Sort by severity (critical first) and filter by tier
    const fixable = findings
        .filter((f) => isFixable(f, tier))
        .sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));

    if (fixable.length === 0) {
        logger.info('No fixable findings for tier', {tier});
        return {
            fixes: [],
            fixesAttempted: 0,
            fixesVerified: 0,
            fixesBestEffort: 0,
            fixesReverted: 0,
            fixesSkipped: 0,
            healthScoreBefore,
            healthScoreAfter: healthScoreBefore,
            durationMs: 0,
            tokensUsed: 0,
            costUSD: 0,
        };
    }

    logger.info(`Fix loop: ${fixable.length} findings to fix (tier: ${tier})`);

    const client = new Anthropic();
    const model = process.env.QA_AGENT_MODEL || 'claude-sonnet-4-5-20250929';
    const screenshotDir = config.screenshotDir || '.e2e-ai-agents/qa-screenshots';

    const toolCtx: FixToolContext = {
        projectRoot,
        browser,
        baseUrl: config.baseUrl,
        screenshotDir,
        screenshotCounter: 100, // Start at 100 to avoid collisions with Phase 2 screenshots
        qaCommitHashes: new Set(),
        pendingWrittenFiles: new Set(),
    };

    for (const finding of fixable) {
        if (wtf.shouldStop()) {
            logger.warn(`WTF heuristic triggered (score: ${wtf.score}), stopping fix loop`);
            // Mark remaining as skipped
            fixes.push({findingId: finding.id, status: 'skipped'});
            continue;
        }

        if (costUSD >= budgetUSD) {
            logger.info('Fix loop budget exhausted');
            fixes.push({findingId: finding.id, status: 'skipped'});
            continue;
        }

        logger.info(`Fixing: [${finding.severity}] ${finding.summary}`);

        const result = await fixSingleFinding(client, model, config, finding, toolCtx);
        fixes.push(result.fix);
        tokensUsed += result.tokensUsed;
        costUSD += result.costUSD;

        wtf.recordAttempt(result.fix.status, result.fix.filesChanged?.length || 0);
    }

    // Exclude verified fixes from the post-fix score so it reflects actual remaining issues
    const verifiedIds = new Set(fixes.filter((f) => f.status === 'verified').map((f) => f.findingId));
    const remainingFindings = findings.filter((f) => !verifiedIds.has(f.id));
    const healthScoreAfter = computeHealthScore(remainingFindings);

    return {
        fixes,
        fixesAttempted: fixes.filter((f) => f.status !== 'skipped').length,
        fixesVerified: fixes.filter((f) => f.status === 'verified').length,
        fixesBestEffort: fixes.filter((f) => f.status === 'best-effort').length,
        fixesReverted: fixes.filter((f) => f.status === 'reverted').length,
        fixesSkipped: fixes.filter((f) => f.status === 'skipped').length,
        healthScoreBefore,
        healthScoreAfter,
        durationMs: Date.now() - startTime,
        tokensUsed,
        costUSD,
    };
}

async function fixSingleFinding(
    client: Anthropic,
    model: string,
    config: QAConfig,
    finding: Finding,
    toolCtx: FixToolContext,
): Promise<{fix: FixResult; tokensUsed: number; costUSD: number}> {
    const messages: Anthropic.MessageParam[] = [];
    let tokensUsed = 0;
    let costUSD = 0;
    let commitHash: string | undefined;
    let filesChanged: string[] = [];
    let beforeScreenshot: string | undefined;
    let afterScreenshot: string | undefined;
    let verifiedFixed = false;
    let status: FixStatus = 'skipped';

    // Take "before" screenshot
    try {
        toolCtx.screenshotCounter++;
        const label = `before-fix-${finding.id.slice(-6)}`;
        const path = `${toolCtx.screenshotDir}/${String(toolCtx.screenshotCounter).padStart(3, '0')}-${label}.png`;
        toolCtx.browser.open(finding.evidence.url.startsWith('http') ? finding.evidence.url : `${config.baseUrl}${finding.evidence.url}`);
        toolCtx.browser.screenshot(path);
        beforeScreenshot = path;
    } catch {
        // Non-critical
    }

    messages.push({role: 'user', content: 'Fix the finding described in the system prompt. Start by searching for the relevant source code.'});

    for (let iteration = 0; iteration < MAX_ITERATIONS_PER_FIX; iteration++) {
        let response: Anthropic.Message;
        try {
            response = await client.messages.create({
                model,
                max_tokens: 4096,
                system: buildFixSystemPrompt(finding, config.baseUrl),
                tools: FIX_TOOL_DEFINITIONS,
                messages,
            });
        } catch (err) {
            logger.warn('Fix LLM call failed', {error: String(err)});
            status = 'skipped';
            break;
        }

        // Track cost
        const usage = response.usage;
        const pricing = getPricing(model);
        const inputCost = (usage.input_tokens / 1_000_000) * pricing.input;
        const outputCost = (usage.output_tokens / 1_000_000) * pricing.output;
        tokensUsed += usage.input_tokens + usage.output_tokens;
        costUSD += inputCost + outputCost;

        const assistantContent = response.content;
        messages.push({role: 'assistant', content: assistantContent});

        // If no tool use, the agent is done
        const toolUseBlocks = assistantContent.filter((b) => b.type === 'tool_use');
        if (toolUseBlocks.length === 0) {
            // Determine status: 'verified' requires both a commit and explicit confirmation
            // from verify_in_browser that the bug is gone. A screenshot alone is not proof.
            if (commitHash) {
                status = verifiedFixed ? 'verified' : 'best-effort';
            }
            break;
        }

        // Execute tools
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of toolUseBlocks) {
            if (block.type !== 'tool_use') continue;

            const result = executeFixTool(toolCtx, block.name, block.input as Record<string, unknown>);

            if (result.commitHash && block.name === 'git_commit') {
                commitHash = result.commitHash;
            }
            if (result.filesChanged) {
                filesChanged = [...filesChanged, ...result.filesChanged];
            }
            if (block.name === 'verify_in_browser') {
                if (result.screenshotPath) {
                    afterScreenshot = result.screenshotPath;
                }
                if (result.verifiedFixed === true) {
                    verifiedFixed = true;
                }
            }
            if (block.name === 'git_revert') {
                status = 'reverted';
                commitHash = undefined;
                filesChanged = [];
            }

            toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: result.output,
            });
        }

        messages.push({role: 'user', content: toolResults});
    }

    // If we have a commit but didn't get classified yet
    if (status === 'skipped' && commitHash) {
        status = 'best-effort';
    }

    return {
        fix: {
            findingId: finding.id,
            status,
            commitHash,
            filesChanged: [...new Set(filesChanged)],
            beforeScreenshot,
            afterScreenshot,
        },
        tokensUsed,
        costUSD,
    };
}

function severityOrder(severity: string): number {
    switch (severity) {
    case 'critical': return 0;
    case 'high': return 1;
    case 'medium': return 2;
    case 'low': return 3;
    default: return 4;
    }
}
