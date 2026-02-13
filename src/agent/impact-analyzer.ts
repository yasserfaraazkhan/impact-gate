/**
 * Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
 * See LICENSE.txt for license information.
 *
 * Impact Analysis Engine
 *
 * Analyzes code changes and identifies which user flows are affected,
 * then maps those flows to test coverage gaps.
 */

import {execSync} from 'child_process';
import {existsSync, readFileSync} from 'fs';
import {join, resolve} from 'path';
import {minimatch} from 'minimatch';

// =============================================================================
// TYPES
// =============================================================================

export interface GitChange {
    path: string;
    status: 'added' | 'modified' | 'deleted';
    ref?: string;
}

export interface ChangeAnalysis {
    file: string;
    status: 'added' | 'modified' | 'deleted';
    linesAdded: number;
    linesRemoved: number;
    functions: string[];
    classes: string[];
    imports: Array<{from: string; names: string[]}>;
}

export interface Flow {
    id: string;
    name: string;
    priority: 'P0' | 'P1' | 'P2';
    keywords: string[];
    paths: string[];
    tests: string[];
    audience: string[];
    flags: Array<{name: string; source: string}>;
}

export interface FlowImpact {
    flow: Flow;
    matchType: 'path' | 'keyword' | 'import' | 'combined';
    confidence: number; // 0-100
    affectedFiles: string[];
    existingTests: string[];
    testGaps: string[];
    reasons: string[];
}

export interface FlowGroup {
    id: string;
    name: string;
    description: string;
    flows: string[];
    testStrategy: 'sequential' | 'parallel' | 'mixed';
    priority: string;
    affectedFlows: FlowImpact[];
}

export interface ImpactReport {
    timestamp: string;
    gitRef: string;
    totalChanges: number;
    affectedFlows: FlowImpact[];
    flowGroups: FlowGroup[];
    ungroupedFlows: FlowImpact[];
    priorityBreakdown: {
        p0: number;
        p1: number;
        p2: number;
    };
    testCoverage: {
        total: number;
        covered: number;
        gaps: number;
    };
    recommendations: string[];
    hasP0Impact: boolean;
}

// =============================================================================
// GIT CHANGE DETECTION
// =============================================================================

/**
 * Intelligently detect the best git reference for comparison:
 * - If on feature branch: use origin/master, origin/main, or master
 * - If on main branch: use HEAD~1
 * Returns the best available reference to compare against
 */
export function detectComparisonBase(): string {
    try {
        const gitRoot = findGitRoot();
        // Get current branch
        const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
            encoding: 'utf-8',
            cwd: gitRoot,
        }).trim();

        // If on main branch, just check last commit
        if (currentBranch === 'master' || currentBranch === 'main') {
            return 'HEAD~1';
        }

        // On feature branch: try to find the main branch
        // Try origin/master first, then origin/main, then master
        const candidates = ['origin/master', 'origin/main', 'master'];
        for (const candidate of candidates) {
            try {
                execSync(`git rev-parse ${candidate}`, {
                    encoding: 'utf-8',
                    cwd: gitRoot,
                    stdio: 'ignore',
                });
                return candidate;
            } catch {
                // Try next candidate
            }
        }

        // Fallback if none found
        return 'HEAD~1';
    } catch {
        // If git commands fail, default to HEAD~1
        return 'HEAD~1';
    }
}

/**
 * Check if a file path is a frontend file
 * Frontend includes: webapp and e2e-tests directories
 */
function isFrontendFile(filePath: string): boolean {
    return filePath.startsWith('webapp/') || filePath.startsWith('e2e-tests/');
}

/**
 * Get git changes since a given reference
 * Filters to only include frontend files (webapp and e2e-tests)
 */
export function getGitChanges(since: string = 'HEAD~1'): GitChange[] {
    try {
        const gitRoot = findGitRoot();
        const result = execSync(`git diff --name-status ${since}...HEAD`, {
            encoding: 'utf-8',
            cwd: gitRoot,
        });

        return result
            .trim()
            .split('\n')
            .filter((line) => line.length > 0)
            .map((line) => {
                const [status, path] = line.split('\t');
                return {
                    path,
                    status: status as 'added' | 'modified' | 'deleted',
                    ref: since,
                };
            })
            .filter((change) => isFrontendFile(change.path));
    } catch (error) {
        console.warn(`⚠️  Could not get git changes: ${(error as Error).message}`);
        return [];
    }
}

