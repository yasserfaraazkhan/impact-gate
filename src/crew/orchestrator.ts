// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Crew Orchestrator — executes workflow definitions by dispatching to agents.
 */

import {getChangedFiles, isTestFile} from '../agent/git.js';
import {preprocess} from '../pipeline/stage0_preprocess.js';
import {logger} from '../logger.js';
import type {RouteFamilyConfig} from '../knowledge/route_families.js';
import type {ApiSurfaceConfig} from '../knowledge/api_surface.js';
import type {Agent, AgentMessage, AgentResult, AgentTask} from './protocol.js';
import type {CrewContext} from './context.js';
import {createEmptyUsageStats, mergeUsageStats} from './context.js';
import type {AgentRole} from './types.js';
import type {WorkflowDef, WorkflowPhase, WorkflowName} from './workflows.js';
import {WORKFLOWS} from './workflows.js';

export interface CrewConfig {
    appPath: string;
    testsRoot: string;
    gitSince: string;
    gitIncludeUncommitted?: boolean;
    routeFamilies?: RouteFamilyConfig;
    apiSurface?: ApiSurfaceConfig;
    workflow?: WorkflowName;
    providerOverride?: string;
    budgetUSD?: number;
    dryRun?: boolean;
}

export interface CrewResult {
    context: CrewContext;
    warnings: string[];
    timings: Record<string, number>;
}

export class CrewOrchestrator {
    private agents = new Map<AgentRole, Agent>();

    registerAgent(agent: Agent): void {
        this.agents.set(agent.role, agent);
    }

    async run(config: CrewConfig): Promise<CrewResult> {
        const workflow = WORKFLOWS[config.workflow || 'full-qa'];
        const timings: Record<string, number> = {};
        const warnings: string[] = [];

        // Step 1: Get changed files
        const gitResult = getChangedFiles(config.appPath, config.gitSince, {
            includeUncommitted: config.gitIncludeUncommitted,
        });
        if (gitResult.error) {
            warnings.push(`Git diff warning: ${gitResult.error}`);
        }
        const changedFiles = gitResult.files
            .map((f) => f.replace(/\\/g, '/'))
            .filter((f) => !isTestFile(f));

        if (changedFiles.length === 0) {
            warnings.push('No changed application files detected.');
        }

        // Initialize context (will be populated during preprocess phase)
        const ctx: CrewContext = {
            changedFiles,
            routeFamilies: [],
            manifest: null,
            apiSurface: {pageObjects: [], generatedAt: ''},
            specIndex: {specs: [], indexedAt: ''},
            context: {documents: [], warnings: []},
            familyGroups: [],
            preprocessResult: null,
            appPath: config.appPath,
            testsRoot: config.testsRoot,
            gitSince: config.gitSince,
            providerOverride: config.providerOverride,
            impactedFlows: [],
            strategyEntries: [],
            testDesigns: [],
            crossImpacts: [],
            regressionRisks: [],
            findings: [],
            generatedSpecs: [],
            usage: createEmptyUsageStats(),
            messages: [],
            warnings,
        };

        // Execute each phase
        for (const phase of workflow.phases) {
            const timer = logger.timer(`crew:${phase.name}`);

            if (phase.handler === 'built-in') {
                await this.runBuiltInPhase(phase.name, ctx, config);
            } else if (phase.parallel && phase.parallel.length > 0) {
                await this.runParallel(phase.parallel, phase.name, ctx);
            } else if (phase.sequential && phase.sequential.length > 0) {
                await this.runSequential(phase.sequential, phase.name, ctx);
            }

            timings[phase.name] = timer.end();

            // Budget check
            if (config.budgetUSD && ctx.usage.totalCost >= config.budgetUSD) {
                warnings.push(`Budget limit reached ($${ctx.usage.totalCost.toFixed(4)} >= $${config.budgetUSD}). Stopping workflow.`);
                break;
            }
        }

        return {context: ctx, warnings, timings};
    }

    async dispatch(role: AgentRole, action: string, ctx: CrewContext): Promise<AgentResult> {
        const agent = this.agents.get(role);
        if (!agent) {
            return {
                role,
                status: 'failed',
                output: null,
                warnings: [`Agent '${role}' is not registered.`],
            };
        }

        const task: AgentTask = {role, action, input: null};

        try {
            const result = await agent.execute(task, ctx);
            if (result.usage) {
                mergeUsageStats(ctx.usage, result.usage);
            }
            ctx.warnings.push(...result.warnings);
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.warnings.push(`Agent '${role}' failed: ${message}`);
            return {role, status: 'failed', output: null, warnings: [message]};
        }
    }

    async parallel(roles: AgentRole[], action: string, ctx: CrewContext): Promise<AgentResult[]> {
        const promises = roles.map((role) => this.dispatch(role, action, ctx));
        return Promise.all(promises);
    }

    async broadcast(msg: AgentMessage, ctx: CrewContext): Promise<void> {
        ctx.messages.push(msg);
        const promises: Promise<void>[] = [];
        for (const agent of this.agents.values()) {
            if (agent.onMessage && agent.role !== msg.from) {
                promises.push(
                    agent.onMessage(msg).catch((err) => {
                        ctx.warnings.push(`Broadcast to ${agent.role} failed: ${err instanceof Error ? err.message : String(err)}`);
                    }),
                );
            }
        }
        await Promise.all(promises);
    }

    private async runBuiltInPhase(name: string, ctx: CrewContext, config: CrewConfig): Promise<void> {
        if (name === 'preprocess') {
            if (ctx.changedFiles.length === 0) {
                return;
            }

            const result = preprocess(ctx.changedFiles, {
                appPath: config.appPath,
                testsRoot: config.testsRoot,
                routeFamilies: config.routeFamilies,
                apiSurface: config.apiSurface,
            });

            ctx.preprocessResult = result;
            ctx.manifest = result.manifest;
            ctx.routeFamilies = result.manifest?.families || [];
            ctx.apiSurface = result.apiSurface;
            ctx.specIndex = result.specIndex;
            ctx.context = result.context;
            ctx.familyGroups = result.familyGroups;
            ctx.warnings.push(...result.warnings);
        }
    }

    private async runParallel(roles: AgentRole[], phaseName: string, ctx: CrewContext): Promise<void> {
        logger.info(`Crew phase '${phaseName}': running ${roles.join(', ')} in parallel`);
        const results = await this.parallel(roles, phaseName, ctx);
        this.checkPhaseResults(phaseName, results, ctx);
    }

    private async runSequential(roles: AgentRole[], phaseName: string, ctx: CrewContext): Promise<void> {
        logger.info(`Crew phase '${phaseName}': running ${roles.join(' → ')} sequentially`);
        const results: AgentResult[] = [];
        for (const role of roles) {
            results.push(await this.dispatch(role, phaseName, ctx));
        }
        this.checkPhaseResults(phaseName, results, ctx);
    }

    private checkPhaseResults(phaseName: string, results: AgentResult[], ctx: CrewContext): void {
        const allFailed = results.length > 0 && results.every((r) => r.status === 'failed');
        if (allFailed) {
            ctx.warnings.push(`Phase '${phaseName}': all ${results.length} agent(s) failed. Downstream phases may produce empty results.`);
        }
    }
}
