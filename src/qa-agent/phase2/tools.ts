// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type Anthropic from '@anthropic-ai/sdk';

import type {AgentBrowser} from './agent_browser.js';
import type {Finding, FindingSeverity, FindingType} from '../types.js';

// ---------------------------------------------------------------------------
// Tool definitions (Anthropic tool_use schema)
// ---------------------------------------------------------------------------

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
    {
        name: 'navigate',
        description: 'Navigate to a URL. Use absolute paths starting with / or full URLs.',
        input_schema: {
            type: 'object' as const,
            properties: {
                url: {type: 'string', description: 'URL or path to navigate to'},
            },
            required: ['url'],
        },
    },
    {
        name: 'click',
        description: 'Click an element by its accessibility ref (e.g. @e4).',
        input_schema: {
            type: 'object' as const,
            properties: {
                ref: {type: 'string', description: 'Accessibility ref like @e4'},
            },
            required: ['ref'],
        },
    },
    {
        name: 'fill',
        description: 'Clear a field and type new text into it.',
        input_schema: {
            type: 'object' as const,
            properties: {
                ref: {type: 'string', description: 'Accessibility ref of the input field'},
                value: {type: 'string', description: 'Text to type'},
            },
            required: ['ref', 'value'],
        },
    },
    {
        name: 'press_key',
        description: 'Press a keyboard key (e.g. Enter, Escape, Tab).',
        input_schema: {
            type: 'object' as const,
            properties: {
                key: {type: 'string', description: 'Key name (Enter, Escape, Tab, etc.)'},
            },
            required: ['key'],
        },
    },
    {
        name: 'scroll',
        description: 'Scroll the page or a specific element up or down.',
        input_schema: {
            type: 'object' as const,
            properties: {
                direction: {type: 'string', enum: ['up', 'down']},
                ref: {type: 'string', description: 'Optional element ref to scroll within'},
            },
            required: ['direction'],
        },
    },
    {
        name: 'go_back',
        description: 'Go back to the previous page.',
        input_schema: {
            type: 'object' as const,
            properties: {},
            required: [],
        },
    },
    {
        name: 'take_screenshot',
        description: 'Take an annotated screenshot for evidence or vision analysis. Use sparingly (costs tokens).',
        input_schema: {
            type: 'object' as const,
            properties: {
                label: {type: 'string', description: 'Short label for the screenshot (used in filename)'},
            },
            required: ['label'],
        },
    },
    {
        name: 'get_text',
        description: 'Read the text content of a specific element.',
        input_schema: {
            type: 'object' as const,
            properties: {
                ref: {type: 'string', description: 'Accessibility ref'},
            },
            required: ['ref'],
        },
    },
    {
        name: 'report_finding',
        description: 'Report a bug, visual issue, UX problem, or gap you discovered. Always include current URL and repro steps.',
        input_schema: {
            type: 'object' as const,
            properties: {
                type: {type: 'string', enum: ['bug', 'visual-regression', 'ux-issue', 'gap']},
                severity: {type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info']},
                summary: {type: 'string', description: 'What you found'},
                repro_steps: {
                    type: 'array',
                    items: {type: 'string'},
                    description: 'Steps to reproduce',
                },
            },
            required: ['type', 'severity', 'summary', 'repro_steps'],
        },
    },
    {
        name: 'mark_flow_done',
        description: 'Mark the current flow as verified/explored. Call when you are done testing a flow.',
        input_schema: {
            type: 'object' as const,
            properties: {
                flow_id: {type: 'string', description: 'ID of the flow being marked done'},
                status: {type: 'string', enum: ['verified-ok', 'has-issues']},
            },
            required: ['flow_id', 'status'],
        },
    },
    {
        name: 'switch_user',
        description: 'Log out and log in as a different user role.',
        input_schema: {
            type: 'object' as const,
            properties: {
                role: {type: 'string', description: 'Role of the user to switch to (e.g. admin, regular, guest)'},
            },
            required: ['role'],
        },
    },
];

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

export interface ToolContext {
    browser: AgentBrowser;
    baseUrl: string;
    screenshotDir: string;
    screenshotCounter: number;
    currentUrl: string;
    currentFlow: string;
    users?: Array<{role: string; username: string; password: string}>;
}

export interface ToolResult {
    output: string;
    finding?: Finding;
    flowDone?: {flowId: string; status: 'verified-ok' | 'has-issues'};
    navigated?: boolean;
}

