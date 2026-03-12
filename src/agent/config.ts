// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, readFileSync} from 'fs';
import {dirname, resolve} from 'path';

export type AnalysisMode = 'impact' | 'gap';
export type FrameworkType = 'auto' | 'playwright' | 'cypress' | 'selenium' | 'unknown';
export type ArtifactMode = 'commit' | 'keep-local' | 'none';
export type AnalysisProfile = 'default' | 'mattermost';

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
    mcpAllowFallback?: boolean;
    mcpOnly?: boolean;
    mcpCommandTimeoutMs?: number;
    mcpRetries?: number;
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

export interface PolicyConfig {
    minConfidenceForTargeted: number;
    safeMergeMinConfidence: number;
    forceFullOnWarningsAtOrAbove: number;
    forceFullOnP0WithGaps: boolean;
    forceFullOnRiskyFiles: boolean;
    riskyFilePatterns: string[];
    enforcementMode: 'advisory' | 'warn' | 'block';
    blockOnActions: Array<'run-now' | 'must-add-tests' | 'safe-to-merge'>;
}

export interface DependencyGraphImpactConfig {
    enabled: boolean;
    maxDepth: number;
    maxExpandedFiles: number;
    filePatterns: string[];
    excludePatterns: string[];
    aliasRoots: string[];
    pathAliases: Record<string, string[]>;
}

export interface TraceabilityImpactConfig {
    enabled: boolean;
    manifestPath: string;
    minSignalsPerTest: number;
}

export interface SubsystemRiskImpactConfig {
    enabled: boolean;
    mapPath: string;
    maxRulesPerFile: number;
}

export type AIMappingProvider = 'anthropic' | 'openai' | 'ollama' | 'auto';

export interface AIMappingImpactConfig {
    enabled: boolean;
    provider: AIMappingProvider;
    contextFiles: string[];
    maxFlowsPerRequest: number;
    maxCandidateTests: number;
    maxTokens: number;
    temperature: number;
}

export interface AIFlowImpactConfig {
    enabled: boolean;
    strict: boolean;
    provider: AIMappingProvider;
    contextFiles: string[];
    maxFilesPerRequest: number;
    maxFlowsPerRequest: number;
    maxTokens: number;
    temperature: number;
}

export interface GitConfig {
    since: string;
    includeUncommitted?: boolean;
}

export interface RouteFamiliesConfig {
    manifestPath?: string;
    strict?: boolean;
}

export interface ApiSurfaceConfig {
    enabled: boolean;
    pageObjectsDir?: string;
    componentsDir?: string;
    cachePath?: string;
}

export interface AgentConfig {
    path: string;
    profile: AnalysisProfile;
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
        dependencyGraph: DependencyGraphImpactConfig;
        traceability: TraceabilityImpactConfig;
        subsystemRisk: SubsystemRiskImpactConfig;
        aiFlow: AIFlowImpactConfig;
        aiMapping: AIMappingImpactConfig;
    };
    pipeline: PipelineConfig;
    llm: LLMConfig;
    specPDF?: string;
    risk: RiskConfig;
    policy: PolicyConfig;
    flags: FlagConfig;
    audience: AudienceConfig;
    blastRadius: BlastRadiusConfig;
    git: GitConfig;
    routeFamilies: RouteFamiliesConfig;
    apiSurface: ApiSurfaceConfig;
}

export interface ResolvedConfig {
    config: AgentConfig;
    configPath?: string;
    rootDir: string;
}

