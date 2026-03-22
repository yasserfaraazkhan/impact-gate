// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {readFileSync} from 'fs';
import {join, dirname} from 'path';

let _version: string | undefined;

/**
 * Returns the package version by reading the nearest package.json.
 * Cached after first call.
 */
export function getVersion(): string {
    if (_version) return _version;
    try {
        // Walk up from this file's compiled location to find package.json
        for (let d = __dirname, prev = ''; d !== prev; prev = d, d = dirname(d)) {
            try {
                const pkg = JSON.parse(readFileSync(join(d, 'package.json'), 'utf-8')) as {name?: string; version?: string};
                if (pkg.name === '@yasserkhanorg/e2e-agents' && pkg.version) {
                    _version = pkg.version;
                    return _version;
                }
            } catch {
                // keep walking up
            }
        }
    } catch {
        // fallback
    }
    _version = 'unknown';
    return _version;
}
