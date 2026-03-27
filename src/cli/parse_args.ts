// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync} from 'fs';
import {dirname, join, resolve} from 'path';

import type {FrameworkType} from '../agent/config.js';
import {logger} from '../logger.js';

import type {Command, ParsedArgs} from './types.js';

export const CONFIG_CANDIDATES = [
    'impact-gate.config.json',
    '.impact-gate.config.json',
    'e2e-ai-agents.config.json',
    '.e2e-ai-agents.config.json',
];

export function findConfigUpwards(startDir: string | undefined): string | undefined {
    if (!startDir) {
        return undefined;
    }
    let current = resolve(startDir);
    while (true) {
        for (const candidate of CONFIG_CANDIDATES) {
            const fullPath = join(current, candidate);
            if (existsSync(fullPath)) {
                return fullPath;
            }
        }
        const parent = dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
    return undefined;
}

export function resolveAutoConfig(args: ParsedArgs): string | undefined {
    if (args.configPath) {
        return args.configPath;
    }

    const searchRoots = [
        process.cwd(),
        args.testsRoot,
        args.path,
    ].filter(Boolean) as string[];

    for (const root of searchRoots) {
        const found = findConfigUpwards(root);
        if (found) {
            return found;
        }
    }

    return undefined;
}

// ---------------------------------------------------------------------------
// Declarative flag definitions
// ---------------------------------------------------------------------------

type FlagType = 'boolean' | 'boolean-false' | 'string' | 'number' | 'number-raw' | 'csv' | 'enum';

interface FlagDef {
    key: keyof ParsedArgs;
    type: FlagType;
    aliases?: string[];
    enumValues?: string[];
    transform?: (value: string) => unknown;
}

const csvSplit = (v: string): string[] => v.split(',').map((s) => s.trim()).filter(Boolean);

// prettier-ignore
const FLAGS: Record<string, FlagDef> = {
    // -- boolean flags --
    '--help':                       {key: 'help', type: 'boolean', aliases: ['-h']},
    '--apply':                      {key: 'apply', type: 'boolean'},
    '--allow-fallback':             {key: 'allowFallback', type: 'boolean'},
    '--pipeline':                   {key: 'pipeline', type: 'boolean'},
    '--pipeline-mcp':               {key: 'pipelineMcp', type: 'boolean'},
    '--pipeline-mcp-allow-fallback': {key: 'pipelineMcpAllowFallback', type: 'boolean'},
    '--pipeline-mcp-only':          {key: 'pipelineMcpOnly', type: 'boolean'},
    '--pipeline-headless':          {key: 'pipelineHeadless', type: 'boolean'},
    '--pipeline-headed':            {key: 'pipelineHeadless', type: 'boolean-false'},
    '--pipeline-parallel':          {key: 'pipelineParallel', type: 'boolean'},
    '--pipeline-dry-run':           {key: 'pipelineDryRun', type: 'boolean'},
    '--fail-on-must-add-tests':     {key: 'failOnMustAddTests', type: 'boolean'},
    '--crew':                       {key: 'crew', type: 'boolean'},
    '--create-pr':                  {key: 'createPr', type: 'boolean'},
    '--dry-run':                    {key: 'dryRun', type: 'boolean'},
    '--generate':                   {key: 'analyzeGenerate', type: 'boolean'},
    '--heal':                       {key: 'analyzeHeal', type: 'boolean'},
    '--no-ai':                      {key: 'noAi', type: 'boolean'},
    '--degraded-mode':              {key: 'degradedMode', type: 'boolean'},
    '--enrich':                     {key: 'trainEnrich', type: 'boolean'},
    '--no-enrich':                  {key: 'trainEnrich', type: 'boolean-false'},
    '--validate':                   {key: 'trainValidate', type: 'boolean'},
    '--yes':                        {key: 'trainYes', type: 'boolean', aliases: ['-y']},
    '--verbose':                    {key: 'verbose', type: 'boolean', aliases: ['-v']},
    '--json':                       {key: 'jsonOutput', type: 'boolean'},
    '--mattermost':                 {key: 'profile', type: 'boolean', transform: () => 'mattermost'},

    // -- string flags --
    '--config':                        {key: 'configPath', type: 'string'},
    '--path':                          {key: 'path', type: 'string'},
    '--tests-root':                    {key: 'testsRoot', type: 'string'},
    '--framework':                     {key: 'framework', type: 'string', transform: (v) => v as FrameworkType},
    '--scenarios':                     {key: 'generateScenarios', type: 'string'},
    '--pipeline-output':               {key: 'pipelineOutput', type: 'string'},
    '--pipeline-base-url':             {key: 'pipelineBaseUrl', type: 'string'},
    '--pipeline-project':              {key: 'pipelineProject', type: 'string'},
    '--spec':                          {key: 'specPDF', type: 'string'},
    '--since':                         {key: 'gitSince', type: 'string'},
    '--llm-provider':                  {key: 'llmProvider', type: 'string'},
    '--ci-comment-path':               {key: 'ciCommentPath', type: 'string'},
    '--github-output':                 {key: 'githubOutputPath', type: 'string'},
    '--feedback-input':                {key: 'feedbackInputPath', type: 'string'},
    '--traceability-report':           {key: 'traceabilityReportPath', type: 'string'},
    '--traceability-capture-output':   {key: 'traceabilityCaptureOutputPath', type: 'string'},
    '--traceability-coverage-map':     {key: 'traceabilityCoverageMapPath', type: 'string'},
    '--traceability-changed-files':    {key: 'traceabilityChangedFilesPath', type: 'string'},
    '--traceability-input':            {key: 'traceabilityInputPath', type: 'string'},
    '--branch':                        {key: 'branch', type: 'string'},
    '--commit-message':                {key: 'commitMessage', type: 'string'},
    '--pr-title':                      {key: 'prTitle', type: 'string'},
    '--pr-body':                       {key: 'prBody', type: 'string'},
    '--pr-base':                       {key: 'prBase', type: 'string'},
    '--generate-output':               {key: 'analyzeGenerateOutputDir', type: 'string'},
    '--heal-report':                   {key: 'analyzeHealReport', type: 'string'},
    '--flow-catalog':                  {key: 'flowCatalogPath', type: 'string'},
    '--output':                        {key: 'trainOutput', type: 'string'},
    '--server-path':                   {key: 'serverPath', type: 'string'},
    '--workflow':                       {key: 'crewWorkflow', type: 'string'},
    '--crew-workflow':                  {key: 'crewWorkflow', type: 'string'},

    // -- number flags (with isFinite guard) --
    '--pipeline-scenarios':              {key: 'pipelineScenarios', type: 'number'},
    '--time':                            {key: 'timeLimitMinutes', type: 'number'},
    '--budget-usd':                      {key: 'budgetUSD', type: 'number'},
    '--budget-tokens':                   {key: 'budgetTokens', type: 'number'},
    '--policy-min-confidence':           {key: 'policyMinConfidence', type: 'number'},
    '--policy-safe-merge-confidence':    {key: 'policySafeMergeConfidence', type: 'number'},
    '--policy-force-full-on-warnings':   {key: 'policyWarningsThreshold', type: 'number'},
    '--traceability-min-hits':           {key: 'traceabilityMinHits', type: 'number'},
    '--traceability-max-files-per-test': {key: 'traceabilityMaxFilesPerTest', type: 'number'},
    '--traceability-max-age-days':       {key: 'traceabilityMaxAgeDays', type: 'number'},
    '--pr':                              {key: 'trainPr', type: 'number'},

    // -- number-raw flags (no isFinite guard, assigned directly via Number()) --
    '--max-attempts':           {key: 'maxAttempts', type: 'number-raw', transform: (v) => parseInt(v, 10)},
    '--pipeline-mcp-timeout-ms': {key: 'pipelineMcpTimeoutMs', type: 'number-raw'},
    '--pipeline-mcp-retries':   {key: 'pipelineMcpRetries', type: 'number-raw'},

    // -- enum flags --
    '--profile':                  {key: 'profile', type: 'enum', enumValues: ['default', 'mattermost']},
    '--pipeline-browser':         {key: 'pipelineBrowser', type: 'enum', enumValues: ['chrome', 'chromium', 'firefox', 'webkit']},
    '--policy-enforcement-mode':  {key: 'policyEnforcementMode', type: 'enum', enumValues: ['advisory', 'warn', 'block']},

    // -- csv flags --
    '--patterns':              {key: 'testPatterns', type: 'csv'},
    '--flow-patterns':         {key: 'flowPatterns', type: 'csv'},
    '--flow-exclude':          {key: 'flowExclude', type: 'csv'},
    '--plugins':               {key: 'plugins', type: 'csv'},
    '--policy-risky-patterns': {key: 'policyRiskyPatterns', type: 'csv'},
    '--policy-block-actions':  {
        key: 'policyBlockActions',
        type: 'csv',
        transform: (v) => csvSplit(v).filter(
            (s): s is 'run-now' | 'must-add-tests' | 'safe-to-merge' =>
                s === 'run-now' || s === 'must-add-tests' || s === 'safe-to-merge',
        ),
    },

    // -- gate command --
    '--threshold':             {key: 'gateThreshold', type: 'number'},

    // -- bootstrap command --
    '--kg-path':               {key: 'bootstrapKgPath', type: 'string'},
    '--scaffold-framework':    {key: 'bootstrapScaffoldFramework', type: 'boolean'},
    '--test-mode':             {key: 'bootstrapTestMode', type: 'enum', enumValues: ['ui', 'api', 'both']},
    '--max-families':          {key: 'bootstrapMaxFamilies', type: 'number'},
};

// Build a lookup from alias -> canonical flag name
const ALIAS_MAP: Record<string, string> = {};
for (const [flag, def] of Object.entries(FLAGS)) {
    ALIAS_MAP[flag] = flag;
    if (def.aliases) {
        for (const alias of def.aliases) {
            ALIAS_MAP[alias] = flag;
        }
    }
}

const COMMANDS = new Set<Command>([
    'init', 'impact', 'plan', 'heal', 'suggest', 'generate',
    'finalize-generated-tests', 'feedback',
    'traceability-capture', 'traceability-ingest',
    'analyze', 'llm-health', 'train', 'crew', 'cost-report', 'gate',
    'bootstrap', 'install-skill',
]);

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function setField(obj: ParsedArgs, key: keyof ParsedArgs, value: unknown): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (obj as any)[key] = value;
}

