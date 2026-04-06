// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * CLI commands: impact-gate predict / predict-feedback
 *
 * Predict: Run defect prediction on a git diff.
 *   impact-gate predict                          # predict HEAD vs origin/main
 *   impact-gate predict --base main              # predict HEAD vs main
 *   impact-gate predict --deep                   # include LLM semantic analysis (~$0.02)
 *   impact-gate predict --threshold 0.6          # exit 1 if risk > 0.6
 *   impact-gate predict --train                  # retrain weights from feedback data
 *   impact-gate predict --calibration-status     # show calibration state
 *   impact-gate predict --json                   # output as JSON
 *
 * Predict-feedback: Record the actual outcome for a prediction.
 *   impact-gate predict-feedback --outcome defect --ref abc123
 *   impact-gate predict-feedback --outcome clean
 */

import {resolve} from 'path';

import {
    predict, predictSync, formatPrediction,
    formatSemanticAnalysis, trainWeights,
    getCalibrationStatus, formatCalibrationStatus,
    recordOutcome,
} from '../../prediction/index.js';
import type {DefectPrediction} from '../../prediction/types.js';
import type {ParsedArgs} from '../types.js';
import {LLMProviderFactory} from '../../provider_factory.js';

export async function runPredictCommand(args: ParsedArgs): Promise<void> {
    const repoRoot = resolve(args.path || process.cwd());
    const baseRef = args.gitSince || 'origin/main';
    const headRef = 'HEAD';

    // --calibration-status: just show calibration state and exit
    if (args.predictCalibrationStatus) {
        const status = getCalibrationStatus(repoRoot);
        console.log(formatCalibrationStatus(status));
        return;
    }

    // --train: retrain weights from feedback data and exit
    if (args.predictTrain) {
        console.log('Retraining prediction weights from feedback data...');
        const result = trainWeights(repoRoot);
        if (!result) {
            const status = getCalibrationStatus(repoRoot);
            console.log(`Not enough labeled data. Need ${status.samplesNeeded} more labeled samples.`);
            console.log(`Use: impact-gate predict-feedback --outcome defect|clean --ref <commit>`);
            return;
        }
        console.log(`Retrained on ${result.samples} samples:`);
        console.log(`  Accuracy: ${Math.round(result.accuracy * 100)}%`);
        console.log(`  Precision: ${Math.round(result.precision * 100)}%`);
        console.log(`  Recall: ${Math.round(result.recall * 100)}%`);
        console.log('');
        console.log('Updated weights saved. Future predictions will use calibrated weights.');
        return;
    }

    console.log(`Analyzing defect risk: ${baseRef}...${headRef}`);
    console.log(`Repository: ${repoRoot}`);

    // Determine if we need the LLM for --deep
    const useDeep = args.deep === true;
    let prediction: DefectPrediction;

    if (useDeep) {
        console.log('Mode: deep (LLM semantic analysis enabled)');
        console.log('');

        try {
            const provider = args.llmProvider
                ? LLMProviderFactory.createFromString(args.llmProvider)
                : await LLMProviderFactory.createFromEnv();

            prediction = await predict(repoRoot, baseRef, headRef, {
                deep: true,
                provider,
                projectRoot: repoRoot,
                record: true,
                ref: args.predictRef,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.log(`LLM unavailable (${msg}). Falling back to deterministic analysis.`);
            console.log('');
            prediction = predictSync(repoRoot, baseRef, headRef);
        }
    } else {
        console.log('');
        prediction = await predict(repoRoot, baseRef, headRef, {
            projectRoot: repoRoot,
            record: true,
            ref: args.predictRef,
        });
    }

    if (args.jsonOutput) {
        console.log(JSON.stringify(predictionToJSON(prediction), null, 2));
    } else {
        console.log(formatPrediction(prediction));

        // Show calibration status
        if (prediction.calibrated) {
            console.log('');
            console.log('📐 Using calibrated weights (trained on your repo data)');
        }

        // Show semantic analysis results
        if (prediction.semantic) {
            console.log('');
            console.log(formatSemanticAnalysis({
                score: prediction.semantic.score,
                patterns: prediction.semantic.patterns,
                cost: prediction.semantic.cost,
                tokens: prediction.semantic.tokens,
                success: true,
            }));
        }

        // Show metrics detail in verbose mode
        if (args.verbose) {
            console.log('');
            console.log('Change Metrics:');
            const cm = prediction.metrics.change;
            console.log(`  Lines: +${cm.la} -${cm.ld} (${cm.nf} files, ${cm.nd} dirs, ${cm.ns} subsystems)`);
            console.log(`  Entropy: ${cm.entropy.toFixed(2)} | Fix: ${cm.fix ? 'yes' : 'no'}`);
            console.log(`  History: ${cm.ndev} devs, ${cm.age} days avg age, ${cm.nuc} prior changes`);
            console.log(`  Experience: ${cm.exp} total commits, ${cm.rexp} recent, ${cm.sexp} subsystem`);
            console.log('');
            console.log('Complexity Metrics:');
            const cx = prediction.metrics.complexity;
            console.log(`  Cognitive delta: ${cx.cognitive_delta > 0 ? '+' : ''}${cx.cognitive_delta}`);
            console.log(`  Coupling delta: ${cx.coupling_delta > 0 ? '+' : ''}${cx.coupling_delta}`);
            console.log(`  Test ratio: ${Math.round(cx.test_ratio * 100)}%`);

            // Show calibration status in verbose mode
            console.log('');
            const calStatus = getCalibrationStatus(repoRoot);
            console.log(formatCalibrationStatus(calStatus));
        }
    }

    // Gate: exit 1 if score exceeds threshold
    const threshold = args.threshold ?? args.gateThreshold;
    if (typeof threshold === 'number' && prediction.score > threshold) {
        console.log('');
        console.log(`GATE FAILED: defect risk ${prediction.score.toFixed(2)} exceeds threshold ${threshold}`);
        process.exit(1);
    }
}

/** Handle predict-feedback command: record outcomes for calibration */
export function runPredictFeedbackCommand(args: ParsedArgs): void {
    const repoRoot = resolve(args.path || process.cwd());
    const outcome = args.predictOutcome;
    const ref = args.predictRef;

    if (!outcome) {
        console.error('Error: --outcome is required (defect or clean)');
        console.error('Usage: impact-gate predict-feedback --outcome defect --ref <commit-sha>');
        process.exit(1);
    }

    const updated = recordOutcome(repoRoot, ref || '', outcome);

    if (updated) {
        console.log(`Recorded outcome: ${outcome}${ref ? ` for ref ${ref}` : ''}`);

        // Check if we can retrain
        const status = getCalibrationStatus(repoRoot);
        if (status.readyToTrain && !status.isCalibrated) {
            console.log('');
            console.log(`🎯 ${status.labeledEntries} labeled samples — ready to calibrate!`);
            console.log('Run: impact-gate predict --train');
        } else if (!status.readyToTrain) {
            console.log(`Progress: ${status.labeledEntries}/50 labeled samples (need ${status.samplesNeeded} more)`);
        }
    } else {
        console.log('No pending prediction found to record outcome for.');
        if (ref) {
            console.log(`Tip: Make sure you ran 'impact-gate predict --ref ${ref}' first.`);
        }
    }
}

function predictionToJSON(p: DefectPrediction): Record<string, unknown> {
    const result: Record<string, unknown> = {
        score: p.score,
        level: p.level,
        recommendation: p.recommendation,
        calibrated: p.calibrated || false,
        factors: p.factors.map((f) => ({
            name: f.name,
            value: f.value,
            contribution: f.contribution,
            direction: f.direction,
            explanation: f.explanation,
        })),
        metrics: {
            change: p.metrics.change,
            complexity: p.metrics.complexity,
        },
    };

    if (p.semantic) {
        result.semantic = {
            score: p.semantic.score,
            patterns: p.semantic.patterns,
            cost: p.semantic.cost,
        };
    }

    return result;
}
