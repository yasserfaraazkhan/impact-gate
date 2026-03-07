// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, readFileSync} from 'fs';
import {isAbsolute, join} from 'path';
import {LLMProviderFactory} from '../provider_factory.js';
import type {FileAnalysis, FlowImpact, FlowPriority} from './analysis.js';
import type {AIFlowImpactConfig} from './config.js';
import {normalizePath, tokenize, uniqueTokens} from './utils.js';

interface AIFlowEntry {
    id?: string;
    name?: string;
    kind?: 'screen' | 'flow';
    priority?: 'P0' | 'P1' | 'P2';
    score?: number;
    reasons?: string[];
    keywords?: string[];
    files?: string[];
}

interface AIFlowResponse {
    flows: AIFlowEntry[];
}

export interface AIFlowAnalysisResult {
    enabled: boolean;
    used: boolean;
    provider: string;
    flowCount: number;
    warnings: string[];
    flows: FlowImpact[];
}

function extractJson(text: string): AIFlowResponse | null {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidates = fenced ? [fenced[1], text] : [text];

    for (const candidate of candidates) {
        const start = candidate.indexOf('{');
        const end = candidate.lastIndexOf('}');
        if (start < 0 || end <= start) {
            continue;
        }
        const raw = candidate.slice(start, end + 1);
        try {
            const parsed = JSON.parse(raw) as AIFlowResponse;
            if (parsed && Array.isArray(parsed.flows)) {
                return parsed;
            }
        } catch {
            // Ignore parse failure and keep trying other candidates.
        }
    }

    return null;
}

function resolveContextFiles(appRoot: string, testsRoot: string, files: string[]): Array<{path: string; content: string}> {
    const resolved: Array<{path: string; content: string}> = [];
    const seen = new Set<string>();
    const maxCharsPerFile = 12000;
    const maxTotalChars = 32000;
    let totalChars = 0;

    for (const file of files) {
        const candidates = isAbsolute(file)
            ? [file]
            : [join(testsRoot, file), join(appRoot, file)];
        for (const candidate of candidates) {
            const normalized = normalizePath(candidate);
            if (seen.has(normalized) || !existsSync(candidate)) {
                continue;
            }
            const content = readFileSync(candidate, 'utf-8');
            const trimmed = content.trim();
            if (!trimmed) {
                seen.add(normalized);
                continue;
            }
            const remaining = Math.max(0, maxTotalChars - totalChars);
            if (remaining <= 0) {
                return resolved;
            }
            const clipped = trimmed.slice(0, Math.min(maxCharsPerFile, remaining));
            resolved.push({path: normalized, content: clipped});
            seen.add(normalized);
            totalChars += clipped.length;
            break;
        }
    }

    return resolved;
}

function priorityFromEntry(entry: AIFlowEntry): FlowPriority {
    if (entry.priority === 'P0' || entry.priority === 'P1' || entry.priority === 'P2') {
        return entry.priority;
    }
    const score = typeof entry.score === 'number' ? entry.score : 0;
    if (score >= 8) {
        return 'P0';
    }
    if (score >= 5) {
        return 'P1';
    }
    return 'P2';
}

function normalizeFlowId(value: string): string {
    return normalizePath(value)
        .replace(/[^a-zA-Z0-9/_-]+/g, '_')
        .replace(/\/{2,}/g, '/')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '')
        .trim();
}

function sanitizeReasons(reasons: unknown, fallback: string): string[] {
    if (!Array.isArray(reasons)) {
        return [fallback];
    }
    const cleaned = reasons.filter((entry) => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean);
    return cleaned.length > 0 ? cleaned : [fallback];
}

function sanitizeKeywords(keywords: unknown, fallbackTokens: string[]): string[] {
    if (!Array.isArray(keywords)) {
        return uniqueTokens(fallbackTokens).slice(0, 20);
    }
    const fromAI = keywords.filter((entry) => typeof entry === 'string').flatMap((entry) => tokenize(entry));
    return uniqueTokens([...fromAI, ...fallbackTokens]).slice(0, 20);
}

