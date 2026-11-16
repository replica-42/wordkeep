import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { filterPosts, parsePosts, readPosts } from '../src/main/posts';

const row = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: 'one',
    content: '喜欢音乐。',
    create_at: '2026-11-01 10:20:30',
    ...overrides,
  });
let directory: string | undefined;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
describe('博文导入', () => {
  it('读取兼容字段和标准字段，并按日期倒序排列', () => {
    const posts = parsePosts(
      `\uFEFF${row()}\r\n${JSON.stringify({ id: 2, text: '今天去海边。', created_at: '2026-11-02T01:00:00+08:00' })}\r\n`,
    );
    expect(posts.map((p) => [p.id, p.text, p.date])).toEqual([
      ['2', '今天去海边。', '2026-11-02'],
      ['one', '喜欢音乐。', '2026-11-01'],
    ]);
  });
  it.each([
    ['{', 'JSON 格式无效'],
    ['', '空行'],
    ['[]', 'JSON 对象'],
    [row({ id: null }), 'id 必须'],
    [row({ content: ' ' }), '正文'],
    [row({ create_at: '2026-02-30' }), '日期无效'],
    [row({ create_at: '2026-11-01 24:10:00' }), '日期无效'],
    [row({ create_at: null }), '缺少日期'],
  ])('遇到无效记录立即中断并指出行号：%s', (bad, message) => {
    expect(() =>
      parsePosts(`${row({ id: 'first' })}\n${bad}\n${row({ id: 'three' })}`),
    ).toThrow(`第 2 行：`);
    expect(() =>
      parsePosts(`${row({ id: 'first' })}\n${bad}\n${row({ id: 'three' })}`),
    ).toThrow(message);
  });
  it('拒绝重复 ID，包括数值与字符串的同一 ID', () => {
    expect(() =>
      parsePosts(`${row({ id: 123 })}\n${row({ id: '123' })}`),
    ).toThrow('重复');
  });
  it('日期范围包含两端，按原始日期而非本机时区筛选', () => {
    const posts = parsePosts(
      [
        row({ id: 'a', create_at: '2026-11-01T00:00:00+08:00' }),
        row({ id: 'b', create_at: '2026-11-02' }),
        row({ id: 'c', create_at: '2026-11-03' }),
      ].join('\n'),
    );
    expect(
      filterPosts(posts, { from: '2026-11-01', to: '2026-11-02' }).map(
        (p) => p.id,
      ),
    ).toEqual(['b', 'a']);
    expect(() =>
      filterPosts(posts, { from: '2026-11-02', to: '2026-11-01' }),
    ).toThrow('时间范围');
  });
  it('拒绝非 UTF-8 文件', async () => {
    directory = await mkdtemp(join(tmpdir(), 'wordkeep-posts-'));
    const path = join(directory, 'invalid.jsonl');
    await writeFile(path, Buffer.from([0xff, 0xfe, 0xff]));
    await expect(readPosts(path)).rejects.toThrow('UTF-8');
  });
});
