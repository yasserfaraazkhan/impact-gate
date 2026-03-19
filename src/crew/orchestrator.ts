// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Crew Orchestrator — executes workflow definitions by dispatching to agents.
 */

import {getChangedFiles, isTestFile} from '../agent/git.js';
import {preprocess} from '../pipeline/stage0_preprocess.js';
import {logger} from '../logger.js';
import {BudgetExceededError} from '../base_provider.js';
import {BudgetLedger} from '../budget_ledger.js';
import type {RouteFamilyConfig} from '../knowledge/route_families.js';
import type {ApiSurfaceConfig} from '../knowledge/api_surface.js';
import type {Agent, AgentMessage, AgentPlugin, AgentResult, AgentTask} from './protocol.js';
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
    plugins?: string[];  // Paths to plugin modules
}

export interface CrewResult {
    context: CrewContext;
    warnings: string[];
    timings: Record<string, number>;
    dryRun?: boolean;
}

export class CrewOrchestrator {
    private agents = new Map<AgentRole, Agent>();

    registerAgent(agent: Agent): void {
        this.agents.set(agent.role, agent);
    }

    /**
     * Load and register plugins from file paths.
     * Each module must default-export an object satisfying AgentPlugin.
     */
    async loadPlugins(pluginPaths: string[]): Promise<string[]> {
        const loaded: string[] = [];
        for (const pluginPath of pluginPaths) {
            try {
                // Security: Only allow relative paths (starting with . or ..) to prevent loading arbitrary modules.
                // Absolute paths, URLs, and node_modules references are rejected.
                if (!pluginPath.startsWith('.')) {
                    logger.warn(`Plugin path must be relative (start with ./): ${pluginPath} — skipped`);
                    continue;
                }
                const resolved = new URL(pluginPath, `file://${process.cwd()}/`).href;
                // Security: reject paths that resolve outside the workspace (e.g., ../../etc/evil.js)
                const cwd = `file://${process.cwd()}/`;
                if (!resolved.startsWith(cwd)) {
                    logger.warn(`Plugin path '${pluginPath}' resolves outside workspace — skipped`);
                    continue;
                }
                const mod = await import(resolved);
                const plugin: AgentPlugin = mod.default || mod;
                if (!plugin.role || typeof plugin.execute !== 'function') {
                    logger.warn(`Plugin at ${pluginPath} missing required role/execute — skipped`);
                    continue;
                }
                // Warn if plugin overrides a built-in agent
                if (this.agents.has(plugin.role as AgentRole)) {
                    logger.warn(`Plugin '${plugin.role}' overrides built-in agent — ensure this is intentional`);
                }
                this.agents.set(plugin.role as AgentRole, plugin);
                loaded.push(plugin.role);
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                logger.warn(`Failed to load plugin ${pluginPath}: ${msg}`);
            }
        }
        return loaded;
    }

    async run(config: CrewConfig): Promise<CrewResult> {
        const workflow = WORKFLOWS[config.workflow || 'full-qa'];
        const timings: Record<string, number> = {};
        const warnings: string[] = [];

        // Load plugins if configured, then inject them into workflow phases
        const pluginRoles: string[] = [];
        if (config.plugins && config.plugins.length > 0) {
            const loaded = await this.loadPlugins(config.plugins);
            pluginRoles.push(...loaded);
            if (loaded.length > 0) {
                logger.info(`Loaded ${loaded.length} plugins: ${loaded.join(', ')}`);
            }
        }
        const effectivePhases = this.injectPluginsIntoPhases(workflow.phases, pluginRoles);

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

        // Create shared budget ledger for aggregate cost tracking across all agents
        const budgetLedger = config.budgetUSD ? new BudgetLedger(config.budgetUSD) : undefined;

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
            budgetUSD: config.budgetUSD,
            budgetLedger,
            impactedFlows: [],
            strategyEntries: [],
            testDesigns: [],
            crossImpacts: [],
            regressionRisks: [],
            findings: [],
            generatedSpecs: [],
            usage: createEmptyUsageStats(),
            agentUsage: [],
            messages: [],
            warnings,
        };

