import assert from 'assert';
import test from 'node:test';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {analyzeFiles} from '../dist/agent/analysis.js';
import {resolveConfig} from '../dist/agent/config.js';
import {loadSubsystemRiskResolver} from '../dist/agent/subsystem_risk.js';

function writeJson(path, value) {
    writeFileSync(path, JSON.stringify(value, null, 2), 'utf-8');
}

test('subsystem risk resolver caps rules per file and preserves highest priority floor', () => {
    const root = mkdtempSync(join(tmpdir(), 'subsystem-risk-resolver-'));
    try {
        const mapPath = join(root, 'subsystem-risk-map.json');
        writeJson(mapPath, {
            rules: [
                {
                    id: 'plugin-low',
                    patterns: ['channels/src/plugins/**'],
                    scoreDelta: 1,
                    priorityFloor: 'P2',
                    reasons: ['Low-impact plugin rule'],
                },
                {
                    id: 'plugin-high',
                    patterns: ['channels/src/plugins/**'],
                    scoreDelta: 5,
                    priorityFloor: 'P0',
                    reasons: ['High-impact plugin rule'],
                },
                {
                    id: 'plugin-medium',
                    patterns: ['channels/src/plugins/**'],
                    scoreDelta: 3,
                    priorityFloor: 'P1',
                    reasons: ['Medium-impact plugin rule'],
                },
            ],
        });

        const resolver = loadSubsystemRiskResolver({
            enabled: true,
            mapPath,
            maxRulesPerFile: 2,
        });

        assert.equal(resolver.info.rulesLoaded, 3);
        const matches = resolver.matchFile('channels/src/plugins/registry.ts');
        assert.equal(matches.length, 2);
        assert.deepEqual(
            matches.map((match) => match.ruleId).sort(),
            ['plugin-high', 'plugin-medium'],
        );
        const matchedFloors = matches.map((match) => match.priorityFloor).filter(Boolean);
        assert(matchedFloors.includes('P0'));
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

test('analyzeFiles applies subsystem risk score and priority floor', () => {
    const root = mkdtempSync(join(tmpdir(), 'subsystem-risk-analysis-'));
    try {
        const changedFile = 'channels/src/plugins/registry.tsx';
        const changedFilePath = join(root, changedFile);
        mkdirSync(join(root, 'channels/src/plugins'), {recursive: true});
        writeFileSync(changedFilePath, 'export const registry = () => <button>Open</button>;', 'utf-8');

        const mapPath = join(root, '.e2e-ai-agents', 'subsystem-risk-map.json');
        mkdirSync(join(root, '.e2e-ai-agents'), {recursive: true});
        writeJson(mapPath, {
            rules: [
                {
                    id: 'plugin-platform',
                    patterns: ['channels/src/plugins/**'],
                    scoreDelta: 3,
                    priorityFloor: 'P0',
                    reasons: ['Shared plugin surface changed'],
                    keywords: ['plugins'],
                },
            ],
        });

        const {config} = resolveConfig(root, undefined, {path: root, mode: 'impact'});
        config.risk.p0Threshold = 50;
        config.risk.p1Threshold = 25;
        config.impact.subsystemRisk.enabled = true;
        config.impact.subsystemRisk.mapPath = mapPath;
        config.impact.subsystemRisk.maxRulesPerFile = 4;

        const result = analyzeFiles(root, [changedFile], config);

        assert.equal(result.subsystemRisk.enabled, true);
        assert.equal(result.subsystemRisk.mapFound, true);
        assert.equal(result.subsystemRisk.rulesLoaded, 1);
        assert.equal(result.subsystemRisk.filesMatched, 1);
        assert.equal(result.subsystemRisk.ruleMatches, 1);
        assert.equal(result.subsystemRisk.boostedFlows, 1);

        assert.equal(result.files.length, 1);
        assert(result.files[0].subsystemRisk);
        assert.deepEqual(result.files[0].subsystemRisk.rules, ['plugin-platform']);
        assert.equal(result.files[0].subsystemRisk.priorityFloor, 'P0');
        assert(result.files[0].keywords.includes('plugins'));

        assert.equal(result.flows.length, 1);
        assert.equal(result.flows[0].priority, 'P0');
        assert.equal(result.flows[0].subsystemRiskBoost, 3);
        assert(result.flows[0].subsystemRiskRules.includes('plugin-platform'));
        assert(result.flows[0].reasons.some((reason) => reason.includes('Subsystem risk adjustment')));
        assert(result.flows[0].reasons.some((reason) => reason.includes('Shared plugin surface changed')));
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});
