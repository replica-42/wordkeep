const assert = require('node:assert/strict');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const {
  fingerprint,
  runStage,
  clearInstallerArchives,
} = require('../build-cache.cjs');
const { clean } = require('../clean.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'wordkeep-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, text = name) => {
    fs.mkdirSync(join(root, name, '..'), { recursive: true });
    fs.writeFileSync(join(root, name), text);
  };
  return { root, write };
}

test('completed stages are reused; source, context and missing outputs invalidate them', (t) => {
  const { root, write } = fixture(t);
  write('src/main.py', 'first');
  let builds = 0;
  const run = (platform = 'win32', force = false) =>
    runStage({
      root,
      name: 'backend',
      force,
      log() {},
      key: fingerprint(root, ['src'], { platform }),
      outputs: ['build/resources', 'build/resources/manifest.json'],
      execute() {
        builds++;
        write('build/resources/manifest.json');
        write('build/resources/library.dll');
      },
    });
  const first = run();
  assert.equal(run(), first);
  assert.equal(builds, 1);
  write('src/main.py', 'other');
  run();
  assert.equal(builds, 2);
  run('darwin');
  assert.equal(builds, 3);
  fs.unlinkSync(join(root, 'build/resources/library.dll'));
  run('darwin');
  assert.equal(builds, 4);
  run('darwin', true);
  assert.equal(builds, 5);
});

test('failed stages are retried without invalidating successful upstream work', (t) => {
  const { root, write } = fixture(t);
  let upstream = 0;
  let attempts = 0;
  const run = () => {
    const dependency = runStage({
      root,
      name: 'backend',
      key: 'fixed',
      outputs: ['backend.exe'],
      log() {},
      execute() {
        upstream++;
        write('backend.exe');
      },
    });
    return runStage({
      root,
      name: 'installer',
      key: dependency,
      outputs: ['installer.exe'],
      log() {},
      execute() {
        if (++attempts === 1) throw new Error('interrupted');
        write('installer.exe');
      },
    });
  };
  assert.throws(run, /interrupted/);
  assert.equal(fs.existsSync(join(root, 'build/stages/installer.json')), false);
  run();
  run();
  assert.equal(upstream, 1);
  assert.equal(attempts, 2);
});

test('dependency changes invalidate downstream stages even if their source is unchanged', (t) => {
  const { root, write } = fixture(t);
  let builds = 0;
  const run = (dependency) =>
    runStage({
      root,
      name: 'application',
      key: fingerprint(root, [], { dependency }),
      outputs: ['app.exe'],
      log() {},
      execute() {
        builds++;
        write('app.exe');
      },
    });
  run('backend-1');
  run('backend-1');
  run('backend-2');
  assert.equal(builds, 2);
});

test('environment bytecode does not invalidate reuse; missing runtime libraries do', (t) => {
  const { root, write } = fixture(t);
  let builds = 0;
  const run = () =>
    runStage({
      root,
      name: 'environment',
      key: 'env',
      outputs: ['wordkeep-backend/.venv'],
      ignoreBytecode: true,
      log() {},
      execute() {
        builds++;
        write('wordkeep-backend/.venv/python.exe');
      },
    });
  run();
  write('wordkeep-backend/.venv/__pycache__/module.pyc');
  run();
  assert.equal(builds, 1);
  fs.unlinkSync(join(root, 'wordkeep-backend/.venv/python.exe'));
  run();
  assert.equal(builds, 2);
});

test('an incomplete successful command and malformed marker never count as complete', (t) => {
  const { root, write } = fixture(t);
  const options = {
    root,
    name: 'backend',
    key: 'key',
    outputs: ['backend.exe'],
    log() {},
    execute() {},
  };
  assert.throws(() => runStage(options), /required output is missing/);
  write('build/stages/backend.json', '{broken');
  runStage({
    ...options,
    execute() {
      write('backend.exe');
    },
  });
  assert.equal(
    JSON.parse(fs.readFileSync(join(root, 'build/stages/backend.json'))).key,
    'key',
  );
});

test('root cleanup preserves dependencies and backend outputs', (t) => {
  const { root, write } = fixture(t);
  const keep = [
    'node_modules/package/index.js',
    'wordkeep-app/node_modules/package/index.js',
    'wordkeep-backend/.venv/bin/python',
    'wordkeep-backend/build/venv/bin/python',
    'wordkeep-backend/dist/wordkeep-backend/program',
    'wordkeep-backend/data/hanlp/model.pt',
  ];
  const remove = [
    'build/stages/frontend.json',
    'build/app-resources/licenses/NOTICE',
    'wordkeep-app/out/main/index.js',
    'release/mac-arm64/wordkeep-app.app/program',
  ];
  for (const name of [...keep, ...remove, 'release/wordkeep-app.dmg'])
    write(name);
  clean(root, { log() {} });
  for (const name of keep) assert(fs.existsSync(join(root, name)));
  for (const name of remove) assert(!fs.existsSync(join(root, name)));
  assert(fs.existsSync(join(root, 'release/wordkeep-app.dmg')));
  clean(root, { all: true, log() {} });
  assert(!fs.existsSync(join(root, 'release')));
  for (const name of keep) assert(fs.existsSync(join(root, name)));
});

test('installer retries discard payload archives and retain the assembled app', (t) => {
  const { root, write } = fixture(t);
  write('release/app.nsis.zip');
  write('release/app.__uninstaller.exe');
  write('release/win-unpacked/wordkeep-app.exe');
  clearInstallerArchives(root);
  assert(!fs.existsSync(join(root, 'release/app.nsis.zip')));
  assert(fs.existsSync(join(root, 'release/win-unpacked/wordkeep-app.exe')));
});
