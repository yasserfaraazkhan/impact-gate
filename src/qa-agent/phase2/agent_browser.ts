// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {execFileSync} from 'child_process';

const COMMAND = 'agent-browser';
const TIMEOUT_MS = 30_000;
const MAX_OUTPUT = 512 * 1024; // 512 KB

function run(args: string[], timeoutMs = TIMEOUT_MS): string {
    const result = execFileSync(COMMAND, args, {
        encoding: 'utf-8',
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT,
    });
    return result.trim();
}

/**
 * Thin wrapper around the `agent-browser` CLI.
 *
 * Every method calls execFileSync (array form — no shell injection) and
 * returns the stdout string.  Session persistence is handled by
 * agent-browser's daemon; the browser stays open between calls.
 */
export class AgentBrowser {
    private session?: string;

    constructor(options?: {session?: string}) {
        this.session = options?.session;
    }

    private args(base: string[]): string[] {
        if (this.session) {
            return [...base, '--session', this.session];
        }
        return base;
    }

    open(url: string): string {
        return run(this.args(['open', url]));
    }

    click(ref: string): string {
        return run(this.args(['click', ref]));
    }

    fill(ref: string, value: string): string {
        return run(this.args(['fill', ref, value]));
    }

    type(ref: string, value: string): string {
        return run(this.args(['type', ref, value]));
    }

    press(key: string): string {
        return run(this.args(['press', key]));
    }

    scroll(direction: 'up' | 'down', ref?: string): string {
        const scrollArgs = ['scroll', direction];
        if (ref) scrollArgs.push(ref);
        return run(this.args(scrollArgs));
    }

    snapshot(): string {
        return run(this.args(['snapshot', '-i']));
    }

    screenshot(path?: string): string {
        const screenshotArgs = ['screenshot'];
        if (path) {
            screenshotArgs.push(path);
        }
        screenshotArgs.push('--annotate');
        return run(this.args(screenshotArgs));
    }

    getUrl(): string {
        return run(this.args(['get', 'url']));
    }

    getTitle(): string {
        return run(this.args(['get', 'title']));
    }

    getText(ref: string): string {
        return run(this.args(['get', 'text', ref]));
    }

    /**
     * Run a JS expression in the browser via agent-browser's evaluate command.
     * SECURITY: Only used internally for console error capture. Do NOT expose to LLM tools.
     * Uses execFileSync array form — expression is a CLI arg, NOT JS eval().
     */
    evaluateInternal(expression: string): string {
        return run(this.args(['evaluate', expression]));
    }

    back(): string {
        return run(this.args(['back']));
    }

    forward(): string {
        return run(this.args(['forward']));
    }

    close(): void {
        try {
            run(this.args(['close']), 5_000);
        } catch {
            // Ignore close errors — daemon may already be gone
        }
    }
}
