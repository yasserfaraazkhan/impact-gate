// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Bootstrap command — takes a project with an Understand-Anything knowledge graph
 * and generates route-families.json + initial test stubs.
 */

import {existsSync, mkdirSync, writeFileSync} from 'fs';
import {join, resolve} from 'path';

import {logger, LogLevel} from '../../logger.js';
import {loadKnowledgeGraph, classifyProjectType, transformKGToFamilies} from '../../knowledge/kg_bridge.js';
import {serializeManifest} from '../../knowledge/route_families.js';
import {detectFramework, detectTestMode} from '../../adapters/framework_adapter.js';
import {resolveGenerationProfile} from '../../prompts/generation_profile.js';

import type {ParsedArgs} from '../types.js';

class BootstrapError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BootstrapError';
    }
}

export async function runBootstrapCommand(args: ParsedArgs): Promise<void> {
    const projectRoot = resolve(args.path || '.');

    if (args.verbose) logger.setLevel(LogLevel.DEBUG);
    if (args.jsonOutput) logger.setJsonMode(true);

    logger.info('e2e-ai-agents bootstrap');
    logger.info('=======================');

    // ---------- Step 1: Check for knowledge graph ----------
    const kgPath = args.bootstrapKgPath
        ? resolve(args.bootstrapKgPath)
        : join(projectRoot, '.understand-anything', 'knowledge-graph.json');

    if (!existsSync(kgPath)) {
        throw new BootstrapError(
            `Knowledge graph not found at: ${kgPath}\n\n` +
            'To bootstrap, first generate a knowledge graph for your project:\n' +
            '  1. Install Understand-Anything: npm install -g understand-anything\n' +
            '  2. Run: understand-anything analyze .\n' +
            '  3. Then run: e2e-ai-agents bootstrap\n\n' +
            'Or provide a path: e2e-ai-agents bootstrap --kg-path /path/to/knowledge-graph.json',
        );
    }

    // ---------- Step 2: Load KG and classify ----------
    logger.info('Loading knowledge graph...');
    const kg = loadKnowledgeGraph(projectRoot, args.bootstrapKgPath ? kgPath : undefined);
    if (!kg) {
        throw new BootstrapError('Failed to load knowledge graph. Ensure it is valid JSON with nodes and edges arrays.');
    }

    const projectType = classifyProjectType(kg);
    logger.info(`Project: ${kg.project.name || '(unnamed)'}`);
    logger.info(`Type: ${projectType}`);
    logger.info(`Frameworks: ${kg.project.frameworks.join(', ')}`);
    logger.info(`Languages: ${kg.project.languages.join(', ')}`);
    logger.info(`Nodes: ${kg.nodes.length}, Edges: ${kg.edges.length}`);

    // ---------- Step 3: Transform KG to route families ----------
    logger.info('');
    logger.info('Generating route families from knowledge graph...');
    const manifest = transformKGToFamilies(kg);

    const maxFamilies = args.bootstrapMaxFamilies || 50;
    if (manifest.families.length > maxFamilies) {
        logger.info(`Limiting to top ${maxFamilies} families (of ${manifest.families.length} discovered). Use --max-families to adjust.`);
        manifest.families = manifest.families.slice(0, maxFamilies);
    }

    const p0Count = manifest.families.filter((f) => f.priority === 'P0').length;
    const p1Count = manifest.families.filter((f) => f.priority === 'P1').length;
    const p2Count = manifest.families.filter((f) => f.priority === 'P2').length;
    logger.info(`Discovered ${manifest.families.length} families: ${p0Count} P0, ${p1Count} P1, ${p2Count} P2`);

    // ---------- Step 4: Detect/scaffold test framework ----------
    const framework = detectFramework(projectRoot);
    const testMode = args.bootstrapTestMode || detectTestMode(projectRoot, kg);
    const profile = resolveGenerationProfile({profile: args.profile, testMode}, kg);

    logger.info(`Test framework: ${framework.name}`);
    logger.info(`Test mode: ${testMode}`);
    logger.info(`Generation profile: ${profile.projectName} (${profile.testFramework})`);

    // ---------- Step 5: Write route-families.json ----------
    const outputDir = join(projectRoot, '.e2e-ai-agents');
    const outputPath = join(outputDir, 'route-families.json');

    if (args.dryRun) {
        logger.info('');
        logger.info('Dry run — proposed manifest:');
        console.log(serializeManifest(manifest));
    } else {
        if (!existsSync(outputDir)) {
            mkdirSync(outputDir, {recursive: true});
        }
        writeFileSync(outputPath, serializeManifest(manifest), 'utf-8');
        logger.info(`Wrote ${outputPath}`);
    }

    // ---------- Step 6: Summary and next steps ----------
    logger.info('');
    logger.info('Bootstrap complete!');
    logger.info('');
    logger.info('Route families summary:');
    for (const family of manifest.families.slice(0, 15)) {
        const endpoints = family.apiEndpoints?.length || 0;
        const endpointSuffix = endpoints > 0 ? ` (${endpoints} API endpoints)` : '';
        logger.info(`  ${family.priority || 'P2'} ${family.id}: ${family.routes.join(', ')}${endpointSuffix}`);
    }
    if (manifest.families.length > 15) {
        logger.info(`  ... and ${manifest.families.length - 15} more`);
    }

    logger.info('');
    logger.info('Next steps:');
    logger.info('  1. Review and refine .e2e-ai-agents/route-families.json');
    logger.info('  2. Run `e2e-ai-agents train --enrich` to add LLM-enriched metadata');
    logger.info('  3. Run `e2e-ai-agents plan` to see what tests are needed');
    logger.info('  4. Run `e2e-ai-agents generate` to create test stubs');
}