function summarizeFiles(files: FileAnalysis[], changedFileSet: Set<string>, maxFiles: number): Array<Record<string, unknown>> {
    const sorted = [...files].sort((a, b) => {
        const aChanged = changedFileSet.has(a.relativePath) ? 1 : 0;
        const bChanged = changedFileSet.has(b.relativePath) ? 1 : 0;
        if (aChanged !== bChanged) {
            return bChanged - aChanged;
        }
        const aSignals = (a.isUI ? 1 : 0) + (a.isScreen ? 1 : 0) + (a.isState ? 1 : 0) + (a.hasInteractions ? 1 : 0);
        const bSignals = (b.isUI ? 1 : 0) + (b.isScreen ? 1 : 0) + (b.isState ? 1 : 0) + (b.hasInteractions ? 1 : 0);
        if (aSignals !== bSignals) {
            return bSignals - aSignals;
        }
        return a.relativePath.localeCompare(b.relativePath);
    }).slice(0, Math.max(20, maxFiles));

    return sorted.map((file) => ({
        path: file.relativePath,
        changed: changedFileSet.has(file.relativePath),
        isUI: file.isUI,
        isScreen: file.isScreen,
        isComponent: file.isComponent,
        isState: file.isState,
        isStyle: file.isStyle,
        hasInteractions: file.hasInteractions,
        keywords: file.keywords.slice(0, 20),
        audience: file.audience,
        flags: file.flags?.map((flag) => ({name: flag.name, source: flag.source, defaultState: flag.defaultState})),
    }));
}

function mergeFlow(existing: FlowImpact | undefined, candidate: FlowImpact): FlowImpact {
    if (!existing) {
        return candidate;
    }
    const priorityOrder: Record<FlowPriority, number> = {P0: 0, P1: 1, P2: 2};
    const priority = priorityOrder[candidate.priority] < priorityOrder[existing.priority]
        ? candidate.priority
        : existing.priority;

    return {
        ...existing,
        name: existing.name || candidate.name,
        kind: existing.kind || candidate.kind,
        score: Math.max(existing.score, candidate.score),
        priority,
        reasons: uniqueTokens([...(existing.reasons || []), ...(candidate.reasons || [])]),
        keywords: uniqueTokens([...(existing.keywords || []), ...(candidate.keywords || [])]),
        files: uniqueTokens([...(existing.files || []), ...(candidate.files || [])]),
        audience: uniqueTokens([...(existing.audience || []), ...(candidate.audience || [])]) as FlowImpact['audience'],
        flags: [...(existing.flags || []), ...(candidate.flags || [])],
    };
}

