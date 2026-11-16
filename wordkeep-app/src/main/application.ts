import { mkdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type {
  AnalysisResult,
  AnalysisSettings,
  BlogDocument,
  Bootstrap,
  CloudImage,
  CloudSettings,
  DateRange,
  FontOption,
  MaskImage,
  RuntimeSettings,
  SavedSettings,
  WordListKind,
  WordLists,
} from '../shared/api';
import { filterPosts, readPosts } from './posts';
import { PythonWorker } from './python-worker';
import { SettingsStore } from './settings';
import { readWordList, WordListStore } from './word-lists';

export class Application {
  private readonly worker: PythonWorker;
  private words!: WordListStore;
  private readonly preferences: SettingsStore;
  private prepared: Promise<void> | null = null;
  private initialized: Promise<unknown> | null = null;
  private analysisConfig!: AnalysisSettings;
  private settings: CloudSettings = {
    font_path: '',
    width: 1920,
    height: 1080,
    max_words: 400,
    colormap: 'ocean',
    scale: 1,
  };
  private fonts: FontOption[] = [];
  private customFonts = new Set<string>();
  private document: BlogDocument | null = null;
  private analysis: AnalysisResult | null = null;
  private image: CloudImage | null = null;
  private range: DateRange | null = null;
  private active: symbol | null = null;
  private generation = 0;

  constructor(
    private readonly resourceRoot: string,
    private readonly userData: string,
    executable: string,
    args = ['-u', '-m', 'wordkeep_backend.interfaces.http'],
  ) {
    this.worker = new PythonWorker({
      executable,
      args,
      userData,
      cwd: resourceRoot,
    });
    this.preferences = new SettingsStore(resourceRoot, userData);
  }

  private async prepare(): Promise<void> {
    if (!this.prepared) {
      this.prepared = (async () => {
        const config = await this.preferences.load();
        this.applySettings(config.analysis);
        this.worker.setLogLevel(config.runtime.log_level);
        this.settings = { ...this.settings, ...config.wordcloud };
      })().catch((error) => {
        this.prepared = null;
        throw error;
      });
    }
    await this.prepared;
  }

  private applySettings(settings: AnalysisSettings): void {
    this.analysisConfig = settings;
    this.words = new WordListStore('', {
      stopwords: settings.stopwords_path,
      dictionary: settings.dictionary_path,
    });
  }

  async readSettings(): Promise<AnalysisSettings> {
    await this.prepare();
    return { ...this.analysisConfig };
  }

  async readRuntimeSettings(): Promise<RuntimeSettings> {
    return (await this.preferences.load()).runtime;
  }

  async saveRuntimeSettings(
    settings: RuntimeSettings,
  ): Promise<RuntimeSettings> {
    return this.task(async () => {
      const value = await this.preferences.saveRuntime(settings);
      await this.worker.shutdown();
      this.initialized = null;
      this.worker.setLogLevel(value.log_level);
      return value;
    });
  }

  async clearCache(clearBrowserCache: () => Promise<void>): Promise<null> {
    return this.task(async () => {
      await this.worker.shutdown();
      this.initialized = null;
      await clearBrowserCache();
      for (const folder of ['cache/python', 'cache/crashes', 'runtime']) {
        const path = join(this.userData, folder);
        await rm(path, { recursive: true, force: true });
        await mkdir(path, { recursive: true });
      }
      return null;
    });
  }

  async shutdown(): Promise<void> {
    this.cancel();
    await this.worker.shutdown();
  }

  async readWordList(kind: WordListKind): Promise<string> {
    await this.prepare();
    if (kind !== 'stopwords' && kind !== 'dictionary')
      throw new Error('未知词表。');
    return readWordList(this.words.paths[kind]);
  }

  async saveSettings(settings: AnalysisSettings): Promise<SavedSettings> {
    return this.task(async (assertActive) => {
      await this.prepare();
      assertActive();
      const result = await this.preferences.save(settings);
      this.applySettings(result.analysis);
      this.invalidateAnalysis();
      return result;
    });
  }

  private invalidateAnalysis(): void {
    ++this.generation;
    this.worker.stop();
    this.initialized = null;
    this.analysis = null;
    this.image = null;
  }

  private async initialize(): Promise<void> {
    const generation = this.generation;
    await this.prepare();
    if (generation !== this.generation) throw new Error('操作已取消。');
    if (!this.worker.isRunning) this.initialized = null;
    if (!this.initialized)
      this.initialized = this.worker
        .request('initialize', {
          resource_root: this.resourceRoot,
          analysis: this.analysisConfig,
        })
        .catch((error) => {
          this.initialized = null;
          throw error;
        });
    await this.initialized;
  }

  async bootstrap(): Promise<Bootstrap> {
    try {
      await this.initialize();
      const [fonts, colormaps, wordLists] = await Promise.all([
        this.worker.request<FontOption[]>('fonts.list'),
        this.worker.request<string[]>('colormaps.list'),
        this.words.read(),
      ]);
      this.fonts = fonts;
      return { fonts, colormaps, wordLists, settings: this.settings };
    } catch (error) {
      this.initialized = null;
      throw error;
    }
  }

  async open(path: string): Promise<BlogDocument> {
    if (this.active) throw new Error('请先等待当前操作完成，或取消操作。');
    const document = await readPosts(path);
    this.document = document;
    this.analysis = null;
    this.image = null;
    return document;
  }

  private async task<T>(
    action: (assertActive: () => void) => Promise<T>,
  ): Promise<T> {
    if (this.active) throw new Error('另一个操作尚未完成。');
    const token = Symbol();
    this.active = token;
    try {
      return await action(() => {
        if (this.active !== token) throw new Error('操作已取消。');
      });
    } catch (error) {
      if (this.active === token) this.initialized = null;
      throw error;
    } finally {
      if (this.active === token) this.active = null;
    }
  }

  async analyze(range: DateRange): Promise<AnalysisResult> {
    if (!this.document) throw new Error('请先导入博文。');
    const posts = filterPosts(this.document.posts, range);
    if (!posts.length) throw new Error('所选时间范围内没有博文。');
    return this.task(async (assertActive) => {
      await this.initialize();
      assertActive();
      const result = await this.worker.request<AnalysisResult>(
        'analysis.analyze',
        { posts: posts.map(({ id, text }) => ({ id, text })) },
      );
      assertActive();
      this.analysis = result;
      this.range = range;
      this.image = null;
      return result;
    });
  }

  registerFont(path: string): FontOption {
    this.customFonts.add(path);
    return { name: basename(path), path };
  }

  async generate(
    settings: CloudSettings,
    mask: MaskImage | null,
  ): Promise<CloudImage> {
    const analysis = this.analysis;
    if (!analysis) throw new Error('请先完成词频分析。');
    if (
      !this.fonts.some((font) => font.path === settings.font_path) &&
      !this.customFonts.has(settings.font_path)
    )
      throw new Error('请选择系统字体或导入字体文件。');
    return this.task(async (assertActive) => {
      await this.initialize();
      assertActive();
      const image = await this.worker.request<CloudImage>(
        'wordcloud.generate',
        {
          frequencies: analysis.frequencies,
          config: settings,
          mask_base64: mask?.base64 ?? null,
        },
      );
      assertActive();
      this.image = image;
      return image;
    });
  }

  exportImage(): { data: Buffer; name: string } {
    if (this.active || !this.image) throw new Error('请先生成词云预览。');
    const stem = this.document?.name.replace(/\.[^.]+$/, '') ?? 'wordcloud';
    return {
      data: Buffer.from(this.image.png_base64, 'base64'),
      name: `${stem}${this.range ? `_${this.range.from}_${this.range.to}` : ''}.png`,
    };
  }

  async saveWordList(kind: WordListKind, text: string): Promise<WordLists> {
    return this.task(async (assertActive) => {
      await this.prepare();
      assertActive();
      const result = await this.words.save(kind, text);
      this.invalidateAnalysis();
      return result;
    });
  }

  cancel(): void {
    ++this.generation;
    this.worker.stop();
    this.initialized = null;
    this.active = null;
  }
}
