// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Defect Prediction Engine
 *
 * Research-backed defect prediction that works on any repo, out of the box.
 * Three layers: change metrics (Kamei 2013) + complexity (Hassan 2009) + ensemble model.
 *
 * Usage:
 *   import { predict } from './prediction/index.js';
 *   const result = predict('/path/to/repo', 'main', 'feature-branch');
 *   console.log(result.score); // 0.0 to 1.0
 */

export {extractChangeMetrics} from './metrics_extractor.js';
export {extractComplexityMetrics} from './complexity.js';
export {predictDefect, formatPrediction} from './model.js';
export type {ChangeMetrics, ComplexityMetrics, DefectPrediction, PredictionFeatures, RiskFactor} from './types.js';

import {extractChangeMetrics} from './metrics_extractor.js';
import {extractComplexityMetrics} from './complexity.js';
import {predictDefect, formatPrediction} from './model.js';
import type {DefectPrediction} from './types.js';

/**
 * Run the full defect prediction pipeline on a git diff.
 *
 * @param repoRoot - Path to the git repository root
 * @param baseRef - Base ref (e.g., 'main', 'origin/main', tag name)
 * @param headRef - Head ref (default: 'HEAD')
 * @returns DefectPrediction with score, level, risk factors, and recommendation
 */
export function predict(repoRoot: string, baseRef: string, headRef: string = 'HEAD'): DefectPrediction {
    const changeMetrics = extractChangeMetrics(repoRoot, baseRef, headRef);
    const complexityMetrics = extractComplexityMetrics(repoRoot, baseRef, headRef);

    return predictDefect({
        change: changeMetrics,
        complexity: complexityMetrics,
    });
}

/** Convenience: predict and return formatted string */
export function predictFormatted(repoRoot: string, baseRef: string, headRef: string = 'HEAD'): string {
    const prediction = predict(repoRoot, baseRef, headRef);
    return formatPrediction(prediction);
}
