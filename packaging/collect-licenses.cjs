const {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} = require('node:fs');
const { join } = require('node:path');

function collectLicenses(root) {
  const app = join(root, 'wordkeep-app');
  const target = join(root, 'build/app-resources/licenses');
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  copyFileSync(join(root, 'LICENSE'), join(target, 'Wordkeep-LICENSE.txt'));
  for (const name of ['THIRD_PARTY_NOTICES.md', 'Remix-Icon-NOTICE.txt'])
    copyFileSync(join(root, 'packaging', name), join(target, name));
  const pending = Object.keys(
    JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).dependencies,
  );
  const seen = new Set();
  const packages = [];
  while (pending.length) {
    const name = pending.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    const directory = join(app, 'node_modules', name);
    const metadata = JSON.parse(
      readFileSync(join(directory, 'package.json'), 'utf8'),
    );
    pending.push(...Object.keys(metadata.dependencies ?? {}));
    const notices = readdirSync(directory, { withFileTypes: true }).filter(
      (entry) =>
        entry.isFile() && /^(license|licence|copying|notice)/i.test(entry.name),
    );
    const paths = [];
    for (const entry of notices) {
      const destination = join(target, 'npm', name);
      mkdirSync(destination, { recursive: true });
      copyFileSync(join(directory, entry.name), join(destination, entry.name));
      paths.push(`npm/${name}/${entry.name}`);
    }
    if (!paths.length && name === '@remixicon/react')
      paths.push('Remix-Icon-NOTICE.txt');
    if (!paths.length) throw new Error(`Missing license text for ${name}`);
    packages.push({
      name,
      version: metadata.version,
      license: metadata.license,
      license_files: paths,
    });
  }
  require('node:fs').writeFileSync(
    join(target, 'packages.json'),
    `${JSON.stringify(packages, null, 2)}\n`,
  );
}
module.exports = { collectLicenses };
