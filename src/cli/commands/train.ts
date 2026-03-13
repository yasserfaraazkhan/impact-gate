// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {ParsedArgs} from '../types.js';

export async function runTrainCommand(args: ParsedArgs, _autoConfig?: string): Promise<void> {
    console.log('train command: not yet implemented');
    console.log(`  path: ${args.path || '.'}`);
    console.log(`  enrich: ${args.trainEnrich !== false}`);
    console.log(`  validate: ${args.trainValidate || false}`);
    console.log(`  since: ${args.gitSince || 'HEAD~20'}`);
    if (args.trainPr) {
        console.log(`  pr: ${args.trainPr}`);
    }
}