/**
 * Get git diff stats for a file
 */
function getFileDiffStats(filePath: string, since: string = 'HEAD~1'): {linesAdded: number; linesRemoved: number} {
    try {
        const gitRoot = findGitRoot();
        const result = execSync(`git diff --numstat ${since}...HEAD -- ${filePath}`, {
            encoding: 'utf-8',
            cwd: gitRoot,
        });

        const match = result.match(/(\d+)\s+(\d+)/);
        if (match) {
            return {
                linesAdded: parseInt(match[1], 10),
                linesRemoved: parseInt(match[2], 10),
            };
        }
    } catch (error) {
        // Ignore errors
    }

    return {linesAdded: 0, linesRemoved: 0};
}

// =============================================================================
// FLOW CATALOG LOADING
// =============================================================================

/**
 * Load flow catalog from flows.json
 */
export function loadFlowCatalog(catalogPath?: string): Flow[] {
    let path = catalogPath;

    if (!path) {
        // Try multiple possible paths for flows.json
        const possiblePaths = [
            // If running from e2e-tests/playwright directory
            join(process.cwd(), '.e2e-ai-agents/flows.json'),
            // If running from monorepo root
            join(process.cwd(), 'e2e-tests/playwright/.e2e-ai-agents/flows.json'),
        ];

        // Find the first path that exists
        path = possiblePaths.find((p) => existsSync(p));

        if (!path) {
            throw new Error(`Flow catalog not found. Tried:\n${possiblePaths.map((p) => `  - ${p}`).join('\n')}`);
        }
    }

    if (!existsSync(path)) {
        throw new Error(`Flow catalog not found at ${path}`);
    }

    const content = readFileSync(path, 'utf-8');
    const data = JSON.parse(content);
    return data.flows || [];
}

// =============================================================================
// FLOW MATCHING
// =============================================================================

/**
 * Check if a file path matches a glob pattern
 */
function pathMatches(filePath: string, pattern: string): boolean {
    // Normalize patterns
    const normalizedPattern = pattern.replace(/\\/g, '/');
    const normalizedPath = filePath.replace(/\\/g, '/');

    // Handle ** wildcards
    if (normalizedPattern.includes('**')) {
        // Convert ** pattern to regex
        // Use placeholder to avoid escaping issues with **
        const placeholder = '___DOUBLE_STAR___';
        let regexPattern = normalizedPattern.replace(/\*\*/g, placeholder);

        // Escape regex special chars
        regexPattern = regexPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');

        // Replace placeholder with .* (matches anything including /)
        regexPattern = regexPattern.replace(new RegExp(placeholder, 'g'), '.*');

        // Replace remaining * with [^/]* (matches anything except /)
        regexPattern = regexPattern.replace(/\*/g, '[^/]*');

        // Replace ? with [^/]
        regexPattern = regexPattern.replace(/\?/g, '[^/]');

        return new RegExp(`^${regexPattern}$`).test(normalizedPath);
    }

    return minimatch(normalizedPath, normalizedPattern, {matchBase: true});
}

/**
 * Calculate confidence score based on match type and quality
 */
function calculateConfidence(matchType: string, matchQuality: number): number {
    const typeWeights: Record<string, number> = {
        path_exact: 100,
        path_pattern: 85,
        keyword_multiple: 75,
        keyword_single: 60,
        import: 50,
    };

    return Math.min(100, typeWeights[matchType] || 50);
}

/**
 * Match a flow to changed files
 */
