import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { FileLogger, LOG_BYTES } from '../src/main/logging';

it('默认过滤信息日志，并按字节轮转；超长中文消息不会突破文件上限', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wordkeep-log-'));
  try {
    expect(LOG_BYTES).toBeLessThanOrEqual(25_000_000);
    const path = join(root, 'desktop.log');
    const logger = new FileLogger(path, 200, 3);
    logger.write('INFO', '不应保存');
    expect(await readdir(root)).toEqual([]);
    logger.write('WARNING', '警告');
    expect(await readFile(path, 'utf8')).toContain('警告');
    logger.setLevel('DEBUG');
    logger.write('DEBUG', '调试');
    expect(await readFile(path, 'utf8')).toContain('调试');
    for (let i = 0; i < 12; i++) logger.write('ERROR', '中文'.repeat(500));
    const files = await readdir(root);
    expect(files.length).toBe(4);
    for (const file of files) {
      expect((await stat(join(root, file))).size).toBeLessThanOrEqual(200);
      const bytes = await readFile(join(root, file));
      expect(() =>
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      ).not.toThrow();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
