#!/usr/bin/env node
// Lists installed packages whose registry metadata marks them deprecated.
// Exits 1 if any are found. Usage: node scripts/check-deprecated.js [--prod]
const { execFileSync } = require('child_process');

const npm = (args) =>
  execFileSync('npm', args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'], // aliased packages (e.g. string-width-cjs) 404 on view
  });

const lsArgs = ['ls', '--all', '--json'];
if (process.argv.includes('--prod')) lsArgs.push('--omit=dev');

let tree;
try {
  tree = JSON.parse(npm(lsArgs));
} catch (err) {
  // npm ls exits non-zero on peer/extraneous problems but still prints the tree.
  tree = JSON.parse(err.stdout);
}

const installed = new Map();
const walk = (deps) => {
  for (const [name, info] of Object.entries(deps || {})) {
    if (info.version) installed.set(`${name}@${info.version}`, true);
    walk(info.dependencies);
  }
};
walk(tree.dependencies);

const deprecated = [];
for (const spec of installed.keys()) {
  let message = '';
  try {
    message = npm(['view', spec, 'deprecated', '--json']).trim();
  } catch {
    continue;
  }
  if (message && message !== '""') {
    deprecated.push({ spec, message: JSON.parse(message) });
  }
}

if (deprecated.length === 0) {
  console.log('No deprecated packages found.');
  process.exit(0);
}

for (const { spec, message } of deprecated) {
  console.log(`- ${spec}: ${message}`);
}
process.exit(1);
