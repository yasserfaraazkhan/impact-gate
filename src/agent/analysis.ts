// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync} from 'fs';
import {join} from 'path';
import {globSync} from 'glob';
import type {AgentConfig, AudienceRole, RiskConfig} from './config.js';
import {extractFlagHits, inferAudienceFromPath, mergeFlags, normalizeRoles, type BlastRadius, type FlagHit} from './flags.js';
import {
    baseNameWithoutExt,
    fileExtension,
    normalizePath,
    safeReadTextFile,
    titleCase,
    tokenize,
    uniqueTokens,
} from './utils.js';

export type FlowPriority = 'P0' | 'P1' | 'P2';

export interface FileAnalysis {
    relativePath: string;
    extension: string;
    exists: boolean;
    content: string | null;
    isUI: boolean;
    isScreen: boolean;
    isComponent: boolean;
    isState: boolean;
    isStyle: boolean;
    hasInteractions: boolean;
    keywords: string[];
    flowId: string;
    flowName: string;
    flowKind: 'screen' | 'flow';
    audience: AudienceRole[];
    flags: FlagHit[];
}

export interface FlowImpact {
    id: string;
    name: string;
    kind: 'screen' | 'flow';
    score: number;
    priority: FlowPriority;
    reasons: string[];
    keywords: string[];
    files: string[];
    audience?: AudienceRole[];
    flags?: FlagHit[];
    blastRadius?: BlastRadius;
}

export interface ImpactAnalysisResult {
    files: FileAnalysis[];
    flows: FlowImpact[];
}

