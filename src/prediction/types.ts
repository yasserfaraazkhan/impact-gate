// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Types for the defect prediction engine.
 *
 * Based on Kamei et al. 2013 "A Large-Scale Empirical Study of Just-in-Time Quality Assurance"
 * and Hassan 2009 "Predicting Faults Using the Complexity of Code Changes"
 */

/** The 14 Kamei change-level metrics + complexity extensions */
export interface ChangeMetrics {
    // Size metrics
    la: number;          // lines added
    ld: number;          // lines deleted
    lt: number;          // total lines in changed files (before change)
    nf: number;          // number of files changed

    // Diffusion metrics
    nd: number;          // number of directories modified
    ns: number;          // number of subsystems modified (top-level dirs)
    entropy: number;     // distribution of changes across files (0 = focused, 1 = spread)

    // Purpose metrics
    fix: number;         // 1 if this is a bug fix commit, 0 otherwise

    // History metrics (require git log)
    ndev: number;        // number of developers who previously changed these files
    age: number;         // average age of changed files (days since last modification)
    nuc: number;         // number of unique prior changes to the files

    // Experience metrics
    exp: number;         // developer's total commits to this repo
    rexp: number;        // developer's recent commits (last 30 days)
    sexp: number;        // developer's commits to these specific subsystems
}

/** Code complexity metrics extracted from the diff */
export interface ComplexityMetrics {
    cognitive_delta: number;   // change in nesting depth / branching
    coupling_delta: number;    // new imports/dependencies added
    test_ratio: number;        // ratio of test lines changed vs source lines changed
    lines_changed: number;     // total lines added + deleted
}

/** Combined feature vector for the model */
export interface PredictionFeatures {
    change: ChangeMetrics;
    complexity: ComplexityMetrics;
}

/** Risk factor explaining why the score is high/low */
export interface RiskFactor {
    name: string;
    value: number;
    contribution: number;   // how much this feature contributed to the score
    direction: 'risk' | 'safe';
    explanation: string;
}

/** The prediction output */
export interface DefectPrediction {
    score: number;          // 0.0 to 1.0 probability
    level: 'low' | 'medium' | 'high' | 'critical';
    factors: RiskFactor[];  // top risk factors, sorted by |contribution|
    metrics: PredictionFeatures;
    recommendation: string;
}
