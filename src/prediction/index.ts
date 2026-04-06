// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Defect Prediction Engine
 *
 * Research-backed defect prediction that works on any repo, out of the box.
 * Three layers: change metrics (Kamei 2013) + complexity (Hassan 2009) + ensemble model.
 * Optional fourth layer: LLM semantic analysis for risky pattern detection.
 * Calibration system improves accuracy over time with feedback data.
 *
 * Usage:
 *   import { predict, predictSync } from './prediction/index.js';
 *   const result = await predict('/path/to/repo', 'main', 'feature-branch');
 *   console.log(result.score); // 0.0 to 1.0
 *
 *   // Synchronous (no LLM, no calibration recording):
 *   const sync = predictSync('/path/to/repo', 'main', 'feature-branch');
 */

export {extractChangeMetrics} from './metrics_extractor.js';
export {extractComplexityMetrics} from './complexity.js';
export {predictDefect, formatPrediction} from './model.js';
export type {PredictOptions} from './model.js';
export {analyzeSemanticRisk, formatSemanticAnalysis} from './semantic.js';
export type {SemanticAnalysis, SemanticRiskPattern} from './semantic.js';
export {
    recordPrediction, recordOutcome, trainWeights,
    getCalibrationStatus, formatCalibrationStatus, getCustomWeights,
} from './calibration.js';
export type {CalibrationEntry, CalibrationStore, CalibrationStatus, TrainingResult} from './calibration.js';
export type {ChangeMetrics, ComplexityMetrics, DefectPrediction, PredictionFeatures, RiskFactor} from './types.js';

import {extractChangeMetrics} from './metrics_extractor.js';
import {extractComplexityMetrics} from './complexity.js';
import {predictDefect, formatPrediction} from './model.js';
import type {PredictOptions} from './model.js';
import {analyzeSemanticRisk, formatSemanticAnalysis} from './semantic.js';
import {getCustomWeights, recordPrediction} from './calibration.js';
import type {DefectPrediction} from './types.js';
import type {LLMProvider} from '../provider_interface.js';

/** Options for the full prediction pipeline */
export interface PredictPipelineOptions {
    /** Enable LLM semantic analysis (--deep flag) */
    deep?: boolean;

    /** LLM provider for semantic analysis (required if deep=true) */
    provider?: LLMProvider;

    /** Project root for calibration data (defaults to repoRoot) */
    projectRoot?: string;

    /** Whether to record this prediction for calibration */
    record?: boolean;

    /** Commit ref for traceability in calibration log */
    ref?: string;
}

/**
 * Run the full defect prediction pipeline on a git diff.
 *
 * @param repoRoot - Path to the git repository root
 * @param baseRef - Base ref (e.g., 'main', 'origin/main', tag name)
 * @param headRef - Head ref (default: 'HEAD')
 * @param options - Optional: deep analysis, calibration, recording
 * @returns DefectPrediction with score, level, risk factors, and recommendation
 */
export async function predict(
    repoRoot: string,
    baseRef: string,
    headRef: string = 'HEAD',
    options?: PredictPipelineOptions,
): Promise<DefectPrediction> {
    const changeMetrics = extractChangeMetrics(repoRoot, baseRef, headRef);
    const complexityMetrics = extractComplexityMetrics(repoRoot, baseRef, headRef);

    const features = {change: changeMetrics, complexity: complexityMetrics};

    // Check for calibrated weights
    const projectRoot = options?.projectRoot || repoRoot;
    const calibrated = getCustomWeights(projectRoot);

    const predictOptions: PredictOptions = {};
    if (calibrated) {
        predictOptions.customWeights = calibrated.weights;
        predictOptions.customBias = calibrated.bias;
    }

    // Run LLM semantic analysis if requested
    let semantic: DefectPrediction['semantic'];
    if (options?.deep && options.provider) {
        const semanticResult = await analyzeSemanticRisk(options.provider, repoRoot, baseRef, headRef);
        if (semanticResult.success) {
            predictOptions.semanticScore = semanticResult.score;
            semantic = {
                score: semanticResult.score,
                patterns: semanticResult.patterns,
                cost: semanticResult.cost,
                tokens: semanticResult.tokens,
            };
        }
    }

    const prediction = predictDefect(features, predictOptions);

    // Attach semantic results
    if (semantic) {
        prediction.semantic = semantic;
    }

    // Record prediction for calibration (only when explicitly opted in)
    if (options?.record === true) {
        try {
            // Build raw feature map explicitly (not Object.entries) for type safety
            const rawFeatures: Record<string, number> = {
                la: changeMetrics.la,
                ld: changeMetrics.ld,
                lt: changeMetrics.lt,
                nf: changeMetrics.nf,
                nd: changeMetrics.nd,
                ns: changeMetrics.ns,
                entropy: changeMetrics.entropy,
                fix: changeMetrics.fix,
                ndev: changeMetrics.ndev,
                age: changeMetrics.age,
                nuc: changeMetrics.nuc,
                exp: changeMetrics.exp,
                rexp: changeMetrics.rexp,
                sexp: changeMetrics.sexp,
                cognitive_delta: complexityMetrics.cognitive_delta,
                coupling_delta: complexityMetrics.coupling_delta,
                test_ratio: complexityMetrics.test_ratio,
            };

            recordPrediction(projectRoot, prediction, rawFeatures, options?.ref);
        } catch (err) {
            // Non-fatal: don't break prediction if recording fails
            if (process.env.DEBUG) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn(`[predict] Failed to record prediction: ${msg}`);
            }
        }
    }

    return prediction;
}

/**
 * Synchronous predict (no LLM, no calibration recording).
 * Backward-compatible API for simple usage.
 */
export function predictSync(repoRoot: string, baseRef: string, headRef: string = 'HEAD'): DefectPrediction {
    const changeMetrics = extractChangeMetrics(repoRoot, baseRef, headRef);
    const complexityMetrics = extractComplexityMetrics(repoRoot, baseRef, headRef);

    const projectRoot = repoRoot;
    const calibrated = getCustomWeights(projectRoot);

    const predictOptions: PredictOptions = {};
    if (calibrated) {
        predictOptions.customWeights = calibrated.weights;
        predictOptions.customBias = calibrated.bias;
    }

    return predictDefect({change: changeMetrics, complexity: complexityMetrics}, predictOptions);
}

/** Convenience: predict and return formatted string */
export function predictFormatted(repoRoot: string, baseRef: string, headRef: string = 'HEAD'): string {
    const prediction = predictSync(repoRoot, baseRef, headRef);
    return formatPrediction(prediction);
}

export {formatSemanticAnalysis as formatSemantic};
