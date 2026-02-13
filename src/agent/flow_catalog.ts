// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, readFileSync, statSync} from 'fs';
import {join} from 'path';
import type {AgentConfig, AudienceRole} from './config.js';
import type {FlowPriority} from './analysis.js';
import {normalizeFlagSource, normalizeFlagState, normalizeRoles, type FlagHit} from './flags.js';
import {normalizePath, titleCase} from './utils.js';

export interface FlowCatalogFlag {
    name: string;
    source?: string;
    defaultState?: string;
}

export interface FlowCatalogEntry {
    id: string;
    name?: string;
    priority: FlowPriority;
    keywords?: string[];
    paths?: string[];
    tests?: string[];
    description?: string;
    audience?: AudienceRole[];
    flags?: FlagHit[];
}

export interface FlowCatalog {
    flows: FlowCatalogEntry[];
    source: string;
}

interface RawFlowCatalogEntry extends Omit<FlowCatalogEntry, 'audience' | 'flags'> {
    audience?: string[];
    flags?: Array<string | FlowCatalogFlag>;
}

const catalogCache = new Map<string, {mtimeMs: number; catalog: FlowCatalog | null}>();

function normalizePriority(value: string): FlowPriority | null {
    const upper = value.toUpperCase();
    if (upper === 'P0' || upper === 'P1' || upper === 'P2') {
        return upper as FlowPriority;
    }
    return null;
}

function normalizeEntry(entry: RawFlowCatalogEntry, config: AgentConfig): FlowCatalogEntry | null {
    if (!entry.id || !entry.priority) {
        return null;
    }
    const priority = normalizePriority(entry.priority as string);
    if (!priority) {
        return null;
    }

    const rawAudience = Array.isArray(entry.audience)
        ? entry.audience.filter((role) => typeof role === 'string')
        : [];
    const normalizedAudience = normalizeRoles(rawAudience, config.audience.defaultRoles as AudienceRole[]);

    const rawFlags = Array.isArray(entry.flags) ? entry.flags : [];
    const normalizedFlags: FlagHit[] = [];
    for (const flag of rawFlags) {
        if (typeof flag === 'string') {
            normalizedFlags.push({
                name: flag,
                source: 'featureFlag',
                defaultState: config.flags.defaultState,
            });
            continue;
        }
        if (flag && typeof flag === 'object' && typeof flag.name === 'string') {
            normalizedFlags.push({
                name: flag.name,
                source: normalizeFlagSource(flag.source),
                defaultState: normalizeFlagState(flag.defaultState, config.flags.defaultState),
            });
        }
    }

    return {
        ...entry,
        id: normalizePath(entry.id),
        name: entry.name || titleCase(entry.id),
        priority,
        keywords: (entry.keywords || []).map((keyword) => keyword.toLowerCase()),
        paths: (entry.paths || []).map((path) => normalizePath(path)),
        tests: (entry.tests || []).map((path) => normalizePath(path)),
        audience: normalizedAudience,
        flags: normalizedFlags,
    };
}

function readCatalog(path: string, config: AgentConfig): FlowCatalog | null {
    try {
        if (!existsSync(path)) {
            return null;
        }
        const mtimeMs = statSync(path).mtimeMs;
        const cached = catalogCache.get(path);
        if (cached && cached.mtimeMs === mtimeMs) {
            return cached.catalog;
        }
        const raw = JSON.parse(readFileSync(path, 'utf-8')) as {flows?: RawFlowCatalogEntry[]};
        if (!raw.flows || !Array.isArray(raw.flows)) {
            catalogCache.set(path, {mtimeMs, catalog: null});
            return null;
        }
        const flows = raw.flows
            .map((flow) => normalizeEntry(flow, config))
            .filter((flow): flow is FlowCatalogEntry => Boolean(flow));
        if (flows.length === 0) {
            catalogCache.set(path, {mtimeMs, catalog: null});
            return null;
        }
        const catalog = {flows, source: path};
        catalogCache.set(path, {mtimeMs, catalog});
        return catalog;
    } catch {
        return null;
    }
}

export function loadFlowCatalog(config: AgentConfig): FlowCatalog | null {
    const candidates: string[] = [];
    if (config.flowCatalogPath) {
        candidates.push(config.flowCatalogPath);
    }
    const testsRoot = config.testsRoot || config.path;
    candidates.push(join(testsRoot, '.e2e-ai-agents', 'flows.json'));
    candidates.push(join(config.path, '.e2e-ai-agents', 'flows.json'));

    for (const candidate of candidates) {
        const catalog = readCatalog(candidate, config);
        if (catalog) {
            return catalog;
        }
    }

    return null;
}
