import { RiCloseLine, RiFolderOpenLine } from '@remixicon/react';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  AnalysisResult,
  BlogDocument,
  Bootstrap,
  CloudImage,
  CloudSettings,
  DateRange,
  MaskImage,
  MenuCommand,
  MenuState,
  WordListKind,
  WordLists,
} from '../../shared/api';
import { APP_NAME } from '../../shared/brand';
import { CloudView } from './CloudView';
import {
  formatSize,
  imageSignature,
  selectedPosts,
  settingsError,
  unwrap,
} from './model';
import { PostsView } from './PostsView';
import { ReviewView } from './ReviewView';
import { type SettingsSection, SettingsView } from './SettingsView';
import { resetPaneLayout, SplitPane } from './SplitPane';

type TaskKind = 'import' | 'analyze' | 'generate' | 'font' | 'mask' | 'export';
interface Busy {
  kind: TaskKind;
  label: string;
}
export function App() {
  const [options, setOptions] = useState<Bootstrap | null>(null);
  const [settings, setSettings] = useState<CloudSettings | null>(null);
  const [preparing, setPreparing] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const bootPromise = useRef<{
    attempt: number;
    promise: Promise<Bootstrap>;
  } | null>(null);
  const [details, setDetails] = useState<'terms' | 'posts'>('posts');
  const [document, setDocument] = useState<BlogDocument | null>(null);
  const [documentRevision, setDocumentRevision] = useState(0);
  const [wordRevision, setWordRevision] = useState(0);
  const [range, setRange] = useState<DateRange>({ from: '', to: '' });
  const [analysis, setAnalysis] = useState<{
    value: AnalysisResult;
    signature: string;
  } | null>(null);
  const [cloud, setCloud] = useState<{
    value: CloudImage;
    signature: string;
  } | null>(null);
  const [mask, setMask] = useState<MaskImage | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const busyRef = useRef(false);
  const operation = useRef(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [settingsPage, setSettingsPage] = useState<{
    kind: SettingsSection;
    word?: string;
  } | null>(null);
  const posts = useMemo(
    () => selectedPosts(document?.posts ?? [], range),
    [document, range],
  );
  const signature = JSON.stringify([documentRevision, wordRevision, range]);
  const analysisFresh = Boolean(analysis && analysis.signature === signature);
  const layoutSignature = useMemo(
    () => (settings ? imageSignature(settings, mask) : ''),
    [settings, mask],
  );
  const cloudSignature = `${signature}:${layoutSignature}`;
  const cloudFresh = Boolean(
    cloud && analysisFresh && cloud.signature === cloudSignature,
  );

  useEffect(() => {
    let active = true;
    setPreparing(true);
    if (bootPromise.current?.attempt !== attempt) {
      bootPromise.current = {
        attempt,
        promise: window.wordkeep
          ? unwrap(window.wordkeep.bootstrap())
          : Promise.reject(
              new Error(`请在 ${APP_NAME} 桌面应用中打开此界面。`),
            ),
      };
    }
    void bootPromise.current.promise
      .then((value) => {
        if (active) {
          setOptions(value);
          setSettings(value.settings);
        }
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error ? reason.message : '无法准备应用资源。',
          );
      })
      .finally(() => {
        if (active) setPreparing(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const run = useCallback(
    async <T,>(
      kind: TaskKind,
      label: string,
      action: () => Promise<T>,
    ): Promise<T | null> => {
      if (busyRef.current) return null;
      const id = ++operation.current;
      busyRef.current = true;
      setBusy({ kind, label });
      setError('');
      setNotice('');
      try {
        const result = await action();
        return operation.current === id ? result : null;
      } catch (reason) {
        if (operation.current === id)
          setError(
            reason instanceof Error ? reason.message : '操作未完成，请重试。',
          );
        return null;
      } finally {
        if (operation.current === id) {
          busyRef.current = false;
          setBusy(null);
        }
      }
    },
    [],
  );

  const openDocument = useCallback(async () => {
    const result = await run('import', '正在读取博文…', () =>
      unwrap(window.wordkeep.openPosts()),
    );
    if (result) {
      const dates = result.posts.map((post) => post.date).sort();
      setDocument(result);
      setDocumentRevision((value) => value + 1);
      setRange({ from: dates[0] ?? '', to: dates.at(-1) ?? '' });
      setAnalysis(null);
      setCloud(null);
      setDetails('posts');
      setNotice('文件已读取');
    }
  }, [run]);

  async function analyze() {
    const result = await run(
      'analyze',
      '正在分析博文，首次分析需要加载模型…',
      () => unwrap(window.wordkeep.analyze(range)),
    );
    if (result) {
      setAnalysis({ value: result, signature });
      setCloud(null);
      setDetails('terms');
      setNotice(`分析完成 · ${result.terms.length.toLocaleString()} 个词`);
    }
  }
  async function generate() {
    if (!settings || !analysisFresh) return;
    const result = await run('generate', '正在生成词云…', () =>
      unwrap(window.wordkeep.generate(settings, mask)),
    );
    if (result) {
      setCloud({ value: result, signature: cloudSignature });
      setNotice('词云已生成');
    }
  }
  async function chooseFont() {
    const result = await run('font', '正在选择字体…', () =>
      unwrap(window.wordkeep.chooseFont()),
    );
    if (result && settings && options) {
      if (!options.fonts.some((font) => font.path === result.path))
        setOptions({ ...options, fonts: [...options.fonts, result] });
      setSettings({ ...settings, font_path: result.path });
    }
  }
  async function chooseMask() {
    const result = await run('mask', '正在读取蒙版…', () =>
      unwrap(window.wordkeep.chooseMask()),
    );
    if (result) setMask(result);
  }
  async function saveImage() {
    if (!cloudFresh) return;
    const path = await run('export', '正在导出 PNG…', () =>
      unwrap(window.wordkeep.saveImage()),
    );
    if (path) setNotice(`已保存：${path.split(/[\\/]/).at(-1)}`);
  }
  function settingsSaved(lists: WordLists) {
    setOptions((value) => (value ? { ...value, wordLists: lists } : value));
    setWordRevision((value) => value + 1);
    setNotice('设置已保存');
    if (!options) {
      bootPromise.current = null;
      setAttempt((value) => value + 1);
    }
  }
  async function cancel() {
    ++operation.current;
    try {
      await unwrap(window.wordkeep.cancel());
      setNotice('已取消，已完成的结果仍保留。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '取消失败，请重试。');
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }
  const editWords = (kind: WordListKind, word?: string) => {
    setError('');
    setSettingsPage(word ? { kind, word } : { kind });
  };
  const changeSettings = (value: CloudSettings) => {
    setSettings(value);
    setNotice('');
    setError('');
  };
  const disabled = Boolean(busy);
  const canAnalyze = Boolean(
    document &&
      options &&
      posts.length &&
      range.from &&
      range.to &&
      range.from <= range.to &&
      !busy,
  );
  const canGenerate = Boolean(
    settings &&
      !settingsError(settings) &&
      analysisFresh &&
      analysis?.value.terms.length &&
      !busy,
  );
  const menuState = useMemo<MenuState>(
    () => ({
      canOpen: !disabled && !preparing && !settingsPage,
      canSettings: !disabled && !preparing && !settingsPage,
      canAnalyze: canAnalyze && !settingsPage,
      canGenerate: canGenerate && !settingsPage,
      canExport: cloudFresh && !disabled && !settingsPage,
      canCancel: busy?.kind === 'analyze' || busy?.kind === 'generate',
      canView: !preparing && !settingsPage,
      inSettings: Boolean(settingsPage),
      details,
    }),
    [
      disabled,
      preparing,
      settingsPage,
      canAnalyze,
      canGenerate,
      cloudFresh,
      busy?.kind,
      details,
    ],
  );
  const handleMenu = useEffectEvent((command: MenuCommand) => {
    switch (command) {
      case 'open':
        if (menuState.canOpen) void openDocument();
        break;
      case 'settings':
        if (menuState.canSettings) {
          setError('');
          setSettingsPage({ kind: 'analysis' });
        }
        break;
      case 'analyze':
        if (menuState.canAnalyze) void analyze();
        break;
      case 'generate':
        if (menuState.canGenerate) void generate();
        break;
      case 'export':
        if (menuState.canExport) void saveImage();
        break;
      case 'cancel':
        if (menuState.canCancel) void cancel();
        break;
      case 'terms':
      case 'posts':
        if (menuState.canView) setDetails(command);
        break;
      case 'reset-layout':
        if (menuState.canView) resetPaneLayout();
        break;
    }
  });
  useEffect(() => window.wordkeep?.onMenuCommand(handleMenu), []);
  useEffect(() => {
    if (window.wordkeep)
      void unwrap(window.wordkeep.updateMenu(menuState)).catch((reason) =>
        setError(
          reason instanceof Error ? reason.message : '无法更新应用菜单。',
        ),
      );
  }, [menuState]);
  const status =
    busy?.label ??
    (preparing
      ? '正在准备应用资源…'
      : notice ||
        (analysis && !analysisFresh
          ? '分析结果待更新'
          : document
            ? `${posts.length.toLocaleString()} 篇博文`
            : '尚未导入博文'));

  return (
    <div className="app-shell" aria-busy={disabled}>
      {settingsPage && (
        <SettingsView
          initialSection={settingsPage.kind}
          {...(settingsPage.word ? { word: settingsPage.word } : {})}
          onSaved={settingsSaved}
          onClose={() => {
            setSettingsPage(null);
            setError('');
          }}
        />
      )}
      <div className="workbench-shell" hidden={Boolean(settingsPage)}>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            {!options && !preparing && (
              <button
                type="button"
                className="secondary compact"
                onClick={() => {
                  bootPromise.current = null;
                  setError('');
                  setAttempt((value) => value + 1);
                }}
              >
                重试准备
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label="关闭错误提示"
              onClick={() => setError('')}
            >
              <RiCloseLine size={18} aria-hidden="true" />
            </button>
          </div>
        )}
        <main className="workspace workbench">
          <SplitPane
            name="workspace"
            direction="columns"
            label="左右栏分隔线"
            defaultRatio={0.43}
            minimumFirst={300}
            minimumSecond={360}
            first={
              <section className="details-pane" aria-label="词频和博文明细">
                <div className="source-toolbar">
                  <button
                    type="button"
                    className="secondary import-button"
                    disabled={disabled || preparing}
                    onClick={() => void openDocument()}
                  >
                    <RiFolderOpenLine size={17} aria-hidden="true" />
                    导入博文…
                  </button>
                  <span
                    className="source-filename"
                    title={
                      document
                        ? `${document.name} · ${formatSize(document.byteSize)}`
                        : undefined
                    }
                  >
                    {document?.name ?? '未导入文件'}
                  </span>
                </div>
                <div className="source-filter">
                  <input
                    aria-label="开始日期"
                    title="开始日期"
                    type="date"
                    value={range.from}
                    disabled={disabled || !document}
                    onChange={(event) => {
                      setRange({ ...range, from: event.target.value });
                      setNotice('');
                    }}
                  />
                  <span>至</span>
                  <input
                    aria-label="结束日期"
                    title="结束日期"
                    type="date"
                    value={range.to}
                    disabled={disabled || !document}
                    onChange={(event) => {
                      setRange({ ...range, to: event.target.value });
                      setNotice('');
                    }}
                  />
                </div>
                <div className="details-toolbar">
                  <div
                    className="details-tabs"
                    role="tablist"
                    aria-label="明细视图"
                  >
                    {(['terms', 'posts'] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        role="tab"
                        id={`tab-${tab}`}
                        aria-controls={`panel-${tab}`}
                        aria-selected={details === tab}
                        tabIndex={details === tab ? 0 : -1}
                        onClick={() => setDetails(tab)}
                        onKeyDown={(event) => {
                          if (
                            event.key === 'ArrowLeft' ||
                            event.key === 'ArrowRight'
                          ) {
                            event.preventDefault();
                            const next = tab === 'terms' ? 'posts' : 'terms';
                            setDetails(next);
                            globalThis.document
                              .getElementById(`tab-${next}`)
                              ?.focus();
                          }
                        }}
                      >
                        {tab === 'terms' ? '词频' : '博文'}
                        <span>
                          {tab === 'terms'
                            ? (analysis?.value.terms.length.toLocaleString() ??
                              '—')
                            : posts.length.toLocaleString()}
                        </span>
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="secondary compact analyze-button"
                    disabled={!canAnalyze}
                    onClick={() => void analyze()}
                  >
                    {busy?.kind === 'analyze'
                      ? '正在分析…'
                      : analysis
                        ? '重新分析'
                        : '分析词频'}
                  </button>
                </div>
                {document &&
                  (!range.from || !range.to || range.from > range.to) && (
                    <p className="inline-error" role="alert">
                      请选择有效的起止日期，开始日期不能晚于结束日期。
                    </p>
                  )}
                {analysis && !analysisFresh && (
                  <div className="stale-banner">
                    时间范围、分析设置或词表已变更，重新分析后再生成词云。
                  </div>
                )}
                <div
                  className="details-content"
                  role="tabpanel"
                  id="panel-posts"
                  aria-labelledby="tab-posts"
                  hidden={details !== 'posts'}
                >
                  <PostsView
                    key={JSON.stringify([documentRevision, range])}
                    posts={posts}
                    imported={Boolean(document)}
                  />
                </div>
                <div
                  className="details-content"
                  role="tabpanel"
                  id="panel-terms"
                  aria-labelledby="tab-terms"
                  hidden={details !== 'terms'}
                >
                  {analysis && options ? (
                    <ReviewView
                      key={analysis.signature}
                      result={analysis.value}
                      posts={posts}
                      wordLists={options.wordLists}
                      disabled={disabled}
                      stale={!analysisFresh}
                      onEdit={editWords}
                    />
                  ) : (
                    <div className="empty-details">
                      <h2>尚未分析词频</h2>
                      <p>
                        {document
                          ? '确认时间范围后，点击上方「分析词频」。'
                          : '从上方导入博文，再分析这段时间的词语。'}
                      </p>
                    </div>
                  )}
                </div>
              </section>
            }
            second={
              options && settings ? (
                <CloudView
                  options={options}
                  settings={settings}
                  image={cloud?.value ?? null}
                  mask={mask}
                  disabled={disabled}
                  stale={!cloudFresh}
                  analysisStale={
                    !analysisFresh || !analysis?.value.terms.length
                  }
                  generating={busy?.kind === 'generate'}
                  canExport={cloudFresh}
                  onSettings={changeSettings}
                  onFont={() => void chooseFont()}
                  onMask={() => void chooseMask()}
                  onRemoveMask={() => {
                    setMask(null);
                    setNotice('');
                  }}
                  onGenerate={() => void generate()}
                  onExport={() => void saveImage()}
                />
              ) : (
                <section className="cloud-view">
                  <div className="empty-details">
                    <h2>词云预览</h2>
                    <p>
                      {preparing
                        ? '正在准备字体和排版选项…'
                        : '应用资源尚未就绪，请重试或检查设置。'}
                    </p>
                  </div>
                </section>
              )
            }
          />
        </main>
        <footer className="status-bar">
          <div className="status-content" role="status" aria-live="polite">
            {(busy || preparing) && <progress aria-label={status} />}
            <span>{status}</span>
          </div>
          {busy && (busy.kind === 'analyze' || busy.kind === 'generate') && (
            <button
              type="button"
              className="text-button"
              onClick={() => void cancel()}
            >
              取消
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
