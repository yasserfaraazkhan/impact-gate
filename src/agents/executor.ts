// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createHash} from 'crypto';
import {join} from 'path';
import {ArtifactSnapshot} from '../pipeline/mutation_verification.js';
import {runPlaywrightSpec, isCleanRun} from '../agentic/playwright_runner.js';
import type {AgenticResult, AgenticSummary} from '../agentic/types.js';
import type {Agent, AgentTask, AgentResult} from '../crew/protocol.js';
import type {CrewContext} from '../crew/context.js';
import type {AgentRole} from '../crew/types.js';

/** Execute the exact artifacts produced by generation. Never ask a provider to regenerate them. */
export class ExecutorAgent implements Agent {
    readonly role: AgentRole = 'executor';

    async execute(_task: AgentTask, ctx: CrewContext): Promise<AgentResult> {
        const start = Date.now();
        const warnings: string[] = [];
        const results: AgenticResult[] = [];
        for (const spec of ctx.generatedSpecs.filter((item) => item.written)) {
            if (!spec.verified || !spec.verification?.verified) {
                results.push({specPath: spec.specPath, scenarioSource: spec.flowId, status: 'unverified', attempts: 0, verification: spec.verification, warnings: [spec.verificationError || 'Generated artifact is unverified']});
                continue;
            }
            const invalidate = (reason: string) => {
                spec.verified = false;
                spec.verification = {...spec.verification, verified: false, reason};
                spec.verificationError = reason;
                return reason;
            };
            const snapshots: ArtifactSnapshot[] = [];
            try {
                const digest = (snapshot: ArtifactSnapshot) => createHash('sha256').update(snapshot.bytes).digest('hex');
                const artifact = new ArtifactSnapshot(spec.specPath, ctx.testsRoot);
                snapshots.push(artifact);
                const source = new ArtifactSnapshot(join(ctx.appPath, spec.verification.sourcePath || ''), ctx.appPath);
                snapshots.push(source);
                if (digest(artifact) !== spec.verification.specSha256 || digest(source) !== spec.verification.sourceSha256) {
                    results.push({specPath: spec.specPath, scenarioSource: spec.flowId, status: 'unverified', attempts: 0, warnings: [invalidate('Spec or source changed after mutation verification')]});
                    continue;
                }
                const finalRun = runPlaywrightSpec(spec.specPath, ctx.testsRoot, {project: 'chrome', timeoutMs: 120000});
                artifact.assert();
                source.assert();
                if (!isCleanRun(finalRun)) invalidate('Final execution did not pass');
                results.push({specPath: spec.specPath, scenarioSource: spec.flowId, status: isCleanRun(finalRun) ? 'passed' : 'failed', attempts: 1, finalRun, verification: spec.verification, warnings: []});
            } catch (error) {
                invalidate(`Executor failed for ${spec.flowId}: ${String(error)}`);
                warnings.push(spec.verificationError!);
                results.push({specPath: spec.specPath, scenarioSource: spec.flowId, status: 'unverified', attempts: 1, warnings: [String(error)]});
            } finally {
                for (const snapshot of snapshots) snapshot.close();
            }
        }
        if (!results.length) warnings.push('Executor: no written specs to execute.');
        const totalPassed = results.filter((result) => result.status === 'passed').length;
        const output: AgenticSummary = {results, totalGenerated: results.length, totalPassed, totalFailed: results.length - totalPassed, totalAttempts: results.reduce((sum, result) => sum + result.attempts, 0), durationMs: Date.now() - start, warnings};
        return {role: this.role, status: totalPassed > 0 ? 'success' : 'partial', output, warnings};
    }
}
