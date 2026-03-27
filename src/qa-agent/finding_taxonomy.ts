// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {Finding, FindingCategory, FindingType, FindingSeverity, FixTier, HealthScoreCategory} from './types.js';

// ---------------------------------------------------------------------------
// Legacy type → canonical category mapping
// ---------------------------------------------------------------------------

const LEGACY_TO_CATEGORY: Record<string, FindingCategory> = {
    'bug': 'functional',
    'gap': 'functional',
    'visual-regression': 'visual',
    'ux-issue': 'ux',
};

const CANONICAL_CATEGORIES = new Set<string>([
    'visual', 'functional', 'ux', 'content', 'performance', 'console', 'accessibility', 'links',
]);

/**
 * Normalize any FindingType (legacy or canonical) to a canonical FindingCategory.
 * Returns 'functional' for unrecognized types.
 */
export function normalizeFindingType(raw: string): FindingCategory {
    if (CANONICAL_CATEGORIES.has(raw)) {
        return raw as FindingCategory;
    }
    return LEGACY_TO_CATEGORY[raw] ?? 'functional';
}

/**
 * Map a FindingType to its HealthScoreCategory.
 * Same logic as normalizeFindingType — the category names match.
 */
export function normalizeFindingCategory(type: FindingType): HealthScoreCategory {
    if (type === 'verified-ok') {
        return 'functional';
    }
    return normalizeFindingType(type);
}

// ---------------------------------------------------------------------------
// Severity definitions
// ---------------------------------------------------------------------------

export const SEVERITY_DEFINITIONS: Record<FindingSeverity, string> = {
    critical: 'Blocks a core workflow, causes data loss, or crashes the app. Examples: form submit error page, checkout broken, data deleted without confirmation.',
    high: 'Major feature broken or unusable, no workaround. Examples: search returns wrong results, file upload silently fails, auth redirect loop.',
    medium: 'Feature works but with noticeable problems, workaround exists. Examples: slow page load (>5s), missing form validation, layout broken on mobile only.',
    low: 'Minor cosmetic or polish issue. Examples: typo in footer, 1px alignment, hover state inconsistent.',
    info: 'Observation or suggestion, not a defect. Examples: missing alt text noted, potential optimization.',
};

// ---------------------------------------------------------------------------
// Category definitions
// ---------------------------------------------------------------------------

export const CATEGORY_DEFINITIONS: Record<FindingCategory, {label: string; description: string; examples: string[]}> = {
    links: {
        label: 'Links',
        description: 'Broken links (404), wrong destinations, dead anchors, external links that fail.',
        examples: ['404 on nav link', 'Link goes to wrong page', 'Anchor target missing', 'External link returns 500'],
    },
    visual: {
        label: 'Visual/UI',
        description: 'Layout breaks, broken images, z-index issues, font/color inconsistencies, animation glitches, alignment issues, dark mode problems.',
        examples: ['Overlapping elements', 'Clipped text', 'Horizontal scrollbar', 'Incorrect z-index'],
    },
    functional: {
        label: 'Functional',
        description: 'Broken links, dead buttons, form validation failures, incorrect redirects, state not persisting, race conditions.',
        examples: ['404 links', 'Click does nothing', 'Form bypasses validation', 'Data lost on refresh'],
    },
    ux: {
        label: 'UX',
        description: 'Confusing navigation, missing loading indicators, slow interactions, unclear error messages, no destructive-action confirmation.',
        examples: ['No breadcrumbs', 'No loading spinner', '>500ms with no feedback', '"Something went wrong" with no detail'],
    },
    content: {
        label: 'Content',
        description: 'Typos, grammar errors, outdated text, placeholder/lorem ipsum left in, truncated text, wrong labels.',
        examples: ['Typo in heading', 'Lorem ipsum visible', 'Button label says "Submit" instead of "Save"'],
    },
    performance: {
        label: 'Performance',
        description: 'Slow page loads (>3s), janky scrolling, layout shifts, excessive network requests, large unoptimized images.',
        examples: ['Page takes 5s to load', 'Content jumping after load', '>50 network requests'],
    },
    console: {
        label: 'Console/Errors',
        description: 'JavaScript exceptions, failed network requests (4xx/5xx), deprecation warnings, CORS errors, mixed content.',
        examples: ['Uncaught TypeError', '500 on API call', 'CORS blocked', 'Mixed content warning'],
    },
    accessibility: {
        label: 'Accessibility',
        description: 'Missing alt text, unlabeled inputs, broken keyboard navigation, focus traps, missing ARIA attributes, insufficient contrast.',
        examples: ['Image without alt', 'Can\'t tab to button', 'Modal focus trap', 'Low contrast text'],
    },
};

// ---------------------------------------------------------------------------
// Fix eligibility
// ---------------------------------------------------------------------------

const TIER_SEVERITIES: Record<FixTier, Set<FindingSeverity>> = {
    quick: new Set(['critical', 'high']),
    standard: new Set(['critical', 'high', 'medium']),
    exhaustive: new Set(['critical', 'high', 'medium', 'low']),
};

/**
 * Determine whether a finding should be fixed based on the selected tier.
 * 'info' severity and 'verified-ok' type are never fixable.
 */
export function isFixable(finding: Finding, tier: FixTier): boolean {
    if (finding.type === 'verified-ok' || finding.severity === 'info') {
        return false;
    }
    return TIER_SEVERITIES[tier].has(finding.severity);
}
