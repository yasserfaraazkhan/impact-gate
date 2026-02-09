// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Simple structured logging system
 * Replaces 18 console.log statements with configurable logging
 * Environment variable: LOG_LEVEL (ERROR, WARN, INFO, DEBUG)
 */

export enum LogLevel {
    ERROR = 0,
    WARN = 1,
    INFO = 2,
    DEBUG = 3,
}

/**
 * Get log level from environment variable
 */
function getLogLevelFromEnv(): LogLevel {
    const level = process.env.LOG_LEVEL?.toUpperCase() || 'INFO';
    switch (level) {
        case 'ERROR':
            return LogLevel.ERROR;
        case 'WARN':
            return LogLevel.WARN;
        case 'INFO':
            return LogLevel.INFO;
        case 'DEBUG':
            return LogLevel.DEBUG;
        default:
            return LogLevel.INFO;
    }
}

/**
 * Convert log level to string
 */
function logLevelToString(level: LogLevel): string {
    switch (level) {
        case LogLevel.ERROR:
            return 'ERROR';
        case LogLevel.WARN:
            return 'WARN';
        case LogLevel.INFO:
            return 'INFO';
        case LogLevel.DEBUG:
            return 'DEBUG';
    }
}

export class Logger {
    private level: LogLevel;

    constructor(minLevel?: LogLevel) {
        this.level = minLevel ?? getLogLevelFromEnv();
    }

    error(message: string, context?: Record<string, unknown>): void {
        if (this.level >= LogLevel.ERROR) {
            this.log(LogLevel.ERROR, message, context);
        }
    }

    warn(message: string, context?: Record<string, unknown>): void {
        if (this.level >= LogLevel.WARN) {
            this.log(LogLevel.WARN, message, context);
        }
    }

    info(message: string, context?: Record<string, unknown>): void {
        if (this.level >= LogLevel.INFO) {
            this.log(LogLevel.INFO, message, context);
        }
    }

    debug(message: string, context?: Record<string, unknown>): void {
        if (this.level >= LogLevel.DEBUG) {
            this.log(LogLevel.DEBUG, message, context);
        }
    }

    setLevel(level: LogLevel): void {
        this.level = level;
    }

    private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
        const timestamp = new Date().toISOString();
        const levelStr = logLevelToString(level);
        const contextStr = context ? ` ${JSON.stringify(context)}` : '';
        const output = `[${timestamp}] [${levelStr}] ${message}${contextStr}`;

        if (level <= LogLevel.WARN) {
            console.error(output);
        } else {
            console.log(output);
        }
    }
}

// Global logger instance
export const logger = new Logger();
