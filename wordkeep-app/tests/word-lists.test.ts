import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { WordListStore } from '../src/main/word-lists';

let directory: string;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
it('词表修改持久化到用户副本，不改动资源；验证失败时保留原文件', async () => {
  directory = await mkdtemp(join(tmpdir(), 'wordkeep-words-'));
  const seeds = {
    stopwords: join(directory, 'stopwords.txt'),
    dictionary: join(directory, 'dict.txt'),
  };
  await writeFile(seeds.stopwords, '真的\n');
  await writeFile(seeds.dictionary, '初音未来\n');
  const store = new WordListStore(join(directory, 'user'));
  await store.initialize();
  expect(await store.read()).toEqual({ stopwords: '', dictionary: '' });
  await store.save('stopwords', '\uFEFF真的\r\n  事情 \n事情\n');
  expect((await store.read()).stopwords).toBe('真的\n事情\n');
  await expect(store.save('stopwords', '无效\t词语')).rejects.toThrow(
    '第 1 行',
  );
  expect((await store.read()).stopwords).toBe('真的\n事情\n');
  await store.initialize();
  expect((await store.read()).stopwords).toBe('真的\n事情\n');
  expect(await readFile(seeds.stopwords, 'utf8')).toBe('真的\n');
  expect(await readdir(join(directory, 'user'))).toEqual([
    'dict.txt',
    'stopwords.txt',
  ]);
});
