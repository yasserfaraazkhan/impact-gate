const fs = require('node:fs');
const path = require('node:path');

const esmDir = path.resolve(__dirname, '..', 'dist', 'esm');
if (!fs.existsSync(esmDir)) {
  process.exit(0);
}

const packageJson = {
  type: 'module',
};

fs.writeFileSync(path.join(esmDir, 'package.json'), JSON.stringify(packageJson, null, 2));

// TypeScript emits the same runtime version reader for both builds. Supply its
// module directory in ESM so installed packages work from any caller directory.
const versionPath = path.join(esmDir, 'version.js');
const versionSource = fs.readFileSync(versionPath, 'utf8');
const directoryShim = "import {fileURLToPath} from 'node:url';\nconst __dirname = fileURLToPath(new URL('.', import.meta.url));\n";
if (!versionSource.startsWith(directoryShim)) {
  fs.writeFileSync(versionPath, directoryShim + versionSource);
}

// Anchor resolution at the named package root, outside dist/esm's type-only
// package scope, so the skill installer can use the package's own exports.
const installSkillPath = path.join(esmDir, 'cli', 'commands', 'install_skill.js');
const installSkillSource = fs.readFileSync(installSkillPath, 'utf8');
const requireShim = "import {createRequire} from 'node:module';\nconst require = createRequire(new URL('../../../../package.json', import.meta.url));\n";
if (!installSkillSource.startsWith(requireShim)) {
  fs.writeFileSync(installSkillPath, requireShim + installSkillSource);
}