export function executeTool(
    ctx: ToolContext,
    name: string,
    input: Record<string, unknown>,
): ToolResult {
    switch (name) {
    case 'navigate': {
        const url = String(input.url || '');
        const fullUrl = url.startsWith('http') ? url : `${ctx.baseUrl}${url}`;
        // Security: restrict navigation to the configured baseUrl domain
        if (!isAllowedUrl(fullUrl, ctx.baseUrl)) {
            return {output: `Blocked: navigation to "${fullUrl}" is outside the allowed domain (${ctx.baseUrl}).`};
        }
        const output = ctx.browser.open(fullUrl);
        ctx.currentUrl = ctx.browser.getUrl();
        return {output: output || `Navigated to ${ctx.currentUrl}`, navigated: true};
    }

    case 'click': {
        const output = ctx.browser.click(String(input.ref));
        return {output: output || `Clicked ${input.ref}`};
    }

    case 'fill': {
        const ref = String(input.ref);
        const value = String(input.value);
        const output = ctx.browser.fill(ref, value);
        // Redact value for password-like fields to avoid leaking credentials to LLM
        const isSensitive = /password|passwd|pwd|secret|token/i.test(ref);
        const displayValue = isSensitive ? '[REDACTED]' : `"${value}"`;
        return {output: output || `Filled ${ref} with ${displayValue}`};
    }

    case 'press_key': {
        const output = ctx.browser.press(String(input.key));
        return {output: output || `Pressed ${input.key}`};
    }

    case 'scroll': {
        const rawDir = String(input.direction);
        if (rawDir !== 'up' && rawDir !== 'down') {
            return {output: `Invalid scroll direction "${rawDir}". Must be "up" or "down".`};
        }
        const ref = input.ref ? String(input.ref) : undefined;
        const output = ctx.browser.scroll(rawDir, ref);
        return {output: output || `Scrolled ${rawDir}`};
    }

    case 'go_back': {
        const output = ctx.browser.back();
        ctx.currentUrl = ctx.browser.getUrl();
        return {output: output || `Went back to ${ctx.currentUrl}`};
    }

    case 'take_screenshot': {
        ctx.screenshotCounter++;
        const label = String(input.label || 'evidence').replace(/[^a-zA-Z0-9_-]/g, '_');
        const filename = `${String(ctx.screenshotCounter).padStart(3, '0')}-${label}.png`;
        const path = `${ctx.screenshotDir}/${filename}`;
        ctx.browser.screenshot(path);
        return {output: `Screenshot saved: ${path}`};
    }

    case 'get_text': {
        const text = ctx.browser.getText(String(input.ref));
        return {output: text || '(empty)'};
    }

    case 'report_finding': {
        const VALID_TYPES = new Set<FindingType>(['bug', 'visual-regression', 'ux-issue', 'gap']);
        const VALID_SEVERITIES = new Set<FindingSeverity>(['critical', 'high', 'medium', 'low', 'info']);
        const rawType = String(input.type);
        const rawSeverity = String(input.severity);
        if (!VALID_TYPES.has(rawType as FindingType)) {
            return {output: `Invalid finding type "${rawType}". Must be one of: ${[...VALID_TYPES].join(', ')}.`};
        }
        if (!VALID_SEVERITIES.has(rawSeverity as FindingSeverity)) {
            return {output: `Invalid severity "${rawSeverity}". Must be one of: ${[...VALID_SEVERITIES].join(', ')}.`};
        }
        if (!Array.isArray(input.repro_steps)) {
            return {output: `Invalid repro_steps: expected an array of strings.`};
        }
        const finding: Finding = {
            id: `f-${crypto.randomUUID()}`,
            type: rawType as FindingType,
            severity: rawSeverity as FindingSeverity,
            summary: String(input.summary),
            flow: ctx.currentFlow,
            evidence: {
                url: ctx.currentUrl,
                reproSteps: (input.repro_steps as unknown[]).map(String),
            },
            timestamp: Date.now(),
        };
        return {output: `Finding recorded: [${finding.severity}] ${finding.summary}`, finding};
    }

    case 'mark_flow_done': {
        const flowId = String(input.flow_id);
        const rawStatus = String(input.status);
        if (rawStatus !== 'verified-ok' && rawStatus !== 'has-issues') {
            return {output: `Invalid status "${rawStatus}". Must be "verified-ok" or "has-issues".`};
        }
        return {
            output: `Flow "${flowId}" marked as ${rawStatus}`,
            flowDone: {flowId, status: rawStatus},
        };
    }

    case 'switch_user': {
        const role = String(input.role);
        const user = ctx.users?.find((u) => u.role === role);
        if (!user) {
            return {output: `No user configured for role "${role}". Available: ${(ctx.users || []).map((u) => u.role).join(', ')}`};
        }
        // Log out first, then log in as new user
        try {
            ctx.browser.open(`${ctx.baseUrl}/logout`);
        } catch {
            // May not be logged in
        }
        ctx.browser.open(`${ctx.baseUrl}/login`);
        // Use snapshot to find login fields, then fill
        const snap = ctx.browser.snapshot();
        const emailRef = extractRef(snap, 'email') || extractRef(snap, 'username') || '@e1';
        const passRef = extractRef(snap, 'password') || '@e2';
        ctx.browser.fill(emailRef, user.username);
        ctx.browser.fill(passRef, user.password);
        ctx.browser.press('Enter');
        ctx.currentUrl = ctx.browser.getUrl();
        // Redact credentials from LLM context — only expose role
        return {output: `Switched to user role: ${user.role}`};
    }

    default:
        return {output: `Unknown tool: ${name}`};
    }
}

function isAllowedUrl(url: string, baseUrl: string): boolean {
    // Block dangerous schemes
    const scheme = url.split(':')[0]?.toLowerCase();
    if (scheme && !['http', 'https'].includes(scheme)) return false;

    // Parse both URLs and compare origins (hostname + port)
    try {
        const target = new URL(url);
        const base = new URL(baseUrl);
        return target.origin === base.origin;
    } catch {
        // If URL parsing fails, only allow relative paths (already prefixed with baseUrl)
        return url.startsWith(baseUrl);
    }
}

function extractRef(snapshot: string, fieldHint: string): string | undefined {
    // Look for lines containing the hint and extract the @eN ref
    const lines = snapshot.split('\n');
    for (const line of lines) {
        if (line.toLowerCase().includes(fieldHint)) {
            const match = line.match(/@e\d+/);
            if (match) return match[0];
        }
    }
    return undefined;
}
