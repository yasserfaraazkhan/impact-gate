// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, readFileSync} from 'fs';
import type {SubsystemRiskImpactConfig} from './config.js';
import {matchGlob, normalizePath} from './utils.js';

export type RiskPriority = 'P0' | 'P1' | 'P2';

interface RawSubsystemRiskRule {
    id?: unknown;
    description?: unknown;
    patterns?: unknown;
    scoreDelta?: unknown;
    priorityFloor?: unknown;
    reasons?: unknown;
    keywords?: unknown;
}

interface RawSubsystemRiskMap {
    schemaVersion?: unknown;
    rules?: unknown;
}

interface NormalizedSubsystemRiskRule {
    id: string;
    description?: string;
    patterns: string[];
    scoreDelta: number;
    priorityFloor?: RiskPriority;
    reasons: string[];
    keywords: string[];
}

export interface SubsystemRiskRuleMatch {
    ruleId: string;
    scoreDelta: number;
    priorityFloor?: RiskPriority;
    reasons: string[];
    keywords: string[];
}

export interface SubsystemRiskMapInfo {
    source: 'map';
    enabled: boolean;
    mapPath: string;
    mapFound: boolean;
    rulesLoaded: number;
}

export interface SubsystemRiskResolver {
    info: SubsystemRiskMapInfo;
    warnings: string[];
    matchFile: (relativePath: string) => SubsystemRiskRuleMatch[];
}

const PRIORITY_RANK: Record<RiskPriority, number> = {
    P0: 0,
    P1: 1,
    P2: 2,
};

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

function normalizePriority(value: unknown): RiskPriority | undefined {
    if (value === 'P0' || value === 'P1' || value === 'P2') {
        return value;
    }
    return undefined;
}

function parseStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((item) => typeof item === 'string')
        .map((item) => (item as string).trim())
        .filter(Boolean);
}

function parsePathArray(value: unknown): string[] {
    return parseStringArray(value).map((item) => normalizePath(item));
}

function parseKeywords(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return Array.from(
        new Set(
            value
                .filter((item) => typeof item === 'string')
                .map((item) => (item as string).trim().toLowerCase())
                .filter(Boolean),
        ),
    );
}

function parseRules(rawRules: unknown, warnings: string[]): NormalizedSubsystemRiskRule[] {
    if (!Array.isArray(rawRules)) {
        warnings.push('Subsystem risk map has no "rules" array.');
        return [];
    }

    const parsed: NormalizedSubsystemRiskRule[] = [];
    for (let i = 0; i < rawRules.length; i += 1) {
        const rawRule = rawRules[i] as RawSubsystemRiskRule;
        if (!rawRule || typeof rawRule !== 'object') {
            continue;
        }
        const patterns = parsePathArray(rawRule.patterns);
        if (patterns.length === 0) {
            warnings.push(`Subsystem risk rule at index ${i} has no valid patterns and was skipped.`);
            continue;
        }

        const id = typeof rawRule.id === 'string' && rawRule.id.trim()
            ? rawRule.id.trim()
            : `rule-${i + 1}`;
        const description = typeof rawRule.description === 'string' ? rawRule.description.trim() : undefined;
        const reasons = parseStringArray(rawRule.reasons);
        const keywords = parseKeywords(rawRule.keywords);
        const scoreDelta = coerceNumber(rawRule.scoreDelta) ?? 0;
        const priorityFloor = normalizePriority(rawRule.priorityFloor);

        const normalizedReasons = reasons.length > 0
            ? reasons
            : (description ? [description] : []);

        parsed.push({
            id,
            description,
            patterns,
            scoreDelta,
            priorityFloor,
            reasons: normalizedReasons,
            keywords,
        });
    }

    return parsed;
}

function comparePriority(a: RiskPriority, b: RiskPriority): RiskPriority {
    return PRIORITY_RANK[a] <= PRIORITY_RANK[b] ? a : b;
}

export function loadSubsystemRiskResolver(config: SubsystemRiskImpactConfig): SubsystemRiskResolver {
    const mapPath = normalizePath(config.mapPath);
    const warnings: string[] = [];

    if (!config.enabled) {
        return {
            info: {
                source: 'map',
                enabled: false,
                mapPath,
                mapFound: false,
                rulesLoaded: 0,
            },
            warnings,
            matchFile: () => [],
        };
    }

    if (!existsSync(config.mapPath)) {
        warnings.push(`Subsystem risk map file not found: ${config.mapPath}`);
        return {
            info: {
                source: 'map',
                enabled: true,
                mapPath,
                mapFound: false,
                rulesLoaded: 0,
            },
            warnings,
            matchFile: () => [],
        };
    }

    let raw: RawSubsystemRiskMap;
    try {
        raw = JSON.parse(readFileSync(config.mapPath, 'utf-8')) as RawSubsystemRiskMap;
    } catch {
        warnings.push(`Subsystem risk map is invalid JSON: ${config.mapPath}`);
        return {
            info: {
                source: 'map',
                enabled: true,
                mapPath,
                mapFound: true,
                rulesLoaded: 0,
            },
            warnings,
            matchFile: () => [],
        };
    }

    const rules = parseRules(raw.rules, warnings);
    if (rules.length === 0) {
        warnings.push(`Subsystem risk map loaded but no valid rules were found: ${config.mapPath}`);
    }

    const maxRules = Math.max(1, Math.round(config.maxRulesPerFile));
    return {
        info: {
            source: 'map',
            enabled: true,
            mapPath,
            mapFound: true,
            rulesLoaded: rules.length,
        },
        warnings,
        matchFile: (relativePath: string): SubsystemRiskRuleMatch[] => {
            const normalizedPath = normalizePath(relativePath);
            const matches: Array<SubsystemRiskRuleMatch & {priorityRank: number}> = [];
            for (const rule of rules) {
                const matched = rule.patterns.some((pattern) => matchGlob(normalizedPath, pattern));
                if (!matched) {
                    continue;
                }
                const reasons = rule.reasons.length > 0
                    ? rule.reasons
                    : [`Subsystem risk rule matched: ${rule.id}`];
                matches.push({
                    ruleId: rule.id,
                    scoreDelta: rule.scoreDelta,
                    priorityFloor: rule.priorityFloor,
                    reasons,
                    keywords: rule.keywords,
                    priorityRank: rule.priorityFloor ? PRIORITY_RANK[rule.priorityFloor] : 99,
                });
            }

            if (matches.length <= maxRules) {
                return matches.map(({priorityRank, ...rest}) => rest);
            }

            matches.sort((a, b) => {
                const deltaDiff = Math.abs(b.scoreDelta) - Math.abs(a.scoreDelta);
                if (deltaDiff !== 0) {
                    return deltaDiff;
                }
                const priorityDiff = a.priorityRank - b.priorityRank;
                if (priorityDiff !== 0) {
                    return priorityDiff;
                }
                return a.ruleId.localeCompare(b.ruleId);
            });
            const capped = matches.slice(0, maxRules).map(({priorityRank, ...rest}) => rest);
            let floor: RiskPriority | undefined;
            for (const match of capped) {
                if (match.priorityFloor) {
                    floor = floor ? comparePriority(floor, match.priorityFloor) : match.priorityFloor;
                }
            }
            if (floor) {
                for (const match of capped) {
                    if (!match.priorityFloor) {
                        match.priorityFloor = floor;
                    }
                }
            }
            return capped;
        },
    };
}
