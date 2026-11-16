const { existsSync, readFileSync, statSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { Arch } = require('builder-util');

module.exports = async function checkResources(context) {
  const root = resolve(__dirname, '../wordkeep-backend/dist/wordkeep-backend');
  if (!existsSync(join(root, 'build-manifest.json')))
    throw new Error('Build wordkeep-backend before packaging.');
  const manifest = JSON.parse(
    readFileSync(join(root, 'build-manifest.json'), 'utf8'),
  );
  if (
    manifest.platform !== context.electronPlatformName ||
    manifest.arch !== Arch[context.arch] ||
    manifest.mode !== 'onedir' ||
    manifest.runtime_compression !== false
  )
    throw new Error(
      'Backend platform, architecture or compression mode does not match this build.',
    );
  const executable =
    context.electronPlatformName === 'win32'
      ? 'wordkeep-backend.exe'
      : 'wordkeep-backend';
  for (const name of [
    executable,
    'config.json',
    'licenses/THIRD_PARTY_NOTICES.md',
    'licenses/packages.json',
    'data/model-manifest.json',
  ]) {
    if (!statSync(join(root, name)).isFile())
      throw new Error(`Missing release file: ${name}`);
  }
  if (!statSync(join(root, '_internal')).isDirectory())
    throw new Error('Backend must be an expanded onedir bundle.');
  for (const name of ['data/dict.txt', 'data/stopwords.txt']) {
    if (existsSync(join(root, name)))
      throw new Error('Wordlists must not be bundled.');
  }
};
