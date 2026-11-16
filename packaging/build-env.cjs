function buildEnvironment(source = process.env, platform = process.platform) {
  const env = { ...source };
  for (const name of Object.keys(env)) {
    if (platform === 'darwin' && name.startsWith('WIN_CSC_')) delete env[name];
    if (
      platform === 'win32' &&
      /^(CSC_|APPLE_|WORDKEEP_CODESIGN_IDENTITY$)/.test(name)
    )
      delete env[name];
  }
  // GitHub Actions expands unconfigured secrets to empty strings.
  for (const name of [
    'CSC_LINK',
    'CSC_INSTALLER_LINK',
    'CSC_NAME',
    'CSC_KEYCHAIN',
    'WIN_CSC_LINK',
    'WORDKEEP_CODESIGN_IDENTITY',
    'APPLE_ID',
    'APPLE_APP_SPECIFIC_PASSWORD',
    'APPLE_TEAM_ID',
  ]) {
    if (env[name]?.trim() === '') delete env[name];
  }
  if (
    platform === 'darwin' &&
    !env.CSC_LINK &&
    !env.CSC_NAME &&
    !env.CSC_KEYCHAIN &&
    !env.WORDKEEP_CODESIGN_IDENTITY
  )
    env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  // Apply the compression level from electron-builder.yml consistently.
  delete env.ELECTRON_BUILDER_COMPRESSION_LEVEL;
  return env;
}

module.exports = { buildEnvironment };
