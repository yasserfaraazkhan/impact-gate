// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {AgentConfig, AudienceRole, FlagState} from './config.js';

export type FlagSource = 'featureFlag' | 'configFlag' | 'testGate';

export interface FlagHit {
    name: string;
    source: FlagSource;
    defaultState: FlagState;
}

export interface BlastRadius {
    audience: AudienceRole[];
    flags: FlagHit[];
    summary: string;
    scoreDelta: number;
}

const ROLE_ORDER: AudienceRole[] = [
    'system_admin',
    'team_admin',
    'channel_admin',
    'member',
    'guest',
    'deactivated',
];

const FEATURE_FLAG_REGEX = /\bFeatureFlags?\.(\w+)\b/g;
const FEATURE_FLAG_STRING_REGEX =
    /\b(?:isFeatureEnabled|getFeatureFlag|featureFlag)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const SERVICE_SETTINGS_REGEX = /\bServiceSettings\.(\w+)\b/g;
const TEST_GATE_REGEX = /\bskipIfFeatureFlagNotSet\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const ROLE_ALIASES: Record<string, AudienceRole> = {
    'system admin': 'system_admin',
    'system_admin': 'system_admin',
    sysadmin: 'system_admin',
    'team admin': 'team_admin',
    'team_admin': 'team_admin',
    'channel admin': 'channel_admin',
    'channel_admin': 'channel_admin',
    member: 'member',
    members: 'member',
    guest: 'guest',
    guests: 'guest',
    deactivated: 'deactivated',
    inactive: 'deactivated',
    disabled: 'deactivated',
};

export function normalizeRole(role: string): AudienceRole | null {
    const key = role.trim().toLowerCase();
    return ROLE_ALIASES[key] ?? null;
}

export function normalizeRoles(roles: string[], fallback: AudienceRole[]): AudienceRole[] {
    const normalized = roles
        .map((role) => normalizeRole(role))
        .filter((role): role is AudienceRole => Boolean(role));
    const combined = normalized.length > 0 ? normalized : fallback;
    const unique = new Set(combined);
    return ROLE_ORDER.filter((role) => unique.has(role));
}

export function normalizeFlagSource(source?: string): FlagSource {
    if (!source) {
        return 'featureFlag';
    }
    const value = source.trim().toLowerCase();
    if (['feature', 'featureflag', 'feature_flag', 'flag'].includes(value)) {
        return 'featureFlag';
    }
    if (['config', 'service', 'servicesettings', 'server'].includes(value)) {
        return 'configFlag';
    }
    if (['test', 'gate', 'testgate'].includes(value)) {
        return 'testGate';
    }
    return 'featureFlag';
}

export function normalizeFlagState(value: string | undefined, fallback: FlagState): FlagState {
    if (!value) {
        return fallback;
    }
    const lowered = value.trim().toLowerCase();
    if (lowered === 'on' || lowered === 'off' || lowered === 'unknown') {
        return lowered as FlagState;
    }
    return fallback;
}

export function mergeFlags(flags: FlagHit[], defaultState: FlagState): FlagHit[] {
    const map = new Map<string, FlagHit>();
    for (const flag of flags) {
        const key = `${flag.source}:${flag.name.toLowerCase()}`;
        if (!map.has(key)) {
            map.set(key, {
                ...flag,
                defaultState: flag.defaultState ?? defaultState,
            });
        }
    }
    return Array.from(map.values());
}

export function extractFlagHits(content: string | null, config: AgentConfig): FlagHit[] {
    if (!content) {
        return [];
    }

    const hits: FlagHit[] = [];
    const defaultState = config.flags.defaultState;

    for (const match of content.matchAll(FEATURE_FLAG_REGEX)) {
        if (match[1]) {
            hits.push({name: match[1], source: 'featureFlag', defaultState});
        }
    }

    for (const match of content.matchAll(FEATURE_FLAG_STRING_REGEX)) {
        if (match[1]) {
            hits.push({name: match[1], source: 'featureFlag', defaultState});
        }
    }

    for (const match of content.matchAll(SERVICE_SETTINGS_REGEX)) {
        if (match[1]) {
            hits.push({name: match[1], source: 'configFlag', defaultState});
        }
    }

    for (const match of content.matchAll(TEST_GATE_REGEX)) {
        if (match[1]) {
            hits.push({name: match[1], source: 'testGate', defaultState});
        }
    }

    return mergeFlags(hits, defaultState);
}

export function inferAudienceFromPath(relativePath: string, config: AgentConfig): AudienceRole[] {
    const normalized = relativePath.toLowerCase();
    if (normalized.includes('admin_console') || normalized.includes('system_console')) {
        return normalizeRoles(['system_admin'], config.audience.defaultRoles as AudienceRole[]);
    }
    if (normalized.includes('team') && normalized.includes('admin')) {
        return normalizeRoles(['team_admin'], config.audience.defaultRoles as AudienceRole[]);
    }
    if (normalized.includes('channel') && normalized.includes('admin')) {
        return normalizeRoles(['channel_admin'], config.audience.defaultRoles as AudienceRole[]);
    }

    return normalizeRoles(config.audience.defaultRoles, config.audience.defaultRoles as AudienceRole[]);
}

export function formatFlags(flags: FlagHit[]): string {
    if (flags.length === 0) {
        return 'none';
    }
    return flags.map((flag) => `${flag.name} (${flag.defaultState})`).join(', ');
}

export function computeBlastRadius(
    audience: AudienceRole[],
    flags: FlagHit[],
    config: AgentConfig,
): BlastRadius {
    const normalizedAudience = normalizeRoles(audience, config.audience.defaultRoles as AudienceRole[]);
    const normalizedFlags = mergeFlags(flags, config.flags.defaultState);

    const hasMember = normalizedAudience.includes('member');
    const hasGuest = normalizedAudience.includes('guest');
    const hasAdmin = normalizedAudience.some((role) =>
        role === 'system_admin' || role === 'team_admin' || role === 'channel_admin',
    );

    const scope = hasMember || hasGuest ? 'broad' : hasAdmin ? 'admin-only' : 'unknown';
    const flagState = normalizedFlags.length === 0
        ? 'unflagged'
        : normalizedFlags.some((flag) => flag.defaultState === 'off')
          ? 'flagged-off'
          : 'flagged-on';

    let scoreDelta = 0;
    if (hasMember) {
        scoreDelta += config.blastRadius.memberBonus;
    }
    if (hasGuest) {
        scoreDelta += config.blastRadius.guestBonus;
    }
    if (!hasMember && !hasGuest) {
        scoreDelta += config.blastRadius.adminOnlyPenalty;
    }
    if (normalizedFlags.some((flag) => flag.defaultState === 'off')) {
        scoreDelta += config.blastRadius.flagOffPenalty;
    }

    return {
        audience: normalizedAudience,
        flags: normalizedFlags,
        summary: `${scope}; ${flagState}`,
        scoreDelta,
    };
}
