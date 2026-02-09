// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, readFileSync} from 'fs';
import {dirname, resolve} from 'path';

export type AnalysisMode = 'impact' | 'gap';
export type FrameworkType = 'auto' | 'playwright' | 'cypress' | 'selenium' | 'unknown';
export type ArtifactMode = 'commit' | 'keep-local' | 'none';

export interface BudgetConfig {
    maxUSD?: number;
    maxTokens?: number;
}

export interface ArtifactConfig {
    mode: ArtifactMode;
    specsDir: string;
}

export interface SelectorConfig {
    patchOnApply: boolean;
}

export interface TestDiscoveryConfig {
    patterns?: string[];
}

export interface FlowDiscoveryConfig {
    patterns?: string[];
    exclude?: string[];
}

export interface CatalogScoringConfig {
    priorityScores: {
        P0: number;
        P1: number;
        P2: number;
    };
    fileMatchWeight: number;
}

export type FlagState = 'on' | 'off' | 'unknown';

export type AudienceRole =
    | 'system_admin'
    | 'team_admin'
    | 'channel_admin'
    | 'member'
    | 'guest'
    | 'deactivated';

export interface FlagConfig {
    defaultState: FlagState;
}

export interface AudienceConfig {
    defaultRoles: AudienceRole[];
}

export interface BlastRadiusConfig {
    memberBonus: number;
    guestBonus: number;
    adminOnlyPenalty: number;
    flagOffPenalty: number;
}

export interface PipelineConfig {
    enabled: boolean;
    scenarios: number;
    outputDir: string;
    heal: boolean;
    baseUrl?: string;
    browser?: 'chrome' | 'chromium' | 'firefox' | 'webkit';
    headless?: boolean;
    project?: string;
    parallel?: boolean;
    dryRun?: boolean;
    mcp?: boolean;
}

export interface LLMConfig {
    provider?: string;
    fallback?: string;
}

export interface RiskConfig {
    p0Threshold: number;
    p1Threshold: number;
    criticalKeywords: string[];
}

export interface GitConfig {
    since: string;
    includeUncommitted?: boolean;
}

export interface AgentConfig {
    path: string;
    testsRoot?: string;
    flowCatalogPath?: string;
    mode: AnalysisMode;
    framework: FrameworkType;
    timeLimitMinutes: number;
    budget: BudgetConfig;
    artifacts: ArtifactConfig;
    selectors: SelectorConfig;
    testDiscovery: TestDiscoveryConfig;
    flowDiscovery: FlowDiscoveryConfig;
    catalogScoring: CatalogScoringConfig;
    impact: {
        allowFallback: boolean;
    };
    pipeline: PipelineConfig;
    llm: LLMConfig;
    specPDF?: string;
    risk: RiskConfig;
    flags: FlagConfig;
    audience: AudienceConfig;
    blastRadius: BlastRadiusConfig;
    git: GitConfig;
}

export interface ResolvedConfig {
    config: AgentConfig;
    configPath?: string;
    rootDir: string;
}

const DEFAULT_CONFIG: AgentConfig = {
    path: '.',
    testsRoot: undefined,
    flowCatalogPath: undefined,
    mode: 'impact',
    framework: 'auto',
    timeLimitMinutes: 10,
    budget: {
        maxUSD: 2,
        maxTokens: 20000,
    },
    artifacts: {
        mode: 'commit',
        specsDir: '.e2e-ai-agents/reports',
    },
    selectors: {
        patchOnApply: true,
    },
    testDiscovery: {
        patterns: [],
    },
    flowDiscovery: {
        patterns: [],
        exclude: [],
    },
    catalogScoring: {
        priorityScores: {
            P0: 10,
            P1: 6,
            P2: 3,
        },
        fileMatchWeight: 1,
    },
    impact: {
        allowFallback: false,
    },
    pipeline: {
        enabled: false,
        scenarios: 3,
        outputDir: 'specs/functional/ai-assisted',
        heal: true,
        mcp: false,
    },
    llm: {
        provider: 'anthropic',
        fallback: 'ollama',
    },
    risk: {
        p0Threshold: 7,
        p1Threshold: 4,
        criticalKeywords: [
            'auth',
            'login',
            'logout',
            'signup',
            'register',
            'onboarding',
            'checkout',
            'payment',
            'billing',
            'subscription',
            'admin',
            'permissions',
            'settings',
            'profile',
            'search',
            'dashboard',
            'message',
            'notifications',
        ],
    },
    flags: {
        defaultState: 'on',
    },
    audience: {
        defaultRoles: ['member'],
    },
    blastRadius: {
        memberBonus: 1,
        guestBonus: 1,
        adminOnlyPenalty: -1,
        flagOffPenalty: -2,
    },
    git: {
        since: 'HEAD~1',
        includeUncommitted: true,
    },
};

