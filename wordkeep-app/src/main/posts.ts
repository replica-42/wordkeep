import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { BlogDocument, BlogPost, DateRange } from '../shared/api';

export function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const value = new Date(`${date}T00:00:00Z`);
  return (
    Number.isFinite(value.getTime()) &&
    value.toISOString().slice(0, 10) === date
  );
}

export function parsePosts(content: string): BlogPost[] {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const ids = new Set<string>();
  const posts = lines.map((line, index): BlogPost => {
    const fail = (message: string): never => {
      throw new Error(`第 ${index + 1} 行：${message}`);
    };
    if (!line.trim()) fail('空行不是有效的博文记录。');
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      fail('JSON 格式无效，请检查这一行。');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return fail('需要一个 JSON 对象。');
    const row = value as Record<string, unknown>;
    const id =
      typeof row.id === 'number' && Number.isSafeInteger(row.id)
        ? String(row.id)
        : row.id;
    if (typeof id !== 'string' || !id.trim())
      return fail('id 必须是非空字符串或安全整数。');
    if (ids.has(id)) fail(`博文 id「${id}」重复，请先清理重复记录。`);
    const text = 'text' in row ? row.text : row.content;
    if (typeof text !== 'string' || !text.trim())
      return fail('正文 text / content 不能为空。');
    const createdAt = 'created_at' in row ? row.created_at : row.create_at;
    if (typeof createdAt !== 'string')
      return fail('缺少日期 created_at / create_at。');
    const match =
      /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2}))?)?$/.exec(
        createdAt,
      );
    if (
      !match?.[1] ||
      !validDate(match[1]) ||
      Number(match[2] ?? 0) > 23 ||
      Number(match[3] ?? 0) > 59 ||
      Number(match[4] ?? 0) > 59 ||
      Number(match[5] ?? 0) > 23 ||
      Number(match[6] ?? 0) > 59
    ) {
      return fail('日期无效，请使用 YYYY-MM-DD 或 ISO 日期时间。');
    }
    ids.add(id);
    return { id, text, createdAt, date: match[1] };
  });
  if (!posts.length) throw new Error('文件中没有博文。');
  return posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readPosts(path: string): Promise<BlogDocument> {
  const buffer = await readFile(path);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new Error('文件不是有效的 UTF-8 文本，请转换编码后重试。');
  }
  return {
    name: basename(path),
    byteSize: buffer.byteLength,
    posts: parsePosts(text),
  };
}

export function filterPosts(posts: BlogPost[], range: DateRange): BlogPost[] {
  if (!validDate(range.from) || !validDate(range.to) || range.from > range.to) {
    throw new Error('请选择有效的时间范围，开始日期不能晚于结束日期。');
  }
  return posts.filter(
    (post) => post.date >= range.from && post.date <= range.to,
  );
}
