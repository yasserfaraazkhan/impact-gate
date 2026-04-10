// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

/**
 * TTL presets for different cache entry types.
 */
export const TTL = {
    /** 24 hours - for analysis results that change infrequently */
    ANALYSIS: 24 * 60 * 60 * 1000,
    /** 1 hour - for generated content that may need fresher context */
    GENERATION: 1 * 60 * 60 * 1000,
} as const;

/**
 * A single cached LLM response entry stored on disk.
 */
export interface CacheEntry {
    /** Content-addressed cache key (SHA-256 hex) */
    key: string;
    /** The route-family name for invalidation purposes */
    family?: string;
    /** The LLM response text */
    response: string;
    /** Token usage and cost snapshot */
    usage: {
        inputTokens: number;
        outputTokens: number;
        cost: number;
    };
    /** ISO timestamp when the entry was created */
    createdAt: string;
    /** Time-to-live in milliseconds */
    ttlMs: number;
}

/**
 * Parameters used to compute a content-addressed cache key.
 */
export interface CacheKeyParams {
    agent: string;
    family: string;
    fileHashes: string[];
    model: string;
}

/**
 * Cross-run LLM response cache backed by JSON files.
 *
 * Stores entries as `{cacheDir}/{sha256}.json` using a content-addressed key
 * derived from (agentRole + familyName + sorted file hashes + model).
 */
export class ResponseCache {
    private readonly cacheDir: string;

    constructor(workspaceRoot: string) {
        this.cacheDir = path.join(workspaceRoot, '.e2e-ai-agents', 'cache');
    }

    /**
     * Build a deterministic SHA-256 cache key from the provided parameters.
     */
    static buildKey(params: CacheKeyParams): string {
        const sorted = [...params.fileHashes].sort();
        const payload = params.agent + params.family + JSON.stringify(sorted) + params.model;
        return crypto.createHash('sha256').update(payload).digest('hex');
    }

    /**
     * Retrieve a cached response if it exists and has not expired.
     * Returns `null` on cache miss or expiry.
     */
    get(agent: string, family: string, fileHashes: string[], model: string): CacheEntry | null {
        const key = ResponseCache.buildKey({agent, family, fileHashes, model});
        const filePath = path.join(this.cacheDir, `${key}.json`);

        try {
            if (!fs.existsSync(filePath)) {
                return null;
            }

            const raw = fs.readFileSync(filePath, 'utf-8');
            const entry: CacheEntry = JSON.parse(raw);

            const age = Date.now() - new Date(entry.createdAt).getTime();
            if (age > entry.ttlMs) {
                // Expired - clean up eagerly
                fs.unlinkSync(filePath);
                return null;
            }

            return entry;
        } catch {
            // Corrupted or unreadable - treat as miss
            return null;
        }
    }

    /**
     * Write a cache entry to disk.
     * Creates the cache directory if it does not yet exist.
     */
    set(entry: CacheEntry): void {
        this.ensureCacheDir();
        const filePath = path.join(this.cacheDir, `${entry.key}.json`);
        fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');
    }

    /**
     * Remove all cache entries belonging to the given family.
     *
     * Because the cache key is a one-way SHA-256 hash, we scan each file and
     * check its stored `family` field. The directory is scoped to a single
     * workspace so the scan is bounded.
     */
    invalidateFamily(familyName: string): number {
        if (!fs.existsSync(this.cacheDir)) {
            return 0;
        }

        let deleted = 0;
        const files = fs.readdirSync(this.cacheDir).filter((f) => f.endsWith('.json'));

        for (const file of files) {
            const filePath = path.join(this.cacheDir, file);
            try {
                const raw = fs.readFileSync(filePath, 'utf-8');
                const entry = JSON.parse(raw);
                if (entry.family === familyName) {
                    fs.unlinkSync(filePath);
                    deleted++;
                }
            } catch {
                // Skip unreadable files
            }
        }

        return deleted;
    }

    /**
     * Remove all expired entries from the cache directory.
     * Returns the number of entries deleted.
     */
    prune(): number {
        if (!fs.existsSync(this.cacheDir)) {
            return 0;
        }

        let deleted = 0;
        const now = Date.now();
        const files = fs.readdirSync(this.cacheDir).filter((f) => f.endsWith('.json'));

        for (const file of files) {
            const filePath = path.join(this.cacheDir, file);
            try {
                const raw = fs.readFileSync(filePath, 'utf-8');
                const entry: CacheEntry = JSON.parse(raw);
                const age = now - new Date(entry.createdAt).getTime();
                if (age > entry.ttlMs) {
                    fs.unlinkSync(filePath);
                    deleted++;
                }
            } catch {
                // Corrupted file - remove it
                try {
                    fs.unlinkSync(filePath);
                    deleted++;
                } catch {
                    // Ignore if removal also fails
                }
            }
        }

        return deleted;
    }

    /**
     * Ensure the cache directory exists on disk.
     */
    private ensureCacheDir(): void {
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, {recursive: true});
        }
    }
}