export interface ConfigOverrides {
    path?: string;
    testsRoot?: string;
    flowCatalogPath?: string;
    mode?: AnalysisMode;
    framework?: FrameworkType;
    timeLimitMinutes?: number;
    budget?: BudgetConfig;
    testPatterns?: string[];
    flowPatterns?: string[];
    flowExclude?: string[];
    specPDF?: string;
    gitSince?: string;
    pipeline?: Partial<PipelineConfig>;
}

function safeReadJson(path: string): Record<string, unknown> | undefined {
    try {
        if (!existsSync(path)) {
            return undefined;
        }
        const raw = readFileSync(path, 'utf-8');
        return JSON.parse(raw) as Record<string, unknown>;
    } catch {
        return undefined;
    }
}

function mergeConfig(base: AgentConfig, patch: Partial<AgentConfig>): AgentConfig {
    return {
        ...base,
        ...patch,
        budget: {
            ...base.budget,
            ...(patch.budget || {}),
        },
        artifacts: {
            ...base.artifacts,
            ...(patch.artifacts || {}),
        },
        selectors: {
            ...base.selectors,
            ...(patch.selectors || {}),
        },
        testDiscovery: {
            ...base.testDiscovery,
            ...(patch.testDiscovery || {}),
        },
        flowDiscovery: {
            ...base.flowDiscovery,
            ...(patch.flowDiscovery || {}),
        },
        catalogScoring: {
            ...base.catalogScoring,
            ...(patch.catalogScoring || {}),
        },
        impact: {
            ...base.impact,
            ...(patch.impact || {}),
        },
        pipeline: {
            ...base.pipeline,
            ...(patch.pipeline || {}),
        },
        llm: {
            ...base.llm,
            ...(patch.llm || {}),
        },
        risk: {
            ...base.risk,
            ...(patch.risk || {}),
        },
        flags: {
            ...base.flags,
            ...(patch.flags || {}),
        },
        audience: {
            ...base.audience,
            ...(patch.audience || {}),
        },
        blastRadius: {
            ...base.blastRadius,
            ...(patch.blastRadius || {}),
        },
        git: {
            ...base.git,
            ...(patch.git || {}),
        },
    };
}

function coerceNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return undefined;
}

function normalizeMode(value: unknown): AnalysisMode | undefined {
    if (value === 'impact' || value === 'gap') {
        return value;
    }
    return undefined;
}

function normalizeFramework(value: unknown): FrameworkType | undefined {
    if (value === 'auto' || value === 'playwright' || value === 'cypress' || value === 'selenium') {
        return value;
    }
    return undefined;
}

function normalizeFlagState(value: unknown): FlagState | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === 'on' || normalized === 'off' || normalized === 'unknown') {
        return normalized as FlagState;
    }
    return undefined;
}

