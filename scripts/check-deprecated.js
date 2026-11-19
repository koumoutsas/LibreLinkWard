#!/usr/bin/env node
// Lists installed packages whose registry metadata marks them deprecated.
// Exits 1 for any direct dependency, and for any other deprecated package that
// is not listed in deprecated-known.json (exact name@version).
// Usage: node scripts/check-deprecated.js [--prod]
const { execFileSync, execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const KNOWN_FILE = path.join(__dirname, 'deprecated-known.json');
const known = Object.keys(require(KNOWN_FILE)).filter((k) => !k.startsWith('_'));

const execFileAsync = promisify(execFile);

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
const direct = new Set(
  Object.entries(tree.dependencies || {}).map(([name, info]) => `${name}@${info.version}`),
);
const walk = (deps) => {
  for (const [name, info] of Object.entries(deps || {})) {
    if (info.version) installed.set(`${name}@${info.version}`, true);
    walk(info.dependencies);
  }
};
walk(tree.dependencies);

const CONCURRENCY = 16;
const specs = [...installed.keys()];
const results = new Array(specs.length);

const lookup = async (spec) => {
  try {
    const { stdout } = await execFileAsync('npm', ['view', spec, 'deprecated', '--json'], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    return ''; // aliased packages (e.g. string-width-cjs) 404 on view
  }
};

let next = 0;
const worker = async () => {
  while (next < specs.length) {
    const i = next++;
    results[i] = await lookup(specs[i]);
  }
};

(async () => {
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const deprecated = specs
    .map((spec, i) => ({ spec, message: results[i] }))
    .filter(({ message }) => message && message !== '""');

  const isNew = (spec) => direct.has(spec) || !known.includes(spec);
  const fresh = deprecated.filter(({ spec }) => isNew(spec));
  const accepted = deprecated.filter(({ spec }) => !isNew(spec));
  const line = ({ spec, message }) =>
    `- ${spec}${direct.has(spec) ? ' (direct dependency)' : ''}: ${JSON.parse(message)}`;

  if (deprecated.length === 0) console.log('No deprecated packages found.');
  if (fresh.length > 0) {
    console.log('New deprecated packages (fix, or add to scripts/deprecated-known.json if they come from another package):');
    fresh.forEach((d) => console.log(line(d)));
  }
  if (accepted.length > 0) {
    console.log('Known deprecated packages pulled in by other packages:');
    accepted.forEach((d) => console.log(line(d)));
  }
  const stale = known.filter((spec) => !installed.has(spec));
  if (stale.length > 0) {
    console.log(`No longer installed; remove from scripts/deprecated-known.json: ${stale.join(', ')}`);
  }
  if (fresh.length > 0) process.exitCode = 1;
})();
