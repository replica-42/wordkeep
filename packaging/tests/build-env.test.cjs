const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const { test } = require('node:test');
const { buildEnvironment } = require('../build-env.cjs');

function probe(env, expected) {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `
    const assert = require('node:assert/strict');
    const { PlatformPackager } = require('app-builder-lib');
    const context = { info: { config: {} }, platformSpecificBuildOptions: {} };
    const actual = PlatformPackager.prototype.getCscLink.call(context,
      process.env.TEST_PLATFORM === 'win32' ? 'WIN_CSC_LINK' : undefined);
    assert.equal(actual ?? null, JSON.parse(process.env.TEST_LINK));
  `,
    ],
    {
      cwd: resolve(__dirname, '../..'),
      env: { ...env, TEST_LINK: JSON.stringify(expected) },
      encoding: 'utf8',
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
}

for (const platform of ['darwin', 'win32']) {
  test(`${platform}: empty CI secrets do not supply a certificate to electron-builder`, () => {
    const env = buildEnvironment(
      {
        ...process.env,
        TEST_PLATFORM: platform,
        CSC_LINK: '',
        CSC_NAME: '',
        CSC_KEYCHAIN: '',
        CSC_INSTALLER_LINK: '',
        CSC_KEY_PASSWORD: '',
        WIN_CSC_LINK: '  ',
        WIN_CSC_KEY_PASSWORD: '',
        WORDKEEP_CODESIGN_IDENTITY: '',
        APPLE_ID: '',
        APPLE_APP_SPECIFIC_PASSWORD: '',
        APPLE_TEAM_ID: '',
      },
      platform,
    );
    for (const name of [
      'CSC_LINK',
      'WIN_CSC_LINK',
      'WORDKEEP_CODESIGN_IDENTITY',
      'APPLE_ID',
      'APPLE_APP_SPECIFIC_PASSWORD',
      'APPLE_TEAM_ID',
    ])
      assert.equal(env[name], undefined);
    if (platform === 'darwin')
      assert.equal(env.CSC_IDENTITY_AUTO_DISCOVERY, 'false');
    probe(env, null);
  });
}

test('Windows never falls back to the macOS certificate', () => {
  const env = buildEnvironment(
    {
      ...process.env,
      TEST_PLATFORM: 'win32',
      CSC_LINK: '/certs/mac.p12',
      CSC_KEY_PASSWORD: 'mac-password',
      CSC_NAME: 'mac identity',
      CSC_KEYCHAIN: '/mac/keychain',
      WORDKEEP_CODESIGN_IDENTITY: 'mac identity',
      APPLE_ID: 'developer@example.com',
      WIN_CSC_LINK: '',
    },
    'win32',
  );
  assert(
    !Object.keys(env).some((name) =>
      /^(CSC_|APPLE_|WORDKEEP_CODESIGN_IDENTITY$)/.test(name),
    ),
  );
  probe(env, null);
});

test('each platform keeps only its own certificate and preserves password contents', () => {
  const source = {
    ...process.env,
    CSC_LINK: '/certs/mac.p12',
    CSC_KEY_PASSWORD: '  password  ',
    WIN_CSC_LINK: '/certs/windows.p12',
    WIN_CSC_KEY_PASSWORD: '',
    WORDKEEP_CODESIGN_IDENTITY: 'Developer ID Application: Example',
    APPLE_ID: 'developer@example.com',
    APPLE_APP_SPECIFIC_PASSWORD: 'example-password',
    APPLE_TEAM_ID: 'EXAMPLE123',
    ELECTRON_BUILDER_COMPRESSION_LEVEL: '9',
  };
  const mac = buildEnvironment(source, 'darwin');
  const win = buildEnvironment(source, 'win32');
  assert.equal(mac.CSC_KEY_PASSWORD, '  password  ');
  assert.equal(mac.WIN_CSC_LINK, undefined);
  assert.equal(
    mac.APPLE_APP_SPECIFIC_PASSWORD,
    source.APPLE_APP_SPECIFIC_PASSWORD,
  );
  assert.equal(win.WIN_CSC_KEY_PASSWORD, '');
  assert.equal(win.CSC_KEY_PASSWORD, undefined);
  assert.equal(source.ELECTRON_BUILDER_COMPRESSION_LEVEL, '9');
  assert.equal(mac.ELECTRON_BUILDER_COMPRESSION_LEVEL, undefined);
  probe({ ...mac, TEST_PLATFORM: 'darwin' }, source.CSC_LINK);
  probe({ ...win, TEST_PLATFORM: 'win32' }, source.WIN_CSC_LINK);
});
