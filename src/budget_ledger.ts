// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Shared budget ledger — tracks aggregate cost across all provider instances
 * in a single crew run. Prevents parallel agents from each seeing only 1/N
 * of actual spend and overshooting the budget by N×limit.
 *
 * Usage: create one BudgetLedger per crew run, pass it to getCrewProvider(),
 * which attaches it to each provider via setBudgetLedger().
 */

import {BudgetExceededError} from './base_provider.js';

export class BudgetLedger {
    private _totalCost = 0;
    private _reserved = 0;
    private readonly _limitUSD: number;

    constructor(limitUSD: number) {
        this._limitUSD = limitUSD;
    }

    get totalCost(): number {
        return this._totalCost;
    }

    get limitUSD(): number {
        return this._limitUSD;
    }

    /**
     * Record actual cost from a completed LLM call.
     */
    record(cost: number): void {
        if (!Number.isFinite(cost) || cost < 0) return;
        this._totalCost += cost;
    }

    /**
     * Pre-reserve estimated cost before an LLM call begins.
     * Blocks parallel agents from spending into the same headroom.
     * Like a credit card authorization hold.
     */
    reserve(estimate: number): void {
        if (!Number.isFinite(estimate) || estimate <= 0) return;
        this._reserved += estimate;
    }

    /**
     * Release a prior reservation (after API response or on error).
     */
    release(estimate: number): void {
        this._reserved = Math.max(0, this._reserved - estimate);
    }

    /**
     * Throws BudgetExceededError if committed cost + in-flight reservations
     * have reached the limit.
     */
    check(): void {
        const effective = this._totalCost + this._reserved;
        if (effective >= this._limitUSD) {
            throw new BudgetExceededError(effective, this._limitUSD);
        }
    }
}