const TEST_PATH_PATTERN = /(^|\/)__tests__(\/|$)|(^|\/)tests?(\/|$)|\.(spec|test)\.[a-z0-9]+$/i;
const SCREEN_DIRS = new Set(['pages', 'screens', 'views', 'routes']);
const FEATURE_DIRS = new Set(['features', 'modules', 'flows']);
const COMPONENT_DIRS = new Set(['components', 'widgets', 'ui']);
const STATE_DIRS = new Set(['state', 'store', 'stores', 'reducers', 'actions', 'context', 'hooks']);
const STYLE_EXTS = new Set(['css', 'scss', 'sass', 'less', 'styl']);
const UI_EXTS = new Set(['tsx', 'jsx']);
const CODE_EXTS = new Set(['ts', 'js', 'tsx', 'jsx']);
const INTERACTION_PATTERN = /(onClick|onSubmit|onChange|type=['"]submit['"]|role=['"]button['"]|aria-label=)/;

function deriveFlowFromPath(relativePath: string): {id: string; name: string; kind: 'screen' | 'flow'} {
    const segments = normalizePath(relativePath).split('/').filter(Boolean);
    const baseName = baseNameWithoutExt(relativePath);
    const base = baseName.toLowerCase() === 'index' && segments.length > 1 ? segments[segments.length - 2] : baseName;

    for (let i = 0; i < segments.length; i += 1) {
        const segment = segments[i].toLowerCase();
        if (SCREEN_DIRS.has(segment)) {
            const next = segments[i + 1] ? segments[i + 1] : base;
            return {id: normalizePath(next), name: titleCase(next), kind: 'screen'};
        }
        if (FEATURE_DIRS.has(segment)) {
            const next = segments[i + 1] ? segments[i + 1] : base;
            return {id: normalizePath(next), name: titleCase(next), kind: 'flow'};
        }
    }

    return {id: normalizePath(base), name: titleCase(base), kind: 'flow'};
}

function extractKeywords(relativePath: string): string[] {
    const segments = normalizePath(relativePath).split('/').filter(Boolean);
    const base = baseNameWithoutExt(relativePath);
    const tokens = segments.flatMap((segment) => tokenize(segment));
    tokens.push(...tokenize(base));
    return uniqueTokens(tokens);
}

function detectInteractions(content: string | null): boolean {
    if (!content) return false;
    return INTERACTION_PATTERN.test(content);
}

function isScreenPath(relativePath: string): boolean {
    const segments = normalizePath(relativePath).split('/').map((segment) => segment.toLowerCase());
    if (segments.some((segment) => segment === 'selectors' || segment === 'reducers' || segment === 'actions')) {
        return false;
    }
    return segments.some((segment) => SCREEN_DIRS.has(segment));
}

function isComponentPath(relativePath: string): boolean {
    const segments = normalizePath(relativePath).split('/').map((segment) => segment.toLowerCase());
    return segments.some((segment) => COMPONENT_DIRS.has(segment));
}

function isStatePath(relativePath: string): boolean {
    const segments = normalizePath(relativePath).split('/').map((segment) => segment.toLowerCase());
    return segments.some((segment) => STATE_DIRS.has(segment));
}

function scoreFile(file: FileAnalysis, risk: RiskConfig): {score: number; reasons: string[]} {
    let score = 1;
    const reasons: string[] = [];

    if (file.isScreen) {
        score += 3;
        reasons.push('Screen-level change');
    }
    if (file.isComponent) {
        score += 2;
        reasons.push('Shared component change');
    }
    if (file.isUI) {
        score += 2;
        reasons.push('UI logic change');
    }
    if (file.isState) {
        score += 2;
        reasons.push('State or data flow change');
    }
    if (file.isStyle) {
        score += 1;
        reasons.push('Visual styling change');
    }
    if (file.hasInteractions) {
        score += 2;
        reasons.push('Interactive element change');
    }

    const keywordHit = file.keywords.find((keyword) => risk.criticalKeywords.includes(keyword));
    if (keywordHit) {
        score += 2;
        reasons.push(`Critical keyword: ${keywordHit}`);
    }

    return {score, reasons};
}

export function analyzeFiles(appRoot: string, relativePaths: string[], config: AgentConfig): ImpactAnalysisResult {
    const files: FileAnalysis[] = [];
    const defaultAudience = config.audience.defaultRoles as AudienceRole[];
    const defaultFlagState = config.flags.defaultState;

    for (const relativePath of relativePaths) {
        if (isTestFilePath(relativePath)) {
            continue;
        }
        const fullPath = join(appRoot, relativePath);
        const exists = existsSync(fullPath);
        const extension = fileExtension(relativePath);
        const content = exists && CODE_EXTS.has(extension) ? safeReadTextFile(fullPath) : null;
        const {id, name, kind} = deriveFlowFromPath(relativePath);
        const audience = inferAudienceFromPath(relativePath, config);
        const flags = extractFlagHits(content, config);

        const analysis: FileAnalysis = {
            relativePath: normalizePath(relativePath),
            extension,
            exists,
            content,
            isUI: UI_EXTS.has(extension),
            isScreen: isScreenPath(relativePath),
            isComponent: isComponentPath(relativePath),
            isState: isStatePath(relativePath),
            isStyle: STYLE_EXTS.has(extension),
            hasInteractions: detectInteractions(content),
            keywords: extractKeywords(relativePath),
            flowId: id,
            flowName: name,
            flowKind: kind,
            audience,
            flags,
        };

        files.push(analysis);
    }

    const flowMap = new Map<string, FlowImpact>();

    for (const file of files) {
        const {score, reasons} = scoreFile(file, config.risk);
        const existing = flowMap.get(file.flowId);
        if (!existing) {
            flowMap.set(file.flowId, {
                id: file.flowId,
                name: file.flowName,
                kind: file.flowKind,
                score,
                priority: 'P2',
                reasons: [...reasons],
                keywords: [...file.keywords],
                files: [file.relativePath],
                audience: file.audience,
                flags: file.flags,
            });
        } else {
            existing.score += score;
            existing.files.push(file.relativePath);
            existing.reasons.push(...reasons);
            existing.keywords.push(...file.keywords);
            existing.audience = normalizeRoles(
                [...(existing.audience || []), ...file.audience],
                defaultAudience,
            );
            existing.flags = mergeFlags(
                [...(existing.flags || []), ...file.flags],
                defaultFlagState,
            );
        }
    }

    const flows: FlowImpact[] = Array.from(flowMap.values()).map((flow) => {
        const uniqueReason = uniqueTokens(flow.reasons);
        const uniqueKeywords = uniqueTokens(flow.keywords);
        const priority: FlowPriority =
            flow.score >= config.risk.p0Threshold
                ? 'P0'
                : flow.score >= config.risk.p1Threshold
                  ? 'P1'
                  : 'P2';
        return {
            ...flow,
            reasons: uniqueReason.map((reason) => reason),
            keywords: uniqueKeywords,
            priority,
        };
    });

    return {files, flows};
}

export function isTestFilePath(relativePath: string): boolean {
    return TEST_PATH_PATTERN.test(normalizePath(relativePath));
}

export function scanRepositoryFlows(appRoot: string, limit = 250, patterns?: string[], exclude?: string[]): string[] {
    const defaultPatterns = [
        '**/pages/**/*.{tsx,jsx,ts,js}',
        '**/screens/**/*.{tsx,jsx,ts,js}',
        '**/views/**/*.{tsx,jsx,ts,js}',
        '**/routes/**/*.{tsx,jsx,ts,js}',
    ];
    const useDefaults = !(patterns && patterns.length > 0);
    const activePatterns = useDefaults ? defaultPatterns : patterns;
    const matches = new Set<string>();

    const ignorePatterns = [
        '**/node_modules/**',
        '**/.git/**',
        '**/__tests__/**',
        '**/tests/**',
        ...(useDefaults ? ['**/selectors/**', '**/reducers/**', '**/actions/**'] : []),
        ...(exclude || []),
    ];

    for (const pattern of activePatterns) {
        const files = globSync(pattern, {
            cwd: appRoot,
            ignore: ignorePatterns,
            nodir: true,
        });
        for (const file of files) {
            matches.add(normalizePath(file));
            if (matches.size >= limit) {
                break;
            }
        }
        if (matches.size >= limit) {
            break;
        }
    }

    return Array.from(matches);
}
