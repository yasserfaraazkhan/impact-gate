// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {EventEmitter} from 'events';

interface ProgressReporterOptions {
    isTTY?: boolean;
    quiet?: boolean;
    jsonMode?: boolean;
}

interface PhaseStartPayload {
    phase: string;
    agentCount: number;
}

interface AgentStartPayload {
    agent: string;
    family?: string;
}

interface AgentCompletePayload {
    agent: string;
    family: string | undefined;
    tokens: number;
    cost: number;
    durationMs: number;
}

interface PhaseCompletePayload {
    phase: string;
    elapsedMs: number;
}

interface WorkflowCompletePayload {
    totalCost: number;
    totalTokens: number;
    elapsedMs: number;
}

export class ProgressReporter extends EventEmitter {
    private isTTY: boolean;
    private silent: boolean;
    private completedAgents: number;
    private totalAgents: number;
    private currentPhase: string;

    constructor(options?: ProgressReporterOptions) {
        super();
        this.isTTY = options?.isTTY ?? (process.stdout.isTTY === true);
        this.silent = (options?.quiet ?? false) || (options?.jsonMode ?? false);
        this.completedAgents = 0;
        this.totalAgents = 0;
        this.currentPhase = '';
    }

    phaseStart(phase: string, agentCount: number): void {
        const payload: PhaseStartPayload = {phase, agentCount};
        this.emit('phase-start', payload);

        if (this.silent) {
            return;
        }

        this.currentPhase = phase;
        this.completedAgents = 0;
        this.totalAgents = agentCount;

        const message = `--- Phase: ${phase} (${agentCount} agent${agentCount !== 1 ? 's' : ''}) ---`;
        this.writeLine(message);
    }

    agentStart(agent: string, family?: string): void {
        const payload: AgentStartPayload = {agent, family};
        this.emit('agent-start', payload);

        if (this.silent) {
            return;
        }

        const familyLabel = family ? ` processing ${family}` : '';

        if (this.isTTY) {
            const progress = `[${this.completedAgents}/${this.totalAgents} agents]`;
            const message = `${progress} ${this.currentPhase}: ${agent}${familyLabel}...`;
            process.stdout.write(`\r${clearLine()}${message}`);
        } else {
            const message = `[${this.currentPhase}] ${agent} started${familyLabel ? ':' + familyLabel : ''}`;
            this.writeLine(message);
        }
    }

    agentComplete(agent: string, family: string | undefined, tokens: number, cost: number, durationMs: number): void {
        const payload: AgentCompletePayload = {agent, family, tokens, cost, durationMs};
        this.emit('agent-complete', payload);

        if (this.silent) {
            return;
        }

        this.completedAgents++;
        const costStr = formatCost(cost);
        const durationStr = formatDuration(durationMs);
        const tokensStr = formatTokens(tokens);
        const familyLabel = family ? ` ${family}` : '';

        if (this.isTTY) {
            const progress = `[${this.completedAgents}/${this.totalAgents} agents]`;
            const message = `${progress} ${this.currentPhase}: ${agent} complete${familyLabel} (${tokensStr}, ${costStr}, ${durationStr})`;
            process.stdout.write(`\r${clearLine()}${message}\n`);
        } else {
            const message = `[${this.currentPhase}] ${agent} complete:${familyLabel} (${tokensStr}, ${costStr}, ${durationStr})`;
            this.writeLine(message);
        }
    }

    phaseComplete(phase: string, elapsedMs: number): void {
        const payload: PhaseCompletePayload = {phase, elapsedMs};
        this.emit('phase-complete', payload);

        if (this.silent) {
            return;
        }

        const durationStr = formatDuration(elapsedMs);
        const message = `--- Phase ${phase} complete (${durationStr}) ---`;
        this.writeLine(message);
    }

    workflowComplete(totalCost: number, totalTokens: number, elapsedMs: number): void {
        const payload: WorkflowCompletePayload = {totalCost, totalTokens, elapsedMs};
        this.emit('workflow-complete', payload);

        if (this.silent) {
            return;
        }

        const costStr = formatCost(totalCost);
        const tokensStr = formatTokens(totalTokens);
        const durationStr = formatDuration(elapsedMs);
        const message = `=== Workflow complete: ${tokensStr}, ${costStr}, ${durationStr} ===`;
        this.writeLine(message);
    }

    private writeLine(message: string): void {
        process.stdout.write(message + '\n');
    }
}

function clearLine(): string {
    return '\x1B[2K';
}

function formatCost(cost: number): string {
    return `$${cost.toFixed(2)}`;
}

function formatTokens(tokens: number): string {
    if (tokens >= 1_000_000) {
        return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
    }
    if (tokens >= 1_000) {
        return `${(tokens / 1_000).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} tokens`;
    }
    return `${tokens} tokens`;
}

function formatDuration(ms: number): string {
    const seconds = Math.round(ms / 1_000);
    if (seconds >= 60) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return remainingSeconds > 0 ? `${minutes}m${remainingSeconds}s` : `${minutes}m`;
    }
    return `${seconds}s`;
}