function extractConfigPatch(raw: Record<string, unknown>): Partial<AgentConfig> {
    const patch: Partial<AgentConfig> = {};

    if (typeof raw.path === 'string') {
        patch.path = raw.path;
    }
    if (typeof raw.testsRoot === 'string') {
        patch.testsRoot = raw.testsRoot;
    }
    if (typeof raw.flowCatalogPath === 'string') {
        patch.flowCatalogPath = raw.flowCatalogPath;
    }

    const mode = normalizeMode(raw.mode);
    if (mode) {
        patch.mode = mode;
    }

    const framework = normalizeFramework(raw.framework);
    if (framework) {
        patch.framework = framework;
    }

    const timeLimitMinutes = coerceNumber(raw.timeLimitMinutes);
    if (timeLimitMinutes !== undefined) {
        patch.timeLimitMinutes = timeLimitMinutes;
    }

    if (raw.budget && typeof raw.budget === 'object') {
        const budget = raw.budget as Record<string, unknown>;
        patch.budget = {
            maxUSD: coerceNumber(budget.maxUSD),
            maxTokens: coerceNumber(budget.maxTokens),
        };
    }

    if (raw.artifacts && typeof raw.artifacts === 'object') {
        const artifacts = raw.artifacts as Record<string, unknown>;
        const mode =
            artifacts.mode === 'commit' || artifacts.mode === 'keep-local' || artifacts.mode === 'none'
                ? artifacts.mode
                : undefined;
        const specsDir = typeof artifacts.specsDir === 'string' ? artifacts.specsDir : undefined;
        if (mode || specsDir) {
            patch.artifacts = {
                mode: mode ?? DEFAULT_CONFIG.artifacts.mode,
                specsDir: specsDir ?? DEFAULT_CONFIG.artifacts.specsDir,
            };
        }
    }

    if (raw.selectors && typeof raw.selectors === 'object') {
        const selectors = raw.selectors as Record<string, unknown>;
        patch.selectors = {
            patchOnApply: selectors.patchOnApply !== undefined ? Boolean(selectors.patchOnApply) : DEFAULT_CONFIG.selectors.patchOnApply,
        };
    }

    if (raw.testDiscovery && typeof raw.testDiscovery === 'object') {
        const testDiscovery = raw.testDiscovery as Record<string, unknown>;
        patch.testDiscovery = {
            patterns: Array.isArray(testDiscovery.patterns)
                ? testDiscovery.patterns.filter((pattern) => typeof pattern === 'string')
                : undefined,
        };
    }

    if (raw.flowDiscovery && typeof raw.flowDiscovery === 'object') {
        const flowDiscovery = raw.flowDiscovery as Record<string, unknown>;
        patch.flowDiscovery = {
            patterns: Array.isArray(flowDiscovery.patterns)
                ? flowDiscovery.patterns.filter((pattern) => typeof pattern === 'string')
                : undefined,
            exclude: Array.isArray(flowDiscovery.exclude)
                ? flowDiscovery.exclude.filter((pattern) => typeof pattern === 'string')
                : undefined,
        };
    }

    if (raw.catalogScoring && typeof raw.catalogScoring === 'object') {
        const catalogScoring = raw.catalogScoring as Record<string, unknown>;
        const priorityScores = catalogScoring.priorityScores as Record<string, unknown> | undefined;
        patch.catalogScoring = {
            priorityScores: {
                P0: coerceNumber(priorityScores?.P0) ?? DEFAULT_CONFIG.catalogScoring.priorityScores.P0,
                P1: coerceNumber(priorityScores?.P1) ?? DEFAULT_CONFIG.catalogScoring.priorityScores.P1,
                P2: coerceNumber(priorityScores?.P2) ?? DEFAULT_CONFIG.catalogScoring.priorityScores.P2,
            },
            fileMatchWeight: coerceNumber(catalogScoring.fileMatchWeight) ?? DEFAULT_CONFIG.catalogScoring.fileMatchWeight,
        };
    }

    if (raw.impact && typeof raw.impact === 'object') {
        const impact = raw.impact as Record<string, unknown>;
        patch.impact = {
            allowFallback: impact.allowFallback !== undefined ? Boolean(impact.allowFallback) : DEFAULT_CONFIG.impact.allowFallback,
        };
    }

    if (raw.pipeline && typeof raw.pipeline === 'object') {
        const pipeline = raw.pipeline as Record<string, unknown>;
        patch.pipeline = {
            enabled: pipeline.enabled !== undefined ? Boolean(pipeline.enabled) : DEFAULT_CONFIG.pipeline.enabled,
            scenarios: coerceNumber(pipeline.scenarios) ?? DEFAULT_CONFIG.pipeline.scenarios,
            outputDir: typeof pipeline.outputDir === 'string' ? pipeline.outputDir : DEFAULT_CONFIG.pipeline.outputDir,
            heal: pipeline.heal !== undefined ? Boolean(pipeline.heal) : DEFAULT_CONFIG.pipeline.heal,
            baseUrl: typeof pipeline.baseUrl === 'string' ? pipeline.baseUrl : undefined,
            browser:
                pipeline.browser === 'chrome' ||
                pipeline.browser === 'chromium' ||
                pipeline.browser === 'firefox' ||
                pipeline.browser === 'webkit'
                    ? pipeline.browser
                    : undefined,
            headless: pipeline.headless !== undefined ? Boolean(pipeline.headless) : undefined,
            project: typeof pipeline.project === 'string' ? pipeline.project : undefined,
            parallel: pipeline.parallel !== undefined ? Boolean(pipeline.parallel) : undefined,
            dryRun: pipeline.dryRun !== undefined ? Boolean(pipeline.dryRun) : undefined,
            mcp: pipeline.mcp !== undefined ? Boolean(pipeline.mcp) : DEFAULT_CONFIG.pipeline.mcp,
        };
    }

    if (raw.llm && typeof raw.llm === 'object') {
        const llm = raw.llm as Record<string, unknown>;
        patch.llm = {
            provider: typeof llm.provider === 'string' ? llm.provider : undefined,
            fallback: typeof llm.fallback === 'string' ? llm.fallback : undefined,
        };
    }

    if (typeof raw.specPDF === 'string') {
        patch.specPDF = raw.specPDF;
    }

    if (raw.risk && typeof raw.risk === 'object') {
        const risk = raw.risk as Record<string, unknown>;
        patch.risk = {
            p0Threshold: coerceNumber(risk.p0Threshold) ?? DEFAULT_CONFIG.risk.p0Threshold,
            p1Threshold: coerceNumber(risk.p1Threshold) ?? DEFAULT_CONFIG.risk.p1Threshold,
            criticalKeywords: Array.isArray(risk.criticalKeywords)
                ? risk.criticalKeywords.filter((keyword) => typeof keyword === 'string')
                : DEFAULT_CONFIG.risk.criticalKeywords,
        };
    }

    if (raw.flags && typeof raw.flags === 'object') {
        const flags = raw.flags as Record<string, unknown>;
        patch.flags = {
            defaultState: normalizeFlagState(flags.defaultState) ?? DEFAULT_CONFIG.flags.defaultState,
        };
    }

    if (raw.audience && typeof raw.audience === 'object') {
        const audience = raw.audience as Record<string, unknown>;
        const roles = Array.isArray(audience.defaultRoles)
            ? audience.defaultRoles.filter((role) => typeof role === 'string')
            : [];
        patch.audience = {
            defaultRoles: (roles.length > 0 ? roles : DEFAULT_CONFIG.audience.defaultRoles) as AudienceRole[],
        };
    }

    if (raw.blastRadius && typeof raw.blastRadius === 'object') {
        const blastRadius = raw.blastRadius as Record<string, unknown>;
        patch.blastRadius = {
            memberBonus: coerceNumber(blastRadius.memberBonus) ?? DEFAULT_CONFIG.blastRadius.memberBonus,
            guestBonus: coerceNumber(blastRadius.guestBonus) ?? DEFAULT_CONFIG.blastRadius.guestBonus,
            adminOnlyPenalty: coerceNumber(blastRadius.adminOnlyPenalty) ?? DEFAULT_CONFIG.blastRadius.adminOnlyPenalty,
            flagOffPenalty: coerceNumber(blastRadius.flagOffPenalty) ?? DEFAULT_CONFIG.blastRadius.flagOffPenalty,
        };
    }

    if (raw.git && typeof raw.git === 'object') {
        const git = raw.git as Record<string, unknown>;
        patch.git = {
            since: typeof git.since === 'string' ? git.since : DEFAULT_CONFIG.git.since,
            includeUncommitted:
                git.includeUncommitted !== undefined ? Boolean(git.includeUncommitted) : DEFAULT_CONFIG.git.includeUncommitted,
        };
    }

    return patch;
}

