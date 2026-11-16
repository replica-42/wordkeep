import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WordListKind, WordLists } from '../shared/api';

export function normalizeWordList(text: string): string {
  const words = new Set<string>();
  for (const [index, line] of text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .entries()) {
    const word = line.trim();
    if ([...word].some((character) => character.charCodeAt(0) < 32))
      throw new Error(
        `第 ${index + 1} 行含有制表符或控制字符，请一行填写一个词。`,
      );
    if (word) words.add(word);
  }
  return words.size ? `${[...words].join('\n')}\n` : '';
}

export async function readWordList(path: string): Promise<string> {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(
      await readFile(path),
    );
  } catch (error) {
    if (error instanceof TypeError)
      throw new Error('词表必须使用 UTF-8 编码。');
    throw error;
  }
  return normalizeWordList(text);
}

export async function atomicWrite(path: string, text: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export class WordListStore {
  readonly paths: Record<WordListKind, string>;
  constructor(
    private readonly directory: string,
    paths?: Record<WordListKind, string>,
  ) {
    this.paths = paths ?? {
      stopwords: join(directory, 'stopwords.txt'),
      dictionary: join(directory, 'dict.txt'),
    };
  }
  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    for (const kind of ['stopwords', 'dictionary'] as const) {
      try {
        await writeFile(this.paths[kind], '', { encoding: 'utf8', flag: 'wx' });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
  }
  async read(): Promise<WordLists> {
    const [stopwords, dictionary] = await Promise.all([
      readWordList(this.paths.stopwords),
      readWordList(this.paths.dictionary),
    ]);
    return { stopwords, dictionary };
  }
  async save(kind: WordListKind, text: string): Promise<WordLists> {
    if (kind !== 'stopwords' && kind !== 'dictionary')
      throw new Error('未知词表。');
    const normalized = normalizeWordList(text);
    const lists = await this.read();
    await atomicWrite(this.paths[kind], normalized);
    return { ...lists, [kind]: normalized };
  }
}
