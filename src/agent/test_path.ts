// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

function normalizeTestName(test: string): string {
    return test.replace(/ \(flags:.*\)$/, '').trim();
}

export function inferSubsystemFromTestPath(test: string): string {
    const normalized = normalizeTestName(test).replace(/^\/+/, '');
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length === 0) {
        return 'unknown';
    }

    const specsIdx = parts.findIndex((part) => part === 'specs' || part === 'tests');
    if (specsIdx >= 0 && specsIdx + 1 < parts.length) {
        return parts[specsIdx + 1] || 'unknown';
    }

    if (parts.length >= 2 && (parts[0] === 'e2e-tests' || parts[0] === 'playwright')) {
        return parts[1] || 'unknown';
    }

    return parts[0] || 'unknown';
}