export function matchFlowToChanges(flow: Flow, changes: ChangeAnalysis[]): FlowImpact | null {
    const reasons: string[] = [];
    const affectedFiles: string[] = [];
    let matchType: 'path' | 'keyword' | 'import' | 'combined' = 'path';
    let confidence = 0;

    // Check path matching
    const pathMatchedFiles = changes.filter((change) =>
        flow.paths.some((pattern) => pathMatches(change.file, pattern)),
    );

    if (pathMatchedFiles.length > 0) {
        affectedFiles.push(...pathMatchedFiles.map((c) => c.file));
        confidence = Math.max(confidence, 90);
        matchType = 'path';
        reasons.push(
            `${pathMatchedFiles.length} file(s) match flow paths: ${pathMatchedFiles.map((c) => c.file).join(', ')}`,
        );
    }

    // Check keyword matching
    const flowKeywords = flow.keywords.map((k) => k.toLowerCase());
    const keywordMatches: string[] = [];

    for (const change of changes) {
        const changeContent = [
            ...change.functions,
            ...change.classes,
            ...change.imports.flatMap((i) => [i.from, ...i.names]),
        ]
            .join(' ')
            .toLowerCase();

        for (const keyword of flowKeywords) {
            if (changeContent.includes(keyword)) {
                keywordMatches.push(change.file);
                break;
            }
        }
    }

    if (keywordMatches.length > 0) {
        affectedFiles.push(...keywordMatches.filter((f) => !affectedFiles.includes(f)));
        confidence = Math.max(confidence, keywordMatches.length > 1 ? 75 : 60);
        if (pathMatches.length === 0) {
            matchType = 'keyword';
        } else {
            matchType = 'combined';
        }
        reasons.push(`${keywordMatches.length} file(s) contain keywords: ${flowKeywords.slice(0, 3).join(', ')}`);
    }

    // Check import matching
    const importMatches: string[] = [];
    const flowPaths = flow.paths.map((p) => p.replace(/\*\*/g, '').toLowerCase());

    for (const change of changes) {
        for (const imp of change.imports) {
            const impFrom = imp.from.toLowerCase();
            for (const flowPath of flowPaths) {
                if (impFrom.includes(flowPath.replace(/[\/\\]/g, ''))) {
                    importMatches.push(change.file);
                    break;
                }
            }
        }
    }

    if (importMatches.length > 0) {
        affectedFiles.push(...importMatches.filter((f) => !affectedFiles.includes(f)));
        confidence = Math.max(confidence, 50);
        if (pathMatches.length === 0 && keywordMatches.length === 0) {
            matchType = 'import';
        } else {
            matchType = 'combined';
        }
    }

    // Return null if no matches
    if (confidence === 0) {
        return null;
    }

    return {
        flow,
        matchType,
        confidence: Math.min(100, confidence),
        affectedFiles: [...new Set(affectedFiles)],
        existingTests: [],
        testGaps: [],
        reasons,
    };
}

// =============================================================================
// TEST ANALYSIS
// =============================================================================

/**
 * Find existing tests for a flow
 */
export function findExistingTests(flow: Flow, repoRoot?: string): string[] {
    const root = repoRoot || findGitRoot();
    const tests: string[] = [];

    // Use tests array from flow definition
    if (flow.tests && flow.tests.length > 0) {
        for (const testPath of flow.tests) {
            const fullPath = join(root, testPath);
            if (existsSync(fullPath)) {
                tests.push(testPath);
            }
        }
    }

    return tests;
}

/**
 * Identify test coverage gaps for a flow
 */
export function identifyTestGaps(flow: Flow, existingTests: string[]): string[] {
    const gaps: string[] = [];

    // If no existing tests, all scenarios are gaps
    if (existingTests.length === 0) {
        gaps.push(`No existing tests for ${flow.name}`);

        // Suggest specific test scenarios based on audience and keywords
        const audiences = flow.audience || [];
        const keywords = flow.keywords || [];

        if (audiences.length > 0) {
            gaps.push(`Missing scenarios for audiences: ${audiences.slice(0, 2).join(', ')}`);
        }

        if (keywords.length > 0) {
            gaps.push(`Missing tests for: ${keywords.slice(0, 2).join(', ')}`);
        }
    }

    // Check for specific audience coverage
    const audiences = flow.audience || [];
    if (audiences.length > 1) {
        // Suggest multi-audience testing
        gaps.push('Consider testing with different user roles');
    }

    // Check for edge cases based on flow type
    if (flow.keywords.includes('realtime') || flow.keywords.includes('websocket')) {
        gaps.push('Consider testing offline/reconnection scenarios');
    }

    if (flow.keywords.includes('edit') || flow.keywords.includes('delete')) {
        gaps.push('Consider testing permissions/authorization edge cases');
    }

    return gaps;
}

// =============================================================================
// MAIN ANALYSIS
// =============================================================================

/**
 * Analyze code impact and return comprehensive report
 */
