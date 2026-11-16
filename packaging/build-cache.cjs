const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

// Hash source contents and use file metadata to validate large generated trees.
function tree(root, names, contents, ignoreBytecode = false) {
  const entries = [];
  function visit(name) {
    const absolute = path.join(root, name);
    const base = path.basename(name);
    if (ignoreBytecode && (base === '__pycache__' || /\.py[co]$/.test(base)))
      return;
    if (['.git', '.pytest_cache', '.ruff_cache', '.mypy_cache'].includes(base))
      return;
    let stat;
    try {
      stat = fs.lstatSync(absolute, { bigint: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      entries.push([name, 'missing']);
      return;
    }
    if (stat.isSymbolicLink()) {
      entries.push([
        name,
        'link',
        fs.readlinkSync(absolute),
        fs.existsSync(absolute),
      ]);
    } else if (stat.isDirectory()) {
      entries.push([name, 'directory']);
      for (const child of fs.readdirSync(absolute).sort())
        visit(path.join(name, child));
    } else {
      entries.push([
        name,
        contents
          ? createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')
          : [String(stat.size), String(stat.mtimeNs), String(stat.mode)],
      ]);
    }
  }
  for (const name of [...names].sort()) visit(name);
  return hash(entries);
}

function fingerprint(root, inputs, context) {
  return hash([context, tree(root, inputs, true, true)]);
}

function runStage({
  root,
  name,
  key,
  outputs,
  execute,
  force = false,
  ignoreBytecode = false,
  log = console.log,
}) {
  const directory = path.join(root, 'build/stages');
  const marker = path.join(directory, `${name}.json`);
  const started = performance.now();
  log(`[${name}] Checking saved stage...`);
  const complete = () =>
    outputs.every((output) => fs.existsSync(path.join(root, output)));
  const snapshot = () => tree(root, outputs, false, ignoreBytecode);
  let previous;
  try {
    previous = JSON.parse(fs.readFileSync(marker, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  if (
    !force &&
    previous?.key === key &&
    complete() &&
    previous.output === snapshot()
  ) {
    log(
      `[${name}] Reused (${((performance.now() - started) / 1000).toFixed(1)}s)`,
    );
    return hash([key, previous.output]);
  }
  fs.mkdirSync(directory, { recursive: true });
  fs.rmSync(marker, { force: true });
  log(`[${name}] Building...`);
  execute();
  if (!complete())
    throw new Error(
      `[${name}] Build succeeded but required output is missing.`,
    );
  const output = snapshot();
  const temporary = `${marker}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ key, output }, null, 2)}\n`);
  fs.renameSync(temporary, marker);
  log(
    `[${name}] Completed (${((performance.now() - started) / 1000).toFixed(1)}s)`,
  );
  return hash([key, output]);
}

function clearInstallerArchives(frontend) {
  const release = path.join(frontend, 'release');
  if (!fs.existsSync(release)) return;
  for (const name of fs.readdirSync(release)) {
    // electron-builder otherwise reuses archives based only on directory mtime,
    // including leftovers from an interrupted build with different settings.
    if (/\.nsis\.(zip|7z)$/.test(name) || name.endsWith('.__uninstaller.exe'))
      fs.rmSync(path.join(release, name), { force: true });
  }
}

module.exports = { fingerprint, runStage, clearInstallerArchives };
