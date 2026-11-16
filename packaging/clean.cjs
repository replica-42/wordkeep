const fs = require('node:fs');
const { dirname, join, resolve } = require('node:path');

const caches = new Set([
  '__pycache__',
  '.pytest_cache',
  '.ruff_cache',
  '.mypy_cache',
  'htmlcov',
]);
const dependencies = new Set(['.venv', 'venv', 'node_modules', '.git']);

function clean(root, { all = false, dryRun = false, log = console.log } = {}) {
  const paths = new Set([
    'build/app-resources',
    'build/stages',
    'wordkeep-app/out',
    'wordkeep-app/coverage',
    'wordkeep-app/node_modules/.vite',
    'wordkeep-app/node_modules/.vitest',
  ]);
  if (all) paths.add('release');
  else if (fs.existsSync(join(root, 'release'))) {
    if (fs.lstatSync(join(root, 'release')).isSymbolicLink())
      throw new Error('Refusing to clean through a release directory symlink.');
    for (const name of fs.readdirSync(join(root, 'release'))) {
      if (!/\.(exe|dmg)$/i.test(name) || /\.__uninstaller\.exe$/i.test(name))
        paths.add(`release/${name}`);
    }
  }
  function collectCaches(directory) {
    const absolute = join(root, directory);
    if (!fs.existsSync(absolute) || fs.lstatSync(absolute).isSymbolicLink())
      return;
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (dependencies.has(entry.name)) continue;
      const name = `${directory}/${entry.name}`;
      if (
        caches.has(entry.name) ||
        entry.name === '.coverage' ||
        (entry.isFile() && /\.(py[co]|tsbuildinfo)$/.test(entry.name))
      ) {
        paths.add(name);
      } else if (entry.isDirectory() && !paths.has(name)) {
        collectCaches(name);
      }
    }
  }
  // Collect caches within source trees, preserving dependencies and user resources.
  for (const directory of ['wordkeep-app', 'packaging'])
    collectCaches(directory);
  for (const name of [...caches, '.coverage']) paths.add(name);
  for (const name of paths) {
    for (
      let parent = dirname(join(root, name));
      parent !== root;
      parent = dirname(parent)
    ) {
      if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink())
        throw new Error(
          `Refusing to clean through directory symlink: ${parent}`,
        );
    }
  }
  for (const name of paths) {
    const absolute = join(root, name);
    if (!fs.existsSync(absolute)) continue;
    log(`${dryRun ? 'Would remove' : 'Removing'}: ${absolute}`);
    if (!dryRun) fs.rmSync(absolute, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some((argument) => !['--all', '--dry-run'].includes(argument)))
    throw new Error(
      'Usage: npm run clean [-- --dry-run] or npm run clean:all [-- --dry-run]',
    );
  const root = resolve(__dirname, '..');
  if (!args.includes('--dry-run')) {
    const result = require('node:child_process').spawnSync(
      'uv',
      [
        'run',
        '--directory',
        join(root, 'wordkeep-backend'),
        '--no-project',
        '--managed-python',
        'packaging/build.py',
        'clean',
        ...(args.includes('--all') ? ['--all'] : []),
      ],
      { stdio: 'inherit' },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  } else
    console.log(
      'Would also run backend clean' + (args.includes('--all') ? ' --all' : ''),
    );
  clean(root, {
    all: args.includes('--all'),
    dryRun: args.includes('--dry-run'),
  });
}
module.exports = { clean };