export function parseArgs(argv: string[]): ParsedArgs {
    const parsed: ParsedArgs = {apply: false, help: false};
    if (argv.length === 0) {
        return parsed;
    }

    const command = argv[0];
    if (COMMANDS.has(command as Command)) {
        parsed.command = command as Command;
    }

    const startIndex = parsed.command ? 1 : 0;

    for (let i = startIndex; i < argv.length; i += 1) {
        const arg = argv[i];
        const canonical = ALIAS_MAP[arg];
        if (!canonical) {
            if (arg.startsWith('--')) {
                logger.warn(`Unknown flag "${arg}" (ignored)`);
            }
            continue;
        }

        const def = FLAGS[canonical];
        const next = argv[i + 1];

        switch (def.type) {
        case 'boolean':
            setField(parsed, def.key, def.transform ? def.transform('') : true);
            break;

        case 'boolean-false':
            setField(parsed, def.key, false);
            break;

        case 'string':
            if (next) {
                setField(parsed, def.key, def.transform ? def.transform(next) : next);
                i += 1;
            }
            break;

        case 'number':
            if (next) {
                const value = Number(next);
                if (Number.isFinite(value)) {
                    setField(parsed, def.key, value);
                }
                i += 1;
            }
            break;

        case 'number-raw':
            if (next) {
                const rawValue = def.transform ? def.transform(next) : Number(next);
                // Allow non-number transforms through; reject NaN/Infinity for numbers
                if (typeof rawValue === 'number') {
                    if (Number.isFinite(rawValue)) {
                        setField(parsed, def.key, rawValue);
                    }
                } else {
                    setField(parsed, def.key, rawValue);
                }
                i += 1;
            }
            break;

        case 'csv':
            if (next) {
                setField(parsed, def.key, def.transform ? def.transform(next) : csvSplit(next));
                i += 1;
            }
            break;

        case 'enum':
            if (next) {
                if (def.enumValues!.includes(next)) {
                    setField(parsed, def.key, next);
                }
                i += 1;
            }
            break;

        default:
            break;
        }
    }

    return parsed;
}
