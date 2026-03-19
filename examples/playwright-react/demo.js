#!/usr/bin/env node

const { execFileSync } = require('child_process');

console.log('='.repeat(60));
console.log('  E2E Agents Demo - Playwright + React');
console.log('='.repeat(60));
console.log();

try {
  console.log('Running impact analysis...\n');

  const output = execFileSync(
    'npx',
    ['e2e-ai-agents', 'impact', '--path', '.', '--tests-root', 'e2e', '--since', 'HEAD~1', '--json'],
    { cwd: __dirname, encoding: 'utf-8', timeout: 60_000 }
  );

  const result = JSON.parse(output);

  console.log('Impact Analysis Results:');
  console.log('-'.repeat(40));

  if (result.impactedFamilies && result.impactedFamilies.length > 0) {
    console.log(`\nImpacted families (${result.impactedFamilies.length}):`);
    for (const family of result.impactedFamilies) {
      console.log(`  - ${family.id} [${family.priority}]`);
      if (family.specsToRun) {
        for (const spec of family.specsToRun) {
          console.log(`      run: ${spec}`);
        }
      }
    }
  } else {
    console.log('\nNo impacted families detected.');
    console.log('Tip: Edit a file in src/components/ and run again.');
  }

  if (result.summary) {
    console.log(`\nSummary: ${result.summary}`);
  }

  console.log();
} catch (err) {
  if (err.stdout) {
    console.log('Raw output:', err.stdout);
  }
  console.error('Error running impact analysis:', err.message);
  console.log('\nTip: Make sure you have @yasserkhanorg/e2e-agents installed:');
  console.log('  npm install -g @yasserkhanorg/e2e-agents');
  process.exitCode = 1;
}
