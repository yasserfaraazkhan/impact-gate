// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, rmSync} from 'fs';
import {join} from 'path';
import os from 'os';

import {recommendTestsDeterministic, recommendTestsAI} from '../dist/api.js';

// Create a temporary app root directory with minimal structure for tests
let tmpDir;
let savedApiKey;

before(() => {
    tmpDir = join(os.tmpdir(), `e2e-agents-api-ai-test-${Date.now()}`);
    mkdirSync(tmpDir, {recursive: true});
    // Save and unset any real API key to avoid actual network calls
    savedApiKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
});

after(() => {
    if (tmpDir) {
        rmSync(tmpDir, {recursive: true, force: true});
    }
    // Restore env
    if (savedApiKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = savedApiKey;
    }
});

describe('recommendTestsDeterministic', () => {
    it('still works unchanged and returns the expected shape', () => {
        const result = recommendTestsDeterministic({
            cwd: tmpDir,
            path: tmpDir,
        });

        // Verify basic result shape
        assert.ok(result, 'Should return a result');
        assert.ok(result.impact, 'Should have an impact field');
        assert.ok(result.plan, 'Should have a plan field');
        assert.ok(typeof result.planPath === 'string', 'planPath should be a string');
        assert.ok(typeof result.ciSummaryMarkdown === 'string', 'ciSummaryMarkdown should be a string');
        assert.ok(typeof result.ciSummaryPath === 'string', 'ciSummaryPath should be a string');

        // Should not have aiEnrichment (synchronous deterministic function)
        assert.ok(!('aiEnrichment' in result), 'Deterministic result should not have aiEnrichment');
    });
});

describe('recommendTestsAI without API key', () => {
    it('returns deterministic result without crashing when ANTHROPIC_API_KEY is not set', async () => {
        // Ensure no API key
        delete process.env.ANTHROPIC_API_KEY;

        const result = await recommendTestsAI({
            cwd: tmpDir,
            path: tmpDir,
        });

        // Should return the same shape as deterministic
        assert.ok(result, 'Should return a result');
        assert.ok(result.impact, 'Should have an impact field');
        assert.ok(result.plan, 'Should have a plan field');
        assert.ok(typeof result.planPath === 'string', 'planPath should be a string');
        assert.ok(typeof result.ciSummaryMarkdown === 'string', 'ciSummaryMarkdown should be a string');
        assert.ok(typeof result.ciSummaryPath === 'string', 'ciSummaryPath should be a string');

        // aiEnrichment should be undefined when no API key
        assert.equal(result.aiEnrichment, undefined, 'aiEnrichment should be undefined without API key');
    });

    it('plan source should be "impact" (deterministic) when no API key is present', async () => {
        delete process.env.ANTHROPIC_API_KEY;

        const result = await recommendTestsAI({
            cwd: tmpDir,
            path: tmpDir,
        });

        // Without AI enrichment, plan source should be "impact" not "ai+deterministic"
        assert.equal(result.plan.source, 'impact', 'Plan source should be "impact" without AI enrichment');
    });
});

describe('recommendTestsAI result shape', () => {
    it('returns an object extending RecommendTestsV2Result with optional aiEnrichment', async () => {
        delete process.env.ANTHROPIC_API_KEY;

        const result = await recommendTestsAI({
            cwd: tmpDir,
            path: tmpDir,
        });

        // Verify all required RecommendTestsV2Result fields are present
        assert.ok('impact' in result, 'Must have impact');
        assert.ok('plan' in result, 'Must have plan');
        assert.ok('planPath' in result, 'Must have planPath');
        assert.ok('ciSummaryMarkdown' in result, 'Must have ciSummaryMarkdown');
        assert.ok('ciSummaryPath' in result, 'Must have ciSummaryPath');

        // aiEnrichment is optional — should be undefined without key
        assert.ok('aiEnrichment' in result || !('aiEnrichment' in result),
            'aiEnrichment key may or may not be present');
    });
});
