const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const {
  fingerprint,
  runStage,
  clearInstallerArchives,
} = require('./build-cache.cjs');

const root = resolve(__dirname, '..');
const frontend = join(root, 'wordkeep-app');
const args = process.argv.slice(2);
const force = args.includes('--force');
const positional = args.filter((argument) => argument !== '--force');
const [operation = 'dist', requestedTarget] = positional;
const target = process.platform === 'darwin' ? 'mac' : 'win';
if (
  !['backend', 'package', 'dist'].includes(operation) ||
  positional.length > 2 ||
  (requestedTarget && requestedTarget !== target) ||
  !(
    (process.platform === 'darwin' && process.arch === 'arm64') ||
    (process.platform === 'win32' && process.arch === 'x64')
  )
) {
  throw new Error(
    'Build on macOS arm64 or Windows x64. Usage: build.cjs backend|package|dist [mac|win] [--force]',
  );
}
const env = { ...process.env };
// Apply the compression level from electron-builder.yml consistently.
delete env.ELECTRON_BUILDER_COMPRESSION_LEVEL;
function run(command, arguments_, cwd = root, capture = false) {
  const result = spawnSync(command, arguments_, {
    cwd,
    env,
    stdio: capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} failed (${result.signal ?? result.status}). ${result.stderr ?? ''}`,
    );
  return result.stdout?.trim();
}
const signing = Object.fromEntries(
  Object.entries(process.env).filter(([name]) =>
    /^(CSC_|WIN_CSC_|APPLE_|WORDKEEP_CODESIGN_IDENTITY$)/.test(name),
  ),
);
const context = {
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  uv: run('uv', ['--version'], root, true),

  signing,
};
const scripts = [
  'package.json',
  'package-lock.json',
  'packaging/build.cjs',
  'packaging/build-cache.cjs',
  'packaging/collect-licenses.cjs',
];
function stage(
  name,
  inputs,
  outputs,
  dependencies,
  execute,
  ignoreBytecode = false,
) {
  return runStage({
    root,
    name,
    force,
    outputs,
    ignoreBytecode,
    execute,
    key: fingerprint(root, [...scripts, ...inputs], {
      ...context,
      dependencies,
    }),
  });
}
run('uv', [
  'run',
  '--directory',
  join(root, 'wordkeep-backend'),
  '--no-project',
  '--managed-python',
  'packaging/build.py',
  'build',
  ...(force ? ['--force'] : []),
]);
const backendKey = fingerprint(
  root,
  ['wordkeep-backend/dist/wordkeep-backend/build-manifest.json'],
  context,
);
if (operation !== 'backend') {
  const npm = process.env.npm_execpath;
  if (!npm)
    throw new Error('Run this script through npm run package or npm run dist.');
  const frontendKey = stage(
    'frontend',
    [
      'wordkeep-app/src',
      'wordkeep-app/package.json',
      'wordkeep-app/package-lock.json',
      'wordkeep-app/electron.vite.config.ts',
      'wordkeep-app/tsconfig.node.json',
      'wordkeep-app/tsconfig.web.json',
      'wordkeep-app/biome.json',
    ],
    [
      'wordkeep-app/out',
      'wordkeep-app/out/main/index.js',
      'wordkeep-app/out/preload/index.cjs',
      'wordkeep-app/out/renderer/index.html',
    ],
    [],
    () => {
      run(process.execPath, [npm, 'run', 'build'], frontend);
    },
  );
  const builder = require.resolve('electron-builder/cli.js');
  const electronVersion = JSON.parse(
    readFileSync(join(frontend, 'node_modules/electron/package.json'), 'utf8'),
  ).version;
  const builderArgs = [
    '--projectDir',
    root,
    '--config',
    join(root, 'packaging/electron-builder.yml'),
    `--config.electronVersion=${electronVersion}`,
  ];
  const platformArgs =
    target === 'mac' ? ['--mac', '--arm64'] : ['--win', '--x64'];
  const app =
    target === 'mac'
      ? 'release/mac-arm64/wordkeep-app.app'
      : 'release/win-unpacked';
  const executable =
    target === 'mac' ? 'Contents/MacOS/wordkeep-app' : 'wordkeep-app.exe';
  const appKey = stage(
    'application',
    [
      'packaging/electron-builder.yml',
      'wordkeep-app/resources',
      'packaging/installer.nsh',
      'packaging/THIRD_PARTY_NOTICES.md',
      'packaging/Remix-Icon-NOTICE.txt',
      'LICENSE',
      'packaging/check-resources.cjs',
    ],
    [app, `${app}/${executable}`],
    [backendKey, frontendKey],
    () => {
      require('./collect-licenses.cjs').collectLicenses(root);
      run(
        process.execPath,
        [
          builder,
          ...builderArgs,
          '--dir',
          ...platformArgs,
          '--publish',
          'never',
        ],
        frontend,
      );
    },
  );
  if (operation === 'dist') {
    const { version } = JSON.parse(
      readFileSync(join(frontend, 'package.json'), 'utf8'),
    );
    const artifact = `release/wordkeep-app-${version}-${target}-${process.arch}.${target === 'mac' ? 'dmg' : 'exe'}`;
    stage(
      'installer',
      [
        'packaging/electron-builder.yml',
        'packaging/installer.nsh',
        'wordkeep-app/resources',
      ],
      [artifact],
      [appKey],
      () => {
        clearInstallerArchives(root);
        run(
          process.execPath,
          [
            builder,
            ...builderArgs,
            ...platformArgs,
            '--prepackaged',
            join(root, app),
            '--publish',
            'never',
          ],
          frontend,
        );
      },
    );
    console.log(`Installer: ${join(root, artifact)}`);
  }
}
