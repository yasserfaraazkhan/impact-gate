// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Structured logging system.
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
    private jsonMode: boolean;
    private stderrOnly = false;

    constructor(minLevel?: LogLevel) {
        this.level = minLevel ?? getLogLevelFromEnv();
        this.jsonMode = process.env.LOG_FORMAT?.toLowerCase() === 'json';
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

    setOutputToStderr(enabled: boolean): void {
        this.stderrOnly = enabled;
    }

    setJsonMode(enabled: boolean): void {
        this.jsonMode = enabled;
    }

    /**
     * Start a timer for measuring duration of an operation.
     * Returns an object with `end()` that logs at DEBUG level and returns elapsed ms.
     */
    timer(label: string): {end: () => number} {
        const start = performance.now();
        return {
            end: (): number => {
                const elapsed = Math.round(performance.now() - start);
                this.debug(`${label} completed`, {durationMs: elapsed});
                return elapsed;
            },
        };
    }

    private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
        const timestamp = new Date().toISOString();
        const levelStr = logLevelToString(level);

        let output: string;
        if (this.jsonMode) {
            const entry: Record<string, unknown> = {ts: timestamp, level: levelStr, msg: message};
            if (context) entry.ctx = context;
            output = JSON.stringify(entry);
        } else {
            const contextStr = context ? ` ${JSON.stringify(context)}` : '';
            output = `[${timestamp}] [${levelStr}] ${message}${contextStr}`;
        }

        if (this.stderrOnly || level <= LogLevel.WARN) {
            console.error(output);
        } else {
            console.log(output);
        }
    }
}

// Global logger instance
export const logger = new Logger();
