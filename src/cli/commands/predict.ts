// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * CLI command: impact-gate predict
 *
 * Predicts defect probability for a git diff using research-backed metrics.
 * Works on any repo with zero config. Free. No LLM needed.
 *
 * Usage:
 *   impact-gate predict                          # predict HEAD vs origin/main
 *   impact-gate predict --base main              # predict HEAD vs main
 *   impact-gate predict --base v2.0 --head v2.1  # predict between tags
 *   impact-gate predict --threshold 0.6          # exit 1 if risk > 0.6
 *   impact-gate predict --json                   # output as JSON
 */

import {resolve} from 'path';

import {predict, formatPrediction} from '../../prediction/index.js';
import type {DefectPrediction} from '../../prediction/types.js';
import type {ParsedArgs} from '../types.js';

export function runPredictCommand(args: ParsedArgs): void {
    const repoRoot = resolve(args.path || process.cwd());
    const baseRef = args.gitSince || 'origin/main';
    const headRef = 'HEAD';

    console.log(`Analyzing defect risk: ${baseRef}...${headRef}`);
    console.log(`Repository: ${repoRoot}`);
    console.log('');

    const prediction = predict(repoRoot, baseRef, headRef);

    if (args.jsonOutput) {
        console.log(JSON.stringify(predictionToJSON(prediction), null, 2));
    } else {
        console.log(formatPrediction(prediction));

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

function predictionToJSON(p: DefectPrediction): Record<string, unknown> {
    return {
        score: p.score,
        level: p.level,
        recommendation: p.recommendation,
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
}
