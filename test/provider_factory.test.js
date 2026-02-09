const test = require('node:test');
const assert = require('node:assert/strict');

const {LLMProviderFactory} = require('../dist/index.js');

const TEST_OPENAI_KEY = 'sk-1234567890123456789012345';

function withEnv(key, value, fn) {
    const previous = process.env[key];
    process.env[key] = value;
    try {
        return fn();
    } finally {
        if (previous === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = previous;
        }
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
