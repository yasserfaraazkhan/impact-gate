// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {FixStatus} from '../types.js';

/**
 * Tracks fix-loop health using a WTF-likelihood heuristic.
 *
 * Accumulates risk based on:
 *  - Each revert: +15%
 *  - Each fix touching >3 files: +5%
 *  - After fix #15: +1% per additional fix
 *  - All-low-severity batch: +10%
 *  - Touching files outside the affected area: +20%
 *
 * When WTF > 20%, the fix loop should stop.
 */
export class WTFTracker {
    private wtf = 0;
    private totalFixes = 0;
    private consecutiveReverts = 0;

    /** Hard cap — stop regardless after this many fixes. */
    static readonly MAX_FIXES = 50;

    recordAttempt(status: FixStatus, filesChanged: number): void {
        this.totalFixes++;

        if (status === 'reverted') {
            this.wtf += 15;
            this.consecutiveReverts++;
        } else {
            this.consecutiveReverts = 0;
        }

        if (filesChanged > 3) {
            this.wtf += 5;
        }

        if (this.totalFixes > 15) {
            this.wtf += 1;
        }
    }

    recordUnrelatedFileTouch(): void {
        this.wtf += 20;
    }

    recordAllLowSeverityBatch(): void {
        this.wtf += 10;
    }

    shouldStop(): boolean {
        if (this.totalFixes >= WTFTracker.MAX_FIXES) {
            return true;
        }
        if (this.consecutiveReverts >= 3) {
            return true;
        }
        return this.wtf > 20;
    }

    get score(): number {
        return this.wtf;
    }

    get fixes(): number {
        return this.totalFixes;
    }
}
