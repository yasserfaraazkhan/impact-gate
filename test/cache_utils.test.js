// Test for cache_utils.ts
import assert from 'assert';
import test from 'node:test';
import {SimpleCache} from '../dist/agent/cache_utils.js';

test('SimpleCache stores and retrieves values', () => {
    const cache = new SimpleCache();
    cache.set('key1', 'value1');
    assert.equal(cache.get('key1'), 'value1');
});

test('SimpleCache returns undefined for missing keys', () => {
    const cache = new SimpleCache();
    assert.equal(cache.get('nonexistent'), undefined);
});

test('SimpleCache clears all entries', () => {
    const cache = new SimpleCache();
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    assert.equal(cache.size(), 2);
    cache.clear();
    assert.equal(cache.size(), 0);
});

test('SimpleCache enforces TTL expiration', async () => {
    const cache = new SimpleCache(100); // 100ms TTL
    cache.set('key1', 'value1');
    assert.equal(cache.get('key1'), 'value1');

    // Wait for expiration
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(cache.get('key1'), undefined);
});

test('SimpleCache size() returns entry count', () => {
    const cache = new SimpleCache();
    assert.equal(cache.size(), 0);
    cache.set('key1', 'value1');
    assert.equal(cache.size(), 1);
    cache.set('key2', 'value2');
    assert.equal(cache.size(), 2);
});

test('SimpleCache stats() returns correct data', () => {
    const cache = new SimpleCache();
    cache.set('key1', 'value1');
    const stats = cache.stats();
    assert(stats.size >= 1);
    assert(stats.entries >= 1);
});

test('SimpleCache overwrites existing keys', () => {
    const cache = new SimpleCache();
    cache.set('key', 'value1');
    assert.equal(cache.get('key'), 'value1');
    cache.set('key', 'value2');
    assert.equal(cache.get('key'), 'value2');
});

test('SimpleCache stores different value types', () => {
    const cache = new SimpleCache();
    const obj = {nested: {data: true}};
    cache.set('object', obj);
    assert.deepEqual(cache.get('object'), obj);

    const arr = [1, 2, 3];
    cache.set('array', arr);
    assert.deepEqual(cache.get('array'), arr);

    cache.set('number', 42);
    assert.equal(cache.get('number'), 42);
});
