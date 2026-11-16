import { RiArrowLeftLine } from '@remixicon/react';
import { useEffect, useState } from 'react';
import type {
  AnalysisSettings,
  LogLevel,
  ResourceSetting,
  RuntimeSettings,
  WordListKind,
  WordLists,
} from '../../shared/api';
import { unwrap, wordSet } from './model';

export type SettingsSection = 'analysis' | 'runtime' | WordListKind;
const sections: { id: SettingsSection; label: string }[] = [
  { id: 'analysis', label: '分析设置' },
  { id: 'dictionary', label: '个人词典' },
  { id: 'stopwords', label: '停用词' },
  { id: 'runtime', label: '日志与缓存' },
];
const paths: { key: ResourceSetting; label: string; hint: string }[] = [
  {
    key: 'hanlp_home',
    label: '模型资源目录',
    hint: '默认使用随应用安装的模型。留空可恢复默认目录。',
  },
  {
    key: 'dictionary_path',
    label: '个人词典文件',
    hint: '明确保留的词语。默认词表为空，留空路径使用本机词表；每行一个词。',
  },
  {
    key: 'stopwords_path',
    label: '停用词文件',
    hint: '默认词表为空。留空路径使用本机词表；个人词典中的词优先保留。',
  },
];
const message = (error: unknown) =>
  error instanceof Error ? error.message : '操作未完成，请重试。';

