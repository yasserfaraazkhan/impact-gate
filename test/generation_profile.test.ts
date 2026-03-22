// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {
    resolveGenerationProfile,
    isMattermostProfile,
} from '../dist/prompts/generation_profile.js';

import type {KnowledgeGraph} from '../dist/knowledge/kg_types.js';

function makeKG(overrides?: Partial<KnowledgeGraph>): KnowledgeGraph {
    return {
        version: '1.0',
        project: {name: 'TestProject', frameworks: ['react'], languages: ['typescript']},
        nodes: [],
        edges: [],
        ...overrides,
    };
}

describe('generation_profile', () => {
    describe('resolveGenerationProfile', () => {
        it('returns Mattermost profile when profile=mattermost', () => {
            const profile = resolveGenerationProfile({profile: 'mattermost'});
            assert.equal(profile.projectName, 'Mattermost');
            assert.equal(profile.importStatement, '@mattermost/playwright-lib');
        });

        it('returns default Playwright profile with no config', () => {
            const profile = resolveGenerationProfile();
            assert.equal(profile.testFramework, 'Playwright');
            assert.equal(profile.importStatement, '@playwright/test');
            assert.equal(profile.testMode, 'ui');
        });

        it('returns API profile when testMode=api', () => {
            const profile = resolveGenerationProfile({testMode: 'api'});
            assert.equal(profile.testFramework, 'vitest + supertest');
            assert.equal(profile.importStatement, 'vitest');
            assert.equal(profile.testMode, 'api');
        });

        it('detects Mattermost from KG name', () => {
            const kg = makeKG({
                project: {name: 'Mattermost Web', frameworks: ['react'], languages: ['typescript']},
            });
            const profile = resolveGenerationProfile({}, kg);
            assert.equal(profile.projectName, 'Mattermost');
            assert.ok(isMattermostProfile(profile));
        });

        it('derives framework from KG metadata', () => {
            const kg = makeKG({
                project: {name: 'MyApp', frameworks: ['cypress', 'supertest'], languages: ['typescript']},
            });
            const profile = resolveGenerationProfile({}, kg);
            assert.equal(profile.testMode, 'both');
        });

        it('derives pytest framework from KG', () => {
            const kg = makeKG({
                project: {name: 'PythonAPI', frameworks: ['pytest'], languages: ['python']},
            });
            const profile = resolveGenerationProfile({}, kg);
            assert.equal(profile.testFramework, 'pytest');
            assert.equal(profile.testMode, 'api');
        });
    });

    describe('isMattermostProfile', () => {
        it('returns true for Mattermost import', () => {
            const profile = resolveGenerationProfile({profile: 'mattermost'});
            assert.equal(isMattermostProfile(profile), true);
        });

        it('returns false for default Playwright profile', () => {
            const profile = resolveGenerationProfile();
            assert.equal(isMattermostProfile(profile), false);
        });

        it('returns false for API profile', () => {
            const profile = resolveGenerationProfile({testMode: 'api'});
            assert.equal(isMattermostProfile(profile), false);
        });
    });
});