const DEFAULT_CONFIG: AgentConfig = {
    path: '.',
    profile: 'default',
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
        dependencyGraph: {
            enabled: true,
            maxDepth: 3,
            maxExpandedFiles: 1000,
            filePatterns: ['**/*.{ts,tsx,js,jsx}'],
            excludePatterns: [
                '**/node_modules/**',
                '**/.git/**',
                '**/dist/**',
                '**/build/**',
                '**/coverage/**',
                '**/__tests__/**',
                '**/tests/**',
                '**/*.spec.*',
                '**/*.test.*',
            ],
            aliasRoots: ['src'],
            pathAliases: {},
        },
        traceability: {
            enabled: true,
            manifestPath: '.e2e-ai-agents/traceability.json',
            minSignalsPerTest: 1,
        },
        subsystemRisk: {
            enabled: false,
            mapPath: '.e2e-ai-agents/subsystem-risk-map.json',
            maxRulesPerFile: 4,
        },
        aiFlow: {
            enabled: false,
            strict: false,
            provider: 'auto',
            contextFiles: [
                'CLAUDE.OPTIONAL.md',
                '.claude/CLAUDE.OPTIONAL.md',
            ],
            maxFilesPerRequest: 220,
            maxFlowsPerRequest: 80,
            maxTokens: 4000,
            temperature: 0,
        },
        aiMapping: {
            enabled: false,
            provider: 'auto',
            contextFiles: [
                'CLAUDE.OPTIONAL.md',
                '.claude/CLAUDE.OPTIONAL.md',
            ],
            maxFlowsPerRequest: 30,
            maxCandidateTests: 400,
            maxTokens: 4000,
            temperature: 0,
        },
    },
    pipeline: {
        enabled: false,
        scenarios: 3,
        outputDir: 'specs/functional/ai-assisted',
        heal: true,
        project: 'chrome',
        mcp: false,
        mcpAllowFallback: false,
        mcpOnly: false,
        mcpCommandTimeoutMs: 180000,
        mcpRetries: 1,
    },
    llm: {
        provider: 'auto',
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
    policy: {
        minConfidenceForTargeted: 60,
        safeMergeMinConfidence: 85,
        forceFullOnWarningsAtOrAbove: 2,
        forceFullOnP0WithGaps: true,
        forceFullOnRiskyFiles: true,
        riskyFilePatterns: [
            '**/auth/**',
            '**/login/**',
            '**/permissions/**',
            '**/*permission*',
            '**/admin/**',
            '**/security/**',
            '**/migrations/**',
            '**/*migration*',
            '**/schema/**',
            '**/*.sql',
            '**/webhook/**',
        ],
        enforcementMode: 'advisory',
        blockOnActions: ['must-add-tests'],
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
    routeFamilies: {
        strict: false,
    },
    apiSurface: {
        enabled: false,
    },
};

function normalizeMattermostProvider(
    rawProvider: unknown,
    fallback: AIMappingProvider,
    strict = false,
): AIMappingProvider {
    if (typeof rawProvider !== 'string') {
        return fallback;
    }
    const normalized = rawProvider.trim().toLowerCase();
    if (
        normalized === 'anthropic'
        || normalized === 'openai'
        || normalized === 'ollama'
        || normalized === 'auto'
    ) {
        return normalized;
    }
    if (strict) {
        throw new Error(
            `Invalid provider "${rawProvider}". Allowed values for Mattermost flows: ollama, anthropic, openai, auto.`,
        );
    }
    return fallback;
}

function resolveMattermostProvider(config: AgentConfig): AIMappingProvider {
    const envProvider = process.env.LLM_PROVIDER?.trim().toLowerCase();
    const envResolved = envProvider ? normalizeMattermostProvider(envProvider, 'auto', true) : 'auto';
    const llmProvider = normalizeMattermostProvider(config.llm.provider, 'auto', true);
    return envResolved !== 'auto' ? envResolved : llmProvider;
}

export interface ConfigOverrides {
    path?: string;
    profile?: AnalysisProfile;
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
    policy?: Partial<PolicyConfig>;
    llmProvider?: string;
    llmFallback?: string;
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
            dependencyGraph: {
                ...base.impact.dependencyGraph,
                ...(patch.impact?.dependencyGraph || {}),
                pathAliases: {
                    ...base.impact.dependencyGraph.pathAliases,
                    ...(patch.impact?.dependencyGraph?.pathAliases || {}),
                },
            },
            traceability: {
                ...base.impact.traceability,
                ...(patch.impact?.traceability || {}),
            },
            subsystemRisk: {
                ...base.impact.subsystemRisk,
                ...(patch.impact?.subsystemRisk || {}),
            },
            aiFlow: {
                ...base.impact.aiFlow,
                ...(patch.impact?.aiFlow || {}),
            },
            aiMapping: {
                ...base.impact.aiMapping,
                ...(patch.impact?.aiMapping || {}),
            },
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
        policy: {
            ...base.policy,
            ...(patch.policy || {}),
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
        routeFamilies: {
            ...base.routeFamilies,
            ...(patch.routeFamilies || {}),
        },
        apiSurface: {
            ...base.apiSurface,
            ...(patch.apiSurface || {}),
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

function normalizeProfile(value: unknown): AnalysisProfile | undefined {
    if (value === 'default' || value === 'mattermost') {
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

function normalizePolicyEnforcementMode(value: unknown): PolicyConfig['enforcementMode'] | undefined {
    if (value === 'advisory' || value === 'warn' || value === 'block') {
        return value;
    }
    return undefined;
}

function normalizePolicyBlockAction(value: unknown): 'run-now' | 'must-add-tests' | 'safe-to-merge' | undefined {
    if (value === 'run-now' || value === 'must-add-tests' || value === 'safe-to-merge') {
        return value;
    }
    return undefined;
}

function extractConfigPatch(raw: Record<string, unknown>): Partial<AgentConfig> {
    const patch: Partial<AgentConfig> = {};

    if (typeof raw.path === 'string') {
        patch.path = raw.path;
    }
    const profile = normalizeProfile(raw.profile);
    if (profile) {
        patch.profile = profile;
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
        const dependencyGraphRaw =
            impact.dependencyGraph && typeof impact.dependencyGraph === 'object'
                ? impact.dependencyGraph as Record<string, unknown>
                : undefined;
        const traceabilityRaw =
            impact.traceability && typeof impact.traceability === 'object'
                ? impact.traceability as Record<string, unknown>
                : undefined;
        const subsystemRiskRaw =
            impact.subsystemRisk && typeof impact.subsystemRisk === 'object'
                ? impact.subsystemRisk as Record<string, unknown>
                : undefined;
        const aiMappingRaw =
            impact.aiMapping && typeof impact.aiMapping === 'object'
                ? impact.aiMapping as Record<string, unknown>
                : undefined;
        const aiFlowRaw =
            impact.aiFlow && typeof impact.aiFlow === 'object'
                ? impact.aiFlow as Record<string, unknown>
                : undefined;
        const pathAliasesRaw =
            dependencyGraphRaw?.pathAliases && typeof dependencyGraphRaw.pathAliases === 'object'
                ? dependencyGraphRaw.pathAliases as Record<string, unknown>
                : undefined;
        const parsedPathAliases: Record<string, string[]> = {};
        if (pathAliasesRaw) {
            for (const [key, value] of Object.entries(pathAliasesRaw)) {
                if (typeof value === 'string') {
                    parsedPathAliases[key] = [value];
                    continue;
                }
                if (Array.isArray(value)) {
                    const targets = value.filter((item) => typeof item === 'string');
                    if (targets.length > 0) {
                        parsedPathAliases[key] = targets;
                    }
                }
            }
        }
        patch.impact = {
            allowFallback: impact.allowFallback !== undefined ? Boolean(impact.allowFallback) : DEFAULT_CONFIG.impact.allowFallback,
            dependencyGraph: {
                enabled:
                    dependencyGraphRaw?.enabled !== undefined
                        ? Boolean(dependencyGraphRaw.enabled)
                        : DEFAULT_CONFIG.impact.dependencyGraph.enabled,
                maxDepth:
                    coerceNumber(dependencyGraphRaw?.maxDepth) ?? DEFAULT_CONFIG.impact.dependencyGraph.maxDepth,
                maxExpandedFiles:
                    coerceNumber(dependencyGraphRaw?.maxExpandedFiles) ?? DEFAULT_CONFIG.impact.dependencyGraph.maxExpandedFiles,
                filePatterns: Array.isArray(dependencyGraphRaw?.filePatterns)
                    ? dependencyGraphRaw?.filePatterns.filter((pattern) => typeof pattern === 'string')
                    : DEFAULT_CONFIG.impact.dependencyGraph.filePatterns,
                excludePatterns: Array.isArray(dependencyGraphRaw?.excludePatterns)
                    ? dependencyGraphRaw?.excludePatterns.filter((pattern) => typeof pattern === 'string')
                    : DEFAULT_CONFIG.impact.dependencyGraph.excludePatterns,
                aliasRoots: Array.isArray(dependencyGraphRaw?.aliasRoots)
                    ? dependencyGraphRaw?.aliasRoots.filter((pattern) => typeof pattern === 'string')
                    : DEFAULT_CONFIG.impact.dependencyGraph.aliasRoots,
                pathAliases: pathAliasesRaw
                    ? parsedPathAliases
                    : DEFAULT_CONFIG.impact.dependencyGraph.pathAliases,
            },
            traceability: {
                enabled: traceabilityRaw?.enabled !== undefined
                    ? Boolean(traceabilityRaw.enabled)
                    : DEFAULT_CONFIG.impact.traceability.enabled,
                manifestPath:
                    typeof traceabilityRaw?.manifestPath === 'string'
                        ? traceabilityRaw.manifestPath
                        : DEFAULT_CONFIG.impact.traceability.manifestPath,
                minSignalsPerTest:
                    coerceNumber(traceabilityRaw?.minSignalsPerTest) ?? DEFAULT_CONFIG.impact.traceability.minSignalsPerTest,
            },
            subsystemRisk: {
                enabled: subsystemRiskRaw?.enabled !== undefined
                    ? Boolean(subsystemRiskRaw.enabled)
                    : DEFAULT_CONFIG.impact.subsystemRisk.enabled,
                mapPath:
                    typeof subsystemRiskRaw?.mapPath === 'string'
                        ? subsystemRiskRaw.mapPath
                        : DEFAULT_CONFIG.impact.subsystemRisk.mapPath,
                maxRulesPerFile:
                    coerceNumber(subsystemRiskRaw?.maxRulesPerFile) ?? DEFAULT_CONFIG.impact.subsystemRisk.maxRulesPerFile,
            },
            aiFlow: {
                enabled: aiFlowRaw?.enabled !== undefined
                    ? Boolean(aiFlowRaw.enabled)
                    : DEFAULT_CONFIG.impact.aiFlow.enabled,
                strict: aiFlowRaw?.strict !== undefined
                    ? Boolean(aiFlowRaw.strict)
                    : DEFAULT_CONFIG.impact.aiFlow.strict,
                provider:
                    aiFlowRaw?.provider === 'anthropic' ||
                    aiFlowRaw?.provider === 'openai' ||
                    aiFlowRaw?.provider === 'ollama' ||
                    aiFlowRaw?.provider === 'auto'
                        ? aiFlowRaw.provider
                        : DEFAULT_CONFIG.impact.aiFlow.provider,
                contextFiles: Array.isArray(aiFlowRaw?.contextFiles)
                    ? aiFlowRaw.contextFiles.filter((entry) => typeof entry === 'string')
                    : DEFAULT_CONFIG.impact.aiFlow.contextFiles,
                maxFilesPerRequest:
                    coerceNumber(aiFlowRaw?.maxFilesPerRequest) ?? DEFAULT_CONFIG.impact.aiFlow.maxFilesPerRequest,
                maxFlowsPerRequest:
                    coerceNumber(aiFlowRaw?.maxFlowsPerRequest) ?? DEFAULT_CONFIG.impact.aiFlow.maxFlowsPerRequest,
                maxTokens:
                    coerceNumber(aiFlowRaw?.maxTokens) ?? DEFAULT_CONFIG.impact.aiFlow.maxTokens,
                temperature:
                    coerceNumber(aiFlowRaw?.temperature) ?? DEFAULT_CONFIG.impact.aiFlow.temperature,
            },
            aiMapping: {
                enabled: aiMappingRaw?.enabled !== undefined
                    ? Boolean(aiMappingRaw.enabled)
                    : DEFAULT_CONFIG.impact.aiMapping.enabled,
                provider:
                    aiMappingRaw?.provider === 'anthropic' ||
                    aiMappingRaw?.provider === 'openai' ||
                    aiMappingRaw?.provider === 'ollama' ||
                    aiMappingRaw?.provider === 'auto'
                        ? aiMappingRaw.provider
                        : DEFAULT_CONFIG.impact.aiMapping.provider,
                contextFiles: Array.isArray(aiMappingRaw?.contextFiles)
                    ? aiMappingRaw.contextFiles.filter((path) => typeof path === 'string')
                    : DEFAULT_CONFIG.impact.aiMapping.contextFiles,
                maxFlowsPerRequest:
                    coerceNumber(aiMappingRaw?.maxFlowsPerRequest) ?? DEFAULT_CONFIG.impact.aiMapping.maxFlowsPerRequest,
                maxCandidateTests:
                    coerceNumber(aiMappingRaw?.maxCandidateTests) ?? DEFAULT_CONFIG.impact.aiMapping.maxCandidateTests,
                maxTokens:
                    coerceNumber(aiMappingRaw?.maxTokens) ?? DEFAULT_CONFIG.impact.aiMapping.maxTokens,
                temperature:
                    coerceNumber(aiMappingRaw?.temperature) ?? DEFAULT_CONFIG.impact.aiMapping.temperature,
            },
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
            mcpAllowFallback:
                pipeline.mcpAllowFallback !== undefined
                    ? Boolean(pipeline.mcpAllowFallback)
                    : DEFAULT_CONFIG.pipeline.mcpAllowFallback,
            mcpOnly:
                pipeline.mcpOnly !== undefined
                    ? Boolean(pipeline.mcpOnly)
                    : DEFAULT_CONFIG.pipeline.mcpOnly,
            mcpCommandTimeoutMs:
                coerceNumber(pipeline.mcpCommandTimeoutMs) ?? DEFAULT_CONFIG.pipeline.mcpCommandTimeoutMs,
            mcpRetries:
                coerceNumber(pipeline.mcpRetries) ?? DEFAULT_CONFIG.pipeline.mcpRetries,
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

    if (raw.policy && typeof raw.policy === 'object') {
        const policy = raw.policy as Record<string, unknown>;
        const blockOnActions = Array.isArray(policy.blockOnActions)
            ? policy.blockOnActions
                .map((value) => normalizePolicyBlockAction(value))
                .filter((value): value is 'run-now' | 'must-add-tests' | 'safe-to-merge' => Boolean(value))
            : DEFAULT_CONFIG.policy.blockOnActions;
        patch.policy = {
            minConfidenceForTargeted:
                coerceNumber(policy.minConfidenceForTargeted) ?? DEFAULT_CONFIG.policy.minConfidenceForTargeted,
            safeMergeMinConfidence: coerceNumber(policy.safeMergeMinConfidence) ?? DEFAULT_CONFIG.policy.safeMergeMinConfidence,
            forceFullOnWarningsAtOrAbove:
                coerceNumber(policy.forceFullOnWarningsAtOrAbove) ?? DEFAULT_CONFIG.policy.forceFullOnWarningsAtOrAbove,
            forceFullOnP0WithGaps:
                policy.forceFullOnP0WithGaps !== undefined
                    ? Boolean(policy.forceFullOnP0WithGaps)
                    : DEFAULT_CONFIG.policy.forceFullOnP0WithGaps,
            forceFullOnRiskyFiles:
                policy.forceFullOnRiskyFiles !== undefined
                    ? Boolean(policy.forceFullOnRiskyFiles)
                    : DEFAULT_CONFIG.policy.forceFullOnRiskyFiles,
            riskyFilePatterns: Array.isArray(policy.riskyFilePatterns)
                ? policy.riskyFilePatterns.filter((pattern) => typeof pattern === 'string')
                : DEFAULT_CONFIG.policy.riskyFilePatterns,
            enforcementMode: normalizePolicyEnforcementMode(policy.enforcementMode) ?? DEFAULT_CONFIG.policy.enforcementMode,
            blockOnActions: blockOnActions.length > 0 ? blockOnActions : DEFAULT_CONFIG.policy.blockOnActions,
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

    if (raw.routeFamilies && typeof raw.routeFamilies === 'object') {
        const rf = raw.routeFamilies as Record<string, unknown>;
        patch.routeFamilies = {
            manifestPath: typeof rf.manifestPath === 'string' ? rf.manifestPath : undefined,
            strict: rf.strict !== undefined ? Boolean(rf.strict) : DEFAULT_CONFIG.routeFamilies.strict,
        };
    }

    if (raw.apiSurface && typeof raw.apiSurface === 'object') {
        const api = raw.apiSurface as Record<string, unknown>;
        patch.apiSurface = {
            enabled: api.enabled !== undefined ? Boolean(api.enabled) : DEFAULT_CONFIG.apiSurface.enabled,
            pageObjectsDir: typeof api.pageObjectsDir === 'string' ? api.pageObjectsDir : undefined,
            componentsDir: typeof api.componentsDir === 'string' ? api.componentsDir : undefined,
            cachePath: typeof api.cachePath === 'string' ? api.cachePath : undefined,
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

    if (overrides?.profile) {
        config.profile = overrides.profile;
    }
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
        if (overrides.pipeline.mcp !== undefined) {
            pipelinePatch.mcp = overrides.pipeline.mcp;
        }
        if (overrides.pipeline.mcpAllowFallback !== undefined) {
            pipelinePatch.mcpAllowFallback = overrides.pipeline.mcpAllowFallback;
        }
        if (overrides.pipeline.mcpOnly !== undefined) {
            pipelinePatch.mcpOnly = overrides.pipeline.mcpOnly;
        }
        if (overrides.pipeline.mcpCommandTimeoutMs !== undefined) {
            pipelinePatch.mcpCommandTimeoutMs = overrides.pipeline.mcpCommandTimeoutMs;
        }
        if (overrides.pipeline.mcpRetries !== undefined) {
            pipelinePatch.mcpRetries = overrides.pipeline.mcpRetries;
        }
        config.pipeline = {...config.pipeline, ...pipelinePatch};
    }
    if (overrides?.policy) {
        const policyPatch: Partial<PolicyConfig> = {};
        if (overrides.policy.minConfidenceForTargeted !== undefined) {
            policyPatch.minConfidenceForTargeted = overrides.policy.minConfidenceForTargeted;
        }
        if (overrides.policy.safeMergeMinConfidence !== undefined) {
            policyPatch.safeMergeMinConfidence = overrides.policy.safeMergeMinConfidence;
        }
        if (overrides.policy.forceFullOnWarningsAtOrAbove !== undefined) {
            policyPatch.forceFullOnWarningsAtOrAbove = overrides.policy.forceFullOnWarningsAtOrAbove;
        }
        if (overrides.policy.forceFullOnP0WithGaps !== undefined) {
            policyPatch.forceFullOnP0WithGaps = overrides.policy.forceFullOnP0WithGaps;
        }
        if (overrides.policy.forceFullOnRiskyFiles !== undefined) {
            policyPatch.forceFullOnRiskyFiles = overrides.policy.forceFullOnRiskyFiles;
        }
        if (overrides.policy.riskyFilePatterns && overrides.policy.riskyFilePatterns.length > 0) {
            policyPatch.riskyFilePatterns = overrides.policy.riskyFilePatterns;
        }
        if (overrides.policy.enforcementMode !== undefined) {
            policyPatch.enforcementMode = overrides.policy.enforcementMode;
        }
        if (overrides.policy.blockOnActions && overrides.policy.blockOnActions.length > 0) {
            policyPatch.blockOnActions = overrides.policy.blockOnActions;
        }
        config.policy = {...config.policy, ...policyPatch};
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
    if (overrides?.llmProvider !== undefined) {
        config.llm.provider = normalizeMattermostProvider(
            overrides.llmProvider,
            normalizeMattermostProvider(config.llm.provider, 'auto'),
            true,
        );
    }
    if (overrides?.llmFallback !== undefined) {
        config.llm.fallback = overrides.llmFallback;
    }

    if (config.profile === 'mattermost') {
        config.impact.allowFallback = false;
        config.impact.traceability.enabled = true;
        config.impact.traceability.minSignalsPerTest = Math.max(2, config.impact.traceability.minSignalsPerTest);
        config.impact.aiFlow.enabled = true;
        config.impact.aiFlow.strict = true;
        const provider = resolveMattermostProvider(config);
        config.impact.aiFlow.provider = provider;
        config.impact.aiMapping.enabled = true;
        config.impact.aiMapping.provider = provider;
        config.pipeline.mcp = true;
        config.pipeline.mcpOnly = true;
        config.pipeline.mcpAllowFallback = false;
        config.pipeline.mcpCommandTimeoutMs = Math.min(240000, Math.max(60000, config.pipeline.mcpCommandTimeoutMs || 180000));
        config.pipeline.mcpRetries = Math.max(1, Math.min(3, config.pipeline.mcpRetries || 1));
        config.policy.minConfidenceForTargeted = Math.max(75, config.policy.minConfidenceForTargeted);
        config.policy.safeMergeMinConfidence = Math.max(90, config.policy.safeMergeMinConfidence);
        config.policy.forceFullOnWarningsAtOrAbove = 1;
        config.policy.forceFullOnP0WithGaps = true;
        config.policy.forceFullOnRiskyFiles = true;
        config.routeFamilies.strict = true;
        config.apiSurface.enabled = true;
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
    config.impact.subsystemRisk.mapPath = resolve(configDir, config.impact.subsystemRisk.mapPath);

    return {
        config,
        configPath: resolvedConfigPath,
        rootDir: resolvedRoot,
    };
}
