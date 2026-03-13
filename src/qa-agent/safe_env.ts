// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/** Build a minimal env for child processes — only forward what's needed. */
export function safeEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_PATH: process.env.NODE_PATH,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        LLM_PROVIDER: process.env.LLM_PROVIDER,
        LOG_LEVEL: process.env.LOG_LEVEL,
        // Node needs LANG/LC_ALL for proper string handling
        LANG: process.env.LANG,
        // npm/npx need these
        npm_config_prefix: process.env.npm_config_prefix,
        NVM_DIR: process.env.NVM_DIR,
        NVM_BIN: process.env.NVM_BIN,
    };
    if (extra) Object.assign(env, extra);
    return env;
}
