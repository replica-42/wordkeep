import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { Application } from '../src/main/application';
import { PythonWorker } from '../src/main/python-worker';

it('清理缓存会等待后端退出，保留用户词表、配置、日志和模型', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wordkeep-maintenance-'));
  const profile = join(root, 'user');
  const shutdown = vi
    .spyOn(PythonWorker.prototype, 'shutdown')
    .mockResolvedValue();
  try {
    for (const path of [
      'user/cache/python',
      'user/wordlists',
      'user/logs',
      'data/hanlp',
    ])
      await mkdir(join(root, path), { recursive: true });
    for (const path of [
      'user/cache/python/font.json',
      'user/wordlists/dict.txt',
      'user/config.json',
      'user/logs/backend.log',
      'data/hanlp/model.pt',
    ])
      await writeFile(join(root, path), 'keep');
    const app = new Application(root, profile, 'unused');
    const clearBrowser = vi.fn(async () => {
      expect(shutdown).toHaveBeenCalledTimes(1);
    });
    await app.clearCache(clearBrowser);
    expect(clearBrowser).toHaveBeenCalledTimes(1);
    await expect(
      readFile(join(profile, 'cache/python/font.json')),
    ).rejects.toThrow();
    for (const path of [
      'user/wordlists/dict.txt',
      'user/config.json',
      'user/logs/backend.log',
      'data/hanlp/model.pt',
    ])
      expect(await readFile(join(root, path), 'utf8')).toBe('keep');
  } finally {
    shutdown.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});
