// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {BrowserAction, ExplorationState, Finding, TargetFlow} from '../types.js';

const RECENT_WINDOW = 10;
const STUCK_THRESHOLD = 3;

export function createExplorationState(
    flows: TargetFlow[],
    timeLimitMs: number,
    budgetUSD: number,
): ExplorationState {
    return {
        flowsToExplore: [...flows],
        flowsExplored: [],
        currentFlow: null,
        findings: [],
        actionsLog: [],
        recentActions: [],
        tokensUsed: 0,
        costUSD: 0,
        startTime: Date.now(),
        timeLimitMs,
        budgetUSD,
    };
}

export function recordAction(state: ExplorationState, action: BrowserAction): void {
    state.actionsLog.push(action);
    state.recentActions.push(action);
    if (state.recentActions.length > RECENT_WINDOW) {
        state.recentActions.shift();
    }
}

export function recordFinding(state: ExplorationState, finding: Finding): void {
    state.findings.push(finding);
}

export function markFlowExplored(state: ExplorationState, flowId: string): void {
    if (!state.flowsExplored.includes(flowId)) {
        state.flowsExplored.push(flowId);
    }
    state.flowsToExplore = state.flowsToExplore.filter((f) => f.id !== flowId);
    state.currentFlow = null;
}

export function nextFlow(state: ExplorationState): TargetFlow | null {
    if (state.flowsToExplore.length === 0) return null;
    const flow = state.flowsToExplore[0];
    state.currentFlow = flow.id;
    return flow;
}

export function isStuck(state: ExplorationState): boolean {
    if (state.recentActions.length < STUCK_THRESHOLD) return false;
    const last = state.recentActions.slice(-STUCK_THRESHOLD);
    const signature = last.map((a) => `${a.type}:${a.target || ''}:${a.value || ''}`);
    return signature.every((s) => s === signature[0]);
}

export function isBudgetExhausted(state: ExplorationState): boolean {
    if (state.costUSD >= state.budgetUSD) return true;
    if (Date.now() - state.startTime >= state.timeLimitMs) return true;
    return false;
}

export function allFlowsExplored(state: ExplorationState): boolean {
    return state.flowsToExplore.length === 0;
}

export function updateCost(state: ExplorationState, inputTokens: number, outputTokens: number, cost: number): void {
    state.tokensUsed += inputTokens + outputTokens;
    state.costUSD += cost;
}

export function compressActionsLog(state: ExplorationState, summaryText: string): void {
    // Replace all but the most recent 10 actions with a summary marker
    if (state.actionsLog.length <= 20) return;
    const recent = state.actionsLog.slice(-10);
    const compressed: BrowserAction = {
        type: 'compressed',
        value: `[Compressed ${state.actionsLog.length - 10} earlier actions] ${summaryText}`,
        timestamp: Date.now(),
    };
    state.actionsLog = [compressed, ...recent];
}
