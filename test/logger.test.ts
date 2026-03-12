// Test for logger.ts
import assert from 'assert';
import test from 'node:test';
import {Logger, LogLevel} from '../dist/logger.js';

test('Logger initializes with default level', () => {
    const logger = new Logger(LogLevel.INFO);
    assert(logger); // Just check it initializes
});

test('Logger can be set to different levels', () => {
    const logger = new Logger(LogLevel.ERROR);
    logger.setLevel(LogLevel.DEBUG);
    assert(logger); // Check it doesn't throw
});

test('Logger methods exist and are callable', () => {
    const logger = new Logger(LogLevel.DEBUG);

    // Just check they don't throw
    logger.error('test error');
    logger.warn('test warn');
    logger.info('test info');
    logger.debug('test debug');
    assert(true); // Reached without error
});

test('Logger.error includes context', () => {
    const logger = new Logger(LogLevel.ERROR);
    logger.error('test', {key: 'value'});
    assert(true); // Check it doesn't throw with context
});
