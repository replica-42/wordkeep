const assert = require('node:assert/strict');
const fs = require('node:fs');
const { dirname } = require('node:path');
const { test } = require('node:test');
const { withMacSigning, selectIdentity } = require('../mac-signing.cjs');

const hash = 'A'.repeat(40);
const name = 'Developer ID Application: Example (EXAMPLE123)';
const identities = `  1) ${hash} "${name}"\n     1 valid identities found`;

for (const platform of ['darwin', 'win32']) {
  test(`${platform}: unsigned builds need no certificate or keychain operations`, async () => {
    let builds = 0;
    await withMacSigning({}, '/project', () => builds++, {
      platform,
      runSecurity() {
        assert.fail('Unexpected keychain operation');
      },
      loadCertificate() {
        assert.fail('Unexpected certificate import');
      },
    });
    assert.equal(builds, 1);
  });
}

for (const failure of [null, 'import', 'create-keychain', 'build']) {
  test(`certificate setup precedes backend and app builds; cleanup after ${failure ?? 'success'}`, async () => {
    const commands = [];
    let keychain;
    let certificate;
    let built = false;
    const operation = withMacSigning(
      { CSC_LINK: 'certificate-data', CSC_KEY_PASSWORD: '' },
      '/project',
      async (env) => {
        built = true;
        assert.equal(env.WORDKEEP_CODESIGN_IDENTITY, hash);
        assert.equal(env.CSC_NAME, hash);
        assert.equal(env.CSC_KEYCHAIN, keychain);
        assert.equal(env.CSC_LINK, undefined);
        assert.equal(env.CSC_KEY_PASSWORD, undefined);
        assert(commands.some((args) => args[0] === 'set-key-partition-list'));
        assert.equal(commands.at(-1)[0], 'find-identity');
        commands.push(['backend'], ['application']);
        if (failure === 'build') throw new Error('build failed');
        return 'built';
      },
      {
        platform: 'darwin',
        async loadCertificate(link, temporary, root) {
          assert.equal(link, 'certificate-data');
          assert.equal(root, '/project');
          certificate = await temporary.getTempFile({ suffix: '.p12' });
          fs.writeFileSync(certificate, 'test-certificate');
          return certificate;
        },
        runSecurity(args) {
          commands.push(args);
          if (args[0] === 'create-keychain') keychain = args.at(-1);
          if (args[0] === failure) throw new Error(`${failure} failed`);
          if (args[0] === 'list-keychains' && !args.includes('-s'))
            return '  "/original/login.keychain-db"\n';
          if (args[0] === 'find-identity') return identities;
          if (args[0] === 'import')
            assert.equal(args[args.indexOf('-P') + 1], '');
          return '';
        },
      },
    );
    if (failure)
      await assert.rejects(operation, new RegExp(`${failure} failed`));
    else assert.equal(await operation, 'built');
    assert.equal(built, !failure || failure === 'build');
    if (failure !== 'create-keychain') {
      assert.deepEqual(commands.at(-2), [
        'list-keychains',
        '-d',
        'user',
        '-s',
        '/original/login.keychain-db',
      ]);
      assert.deepEqual(commands.at(-1), ['delete-keychain', keychain]);
    }
    assert.equal(fs.existsSync(dirname(keychain)), false);
    assert.equal(fs.existsSync(certificate), false);
  });
}

test('existing explicitly selected identities reuse the local keychain', async () => {
  const commands = [];
  await withMacSigning(
    { WORDKEEP_CODESIGN_IDENTITY: name, CSC_KEYCHAIN: '/existing/keychain' },
    '/project',
    (env) => {
      assert.equal(env.WORDKEEP_CODESIGN_IDENTITY, hash);
    },
    {
      platform: 'darwin',
      runSecurity(args) {
        commands.push(args);
        return identities;
      },
    },
  );
  assert.deepEqual(commands, [
    ['find-identity', '-v', '-p', 'codesigning', '/existing/keychain'],
  ]);
});

test('invalid or ambiguous signing certificates stop the build', async () => {
  const second = `\n  2) ${'B'.repeat(40)} "Developer ID Application: Another (OTHER123)"`;
  assert.equal(selectIdentity(identities), hash);
  assert.equal(selectIdentity(identities + second, name), hash);
  assert.equal(selectIdentity(identities + second, hash), hash);
  assert.throws(() => selectIdentity(identities + second), /Select one/);
  assert.throws(() => selectIdentity('0 valid identities found'), /Select one/);
  await assert.rejects(
    withMacSigning(
      { WORDKEEP_CODESIGN_IDENTITY: name },
      '/project',
      () => {
        assert.fail('Must stop before building');
      },
      { platform: 'darwin', runSecurity: () => '' },
    ),
    /Select one/,
  );
});
