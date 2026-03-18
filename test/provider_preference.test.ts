// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {LLMProviderFactory} from '../dist/index.js';

const TEST_ANTHROPIC_KEY = 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TEST_OPENAI_KEY = 'sk-1234567890123456789012345';

function withEnv(overrides: Record<string, string | undefined>, fn: () => unknown) {
    const saved: Record<string, string | undefined> = {};
    for (const key of Object.keys(overrides)) {
        saved[key] = process.env[key];
        if (overrides[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = overrides[key];
        }
    }
    const restore = () => {
        for (const key of Object.keys(saved)) {
            if (saved[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = saved[key];
            }
        }
    };
    try {
        const result = fn();
        if (result && typeof (result as Promise<unknown>).then === 'function') {
            return (result as Promise<unknown>).finally(restore);
        }
        restore();
        return result;
    } catch (error) {
        restore();
        throw error;
    }
}

// ---------------------------------------------------------------------------
// createFromPreference
// ---------------------------------------------------------------------------

describe('createFromPreference', () => {
    it('should create anthropic provider from explicit preference', async () => {
        await withEnv({ANTHROPIC_API_KEY: TEST_ANTHROPIC_KEY}, async () => {
            const provider = await LLMProviderFactory.createFromPreference('anthropic');
            assert.equal(provider.name, 'anthropic');
        });
    });

    it('should create openai provider from explicit preference', async () => {
        await withEnv({OPENAI_API_KEY: TEST_OPENAI_KEY}, async () => {
            const provider = await LLMProviderFactory.createFromPreference('openai');
            assert.equal(provider.name, 'openai');
        });
    });

    it('should create ollama provider from explicit preference', async () => {
        const provider = await LLMProviderFactory.createFromPreference('ollama');
        assert.equal(provider.name, 'ollama');
    });

    it('should handle preference with whitespace and casing', async () => {
        await withEnv({ANTHROPIC_API_KEY: TEST_ANTHROPIC_KEY}, async () => {
            const provider = await LLMProviderFactory.createFromPreference('  Anthropic  ');
            assert.equal(provider.name, 'anthropic');
        });
    });

    it('should fall back to createFromEnv when preference is "auto"', async () => {
        await withEnv({ANTHROPIC_API_KEY: TEST_ANTHROPIC_KEY, LLM_PROVIDER: undefined, OPENAI_API_KEY: undefined}, async () => {
            const provider = await LLMProviderFactory.createFromPreference('auto');
            assert.equal(provider.name, 'anthropic');
        });
    });

    it('should fall back to createFromEnv when preference is undefined', async () => {
        await withEnv({ANTHROPIC_API_KEY: TEST_ANTHROPIC_KEY, LLM_PROVIDER: undefined, OPENAI_API_KEY: undefined}, async () => {
            const provider = await LLMProviderFactory.createFromPreference(undefined);
            assert.equal(provider.name, 'anthropic');
        });
    });

    it('should fall back to createFromEnv when preference is empty string', async () => {
        await withEnv({ANTHROPIC_API_KEY: TEST_ANTHROPIC_KEY, LLM_PROVIDER: undefined, OPENAI_API_KEY: undefined}, async () => {
            const provider = await LLMProviderFactory.createFromPreference('');
            assert.equal(provider.name, 'anthropic');
        });
    });

    it('should throw for unknown provider preference', async () => {
        await assert.rejects(
            () => LLMProviderFactory.createFromPreference('invalid-provider'),
            /Unknown provider type/,
        );
    });

    it('should pass model through when preference includes colon', async () => {
        const provider = await LLMProviderFactory.createFromPreference('ollama:llama3:8b');
        assert.equal(provider.name, 'ollama');
        assert.equal(provider.model, 'llama3:8b');
    });

    it('should throw when anthropic preference set but no API key', async () => {
        await withEnv({ANTHROPIC_API_KEY: undefined}, async () => {
            await assert.rejects(
                () => LLMProviderFactory.createFromPreference('anthropic'),
                /ANTHROPIC_API_KEY/,
            );
        });
    });

    it('should throw when openai preference set but no API key', async () => {
        await withEnv({OPENAI_API_KEY: undefined}, async () => {
            await assert.rejects(
                () => LLMProviderFactory.createFromPreference('openai'),
                /OPENAI_API_KEY/,
            );
        });
    });
});
