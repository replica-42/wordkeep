const { rmSync, readdirSync } = require('node:fs');
const { resolve, join } = require('node:path');

const root = resolve(__dirname, '..');
for (const name of [
  'out',
  'coverage',
  'node_modules/.vite',
  'node_modules/.vitest',
]) {
  rmSync(join(root, name), { recursive: true, force: true });
}
for (const name of readdirSync(root)) {
  if (name.endsWith('.tsbuildinfo')) rmSync(join(root, name), { force: true });
}
