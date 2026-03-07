const test = require('node:test');
const assert = require('node:assert/strict');

const {LLMProviderFactory} = require('../dist/index.js');

const TEST_OPENAI_KEY = 'sk-1234567890123456789012345';

function withEnv(key, value, fn) {
    const previous = process.env[key];
    const restore = () => {
        if (previous === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = previous;
        }
    };
    if (value === undefined) {
        delete process.env[key];
    } else {
        process.env[key] = value;
    }
    try {
        const result = fn();
        if (result && typeof result.then === 'function') {
            return result.finally(restore);
        }
        restore();
        return result;
    } catch (error) {
        restore();
        throw error;
    }
}

test('createFromString preserves model names with colons (ollama)', () => {
    const provider = LLMProviderFactory.createFromString('ollama:deepseek-r1:14b');
    assert.equal(provider.name, 'ollama');
    assert.equal(provider.model, 'deepseek-r1:14b');
});

test('createFromString falls back to default model when not provided', () => {
    const provider = LLMProviderFactory.createFromString('ollama');
    assert.equal(provider.name, 'ollama');
    assert.equal(provider.model, 'deepseek-r1:7b');
});

test('createFromString supports openai when OPENAI_API_KEY is set', () => {
    withEnv('OPENAI_API_KEY', TEST_OPENAI_KEY, () => {
        const provider = LLMProviderFactory.createFromString('openai:gpt-4');
        assert.equal(provider.name, 'openai');
        assert.equal(provider.model, 'gpt-4');
    });
});

test('createFromEnv rejects invalid explicit provider values', async () => {
    await withEnv('LLM_PROVIDER', 'invalid-provider', async () => {
        await assert.rejects(
            () => LLMProviderFactory.createFromEnv(),
            /Unknown LLM_PROVIDER value/,
        );
    });
});

test('createFromEnv requires OPENAI_API_KEY when LLM_PROVIDER=openai', async () => {
    await withEnv('LLM_PROVIDER', 'openai', async () => {
        await withEnv('OPENAI_API_KEY', undefined, async () => {
            await assert.rejects(
                () => LLMProviderFactory.createFromEnv(),
                /OPENAI_API_KEY environment variable is required/,
            );
        });
    });
});
