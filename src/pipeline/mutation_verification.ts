// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {execFileSync} from 'child_process';
import {createHash} from 'crypto';
import {closeSync, constants, copyFileSync, existsSync, fstatSync, ftruncateSync, openSync, readSync, writeSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {dirname, isAbsolute, join, relative, resolve} from 'path';
import ts from 'typescript';
import {isCleanRun, runPlaywrightSpec} from '../agentic/playwright_runner.js';
import type {PlaywrightRunResult} from '../agentic/types.js';

export interface MutationVerification {
    verified: boolean;
    reason: string;
    workspace?: string;
    sourcePath?: string;
    specSha256?: string;
    sourceSha256?: string;
    sourceSnapshot?: string;
    mutantSnapshot?: string;
    line?: number;
    operator?: string;
    baseline?: PlaywrightRunResult;
    mutant?: PlaywrightRunResult;
    restored?: PlaywrightRunResult;
}
interface VerificationOptions {repositoryRoot?: string; baseRef?: string; testsRoot: string; project?: string; baseUrl?: string; timeoutMs?: number}

/** Reject symlinks at every component, including a not-yet-created output path. */
export function safeArtifactPath(path: string, root: string): string {
    const full = resolve(path);
    const boundary = resolve(root);
    if (!full.startsWith(boundary + '/')) throw new Error('Artifact path is outside its root');
    let cursor = full;
    while (cursor !== dirname(cursor)) {
        try {
            if (lstatSync(cursor).isSymbolicLink()) throw new Error(`Symlink path is unsupported: ${cursor}`);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (cursor === boundary) break;
        cursor = dirname(cursor);
    }
    return full;
}

/** Hold a regular-file descriptor across execution; replacement paths cannot redirect writes. */
export class ArtifactSnapshot {
    private readonly fd: number;
    private readonly identities: Array<{path: string; dev: number; ino: number}> = [];
    readonly bytes: Buffer;
    constructor(readonly path: string, root: string, writable = false) {
        safeArtifactPath(path, root);
        let cursor = resolve(path);
        while (true) {
            const stat = lstatSync(cursor);
            this.identities.push({path: cursor, dev: stat.dev, ino: stat.ino});
            if (cursor === resolve(root)) break;
            cursor = dirname(cursor);
        }
        this.fd = openSync(path, (writable ? constants.O_RDWR : constants.O_RDONLY) | constants.O_NOFOLLOW);
        try {
            const stat = fstatSync(this.fd);
            if (!stat.isFile() || stat.dev !== this.identities[0].dev || stat.ino !== this.identities[0].ino) throw new Error('Artifact identity changed while opening');
            this.bytes = Buffer.alloc(stat.size);
            let offset = 0;
            while (offset < this.bytes.length) {
                const count = readSync(this.fd, this.bytes, offset, this.bytes.length - offset, offset);
                if (!count) throw new Error('Artifact changed while reading');
                offset += count;
            }
            this.assert(this.bytes);
        } catch (error) {closeSync(this.fd); throw error;}
    }
    assert(expected = this.bytes): void {
        for (const identity of this.identities) {
            const stat = lstatSync(identity.path);
            if (stat.isSymbolicLink() || stat.dev !== identity.dev || stat.ino !== identity.ino) throw new Error(`Artifact path identity changed: ${identity.path}`);
        }
        if (fstatSync(this.fd).size !== expected.length) throw new Error(`Artifact bytes changed: ${this.path}`);
        const bytes = Buffer.alloc(expected.length);
        let offset = 0;
        while (offset < bytes.length) {
            const count = readSync(this.fd, bytes, offset, bytes.length - offset, offset);
            if (!count) throw new Error(`Artifact changed while reading: ${this.path}`);
            offset += count;
        }
        if (!bytes.equals(expected)) throw new Error(`Artifact bytes changed: ${this.path}`);
    }
    replace(expected: Buffer, replacement: Buffer): void {
        this.assert(expected);
        // Positional writes use the held inode even if another process replaces the pathname.
        let offset = 0;
        while (offset < replacement.length) offset += writeSync(this.fd, replacement, offset, replacement.length - offset, offset);
        ftruncateSync(this.fd, replacement.length);
        this.assert(replacement);
    }
    close(): void {closeSync(this.fd);}
}

/** Establish quarantine availability before replacing any discoverable test. */
export function prepareQuarantine(root: string): string {
    const directory = join(root, '.e2e-ai-agents', 'unverified');
    safeArtifactPath(join(directory, 'artifact'), root);
    mkdirSync(directory, {recursive: true});
    const destination = join(directory, `${Date.now()}-${Math.random().toString(36).slice(2)}.ts.unverified`);
    const fd = openSync(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    closeSync(fd);
    return destination;
}

/** Cleanup is independent of quarantine storage: never leave owned rejected code discoverable. */
export function quarantineSpec(path: string, root: string, original: Buffer | undefined, generated: Buffer, destination?: string): string {
    const snapshot = new ArtifactSnapshot(path, root, true);
    try {
        snapshot.assert(generated);
        if (original) snapshot.replace(generated, original);
        else {
            snapshot.assert(generated);
            rmSync(path);
        }
    } finally {snapshot.close();}
    const output = destination || prepareQuarantine(root);
    const quarantine = new ArtifactSnapshot(output, root, true);
    try {quarantine.replace(Buffer.alloc(0), generated);} finally {quarantine.close();}
    return output;
}

interface Candidate {path: string; line: number; operator: string; original: Buffer; mutated: Buffer}
function candidates(root: string, base: string): Candidate[] {
    const git = (...args: string[]) => execFileSync('git', args, {cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024});
    const commit = git('rev-parse', '--verify', `${base}^{commit}`).trim();
    const paths = git('diff', '--name-only', '-z', '--no-ext-diff', commit, '--').split('\0').filter(Boolean);
    const found: Candidate[] = [];
    const used = new Set<string>();
    for (const path of paths) {
        if (!/\.[cm]?[jt]sx?$/.test(path) || /(^|\/)(?:tests?|__tests__|e2e|specs)(\/|$)|\.(?:test|spec)\./i.test(path)) continue;
        const full = safeArtifactPath(join(root, path), root);
        if (!existsSync(full) || !lstatSync(full).isFile()) continue;
        const original = readFileSync(full);
        if (original.includes(0)) continue;
        const code = original.toString('utf8');
        if (!Buffer.from(code).equals(original)) continue;
        const diff = git('diff', '--no-ext-diff', '--no-textconv', '--unified=0', commit, '--', path);
        const ranges = [...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)].map((m) => [Number(m[1]), Number(m[2] ?? 1)]);
        const source = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true);
        const add = (node: ts.Node, operator: string, replacement: string) => {
            const start = node.getStart(source);
            const first = source.getLineAndCharacterOfPosition(start).line + 1;
            const last = source.getLineAndCharacterOfPosition(node.end - 1).line + 1;
            if (used.has(operator) || !ranges.some(([line, length]) => length > 0 && first <= line + length - 1 && last >= line)) return;
            used.add(operator);
            found.push({path, line: first, operator, original, mutated: Buffer.from(code.slice(0, start) + replacement + code.slice(node.end))});
        };
        const visit = (node: ts.Node) => {
            if (ts.isBinaryExpression(node) && [ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind)) add(node, 'invert-condition', `!(${node.getText(source)})`);
            if (ts.isReturnStatement(node) && node.expression && node.expression.kind !== ts.SyntaxKind.NullKeyword) add(node, 'return-null', 'return null;');
            if (ts.isExpressionStatement(node)) add(node, 'comment-statement', '; /* mutation: statement removed */');
            ts.forEachChild(node, visit);
        };
        visit(source);
        if (found.length === 3) break;
    }
    return found;
}

function directlyImports(spec: string, source: string): boolean {
    const parsed = ts.createSourceFile(spec, readFileSync(spec, 'utf8'), ts.ScriptTarget.Latest, true);
    return parsed.statements.some((node) => {
        if (!ts.isImportDeclaration(node) || !node.importClause || node.importClause.isTypeOnly || !ts.isStringLiteral(node.moduleSpecifier)) return false;
        const name = node.moduleSpecifier.text;
        if (!name.startsWith('.')) return false;
        const imported = resolve(dirname(spec), name);
        return [imported, `${imported}.ts`, `${imported}.tsx`, `${imported}.js`, join(imported, 'index.ts')].includes(source);
    });
}

/** Internal, conservative verification: source imports only; browser/prebuilt server mutations are unsupported. */
export function verifyGeneratedSpec(specPath: string, options: VerificationOptions): MutationVerification {
    const evidence: MutationVerification = {verified: false, reason: 'Missing source repository or selected base'};
    if (!options.repositoryRoot || !options.baseRef) return evidence;
    const snapshots: ArtifactSnapshot[] = [];
    const capture = (path: string, root: string, writable = false) => {
        const snapshot = new ArtifactSnapshot(path, root, writable);
        snapshots.push(snapshot);
        return snapshot;
    };
    try {
        const root = realpathSync(options.repositoryRoot);
        const tests = resolve(options.testsRoot) === root ? root : safeArtifactPath(options.testsRoot, root);
        const spec = safeArtifactPath(specPath, tests);
        if (options.baseUrl) return {...evidence, reason: 'Remote/prebuilt server mutation is unsupported; only directly imported local source can be verified'};
        const mutations = candidates(root, options.baseRef);
        if (!mutations.length) return {...evidence, reason: 'No supported changed-line source mutation'};
        // Copy tracked files and the generated artifact. Never mutate the user's source checkout.
        const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'impact-verification-')));
        evidence.workspace = workspace;
        const tracked = execFileSync('git', ['ls-files', '-z'], {cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024}).split('\0').filter(Boolean);
        for (const file of [...new Set([...tracked, relative(root, spec)])]) {
            if (isAbsolute(file) || file.split('/').includes('..') || /(^|\/)(?:\.env(?:\.|$)|node_modules(?:\/|$))/.test(file)) continue;
            const input = safeArtifactPath(join(root, file), root);
            if (!existsSync(input) || !lstatSync(input).isFile()) continue;
            const output = join(workspace, file);
            mkdirSync(dirname(output), {recursive: true});
            copyFileSync(input, output);
        }
        // Resolve only the existing dependency roots; never download dependencies.
        for (const directory of new Set([root, tests])) {
            const modules = join(directory, 'node_modules');
            if (existsSync(modules)) {
                const output = join(workspace, relative(root, directory), 'node_modules');
                symlinkSync(realpathSync(modules), output, 'dir');
            }
        }
        const copySpec = join(workspace, relative(root, spec));
        const copyTests = join(workspace, relative(root, tests));
        const artifact = capture(copySpec, workspace);
        const originalArtifact = capture(spec, root);
        const targets = mutations.map((mutation) => {
            const target = capture(join(workspace, mutation.path), workspace, true);
            const original = capture(join(root, mutation.path), root);
            target.assert(mutation.original);
            original.assert(mutation.original);
            const sourceSnapshot = join(workspace, `${mutation.operator}.source.original`);
            const mutantSnapshot = join(workspace, `${mutation.operator}.source.mutant`);
            // Evidence bytes are written before any project code executes.
            writeFileSync(sourceSnapshot, mutation.original, {flag: 'wx'});
            writeFileSync(mutantSnapshot, mutation.mutated, {flag: 'wx'});
            return {mutation, target, original, sourceSnapshot, mutantSnapshot};
        });
        evidence.specSha256 = createHash('sha256').update(artifact.bytes).digest('hex');
        const check = (active?: Candidate) => {
            artifact.assert();
            originalArtifact.assert(artifact.bytes);
            for (const {mutation, target, original} of targets) {
                target.assert(active?.path === mutation.path ? active.mutated : mutation.original);
                original.assert(mutation.original);
            }
        };
        const run = () => runPlaywrightSpec(copySpec, copyTests, options);
        evidence.baseline = run();
        check();
        if (!isCleanRun(evidence.baseline)) return {...evidence, reason: 'Clean execution did not pass positive tests'};
        for (const {mutation, target, sourceSnapshot, mutantSnapshot} of targets) {
            check();
            evidence.sourcePath = mutation.path;
            evidence.line = mutation.line;
            evidence.operator = mutation.operator;
            evidence.sourceSha256 = createHash('sha256').update(mutation.original).digest('hex');
            evidence.sourceSnapshot = sourceSnapshot;
            evidence.mutantSnapshot = mutantSnapshot;
            target.replace(mutation.original, mutation.mutated);
            try {
                evidence.mutant = run();
                check(mutation);
            } finally {
                // A changed identity or changed bytes are never overwritten during cleanup.
                target.replace(mutation.mutated, mutation.original);
            }
            evidence.restored = run();
            check();
            if (!isCleanRun(evidence.restored)) return {...evidence, reason: 'Restored execution did not pass'};
            const mutant = evidence.mutant;
            if (directlyImports(copySpec, target.path) && mutant?.compiled && mutant.exitCode === 1 && (mutant.assertionFailures || 0) > 0 && mutant.failed === mutant.assertionFailures && mutant.flaky === 0 && mutant.skipped === 0) {
                return {...evidence, verified: true, reason: 'Direct source import passed clean, detected changed-line mutation with an assertion, and passed after restoration'};
            }
        }
        return {...evidence, reason: 'No applicable assertion kill; only directly imported local source can be verified'};
    } catch (error) {
        return {...evidence, reason: `Verification unavailable: ${error instanceof Error ? error.message : String(error)}`};
    } finally {
        for (const snapshot of snapshots) snapshot.close();
    }
}
