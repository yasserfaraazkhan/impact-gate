// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, mkdirSync, cpSync, readdirSync} from 'fs';
import {join} from 'path';

// skills/ lives at the package root, two levels up from dist/cli/commands/
const SKILLS_SOURCE = join(__dirname, '..', '..', '..', 'skills');

function getSkillsDir(): string {
    if (existsSync(SKILLS_SOURCE)) {
        return SKILLS_SOURCE;
    }
    throw new Error('Could not find skills/ directory in the impact-gate package. Reinstall with: npm install @yasserkhanorg/impact-gate');
}

function listAvailableSkills(skillsDir: string): string[] {
    return readdirSync(skillsDir, {withFileTypes: true})
        .filter((d) => d.isDirectory() && existsSync(join(skillsDir, d.name, 'SKILL.md')))
        .map((d) => d.name);
}

export function runInstallSkillCommand(skillName?: string): void {
    const targetDir = process.cwd();
    const claudeSkillsDir = join(targetDir, '.claude', 'skills');

    const skillsDir = getSkillsDir();
    const available = listAvailableSkills(skillsDir);

    if (!skillName) {
        // List available skills
        console.log('');
        console.log('  Available skills:');
        console.log('');
        for (const name of available) {
            const installed = existsSync(join(claudeSkillsDir, name, 'SKILL.md'));
            const status = installed ? ' (installed)' : '';
            console.log(`    /${name}${status}`);
        }
        console.log('');
        console.log('  Usage: impact-gate install-skill <name>');
        console.log('  Example: impact-gate install-skill qa');
        console.log('');
        return;
    }

    if (!available.includes(skillName)) {
        console.error(`Unknown skill: "${skillName}". Available: ${available.join(', ')}`);
        process.exit(1);
    }

    const source = join(skillsDir, skillName);
    const dest = join(claudeSkillsDir, skillName);

    if (existsSync(join(dest, 'SKILL.md'))) {
        console.log(`  /${skillName} is already installed at .claude/skills/${skillName}/`);
        console.log('  To reinstall, remove the directory first and re-run.');
        return;
    }

    mkdirSync(dest, {recursive: true});
    cpSync(source, dest, {recursive: true});

    console.log('');
    console.log(`  Installed /${skillName} → .claude/skills/${skillName}/`);
    console.log('');
    console.log('  You can now use /' + skillName + ' in Claude Code.');
    console.log('');
}