        // Execute each phase
        for (const phase of effectivePhases) {
            const timer = logger.timer(`crew:${phase.name}`);

            if (phase.handler === 'built-in') {
                await this.runBuiltInPhase(phase.name, ctx, config);

                // Dry-run: after preprocess, return summary without running agents
                if (config.dryRun && phase.name === 'preprocess') {
                    timings[phase.name] = timer.end();
                    ctx.warnings.push('Dry run — no LLM calls were made.');
                    return {context: ctx, warnings, timings, dryRun: true};
                }
            } else if (phase.parallel && phase.parallel.length > 0) {
                await this.runParallel(phase.parallel, phase.name, ctx);
            } else if (phase.sequential && phase.sequential.length > 0) {
                await this.runSequential(phase.sequential, phase.name, ctx);
            } else {
                warnings.push(`Phase '${phase.name}' has no handler, parallel, or sequential agents — skipped.`);
            }

            timings[phase.name] = timer.end();

            // Budget check — prefer ledger (aggregate across all providers) over ctx.usage
            const currentCost = budgetLedger ? budgetLedger.totalCost : ctx.usage.totalCost;
            if (config.budgetUSD && currentCost >= config.budgetUSD) {
                warnings.push(`Budget limit reached ($${currentCost.toFixed(4)} >= $${config.budgetUSD}). Stopping workflow.`);
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
        const startMs = Date.now();

        try {
            const result = await agent.execute(task, ctx);
            const durationMs = Date.now() - startMs;
            if (result.usage) {
                mergeUsageStats(ctx.usage, result.usage);
                ctx.agentUsage.push({
                    agent: role,
                    inputTokens: result.usage.totalInputTokens,
                    outputTokens: result.usage.totalOutputTokens,
                    cost: result.usage.totalCost,
                    durationMs,
                });
            }
            if (result.warnings && result.warnings.length > 0) {
                ctx.warnings.push(...result.warnings);
            }
            return result;
        } catch (error) {
            if (error instanceof BudgetExceededError) {
                ctx.warnings.push(`Budget exceeded ($${error.currentCost.toFixed(4)} >= $${error.budgetUSD}). Agent '${role}' skipped.`);
                return {role, status: 'failed', output: null, warnings: [error.message]};
            }
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

    /**
     * Inject loaded plugins into workflow phases based on their `phase` and `runAfter` fields.
     * Plugins with `runAfter` dependencies are appended to the sequential list of the matching phase;
     * plugins without `runAfter` are appended to the parallel list.
     * Returns a new array of phases (does not mutate the original workflow definition).
     */
    private injectPluginsIntoPhases(phases: WorkflowPhase[], pluginRoles: string[]): WorkflowPhase[] {
        if (pluginRoles.length === 0) return phases;

        // Build mutable copies keyed by phase name
        const phaseMap = new Map<string, {handler?: 'built-in'; parallel?: AgentRole[]; sequential?: AgentRole[]}>();
        const ordered: string[] = [];
        for (const p of phases) {
            ordered.push(p.name);
            if (p.handler === 'built-in') {
                phaseMap.set(p.name, {handler: 'built-in'});
            } else if (p.parallel) {
                phaseMap.set(p.name, {parallel: [...p.parallel]});
            } else if (p.sequential) {
                phaseMap.set(p.name, {sequential: [...p.sequential]});
            }
        }

        for (const role of pluginRoles) {
            const agent = this.agents.get(role as AgentRole);
            if (!agent) continue;

            const plugin = agent as AgentPlugin;
            if (!plugin.phase) continue;

            const target = phaseMap.get(plugin.phase);
            if (!target) {
                logger.warn(`Plugin '${role}' targets phase '${plugin.phase}' which does not exist in workflow — skipped`);
                continue;
            }
            if (target.handler === 'built-in') {
                logger.warn(`Plugin '${role}' targets built-in phase '${plugin.phase}' — not supported, skipped`);
                continue;
            }

            const pluginRole = role as AgentRole;

            if (plugin.runAfter && plugin.runAfter.length > 0) {
                // Validate that runAfter dependencies are either in this phase or a prior phase
                const phaseRoles = target.parallel || target.sequential || [];
                const missingDeps = plugin.runAfter.filter(
                    (dep) => !phaseRoles.includes(dep) && !this.agents.has(dep),
                );
                if (missingDeps.length > 0) {
                    logger.warn(`Plugin '${role}' has unresolved runAfter deps [${missingDeps.join(', ')}] — injecting anyway`);
                }

                // Plugin has dependencies — must run sequentially
                if (target.sequential) {
                    target.sequential.push(pluginRole);
                } else if (target.parallel) {
                    // Convert to sequential to respect dependency ordering
                    target.sequential = [...target.parallel, pluginRole];
                    delete target.parallel;
                }
            } else {
                if (target.parallel) {
                    target.parallel.push(pluginRole);
                } else if (target.sequential) {
                    target.sequential.push(pluginRole);
                }
            }

            logger.info(`Plugin '${role}' injected into phase '${plugin.phase}'`);
        }

        // Rebuild WorkflowPhase array
        return ordered.map((name): WorkflowPhase => {
            const entry = phaseMap.get(name)!;
            if (entry.handler === 'built-in') return {name, handler: 'built-in'};
            if (entry.parallel) return {name, parallel: entry.parallel};
            if (entry.sequential) return {name, sequential: entry.sequential};
            throw new Error(`Phase '${name}' has no handler, parallel, or sequential agents after plugin injection`);
        });
    }

    private checkPhaseResults(phaseName: string, results: AgentResult[], ctx: CrewContext): void {
        const allFailed = results.length > 0 && results.every((r) => r.status === 'failed');
        if (allFailed) {
            ctx.warnings.push(`Phase '${phaseName}': all ${results.length} agent(s) failed. Downstream phases may produce empty results.`);
        }
    }
}
