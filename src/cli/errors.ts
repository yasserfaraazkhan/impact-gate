// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * CLI Error types with structured exit codes.
 *
 * Exit codes:
 *   0 = success
 *   1 = general/user error (bad args, missing config, invalid input)
 *   2 = budget exceeded
 *   3 = LLM provider unavailable (API down, auth failure)
 *   4 = invalid manifest or config file
 */

export const EXIT_CODES = {
    SUCCESS: 0,
    GENERAL_ERROR: 1,
    BUDGET_EXCEEDED: 2,
    PROVIDER_UNAVAILABLE: 3,
    INVALID_CONFIG: 4,
} as const;

export type ExitCode = typeof EXIT_CODES[keyof typeof EXIT_CODES];

export class CliError extends Error {
    constructor(
        message: string,
        public readonly exitCode: ExitCode = EXIT_CODES.GENERAL_ERROR,
    ) {
        super(message);
        this.name = 'CliError';
    }
}

/**
 * Classify an unknown error into the appropriate exit code.
 */
export function classifyError(error: unknown): ExitCode {
    if (error instanceof CliError) return error.exitCode;

    const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

    // Budget errors
    if (msg.includes('budget exceeded') || msg.includes('budget limit')) {
        return EXIT_CODES.BUDGET_EXCEEDED;
    }

    // Provider/auth errors
    if (msg.includes('api key') || msg.includes('authentication') ||
        msg.includes('unauthorized') || msg.includes('403') ||
        msg.includes('provider') && msg.includes('unavailable') ||
        msg.includes('econnrefused') || msg.includes('econnreset')) {
        return EXIT_CODES.PROVIDER_UNAVAILABLE;
    }

    // Config/manifest errors
    if (msg.includes('manifest') || msg.includes('config') && msg.includes('invalid') ||
        msg.includes('route-families') && msg.includes('invalid')) {
        return EXIT_CODES.INVALID_CONFIG;
    }

    return EXIT_CODES.GENERAL_ERROR;
}
