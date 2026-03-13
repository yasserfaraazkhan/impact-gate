// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import type {FeaturePriority, RouteFamily} from '../../knowledge/route_families.js';
import {loadRouteFamilyManifest} from '../../knowledge/route_families.js';
import type {QAConfig, TargetFlow} from '../types.js';

interface PlanFlow {
    id: string;
    name: string;
    priority: string;
    specDirs?: string[];
    userFlows?: string[];
}

interface PlanJson {
    flows?: PlanFlow[];
    coveredFlows?: Array<{flowId: string; flowName: string; specDirs?: string[]}>;
    gaps?: Array<{flowId: string; flowName: string; priority: string}>;
}

export function resolveScope(config: QAConfig): {flows: TargetFlow[]; specPaths: string[]} {
    const testsRoot = config.testsRoot || process.cwd();
    const planPath = join(testsRoot, '.e2e-ai-agents', 'plan.json');

    // Try to read plan.json (written by e2e-agents plan command)
    const plan = readPlan(planPath);
    const manifest = loadRouteFamilyManifest(testsRoot, {});

    const flows: TargetFlow[] = [];
    const specPaths: string[] = [];

    if (config.mode === 'hunt' && config.huntTarget) {
        return resolveHuntScope(config.huntTarget, manifest, testsRoot);
    }

    if (config.mode === 'release') {
        return resolveReleaseScope(manifest, testsRoot);
    }

    // PR / fix mode: use plan.json flows
    if (plan) {
        const allFlows = [
            ...(plan.flows || []),
            ...(plan.gaps || []).map((g) => ({id: g.flowId, name: g.flowName, priority: g.priority})),
        ];

        for (const f of allFlows) {
            const family = manifest?.families.find((fam) => fam.id === f.id);
            const url = resolveUrlForFamily(family);
            flows.push({
                id: f.id,
                name: f.name,
                priority: (f.priority as FeaturePriority) || 'P1',
                url,
            });
        }

        // Collect spec paths from covered flows
        for (const c of plan.coveredFlows || []) {
            if (c.specDirs) {
                for (const dir of c.specDirs) {
                    const fullDir = join(testsRoot, dir);
                    if (existsSync(fullDir)) {
                        specPaths.push(fullDir);
                    }
                }
            }
        }
    }

    // Sort by priority: P0 first
    flows.sort((a, b) => a.priority.localeCompare(b.priority));

    return {flows, specPaths};
}

function resolveHuntScope(
    target: string,
    manifest: ReturnType<typeof loadRouteFamilyManifest>,
    testsRoot: string,
): {flows: TargetFlow[]; specPaths: string[]} {
    const flows: TargetFlow[] = [];
    const specPaths: string[] = [];
    const targetLower = target.toLowerCase();

    if (manifest) {
        for (const family of manifest.families) {
            const matches = family.id.toLowerCase().includes(targetLower) ||
                (family.userFlows || []).some((uf) => uf.toLowerCase().includes(targetLower));
            if (matches) {
                flows.push({
                    id: family.id,
                    name: family.id,
                    priority: family.priority || 'P1',
                    url: resolveUrlForFamily(family),
                });
                for (const dir of family.specDirs || []) {
                    const fullDir = join(testsRoot, dir);
                    if (existsSync(fullDir)) {
                        specPaths.push(fullDir);
                    }
                }
            }
        }
    }

    // If no manifest matches, create a generic flow
    if (flows.length === 0) {
        flows.push({id: target, name: target, priority: 'P1'});
    }

    return {flows, specPaths};
}

function resolveReleaseScope(
    manifest: ReturnType<typeof loadRouteFamilyManifest>,
    testsRoot: string,
): {flows: TargetFlow[]; specPaths: string[]} {
    const flows: TargetFlow[] = [];
    const specPaths: string[] = [];

    if (manifest) {
        for (const family of manifest.families) {
            if (family.priority === 'P0' || family.priority === 'P1') {
                flows.push({
                    id: family.id,
                    name: family.id,
                    priority: family.priority,
                    url: resolveUrlForFamily(family),
                });
                for (const dir of family.specDirs || []) {
                    const fullDir = join(testsRoot, dir);
                    if (existsSync(fullDir)) {
                        specPaths.push(fullDir);
                    }
                }
            }
        }
    }

    flows.sort((a, b) => a.priority.localeCompare(b.priority));
    return {flows, specPaths};
}

function resolveUrlForFamily(family: RouteFamily | undefined): string | undefined {
    if (!family || !family.routes || family.routes.length === 0) return undefined;

    // Take the first route pattern and substitute common placeholders
    const route = family.routes[0];
    return route
        .replace(/\{team\}/g, 'default')
        .replace(/\{channel\}/g, 'town-square')
        .replace(/\{user_id\}/g, 'me')
        .replace(/\{[^}]+\}/g, 'test');
}

function readPlan(path: string): PlanJson | null {
    if (!existsSync(path)) return null;
    try {
        return JSON.parse(readFileSync(path, 'utf-8')) as PlanJson;
    } catch {
        return null;
    }
}
