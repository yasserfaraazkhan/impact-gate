// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, readFileSync} from 'fs';
import {basename, join} from 'path';
import type {FrameworkType} from './config.js';

export interface FrameworkDetection {
    framework: FrameworkType;
    configPath?: string;
    reason: string;
}

export interface TestPatternResolution {
    patterns: string[];
    source: string;
}

const PLAYWRIGHT_CONFIG_FILES = ['playwright.config.ts', 'playwright.config.js'];
const CYPRESS_CONFIG_FILES = ['cypress.config.ts', 'cypress.config.js'];
const SELENIUM_CONFIG_FILES = ['selenium.config.ts', 'selenium.config.js', 'wdio.conf.ts', 'wdio.conf.js'];

function readPackageJson(appRoot: string): Record<string, unknown> | undefined {
    const pkgPath = join(appRoot, 'package.json');
    if (!existsSync(pkgPath)) {
        return undefined;
    }
    try {
        return JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
    } catch {
        return undefined;
    }
}

function hasDependency(pkg: Record<string, unknown> | undefined, dep: string): boolean {
    if (!pkg) return false;
    const dependencies = (pkg.dependencies as Record<string, unknown> | undefined) || {};
    const devDependencies = (pkg.devDependencies as Record<string, unknown> | undefined) || {};
    return Boolean(dependencies[dep] || devDependencies[dep]);
}

function findConfigFile(appRoot: string, candidates: string[]): string | undefined {
    for (const file of candidates) {
        const fullPath = join(appRoot, file);
        if (existsSync(fullPath)) {
            return fullPath;
        }
    }
    return undefined;
}

export function detectFramework(appRoot: string, explicitFramework?: FrameworkType): FrameworkDetection {
    if (explicitFramework && explicitFramework !== 'auto') {
        return {
            framework: explicitFramework,
            reason: 'explicit',
        };
    }

    const playwrightConfig = findConfigFile(appRoot, PLAYWRIGHT_CONFIG_FILES);
    if (playwrightConfig) {
        return {framework: 'playwright', configPath: playwrightConfig, reason: 'config'};
    }

    const cypressConfig = findConfigFile(appRoot, CYPRESS_CONFIG_FILES);
    if (cypressConfig) {
        return {framework: 'cypress', configPath: cypressConfig, reason: 'config'};
    }

    const seleniumConfig = findConfigFile(appRoot, SELENIUM_CONFIG_FILES);
    if (seleniumConfig) {
        return {framework: 'selenium', configPath: seleniumConfig, reason: 'config'};
    }

    const pkg = readPackageJson(appRoot);
    if (hasDependency(pkg, '@playwright/test') || hasDependency(pkg, 'playwright')) {
        return {framework: 'playwright', reason: 'package.json'};
    }
    if (hasDependency(pkg, 'cypress')) {
        return {framework: 'cypress', reason: 'package.json'};
    }
    if (hasDependency(pkg, 'selenium-webdriver') || hasDependency(pkg, 'webdriverio')) {
        return {framework: 'selenium', reason: 'package.json'};
    }

    return {framework: 'unknown', reason: 'unknown'};
}

function extractQuotedStrings(value: string): string[] {
    const matches = value.match(/['"]([^'"]+)['"]/g);
    if (!matches) {
        return [];
    }
    return matches.map((match) => match.slice(1, -1)).filter(Boolean);
}

function parsePlaywrightPatterns(content: string): string[] {
    const testDirMatch = content.match(/testDir\s*:\s*['"]([^'"]+)['"]/);
    if (testDirMatch) {
        const testDir = testDirMatch[1];
        return [
            join(testDir, '**/*.spec.{ts,tsx,js,jsx}'),
            join(testDir, '**/*.test.{ts,tsx,js,jsx}'),
        ];
    }

    const testMatchMatch = content.match(/testMatch\s*:\s*(\[[^\]]+\]|['"][^'"]+['"])/);
    if (testMatchMatch) {
        const patterns = extractQuotedStrings(testMatchMatch[1]);
        if (patterns.length > 0) {
            return patterns;
        }
    }

    return [];
}

function parseCypressPatterns(content: string): string[] {
    const specPatternMatch = content.match(/specPattern\s*:\s*(\[[^\]]+\]|['"][^'"]+['"])/);
    if (specPatternMatch) {
        const patterns = extractQuotedStrings(specPatternMatch[1]);
        if (patterns.length > 0) {
            return patterns;
        }
    }
    return [];
}

export function resolveTestPatterns(
    appRoot: string,
    detection: FrameworkDetection,
    explicitPatterns?: string[],
): TestPatternResolution {
    if (explicitPatterns && explicitPatterns.length > 0) {
        return {patterns: explicitPatterns, source: 'config'};
    }

    if (detection.configPath) {
        try {
            const configContent = readFileSync(detection.configPath, 'utf-8');
            if (detection.framework === 'playwright') {
                const parsed = parsePlaywrightPatterns(configContent);
                if (parsed.length > 0) {
                    return {patterns: parsed, source: basename(detection.configPath)};
                }
            }
            if (detection.framework === 'cypress') {
                const parsed = parseCypressPatterns(configContent);
                if (parsed.length > 0) {
                    return {patterns: parsed, source: basename(detection.configPath)};
                }
            }
        } catch {
            // Fall through to defaults
        }
    }

    if (detection.framework === 'playwright') {
        return {
            patterns: ['tests/**/*.{spec,test}.{ts,tsx,js,jsx}'],
            source: 'default-playwright',
        };
    }

    if (detection.framework === 'cypress') {
        return {
            patterns: ['cypress/e2e/**/*.cy.{js,jsx,ts,tsx}'],
            source: 'default-cypress',
        };
    }

    if (detection.framework === 'selenium') {
        return {
            patterns: ['tests/selenium/**/*.{spec,test}.{js,ts}'],
            source: 'default-selenium',
        };
    }

    return {patterns: [], source: 'none'};
}

