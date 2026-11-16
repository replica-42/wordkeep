import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type {
  AnalysisSettings,
  CloudSettings,
  RuntimeSettings,
  WordLists,
} from '../shared/api';
import { LOG_LEVELS } from '../shared/api';
import { atomicWrite, readWordList, WordListStore } from './word-lists';

export function resolveSettings(
  value: AnalysisSettings,
  root: string,
  userData = root,
): AnalysisSettings {
  if (!value || !Number.isSafeInteger(value.batch_size) || value.batch_size < 1)
    throw new Error('分析批量必须是大于等于 1 的整数。');
  const path = (key: 'hanlp_home' | 'stopwords_path' | 'dictionary_path') => {
    const input = value[key];
    if (typeof input !== 'string') throw new Error('资源路径必须是字符串。');
    if (!input.trim())
      return key === 'hanlp_home'
        ? join(root, 'data', 'hanlp')
        : join(
            userData,
            'wordlists',
            key === 'dictionary_path' ? 'dict.txt' : 'stopwords.txt',
          );
    return resolve(
      root,
      input.startsWith('~/') ? join(homedir(), input.slice(2)) : input,
    );
  };
  const settings = {
    hanlp_home: path('hanlp_home'),
    stopwords_path: path('stopwords_path'),
    dictionary_path: path('dictionary_path'),
    batch_size: value.batch_size,
  };
  if (settings.stopwords_path === settings.dictionary_path)
    throw new Error('个人词典和停用词不能使用同一个文件。');
  return settings;
}

function runtimeSettings(value?: Partial<RuntimeSettings>): RuntimeSettings {
  const log_level = value?.log_level ?? 'WARNING';
  if (!LOG_LEVELS.includes(log_level)) throw new Error('日志级别无效。');
  return { log_level };
}
interface StoredConfig {
  analysis?: AnalysisSettings;
  runtime?: RuntimeSettings;
}
export class SettingsStore {
  readonly path: string;
  constructor(
    private readonly root: string,
    private readonly userData: string,
  ) {
    this.path = join(userData, 'config.json');
  }
  private async stored(): Promise<StoredConfig> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as StoredConfig;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return {};
    }
  }
  async load(): Promise<{
    analysis: AnalysisSettings;
    wordcloud: Partial<CloudSettings>;
    runtime: RuntimeSettings;
  }> {
    const defaults = JSON.parse(
      await readFile(join(this.root, 'config.json'), 'utf8'),
    ) as {
      analysis: AnalysisSettings;
      wordcloud: Partial<CloudSettings>;
      runtime?: RuntimeSettings;
    };
    const saved = await this.stored();
    const words = new WordListStore(join(this.userData, 'wordlists'));
    await words.initialize();
    const initial = {
      ...defaults.analysis,
      stopwords_path: '',
      dictionary_path: '',
      batch_size: defaults.analysis.batch_size ?? 32,
    };
    return {
      analysis: resolveSettings(
        saved.analysis ?? initial,
        this.root,
        this.userData,
      ),
      wordcloud: defaults.wordcloud,
      runtime: runtimeSettings(saved.runtime ?? defaults.runtime),
    };
  }
  private async persist(value: StoredConfig): Promise<void> {
    await mkdir(this.userData, { recursive: true });
    await atomicWrite(this.path, `${JSON.stringify(value, null, 2)}\n`);
  }
  async saveRuntime(input: RuntimeSettings): Promise<RuntimeSettings> {
    const runtime = runtimeSettings(input);
    await this.persist({ ...(await this.stored()), runtime });
    return runtime;
  }
  async save(
    input: AnalysisSettings,
  ): Promise<{ analysis: AnalysisSettings; wordLists: WordLists }> {
    const analysis = resolveSettings(input, this.root, this.userData);
    if (!(await stat(analysis.hanlp_home)).isDirectory())
      throw new Error('模型资源路径必须是目录。');
    const [stopwords, dictionary, stopwordsReal, dictionaryReal] =
      await Promise.all([
        readWordList(analysis.stopwords_path),
        readWordList(analysis.dictionary_path),
        realpath(analysis.stopwords_path),
        realpath(analysis.dictionary_path),
      ]);
    if (stopwordsReal === dictionaryReal)
      throw new Error('个人词典和停用词不能使用同一个文件。');
    const managed = new WordListStore(join(this.userData, 'wordlists')).paths;
    const model = relative(this.root, analysis.hanlp_home);
    const persisted = {
      ...analysis,
      hanlp_home:
        !isAbsolute(model) && model !== '..' && !model.startsWith(`..${sep}`)
          ? model.split(sep).join('/')
          : analysis.hanlp_home,
      dictionary_path:
        analysis.dictionary_path === managed.dictionary
          ? ''
          : analysis.dictionary_path,
      stopwords_path:
        analysis.stopwords_path === managed.stopwords
          ? ''
          : analysis.stopwords_path,
    };
    await this.persist({ ...(await this.stored()), analysis: persisted });
    return { analysis, wordLists: { stopwords, dictionary } };
  }
}