export function resolveConfig(cwd: string, configPath?: string, overrides?: ConfigOverrides): ResolvedConfig {
    const resolvedConfigPath = configPath ? resolve(cwd, configPath) : undefined;
    const configDir = resolvedConfigPath ? dirname(resolvedConfigPath) : cwd;
    const rawConfig = resolvedConfigPath ? safeReadJson(resolvedConfigPath) : undefined;
    const configPatch = rawConfig ? extractConfigPatch(rawConfig) : {};
    let config = mergeConfig(DEFAULT_CONFIG, configPatch);

    if (overrides?.mode) {
        config.mode = overrides.mode;
    }
    if (overrides?.framework) {
        config.framework = overrides.framework;
    }
    if (overrides?.timeLimitMinutes !== undefined) {
        config.timeLimitMinutes = overrides.timeLimitMinutes;
    }
    if (overrides?.budget) {
        const budgetPatch: BudgetConfig = {};
        if (overrides.budget.maxUSD !== undefined) {
            budgetPatch.maxUSD = overrides.budget.maxUSD;
        }
        if (overrides.budget.maxTokens !== undefined) {
            budgetPatch.maxTokens = overrides.budget.maxTokens;
        }
        config.budget = {...config.budget, ...budgetPatch};
    }
    if (overrides?.testPatterns && overrides.testPatterns.length > 0) {
        config.testDiscovery = {patterns: overrides.testPatterns};
    }
    if (overrides?.flowPatterns && overrides.flowPatterns.length > 0) {
        config.flowDiscovery = {
            patterns: overrides.flowPatterns,
            exclude: overrides.flowExclude,
        };
    } else if (overrides?.flowExclude && overrides.flowExclude.length > 0) {
        config.flowDiscovery = {
            ...config.flowDiscovery,
            exclude: overrides.flowExclude,
        };
    }
    if (overrides?.pipeline) {
        const pipelinePatch: Partial<PipelineConfig> = {};
        if (overrides.pipeline.enabled !== undefined) {
            pipelinePatch.enabled = overrides.pipeline.enabled;
        }
        if (overrides.pipeline.scenarios !== undefined) {
            pipelinePatch.scenarios = overrides.pipeline.scenarios;
        }
        if (overrides.pipeline.outputDir) {
            pipelinePatch.outputDir = overrides.pipeline.outputDir;
        }
        if (overrides.pipeline.heal !== undefined) {
            pipelinePatch.heal = overrides.pipeline.heal;
        }
        if (overrides.pipeline.baseUrl) {
            pipelinePatch.baseUrl = overrides.pipeline.baseUrl;
        }
        if (overrides.pipeline.browser) {
            pipelinePatch.browser = overrides.pipeline.browser;
        }
        if (overrides.pipeline.headless !== undefined) {
            pipelinePatch.headless = overrides.pipeline.headless;
        }
        if (overrides.pipeline.project) {
            pipelinePatch.project = overrides.pipeline.project;
        }
        if (overrides.pipeline.parallel !== undefined) {
            pipelinePatch.parallel = overrides.pipeline.parallel;
        }
        if (overrides.pipeline.dryRun !== undefined) {
            pipelinePatch.dryRun = overrides.pipeline.dryRun;
        }
        config.pipeline = {...config.pipeline, ...pipelinePatch};
    }
    if (overrides?.specPDF) {
        config.specPDF = overrides.specPDF;
    }
    if (overrides?.gitSince) {
        config.git.since = overrides.gitSince;
    }
    if (overrides?.path) {
        config.path = overrides.path;
    }
    if (overrides?.testsRoot) {
        config.testsRoot = overrides.testsRoot;
    }
    if (overrides?.flowCatalogPath) {
        config.flowCatalogPath = overrides.flowCatalogPath;
    }

    const resolvedRoot = resolve(configDir, config.path);
    config.path = resolvedRoot;
    if (config.testsRoot) {
        config.testsRoot = resolve(configDir, config.testsRoot);
    } else {
        config.testsRoot = resolvedRoot;
    }
    if (config.flowCatalogPath) {
        config.flowCatalogPath = resolve(configDir, config.flowCatalogPath);
    }

    return {
        config,
        configPath: resolvedConfigPath,
        rootDir: resolvedRoot,
    };
}