export async function mapAIFlowsFromFiles(
    appRoot: string,
    testsRoot: string,
    config: AIFlowImpactConfig,
    files: FileAnalysis[],
    changedFiles: string[],
): Promise<AIFlowAnalysisResult> {
    const providerName = config.provider === 'auto' ? 'auto' : config.provider;
    const warnings: string[] = [];
    if (!config.enabled) {
        return {
            enabled: false,
            used: false,
            provider: providerName,
            flowCount: 0,
            warnings,
            flows: [],
        };
    }

    if (files.length === 0) {
        warnings.push('AI flow analysis skipped: no analyzable files were found.');
        return {
            enabled: true,
            used: false,
            provider: providerName,
            flowCount: 0,
            warnings,
            flows: [],
        };
    }

    const changedFileSet = new Set(changedFiles.map((entry) => normalizePath(entry)));
    const summarizedFiles = summarizeFiles(files, changedFileSet, config.maxFilesPerRequest);
    const allowedFiles = new Set(files.map((entry) => entry.relativePath));
    const fileByPath = new Map(files.map((entry) => [entry.relativePath, entry]));

    const contextFiles = resolveContextFiles(appRoot, testsRoot, config.contextFiles || []);
    const contextBlock = contextFiles.length > 0
        ? contextFiles.map((entry) => `### Context: ${entry.path}\n${entry.content}`).join('\n\n')
        : 'No optional markdown context files were found.';
    if (contextFiles.length === 0) {
        warnings.push('AI flow analysis context files were not found; continuing without optional markdown context.');
    }

    let provider;
    try {
        provider = config.provider === 'auto'
            ? await LLMProviderFactory.createFromEnv()
            : LLMProviderFactory.createFromString(config.provider);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`AI flow analysis unavailable (${providerName}): ${message}`);
        return {
            enabled: true,
            used: false,
            provider: providerName,
            flowCount: 0,
            warnings,
            flows: [],
        };
    }

    const prompt = [
        'You are an expert frontend impact analyst for Mattermost.',
        'Build impacted user flows from changed frontend files.',
        'This must be flow-centric, not file-centric.',
        '',
        'Return strict JSON only with this exact shape:',
        '{"flows":[{"id":"<flow_id>","name":"<name>","kind":"flow|screen","priority":"P0|P1|P2","score":10,"reasons":["..."],"keywords":["..."],"files":["relative/path.tsx"]}]}',
        '',
        'Rules:',
        '- Use only file paths listed in FILES.',
        '- Every flow must have at least one file.',
        '- Keep IDs stable and lowercase with underscores when possible.',
        '- Prioritize true user-impacting flows; avoid low-value internal buckets.',
        '- Keep at most 6 file paths per flow.',
        `- Keep at most ${Math.max(1, config.maxFlowsPerRequest)} flows.`,
        '',
        `CHANGED_FILES (${changedFileSet.size}):`,
        JSON.stringify(Array.from(changedFileSet), null, 2),
        '',
        `FILES (${summarizedFiles.length}):`,
        JSON.stringify(summarizedFiles, null, 2),
        '',
        contextBlock,
    ].join('\n');

    let parsed: AIFlowResponse | null = null;
    try {
        const response = await provider.generateText(prompt, {
            maxTokens: Math.max(800, config.maxTokens),
            temperature: Math.max(0, Math.min(1, config.temperature)),
            timeout: 45_000,
            systemPrompt: 'Return only valid JSON. Do not include markdown fences unless necessary.',
        });
        parsed = extractJson(response.text);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`AI flow analysis request failed (${provider.name}): ${message}`);
        return {
            enabled: true,
            used: false,
            provider: provider.name,
            flowCount: 0,
            warnings,
            flows: [],
        };
    }

    if (!parsed) {
        warnings.push(`AI flow analysis returned invalid JSON (${provider.name}).`);
        return {
            enabled: true,
            used: false,
            provider: provider.name,
            flowCount: 0,
            warnings,
            flows: [],
        };
    }

    const flowsById = new Map<string, FlowImpact>();
    for (const entry of parsed.flows) {
        if (!entry || !Array.isArray(entry.files)) {
            continue;
        }
        const validFiles = Array.from(
            new Set(
                entry.files
                    .filter((value) => typeof value === 'string')
                    .map((value) => normalizePath(value))
                    .filter((value) => allowedFiles.has(value)),
            ),
        ).slice(0, 6);
        if (validFiles.length === 0) {
            continue;
        }

        const rawId = typeof entry.id === 'string' && entry.id.trim()
            ? entry.id
            : (typeof entry.name === 'string' && entry.name.trim() ? entry.name : validFiles[0]);
        const id = normalizeFlowId(rawId);
        if (!id) {
            continue;
        }

        const fallbackTokens = uniqueTokens([
            ...tokenize(id),
            ...(typeof entry.name === 'string' ? tokenize(entry.name) : []),
            ...validFiles.flatMap((value) => tokenize(value)),
        ]);

        const linkedFiles = validFiles.map((path) => fileByPath.get(path)).filter(Boolean) as FileAnalysis[];
        const audience = uniqueTokens(linkedFiles.flatMap((file) => file.audience || [])) as FlowImpact['audience'];
        const flags = linkedFiles.flatMap((file) => file.flags || []);
        const score = typeof entry.score === 'number' && Number.isFinite(entry.score)
            ? Math.max(1, Math.min(20, Math.round(entry.score)))
            : Math.max(4, validFiles.length * 2);
        const flow: FlowImpact = {
            id,
            name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id.replace(/[_/.-]+/g, ' '),
            kind: entry.kind === 'screen' ? 'screen' : 'flow',
            score,
            priority: priorityFromEntry(entry),
            reasons: sanitizeReasons(entry.reasons, 'AI flow analysis identified impacted behavior'),
            keywords: sanitizeKeywords(entry.keywords, fallbackTokens),
            files: validFiles,
            audience,
            flags,
        };
        flowsById.set(id, mergeFlow(flowsById.get(id), flow));
        if (flowsById.size >= Math.max(1, config.maxFlowsPerRequest)) {
            break;
        }
    }

    const flows = Array.from(flowsById.values());
    if (flows.length === 0) {
        warnings.push('AI flow analysis did not return any valid flows linked to changed files.');
        return {
            enabled: true,
            used: false,
            provider: provider.name,
            flowCount: 0,
            warnings,
            flows: [],
        };
    }

    return {
        enabled: true,
        used: true,
        provider: provider.name,
        flowCount: flows.length,
        warnings,
        flows,
    };
}
