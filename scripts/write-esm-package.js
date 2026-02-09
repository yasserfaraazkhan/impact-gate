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
