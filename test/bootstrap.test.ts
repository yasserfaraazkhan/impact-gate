// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {runBootstrapCommand} from '../dist/cli/commands/bootstrap.js';

describe('bootstrap', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, {recursive: true, force: true});
    });

    it('throws BootstrapError when KG file not found', async () => {
        await assert.rejects(
            () => runBootstrapCommand({path: tmpDir, apply: false, help: false}),
            (err: Error) => {
                assert.equal(err.name, 'BootstrapError');
                assert.ok(err.message.includes('Knowledge graph not found'));
                return true;
            },
        );
    });

    it('does NOT call process.exit', async () => {
        const originalExit = process.exit;
        let exitCalled = false;
        process.exit = (() => {
            exitCalled = true;
        }) as never;

        try {
            await runBootstrapCommand({path: tmpDir, apply: false, help: false}).catch(() => {});
            assert.equal(exitCalled, false, 'process.exit should not be called');
        } finally {
            process.exit = originalExit;
        }
    });
});
