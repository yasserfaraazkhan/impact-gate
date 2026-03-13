// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {resolve} from 'path';
import {runCommand} from '../agent/process_runner.js';

/** Env var prefixes/names stripped when running LLM-generated specs */
const SENSITIVE_ENV_PREFIXES = [
    'AWS_', 'AZURE_', 'GCP_', 'GOOGLE_', 'ANTHROPIC_', 'OPENAI_',
    'GITHUB_TOKEN', 'NPM_TOKEN', 'SSH_', 'SECRET_', 'PRIVATE_',
    'DATABASE_URL', 'DB_', 'REDIS_', 'POSTGRES_', 'MYSQL_', 'MONGO_',
    'API_KEY', 'API_SECRET', 'AUTH_', 'JWT_', 'STRIPE_', 'TWILIO_',
    'SENDGRID_', 'SLACK_TOKEN', 'SLACK_BOT', 'MATTERMOST_',
];

/**
 * Build a restricted environment for running LLM-generated spec files.
 * Strips credentials and secrets to limit damage from malicious generated code.
 */
function buildRestrictedEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
        const isSensitive = SENSITIVE_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
        if (!isSensitive) {
            env[key] = value;
        }
    }
    return env;
}

/**
 * Validate and normalize a spec path to prevent argument injection.
 * Rejects raw input that starts with '-' (could be interpreted as flags by tsc/playwright).
 */
function sanitizeSpecPath(specPath: string): string {
    if (specPath.startsWith('-')) {
        throw new Error(`Invalid spec path: "${specPath}" — path must not start with a dash`);
    }
    return resolve(specPath);
}

export interface CompileCheckResult {
    success: boolean;
    errors: string[];
}

/**
 * Compile-check a generated spec file using tsc --noEmit.
 * Returns success: true if compilation succeeds, or errors array on failure.
 */
export function compileCheckSpec(specPath: string, testsRoot: string): CompileCheckResult {
    const safeSpecPath = sanitizeSpecPath(specPath);
    const result = runCommand(
        'npx',
        ['tsc', '--noEmit', '--esModuleInterop', '--resolveJsonModule', '--moduleResolution', 'node', '--target', 'ES2020', safeSpecPath],
        testsRoot,
        30_000,
        buildRestrictedEnv(),
    );

    if (result.status === 0) {
        return {success: true, errors: []};
    }

    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    const errorLines = output.split('\n')
        .filter((l) => l.includes('error TS') || l.includes('Error:'))
        .slice(0, 10);

    return {
        success: false,
        errors: errorLines.length > 0 ? errorLines : [output.slice(0, 500) || 'Compilation failed'],
    };
}

export interface SmokeRunResult {
    success: boolean;
    error?: string;
}

/**
 * Smoke-run a generated spec against a running app.
 * Runs in a restricted environment with sensitive env vars stripped.
 * Returns success: true if the test passes with retries.
 */
export function smokeRunSpec(
    specPath: string,
    testsRoot: string,
    playwrightBinary: string,
): SmokeRunResult {
    const safeSpecPath = sanitizeSpecPath(specPath);
    const result = runCommand(
        playwrightBinary,
        ['test', safeSpecPath, '--retries', '2', '--reporter', 'list'],
        testsRoot,
        120_000,
        buildRestrictedEnv(),
    );

    if (result.status === 0) {
        return {success: true};
    }

    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    const errorLines = output.split('\n')
        .filter((l) => l.includes('Error') || l.includes('FAILED') || l.includes('Timeout'))
        .slice(0, 5);

    return {
        success: false,
        error: errorLines.join('\n') || result.error || 'Smoke run failed',
    };
}
