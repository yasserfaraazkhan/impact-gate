// Test for base_provider.ts
import assert from 'assert';
import test from 'node:test';
import {BaseProvider} from '../dist/base_provider.js';

// Create concrete implementation for testing
class TestProvider extends BaseProvider {
    name = 'test';
    capabilities = {
        vision: false,
        streaming: false,
        maxTokens: 1000,
        costPer1MInputTokens: 1,
        costPer1MOutputTokens: 2,
        supportsTools: false,
        supportsPromptCaching: false,
        typicalResponseTimeMs: 1000,
    };

    async generateText(prompt) {
        return {text: prompt, usage: {inputTokens: 1, outputTokens: 1, totalTokens: 2}, cost: 0};
    }

    async analyzeImage() {
        throw new Error('Not implemented');
    }

    async *streamText() {
        throw new Error('Not implemented');
    }

    async checkHealth() {
        return {healthy: true, message: 'OK'};
    }
}

test('BaseProvider initializes stats', () => {
    const provider = new TestProvider();
    const stats = provider.getUsageStats();
    assert.equal(stats.requestCount, 0);
    assert.equal(stats.totalInputTokens, 0);
    assert.equal(stats.totalOutputTokens, 0);
    assert.equal(stats.totalTokens, 0);
    assert.equal(stats.totalCost, 0);
    assert.equal(stats.averageResponseTimeMs, 0);
    assert.equal(stats.failedRequests, 0);
    assert(stats.startTime instanceof Date);
    assert(stats.lastUpdated instanceof Date);
});

test('BaseProvider.getUsageStats returns copy', () => {
    const provider = new TestProvider();
    const stats1 = provider.getUsageStats();
    const stats2 = provider.getUsageStats();
    assert.deepEqual(stats1, stats2);
    assert(stats1 !== stats2); // Should be different objects
});

test('BaseProvider.resetUsageStats clears stats', () => {
    const provider = new TestProvider();

    // Simulate usage by directly accessing protected method
    provider['updateStats'](
        {inputTokens: 100, outputTokens: 50, totalTokens: 150},
        1000,
        0.5
    );

    let stats = provider.getUsageStats();
    assert.equal(stats.requestCount, 1);
    assert.equal(stats.totalInputTokens, 100);

    provider.resetUsageStats();
    stats = provider.getUsageStats();
    assert.equal(stats.requestCount, 0);
    assert.equal(stats.totalInputTokens, 0);
    assert.equal(stats.totalCost, 0);
});

test('BaseProvider.calculateCost handles basic cost', () => {
    const provider = new TestProvider();
    const cost = provider['calculateCost'](
        {inputTokens: 1_000_000, outputTokens: 1_000_000},
        1, // $1 per 1M input
        2  // $2 per 1M output
    );
    assert.equal(cost, 3); // $1 + $2
});

test('BaseProvider.calculateCost handles cached tokens', () => {
    const provider = new TestProvider();
    const cost = provider['calculateCost'](
        {inputTokens: 1_000_000, outputTokens: 1_000_000, cachedTokens: 500_000},
        1,  // $1 per 1M input
        2   // $2 per 1M output
    );

    // Cached tokens cost 90% less: 500k * 0.1 = $0.05
    // Uncached: 500k * 1 = $0.50
    // Output: 1M * 2 = $2.00
    // Total: $0.05 + $0.50 + $2.00 = $2.55
    assert.ok(cost > 2 && cost < 2.6);
});

test('BaseProvider.calculateCost with zero cost tokens', () => {
    const provider = new TestProvider();
    const cost = provider['calculateCost'](
        {inputTokens: 1000, outputTokens: 1000},
        0,
        0
    );
    assert.equal(cost, 0);
});

test('BaseProvider updates stats with rolling average', () => {
    const provider = new TestProvider();

    // First request: 1000ms
    provider['updateStats'](
        {inputTokens: 100, outputTokens: 50, totalTokens: 150},
        1000,
        0.5
    );

    let stats = provider.getUsageStats();
    assert.equal(stats.requestCount, 1);
    assert.equal(stats.averageResponseTimeMs, 1000);
    assert.equal(stats.totalCost, 0.5);

    // Second request: 500ms
    // Average should be (1000 + 500) / 2 = 750ms
    provider['updateStats'](
        {inputTokens: 100, outputTokens: 50, totalTokens: 150},
        500,
        0.5
    );

    stats = provider.getUsageStats();
    assert.equal(stats.requestCount, 2);
    assert.equal(stats.averageResponseTimeMs, 750);
    assert.equal(stats.totalCost, 1.0);
    assert.equal(stats.totalInputTokens, 200);
    assert.equal(stats.totalOutputTokens, 100);
    assert.equal(stats.totalTokens, 300);
});