export function SettingsView({
  initialSection,
  word,
  onSaved,
  onClose,
}: {
  initialSection: SettingsSection;
  word?: string;
  onSaved: (lists: WordLists) => void;
  onClose: () => void;
}) {
  const [section, setSection] = useState(initialSection);
  const [settings, setSettings] = useState<AnalysisSettings | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<SettingsSection | 'close' | null>(
    null,
  );
  const [initialWord, setInitialWord] = useState(word);
  useEffect(() => {
    if (!dirty) setPending(null);
  }, [dirty]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The retry counter explicitly repeats this read.
  useEffect(() => {
    let active = true;
    setError('');
    void unwrap(window.wordkeep.readSettings())
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch((reason) => {
        if (active) setError(message(reason));
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  function navigate(target: SettingsSection | 'close') {
    if (target === 'close') onClose();
    else {
      setSection(target);
      setDirty(false);
      setInitialWord(undefined);
    }
    setPending(null);
  }
  function requestNavigation(target: SettingsSection | 'close') {
    if (busy || target === section) return;
    if (dirty) setPending(target);
    else navigate(target);
  }
  return (
    <main className="settings-view">
      <div className="settings-heading">
        <h1>设置</h1>
        <button
          type="button"
          className="toolbar-button"
          disabled={busy}
          onClick={() => requestNavigation('close')}
        >
          <RiArrowLeftLine size={18} aria-hidden="true" />
          返回工作区
        </button>
      </div>
      {pending && (
        <div className="discard-confirm" role="alert">
          <span>当前页的修改尚未保存。</span>
          <button
            type="button"
            className="secondary compact"
            onClick={() => setPending(null)}
          >
            继续编辑
          </button>
          <button
            type="button"
            className="secondary compact danger-button"
            onClick={() => navigate(pending)}
          >
            放弃修改
          </button>
        </div>
      )}
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分类">
          {sections.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={section === item.id ? 'page' : undefined}
              disabled={busy}
              onClick={() => requestNavigation(item.id)}
            >
              {item.label}
            </button>
          ))}
          <p>
            字体、画布和配色在
            <br />
            工作区右侧设置。
          </p>
        </nav>
        {error ? (
          <div className="settings-content">
            <p className="inline-error" role="alert">
              {error}
            </p>
            <button
              type="button"
              className="secondary"
              onClick={() => setAttempt((value) => value + 1)}
            >
              重试读取
            </button>
          </div>
        ) : !settings ? (
          <p role="status">正在读取设置…</p>
        ) : section === 'analysis' ? (
          <AnalysisForm
            key={section}
            settings={settings}
            onDirty={setDirty}
            onBusy={setBusy}
            onSaved={(value, lists) => {
              setSettings(value);
              onSaved(lists);
            }}
          />
        ) : section === 'runtime' ? (
          <RuntimeForm onDirty={setDirty} onBusy={setBusy} />
        ) : (
          <WordListEditor
            key={section}
            kind={section}
            path={
              section === 'dictionary'
                ? settings.dictionary_path
                : settings.stopwords_path
            }
            {...(initialWord ? { word: initialWord } : {})}
            onDirty={setDirty}
            onBusy={setBusy}
            onSaved={onSaved}
          />
        )}
      </div>
    </main>
  );
}

function AnalysisForm({
  settings,
  onDirty,
  onBusy,
  onSaved,
}: {
  settings: AnalysisSettings;
  onDirty: (value: boolean) => void;
  onBusy: (value: boolean) => void;
  onSaved: (settings: AnalysisSettings, lists: WordLists) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const valid = Number.isSafeInteger(draft.batch_size) && draft.batch_size >= 1;
  function change(value: AnalysisSettings) {
    setDraft(value);
    setError('');
    setNotice('');
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      await action();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  async function choose(key: ResourceSetting) {
    await run(async () => {
      const path = await unwrap(window.wordkeep.chooseResource(key));
      if (path) change({ ...draft, [key]: path });
    });
  }
  async function save() {
    await run(async () => {
      const value = await unwrap(window.wordkeep.saveSettings(draft));
      setDraft(value.analysis);
      onSaved(value.analysis, value.wordLists);
      setNotice('设置已保存。下次分析将使用新设置。');
    });
  }
  return (
    <form
      className="settings-content"
      onSubmit={(event) => {
        event.preventDefault();
        if (dirty && valid && !busy) void save();
      }}
    >
      <div className="settings-scroll">
        <h2>分析设置</h2>
        <p className="settings-intro">
          设置分词所需的本地资源。保存后生效，已有结果需要重新分析。
        </p>
        <fieldset disabled={busy}>
          {paths.map(({ key, label, hint }) => (
            <div className="setting-field" key={key}>
              <label htmlFor={key}>{label}</label>
              <div className="path-control">
                <input
                  id={key}
                  value={draft[key]}
                  placeholder="留空使用默认位置"
                  onChange={(event) =>
                    change({ ...draft, [key]: event.target.value })
                  }
                  spellCheck={false}
                  aria-describedby={`${key}-hint`}
                />
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void choose(key)}
                >
                  选择{key === 'hanlp_home' ? '目录' : '文件'}…
                </button>
              </div>
              <p id={`${key}-hint`}>{hint}</p>
            </div>
          ))}
          <div className="setting-field">
            <label htmlFor="batch-size">分析批量</label>
            <div className="batch-control">
              <input
                id="batch-size"
                type="number"
                min="1"
                step="1"
                value={Number.isNaN(draft.batch_size) ? '' : draft.batch_size}
                onChange={(event) =>
                  change({ ...draft, batch_size: event.target.valueAsNumber })
                }
                aria-describedby="batch-hint"
              />
              <span>句 / 批</span>
            </div>
            <p id="batch-hint">
              默认 32。每批处理的句子数；内存不足时可适当调低。
            </p>
          </div>
        </fieldset>
      </div>
      <div className="settings-footer">
        <div aria-live="polite">
          {error ? (
            <p className="inline-error" role="alert">
              {error}
            </p>
          ) : (
            <p>
              {notice ||
                (dirty
                  ? '有未保存的修改'
                  : '设置保存在本机，重新启动后仍然有效。')}
            </p>
          )}
        </div>
        <button
          type="button"
          className="secondary"
          disabled={!dirty || busy}
          onClick={() => change(settings)}
        >
          撤销修改
        </button>
        <button
          type="submit"
          className="primary"
          disabled={!dirty || !valid || busy}
        >
          {busy ? '正在处理…' : '保存设置'}
        </button>
      </div>
    </form>
  );
}

function WordListEditor({
  kind,
  path,
  word,
  onDirty,
  onBusy,
  onSaved,
}: {
  kind: WordListKind;
  path: string;
  word?: string;
  onDirty: (value: boolean) => void;
  onBusy: (value: boolean) => void;
  onSaved: (lists: WordLists) => void;
}) {
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const dirty = saved !== null && draft !== saved;
  const title = kind === 'dictionary' ? '个人词典' : '停用词';
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The retry counter explicitly repeats this read.
  useEffect(() => {
    let active = true;
    setError('');
    void unwrap(window.wordkeep.readWordList(kind))
      .then((text) => {
        if (!active) return;
        setSaved(text);
        setDraft(
          word && !wordSet(text).has(word)
            ? `${text.trimEnd()}${text.trim() ? '\n' : ''}${word}\n`
            : text,
        );
      })
      .catch((reason) => {
        if (active) setError(message(reason));
      });
    return () => {
      active = false;
    };
  }, [kind, word, attempt]);
  async function save() {
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      const lists = await unwrap(window.wordkeep.saveWordList(kind, draft));
      setSaved(lists[kind]);
      setDraft(lists[kind]);
      onSaved(lists);
      setNotice('词表已保存。重新分析后应用到词频结果。');
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <form
      className="settings-content wordlist-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (dirty && !busy) void save();
      }}
    >
      <div className="wordlist-heading">
        <h2>{title}</h2>
        <p className="settings-intro">
          {kind === 'dictionary'
            ? '明确保留的名称、事物和个人感受，优先于停用词。'
            : '排除无意义的词和泛用词。与个人词典重复的词仍会保留。'}
          每行一个词。
        </p>
        <p className="wordlist-path" title={path}>
          当前文件：{path}
        </p>
        <p className="wordlist-hint">
          保存会更新此文件。更换文件请前往「分析设置」。
        </p>
      </div>
      {saved === null ? (
        <div className="settings-scroll">
          {error ? (
            <>
              <p role="alert" className="inline-error">
                {error}
              </p>
              <button
                type="button"
                className="secondary"
                onClick={() => setAttempt((value) => value + 1)}
              >
                重试读取
              </button>
            </>
          ) : (
            <p role="status">正在读取词表…</p>
          )}
        </div>
      ) : (
        <>
          <label className="editor-label" htmlFor="wordlist-text">
            {title}内容 <span>{wordSet(draft).size.toLocaleString()} 个词</span>
          </label>
          <textarea
            id="wordlist-text"
            spellCheck={false}
            value={draft}
            disabled={busy}
            onChange={(event) => {
              setDraft(event.target.value);
              setError('');
              setNotice('');
            }}
          />
        </>
      )}
      <div className="settings-footer">
        <div aria-live="polite">
          {error && saved !== null ? (
            <p className="inline-error" role="alert">
              {error}
            </p>
          ) : (
            <p>
              {notice ||
                (dirty ? '有未保存的修改' : '空行和重复词会在保存时整理。')}
            </p>
          )}
        </div>
        <button
          type="button"
          className="secondary"
          disabled={!dirty || busy}
          onClick={() => {
            setDraft(saved ?? '');
            setError('');
            setNotice('');
          }}
        >
          撤销修改
        </button>
        <button type="submit" className="primary" disabled={!dirty || busy}>
          {busy ? '正在保存…' : '保存词表'}
        </button>
      </div>
    </form>
  );
}

function RuntimeForm({
  onDirty,
  onBusy,
}: {
  onDirty: (value: boolean) => void;
  onBusy: (value: boolean) => void;
}) {
  const [saved, setSaved] = useState<RuntimeSettings | null>(null);
  const [level, setLevel] = useState<LogLevel>('WARNING');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dirty = saved !== null && level !== saved.log_level;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => {
    let active = true;
    void unwrap(window.wordkeep.readRuntimeSettings())
      .then((value) => {
        if (active) {
          setSaved(value);
          setLevel(value.log_level);
        }
      })
      .catch((reason) => {
        if (active) setError(message(reason));
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    onBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <form
      className="settings-content"
      onSubmit={(event) => {
        event.preventDefault();
        if (!dirty || busy) return;
        void run(async () => {
          const value = await unwrap(
            window.wordkeep.saveRuntimeSettings({ log_level: level }),
          );
          setSaved(value);
          setLevel(value.log_level);
          setNotice('日志级别已保存并生效。');
        });
      }}
    >
      <div className="settings-scroll">
        <h2>日志与缓存</h2>
        <fieldset disabled={busy || !saved}>
          <div className="setting-field">
            <label htmlFor="log-level">日志级别</label>
            <select
              id="log-level"
              value={level}
              onChange={(event) => {
                setLevel(event.target.value as LogLevel);
                setNotice('');
              }}
            >
              <option value="ERROR">错误</option>
              <option value="WARNING">警告（默认）</option>
              <option value="INFO">信息</option>
              <option value="DEBUG">调试</option>
            </select>
            <p>
              默认记录警告和错误。每个日志文件不超过 25 MB，前后端分别保留 3
              份轮转备份。
            </p>
          </div>
          <div className="setting-field">
            <h3>运行缓存</h3>
            <p>
              清理字体、模型运行及界面缓存。保留模型文件、词表、设置和已生成的图片。
            </p>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                void run(async () => {
                  await unwrap(window.wordkeep.clearCache());
                  setNotice('缓存已清理，下次使用时按需重建。');
                })
              }
            >
              清理缓存
            </button>
          </div>
        </fieldset>
      </div>
      <div className="settings-footer">
        <div aria-live="polite">
          {error ? (
            <p className="inline-error" role="alert">
              {error}
            </p>
          ) : (
            <p>{notice || (dirty ? '有未保存的修改' : '设置保存在本机。')}</p>
          )}
        </div>
        <button
          type="button"
          className="secondary"
          disabled={!dirty || busy}
          onClick={() => {
            if (saved) setLevel(saved.log_level);
          }}
        >
          撤销修改
        </button>
        <button type="submit" className="primary" disabled={!dirty || busy}>
          {busy ? '正在处理…' : '保存设置'}
        </button>
      </div>
    </form>
  );
}
