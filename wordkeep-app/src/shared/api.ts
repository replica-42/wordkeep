export interface BlogPost {
  id: string;
  text: string;
  createdAt: string;
  date: string;
}

export interface BlogDocument {
  name: string;
  byteSize: number;
  posts: BlogPost[];
}

export interface DateRange {
  from: string;
  to: string;
}
export interface Term {
  text: string;
  occurrences: number;
  document_count: number;
  sources: string[];
  examples: string[];
}
export interface AnalysisResult {
  frequencies: Record<string, number>;
  terms: Term[];
  post_count: number;
  sentence_count: number;
}
export interface FontOption {
  name: string;
  path: string;
}
export interface CloudSettings {
  font_path: string;
  width: number;
  height: number;
  max_words: number;
  colormap: string;
  scale: number;
}
export interface MaskImage {
  name: string;
  base64: string;
  width: number;
  height: number;
}
export interface CloudImage {
  png_base64: string;
  width: number;
  height: number;
  rendered_words: string[];
}
export interface AnalysisSettings {
  hanlp_home: string;
  stopwords_path: string;
  dictionary_path: string;
  batch_size: number;
}
export const LOG_LEVELS = ['ERROR', 'WARNING', 'INFO', 'DEBUG'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export interface RuntimeSettings {
  log_level: LogLevel;
}
export type ResourceSetting = Exclude<keyof AnalysisSettings, 'batch_size'>;
export interface SavedSettings {
  analysis: AnalysisSettings;
  wordLists: WordLists;
}
export type WordListKind = 'stopwords' | 'dictionary';
export type WordLists = Record<WordListKind, string>;
export interface Bootstrap {
  fonts: FontOption[];
  colormaps: string[];
  settings: CloudSettings;
  wordLists: WordLists;
}
export type MenuCommand =
  | 'open'
  | 'settings'
  | 'analyze'
  | 'generate'
  | 'export'
  | 'cancel'
  | 'terms'
  | 'posts'
  | 'reset-layout';
export interface MenuState {
  canOpen: boolean;
  canSettings: boolean;
  canAnalyze: boolean;
  canGenerate: boolean;
  canExport: boolean;
  canCancel: boolean;
  canView: boolean;
  inSettings: boolean;
  details: 'terms' | 'posts';
}
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string };
export interface DesktopAPI {
  bootstrap(): Promise<Reply<Bootstrap>>;
  openPosts(): Promise<Reply<BlogDocument | null>>;
  analyze(range: DateRange): Promise<Reply<AnalysisResult>>;
  generate(
    settings: CloudSettings,
    mask: MaskImage | null,
  ): Promise<Reply<CloudImage>>;
  chooseFont(): Promise<Reply<FontOption | null>>;
  chooseMask(): Promise<Reply<MaskImage | null>>;
  saveImage(): Promise<Reply<string | null>>;
  readSettings(): Promise<Reply<AnalysisSettings>>;
  saveSettings(settings: AnalysisSettings): Promise<Reply<SavedSettings>>;
  readRuntimeSettings(): Promise<Reply<RuntimeSettings>>;
  saveRuntimeSettings(
    settings: RuntimeSettings,
  ): Promise<Reply<RuntimeSettings>>;
  clearCache(): Promise<Reply<null>>;
  chooseResource(setting: ResourceSetting): Promise<Reply<string | null>>;
  readWordList(kind: WordListKind): Promise<Reply<string>>;
  saveWordList(kind: WordListKind, text: string): Promise<Reply<WordLists>>;
  cancel(): Promise<Reply<null>>;
  updateMenu(state: MenuState): Promise<Reply<null>>;
  onMenuCommand(callback: (command: MenuCommand) => void): () => void;
}
