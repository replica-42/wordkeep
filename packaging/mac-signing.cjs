const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

function security(args) {
  const result = spawnSync('/usr/bin/security', args, { encoding: 'utf8' });
  // Do not include command arguments: import and unlock commands carry passwords.
  if (result.error || result.status !== 0)
    throw new Error(
      `security ${args[0]} failed: ${result.error?.code ?? result.stderr.trim()}`,
    );
  return result.stdout;
}

function selectIdentity(output, requested) {
  const identities = [
    ...output.matchAll(
      /^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"(Developer ID Application: [^"]+)"/gm,
    ),
  ]
    .map((match) => ({ hash: match[1], name: match[2] }))
    .filter(
      ({ hash, name }) =>
        !requested || hash === requested || name === requested,
    );
  if (identities.length !== 1)
    throw new Error(
      'Select one valid Developer ID Application certificate with WORDKEEP_CODESIGN_IDENTITY.',
    );
  return identities[0].hash;
}

async function withMacSigning(
  env,
  root,
  build,
  {
    platform = process.platform,
    runSecurity = security,
    loadCertificate = async (link, temporary, directory) => {
      const {
        importCertificate,
      } = require('app-builder-lib/out/codeSign/codesign');
      return importCertificate(link, temporary, directory);
    },
  } = {},
) {
  if (
    platform !== 'darwin' ||
    !(
      env.CSC_LINK ||
      env.WORDKEEP_CODESIGN_IDENTITY ||
      env.CSC_NAME ||
      env.CSC_KEYCHAIN
    )
  )
    return build(env);

  let directory;
  let temporary;
  let previousKeychains;
  let created = false;
  let keychain = env.CSC_KEYCHAIN;
  try {
    if (env.CSC_LINK) {
      const { TmpDir } = require('temp-file');
      temporary = new TmpDir('wordkeep-signing');
      directory = await mkdtemp(join(tmpdir(), 'wordkeep-signing-'));
      keychain = join(directory, 'build.keychain-db');
      const certificate = await loadCertificate(env.CSC_LINK, temporary, root);
      previousKeychains = [
        ...runSecurity(['list-keychains', '-d', 'user']).matchAll(/"([^"]+)"/g),
      ].map((match) => match[1]);
      const password = randomBytes(32).toString('hex');
      runSecurity(['create-keychain', '-p', password, keychain]);
      created = true;
      runSecurity(['set-keychain-settings', '-lut', '21600', keychain]);
      runSecurity(['unlock-keychain', '-p', password, keychain]);
      runSecurity([
        'import',
        certificate,
        '-k',
        keychain,
        '-P',
        env.CSC_KEY_PASSWORD ?? '',
        '-T',
        '/usr/bin/codesign',
      ]);
      runSecurity([
        'set-key-partition-list',
        '-S',
        'apple-tool:,apple:',
        '-s',
        '-k',
        password,
        keychain,
      ]);
      runSecurity([
        'list-keychains',
        '-d',
        'user',
        '-s',
        keychain,
        ...previousKeychains,
      ]);
    }
    const identity = selectIdentity(
      runSecurity([
        'find-identity',
        '-v',
        '-p',
        'codesigning',
        ...(keychain ? [keychain] : []),
      ]),
      env.WORDKEEP_CODESIGN_IDENTITY || env.CSC_NAME,
    );
    const prepared = {
      ...env,
      WORDKEEP_CODESIGN_IDENTITY: identity,
      CSC_NAME: identity,
    };
    if (keychain) prepared.CSC_KEYCHAIN = keychain;
    // Both PyInstaller and electron-builder use the already imported identity.
    delete prepared.CSC_LINK;
    delete prepared.CSC_KEY_PASSWORD;
    delete prepared.CSC_INSTALLER_LINK;
    delete prepared.CSC_INSTALLER_KEY_PASSWORD;
    return await build(prepared);
  } finally {
    try {
      if (created) {
        try {
          runSecurity([
            'list-keychains',
            '-d',
            'user',
            '-s',
            ...previousKeychains,
          ]);
        } finally {
          runSecurity(['delete-keychain', keychain]);
        }
      }
    } finally {
      try {
        if (temporary) await temporary.cleanup();
      } finally {
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    }
  }
}

module.exports = { withMacSigning, selectIdentity };