export async function analyzeImpact(
    changes: GitChange[],
    flows: Flow[],
    options: {verbose?: boolean; includeTests?: boolean; repoRoot?: string} = {},
): Promise<ImpactReport> {
    const repoRoot = options.repoRoot || findGitRoot();

    // Analyze each changed file
    const analyses: ChangeAnalysis[] = [];
    for (const change of changes) {
        const analysis = analyzeFile(change.path, change.status);
        if (analysis) {
            analyses.push(analysis);
        }
    }

    if (options.verbose) {
        console.log(`📊 Analyzed ${analyses.length} changed files`);
    }

    // Match changes to flows
    const impactedFlows: FlowImpact[] = [];
    for (const flow of flows) {
        const impact = matchFlowToChanges(flow, analyses);
        if (impact && impact.confidence > 0) {
            // Find existing tests
            impact.existingTests = findExistingTests(flow, repoRoot);

            // Identify test gaps
            impact.testGaps = identifyTestGaps(flow, impact.existingTests);

            impactedFlows.push(impact);
        }
    }

    // Sort by priority and confidence
    impactedFlows.sort((a, b) => {
        const priorityOrder: Record<string, number> = {P0: 0, P1: 1, P2: 2};
        const aPriority = priorityOrder[a.flow.priority];
        const bPriority = priorityOrder[b.flow.priority];

        if (aPriority !== bPriority) {
            return aPriority - bPriority;
        }

        return b.confidence - a.confidence;
    });

    if (options.verbose) {
        console.log(`🎯 Found ${impactedFlows.length} affected flows`);
    }

    // Generate recommendations
    const recommendations = generateRecommendations(impactedFlows);

    // Group flows by relationships
    const {groups, ungrouped} = groupFlowsByRelationships(impactedFlows, flows);

    return {
        timestamp: new Date().toISOString(),
        gitRef: changes[0]?.ref || 'HEAD',
        totalChanges: changes.length,
        affectedFlows: impactedFlows,
        flowGroups: groups,
        ungroupedFlows: ungrouped,
        priorityBreakdown: {
            p0: impactedFlows.filter((f) => f.flow.priority === 'P0').length,
            p1: impactedFlows.filter((f) => f.flow.priority === 'P1').length,
            p2: impactedFlows.filter((f) => f.flow.priority === 'P2').length,
        },
        testCoverage: {
            total: impactedFlows.length,
            covered: impactedFlows.filter((f) => f.existingTests.length > 0).length,
            gaps: impactedFlows.filter((f) => f.testGaps.length > 0).length,
        },
        recommendations,
        hasP0Impact: impactedFlows.some((f) => f.flow.priority === 'P0'),
    };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Load flow groups from flows.json
 */
function loadFlowGroups(): Record<string, any> {
    const possiblePaths = [
        // If running from e2e-tests/playwright directory
        join(process.cwd(), '.e2e-ai-agents/flows.json'),
        // If running from monorepo root
        join(process.cwd(), 'e2e-tests/playwright/.e2e-ai-agents/flows.json'),
    ];

    const path = possiblePaths.find((p) => existsSync(p));
    if (!path) {
        return {}; // Return empty object if flows.json not found
    }

    try {
        const content = readFileSync(path, 'utf-8');
        const data = JSON.parse(content);
        return data.flowGroups || {};
    } catch (error) {
        return {}; // Return empty object on parse error
    }
}

/**
 * Group related flows into test journeys based on flowGroup metadata
 */
function groupFlowsByRelationships(
    impactedFlows: FlowImpact[],
    flowCatalog: Flow[],
): {
    groups: FlowGroup[];
    ungrouped: FlowImpact[];
} {
    const groups: FlowGroup[] = [];
    const grouped = new Set<string>();

    // Load flow group definitions from flows.json
    const flowGroupDefs = loadFlowGroups();

    // For each flow group definition
    for (const [groupId, groupDef] of Object.entries(flowGroupDefs)) {
        const groupFlows = (groupDef as any).flows || [];

        // Find which flows in this group are impacted
        const affectedInGroup = impactedFlows.filter((impact) => groupFlows.includes(impact.flow.id));

        if (affectedInGroup.length > 0) {
            groups.push({
                id: groupId,
                name: (groupDef as any).name || groupId,
                description: (groupDef as any).description || '',
                flows: groupFlows,
                testStrategy: (groupDef as any).testStrategy || 'mixed',
                priority: (groupDef as any).priority || 'P1',
                affectedFlows: affectedInGroup,
            });

            // Mark as grouped
            affectedInGroup.forEach((impact) => grouped.add(impact.flow.id));
        }
    }

    // Remaining ungrouped flows
    const ungrouped = impactedFlows.filter((impact) => !grouped.has(impact.flow.id));

    return {groups, ungrouped};
}

/**
 * Analyze a single file to extract functions, classes, and imports
 */
/**
 * Find the git repository root directory
 */
function findGitRoot(): string {
    let currentDir = process.cwd();
    const root = resolve('/');

    while (currentDir !== root) {
        if (existsSync(join(currentDir, '.git'))) {
            return currentDir;
        }
        currentDir = resolve(currentDir, '..');
    }

    // Fallback to process.cwd()
    return process.cwd();
}

function analyzeFile(filePath: string, status: string): ChangeAnalysis | null {
    const repoRoot = findGitRoot();
    const fullPath = join(repoRoot, filePath);

    const stats = getFileDiffStats(filePath);

    // Extract imports, functions, and classes from the file
    const functions: string[] = [];
    const classes: string[] = [];
    const imports: Array<{from: string; names: string[]}> = [];

    try {
        const content = readFileSync(fullPath, 'utf-8');

        // Extract imports (handles: import X from 'Y', import * as X from 'Y', etc.)
        const importRegex = /import\s+(?:{([^}]+)}|(?:\*\s+as\s+)?(\w+))\s+from\s+['"]([^'"]+)['"]/g;
        let importMatch;
        while ((importMatch = importRegex.exec(content)) !== null) {
            const namedImports = importMatch[1]?.split(',').map((s) => s.trim().split(/\s+as\s+/)[0]) || [];
            const defaultImport = importMatch[2] ? [importMatch[2]] : [];
            const allNames = [...namedImports, ...defaultImport].filter(Boolean);

            if (allNames.length > 0) {
                imports.push({
                    from: importMatch[3],
                    names: allNames,
                });
            }
        }

        // Extract function declarations (handles: function X, const X = () => {}, export function X)
        const functionRegex = /(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=)/g;
        let functionMatch;
        const seenFunctions = new Set<string>();
        while ((functionMatch = functionRegex.exec(content)) !== null) {
            const funcName = functionMatch[1] || functionMatch[2];
            if (funcName && !seenFunctions.has(funcName)) {
                functions.push(funcName);
                seenFunctions.add(funcName);
            }
        }

        // Extract class declarations
        const classRegex = /(?:export\s+)?class\s+(\w+)/g;
        let classMatch;
        while ((classMatch = classRegex.exec(content)) !== null) {
            if (classMatch[1]) {
                classes.push(classMatch[1]);
            }
        }
    } catch {
        // If file doesn't exist or can't be read, continue with empty arrays
    }

    return {
        file: filePath,
        status: status as 'added' | 'modified' | 'deleted',
        linesAdded: stats.linesAdded,
        linesRemoved: stats.linesRemoved,
        functions,
        classes,
        imports,
    };
}

/**
 * Generate actionable recommendations based on impact
 */
function generateRecommendations(impactedFlows: FlowImpact[]): string[] {
    const recommendations: string[] = [];

    const p0Flows = impactedFlows.filter((f) => f.flow.priority === 'P0');
    const p1Flows = impactedFlows.filter((f) => f.flow.priority === 'P1');

    if (p0Flows.length > 0) {
        recommendations.push(
            `✅ Run critical (P0) flow tests immediately: ${p0Flows.map((f) => f.flow.id).join(', ')}`,
        );
    }

    if (p1Flows.length > 0) {
        recommendations.push(`🟡 Run high-priority (P1) flow tests: ${p1Flows.map((f) => f.flow.id).join(', ')}`);
    }

    const gapFlows = impactedFlows.filter((f) => f.testGaps.length > 0);
    if (gapFlows.length > 0) {
        recommendations.push(`📝 Generate tests to cover ${gapFlows.length} flow(s) with test gaps`);
    }

    const lowConfidenceFlows = impactedFlows.filter((f) => f.confidence < 60);
    if (lowConfidenceFlows.length > 0) {
        recommendations.push(`🔍 Review ${lowConfidenceFlows.length} flow(s) with low confidence matches (< 60%)`);
    }

    return recommendations;
}
