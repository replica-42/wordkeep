import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { SettingsStore } from '../src/main/settings';

let root: string;
let profile: string;
let store: SettingsStore;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wordkeep-settings-'));
  profile = join(root, 'profile');
  await mkdir(join(root, 'models'));
  await writeFile(join(root, 'stopwords.txt'), '真的\n');
  await writeFile(join(root, 'dict.txt'), '初音未来\n');
  await writeFile(
    join(root, 'config.json'),
    JSON.stringify({
      analysis: {
        hanlp_home: 'models',
        stopwords_path: 'stopwords.txt',
        dictionary_path: 'dict.txt',
        batch_size: 32,
      },
      wordcloud: { width: 1920 },
    }),
  );
  store = new SettingsStore(root, profile);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
it('沿用已有用户词表，路径和批量持久化，重建实例后恢复设置', async () => {
  const initial = await store.load();
  await writeFile(initial.analysis.dictionary_path, '初音未来\n海边\n');
  expect((await store.load()).analysis).toEqual(initial.analysis);
  const selected = join(root, 'chosen.txt');
  await writeFile(selected, '\uFEFF夕阳\r\n夕阳\n');
  const saved = await store.save({
    ...initial.analysis,
    dictionary_path: selected,
    batch_size: 16,
  });
  expect(saved.wordLists.dictionary).toBe('夕阳\n');
  expect((await new SettingsStore(root, profile).load()).analysis).toEqual(
    saved.analysis,
  );
  expect(await readFile(initial.analysis.dictionary_path, 'utf8')).toBe(
    '初音未来\n海边\n',
  );
  expect(await readFile(join(root, 'dict.txt'), 'utf8')).toBe('初音未来\n');
  expect(await readFile(selected, 'utf8')).toBe('\uFEFF夕阳\r\n夕阳\n');
});
it('拒绝无效批量、缺失资源、控制字符和错误编码，保留之前保存的配置', async () => {
  const { analysis } = await store.load();
  await store.save(analysis);
  const before = await readFile(store.path, 'utf8');
  for (const batch_size of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    await expect(store.save({ ...analysis, batch_size })).rejects.toThrow(
      '整数',
    );
  }
  await expect(
    store.save({ ...analysis, hanlp_home: join(root, 'missing') }),
  ).rejects.toThrow();
  await expect(
    store.save({ ...analysis, hanlp_home: analysis.dictionary_path }),
  ).rejects.toThrow('目录');
  const invalid = join(root, 'invalid.txt');
  await writeFile(invalid, '错误\t内容');
  await expect(
    store.save({ ...analysis, stopwords_path: invalid }),
  ).rejects.toThrow('第 1 行');
  await writeFile(invalid, Buffer.from([0xff]));
  await expect(
    store.save({ ...analysis, stopwords_path: invalid }),
  ).rejects.toThrow('UTF-8');
  expect(await readFile(store.path, 'utf8')).toBe(before);
});
it('拒绝词典和停用词指向同一文件，包括符号链接', async () => {
  const { analysis } = await store.load();
  await expect(
    store.save({ ...analysis, stopwords_path: analysis.dictionary_path }),
  ).rejects.toThrow('同一个文件');
  const alias = join(root, 'alias.txt');
  await symlink(analysis.dictionary_path, alias);
  await expect(
    store.save({ ...analysis, stopwords_path: alias }),
  ).rejects.toThrow('同一个文件');
});

it('默认创建空词表，不使用资源中的个人词表；保存后移动安装目录仍可定位', async () => {
  const initial = await store.load();
  expect(await readFile(initial.analysis.dictionary_path, 'utf8')).toBe('');
  expect(await readFile(initial.analysis.stopwords_path, 'utf8')).toBe('');
  await store.save(initial.analysis);
  const persisted = JSON.parse(await readFile(store.path, 'utf8'));
  expect(persisted.analysis.hanlp_home).toBe('models');
  expect(persisted.analysis.dictionary_path).toBe('');
  const moved = join(root, 'moved');
  await mkdir(join(moved, 'models'), { recursive: true });
  await writeFile(
    join(moved, 'config.json'),
    await readFile(join(root, 'config.json')),
  );
  const next = await new SettingsStore(moved, profile).load();
  expect(next.analysis.hanlp_home).toBe(join(moved, 'models'));
  expect(next.analysis.dictionary_path).toBe(initial.analysis.dictionary_path);
});
it('日志级别独立保存，更新分析配置时不会丢失', async () => {
  expect((await store.load()).runtime.log_level).toBe('WARNING');
  await store.saveRuntime({ log_level: 'DEBUG' });
  await store.save((await store.load()).analysis);
  expect(
    (await new SettingsStore(root, profile).load()).runtime.log_level,
  ).toBe('DEBUG');
  await expect(
    store.saveRuntime({ log_level: 'invalid' as 'WARNING' }),
  ).rejects.toThrow('日志级别');
});
