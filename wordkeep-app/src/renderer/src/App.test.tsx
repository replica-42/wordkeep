// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  AnalysisResult,
  AnalysisSettings,
  DesktopAPI,
  Reply,
  RuntimeSettings,
} from '../../shared/api';
import { App } from './App';

const result: AnalysisResult = {
  post_count: 2,
  sentence_count: 2,
  frequencies: { 海边: 3, 喜欢: 2 },
  terms: [
    {
      text: '海边',
      occurrences: 3,
      document_count: 2,
      sources: ['pos'],
      examples: ['喜欢海边的夕阳。'],
    },
    {
      text: '喜欢',
      occurrences: 2,
      document_count: 2,
      sources: ['pos'],
      examples: ['喜欢海边的夕阳。'],
    },
  ],
};
const success = <T,>(value: T): Promise<Reply<T>> =>
  Promise.resolve({ ok: true, value });
const preferences: AnalysisSettings = {
  hanlp_home: '/resources/hanlp',
  dictionary_path: '/user/dict.txt',
  stopwords_path: '/user/stopwords.txt',
  batch_size: 32,
};
const api = {
  bootstrap: vi.fn(() =>
    success({
      fonts: [{ name: '苹方', path: '/fonts/pingfang.ttc' }],
      colormaps: ['ocean', 'viridis'],
      wordLists: { stopwords: '真的\n', dictionary: '初音未来\n' },
      settings: {
        font_path: '',
        width: 1920,
        height: 1080,
        max_words: 400,
        colormap: 'ocean',
        scale: 1,
      },
    }),
  ),
  openPosts: vi.fn(() =>
    success({
      name: 'weibo.jsonl',
      byteSize: 1024,
      posts: [
        {
          id: '1',
          text: '喜欢海边的夕阳。',
          date: '2026-11-01',
          createdAt: '2026-11-01',
        },
        {
          id: '2',
          text: '海边很美。',
          date: '2026-11-02',
          createdAt: '2026-11-02',
        },
      ],
    }),
  ),
  analyze: vi.fn(() => success(result)),
  generate: vi.fn(() =>
    success({
      png_base64: 'cG5n',
      width: 1920,
      height: 1080,
      rendered_words: ['海边', '喜欢'],
    }),
  ),
  chooseFont: vi.fn(() => success(null)),
  chooseMask: vi.fn(() => success(null)),
  saveImage: vi.fn(() => success('/tmp/wordcloud.png')),
  readSettings: vi.fn(() => success(preferences)),
  saveSettings: vi.fn((analysis: AnalysisSettings) =>
    success({
      analysis,
      wordLists: { stopwords: '真的\n', dictionary: '初音未来\n' },
    }),
  ),
  readRuntimeSettings: vi.fn(() => success({ log_level: 'WARNING' as const })),
  saveRuntimeSettings: vi.fn((value: RuntimeSettings) => success(value)),
  clearCache: vi.fn(() => success(null)),
  chooseResource: vi.fn((): Promise<Reply<string | null>> => success(null)),
  readWordList: vi.fn((kind: 'stopwords' | 'dictionary') =>
    success(kind === 'stopwords' ? '真的\n' : '初音未来\n'),
  ),
  saveWordList: vi.fn((kind: 'stopwords' | 'dictionary', text: string) =>
    success({ stopwords: '真的\n', dictionary: '初音未来\n', [kind]: text }),
  ),
  cancel: vi.fn(() => success(null)),
  updateMenu: vi.fn(() => success(null)),
  onMenuCommand: vi.fn(
    (_callback: (command: import('../../shared/api').MenuCommand) => void) =>
      () => {},
  ),
} satisfies DesktopAPI;
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(window, 'wordkeep', { value: api, configurable: true });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(cleanup);
async function importAndAnalyze() {
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: '导入博文…' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  await user.click(screen.getByRole('button', { name: '导入博文…' }));
  await user.click(await screen.findByRole('button', { name: '分析词频' }));
  await screen.findByRole('heading', { name: '海边' });
  return user;
}
async function generate() {
  const user = await importAndAnalyze();
  await user.selectOptions(
    screen.getByLabelText('字体'),
    '/fonts/pingfang.ttc',
  );
  await user.click(
    screen
      .getAllByRole('button', { name: '生成词云' })
      .find((button) => button.className === 'primary') as HTMLElement,
  );
  await screen.findByRole('img', { name: '根据博文词频生成的词云' });
  return user;
}
it('完整流程：导入、对照词频原文、选择字体、生成与导出', async () => {
  const user = await generate();
  expect(api.analyze).toHaveBeenCalledWith({
    from: '2026-11-01',
    to: '2026-11-02',
  });
  expect(api.generate).toHaveBeenCalledWith(
    expect.objectContaining({
      font_path: '/fonts/pingfang.ttc',
      width: 1920,
      height: 1080,
      scale: 1,
    }),
    null,
  );
  await user.click(screen.getByRole('button', { name: '导出 PNG…' }));
  await screen.findByText('已保存：wordcloud.png');
  expect(api.saveImage).toHaveBeenCalledTimes(1);
});
it('排版变更保留旧预览，但禁止导出；倍率小于 1 不能生成', async () => {
  const user = await generate();
  const scale = screen.getByLabelText('导出倍率');
  await user.clear(scale);
  await user.type(scale, '0.5');
  expect(screen.getByRole('img')).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: '导出 PNG…' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (screen.getByRole('button', { name: '重新生成' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await user.clear(scale);
  await user.type(scale, '2');
  await user.click(screen.getByRole('button', { name: '重新生成' }));
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: '导出 PNG…' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  expect(api.generate).toHaveBeenLastCalledWith(
    expect.objectContaining({ scale: 2 }),
    null,
  );
});
it('搜索和原文选择可用；保存词表后旧分析失效', async () => {
  const user = await importAndAnalyze();
  await user.type(screen.getByRole('searchbox', { name: '搜索词语' }), '喜欢');
  const table = screen.getByRole('table');
  expect(within(table).queryByRole('button', { name: '海边' })).toBeNull();
  await user.click(within(table).getByRole('button', { name: '喜欢' }));
  expect(screen.getByRole('heading', { name: '喜欢' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '加入停用词…' }));
  const editor = await screen.findByLabelText(/停用词内容/);
  expect((editor as HTMLTextAreaElement).value).toContain('喜欢');
  await user.click(screen.getByRole('button', { name: '保存词表' }));
  await screen.findByText('词表已保存。重新分析后应用到词频结果。');
  await user.click(screen.getByRole('button', { name: '返回工作区' }));
  await screen.findByText(
    '时间范围、分析设置或词表已变更，重新分析后再生成词云。',
  );
  expect(api.saveWordList).toHaveBeenCalledWith(
    'stopwords',
    expect.stringContaining('喜欢'),
  );
  expect(
    (
      screen.getByRole('button', {
        name: '生成词云',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
it('取消后丢弃迟到的分析结果，允许重试', async () => {
  let resolve: ((value: Reply<AnalysisResult>) => void) | undefined;
  api.analyze.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: '导入博文…' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  await user.click(screen.getByRole('button', { name: '导入博文…' }));
  await user.click(await screen.findByRole('button', { name: '分析词频' }));
  await user.click(screen.getByRole('button', { name: '取消' }));
  await act(async () => {
    resolve?.({ ok: true, value: result });
  });
  expect(screen.queryByRole('heading', { name: '海边' })).toBeNull();
  await user.click(screen.getByRole('button', { name: '分析词频' }));
  await screen.findByRole('heading', { name: '海边' });
});
it('修改日期保留输入框焦点，并使旧分析失效', async () => {
  const user = await importAndAnalyze();
  const input = screen.getByLabelText('开始日期');
  input.focus();
  fireEvent.change(input, { target: { value: '2026-11-02' } });
  expect(screen.getByLabelText('开始日期')).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(
    screen.getByText('时间范围、分析设置或词表已变更，重新分析后再生成词云。'),
  ).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '重新分析' }));
  await screen.findByRole('heading', { name: '海边' });
  expect(api.analyze).toHaveBeenLastCalledWith({
    from: '2026-11-02',
    to: '2026-11-02',
  });
});
it('导入失败保留已完成的分析，错误信息可以关闭', async () => {
  const user = await importAndAnalyze();
  api.openPosts.mockResolvedValueOnce({
    ok: false,
    error: '第 2 行：JSON 格式无效。',
  });
  await user.click(screen.getByRole('button', { name: '导入博文…' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('heading', { name: '海边' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '关闭错误提示' }));
  expect(screen.queryByRole('alert')).toBeNull();
});
it('生成失败保留旧图并允许重试，失败的设置不能导出', async () => {
  const user = await generate();
  await user.selectOptions(screen.getByLabelText('配色'), 'viridis');
  api.generate.mockResolvedValueOnce({ ok: false, error: '无法生成词云。' });
  await user.click(screen.getByRole('button', { name: '重新生成' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('img')).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: '导出 PNG…' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await user.click(screen.getByRole('button', { name: '重新生成' }));
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: '导出 PNG…' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
});
it('生成按钮立即显示进行状态并禁止重复提交', async () => {
  const user = await importAndAnalyze();
  await user.selectOptions(
    screen.getByLabelText('字体'),
    '/fonts/pingfang.ttc',
  );
  let finish:
    | ((
        value: Reply<{
          png_base64: string;
          width: number;
          height: number;
          rendered_words: string[];
        }>,
      ) => void)
    | undefined;
  api.generate.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await user.click(screen.getByRole('button', { name: '生成词云' }));
  expect(
    (screen.getByRole('button', { name: '正在生成…' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    screen.getByRole('progressbar', { name: '正在生成词云…' }),
  ).toBeTruthy();
  expect(api.generate).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish?.({
      ok: true,
      value: {
        png_base64: 'cG5n',
        width: 1920,
        height: 1080,
        rendered_words: ['喜欢'],
      },
    });
  });
  expect(screen.getByRole('button', { name: '重新生成' })).toBeTruthy();
});

async function openSettings() {
  const user = await importAndAnalyze();
  await act(async () => api.onMenuCommand.mock.calls.at(-1)?.[0]('settings'));
  await screen.findByLabelText('分析批量');
  return user;
}
it('设置不重复排版选项；取消选择不修改路径，合法配置保存后使旧分析失效', async () => {
  const user = await openSettings();
  expect(screen.queryByRole('combobox', { name: '配色' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: '字体' })).toBeNull();
  await user.click(screen.getByRole('button', { name: '选择目录…' }));
  expect(
    (screen.getByRole('button', { name: '保存设置' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  api.chooseResource.mockResolvedValueOnce({ ok: true, value: '/new/hanlp' });
  await user.click(screen.getByRole('button', { name: '选择目录…' }));
  expect(
    (screen.getByLabelText('模型资源目录') as HTMLInputElement).value,
  ).toBe('/new/hanlp');
  const batch = screen.getByLabelText('分析批量');
  await user.clear(batch);
  await user.type(batch, '0');
  expect(
    (screen.getByRole('button', { name: '保存设置' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await user.clear(batch);
  await user.type(batch, '16');
  await user.click(screen.getByRole('button', { name: '保存设置' }));
  await screen.findByText('设置已保存。下次分析将使用新设置。');
  expect(api.saveSettings).toHaveBeenCalledWith({
    ...preferences,
    hanlp_home: '/new/hanlp',
    batch_size: 16,
  });
  await user.click(screen.getByRole('button', { name: '返回工作区' }));
  expect(screen.getByRole('heading', { name: '海边' })).toBeTruthy();
  expect(
    screen.getByText('时间范围、分析设置或词表已变更，重新分析后再生成词云。'),
  ).toBeTruthy();
});
it('词表未保存时切换页面和返回都需要处理草稿；放弃不影响原分析', async () => {
  const user = await openSettings();
  await user.click(screen.getByRole('button', { name: '个人词典' }));
  const editor = await screen.findByLabelText(/个人词典内容/);
  await user.type(editor, '夕阳');
  await user.click(screen.getByRole('button', { name: '停用词' }));
  await screen.findByText('当前页的修改尚未保存。');
  await user.click(screen.getByRole('button', { name: '继续编辑' }));
  expect((editor as HTMLTextAreaElement).value).toContain('夕阳');
  await user.click(screen.getByRole('button', { name: '返回工作区' }));
  await user.click(screen.getByRole('button', { name: '放弃修改' }));
  expect(api.saveWordList).not.toHaveBeenCalled();
  expect(api.saveSettings).not.toHaveBeenCalled();
  expect(
    screen.queryByText(
      '时间范围、分析设置或词表已变更，重新分析后再生成词云。',
    ),
  ).toBeNull();
});
it('保存配置或词表失败保留草稿，允许修正后重试', async () => {
  const user = await openSettings();
  api.saveSettings.mockResolvedValueOnce({ ok: false, error: '目录不存在' });
  const batch = screen.getByLabelText('分析批量');
  await user.clear(batch);
  await user.type(batch, '16');
  await user.click(screen.getByRole('button', { name: '保存设置' }));
  await screen.findByText('目录不存在');
  expect((batch as HTMLInputElement).value).toBe('16');
  await user.click(screen.getByRole('button', { name: '撤销修改' }));
  await user.click(screen.getByRole('button', { name: '停用词' }));
  const editor = await screen.findByLabelText(/停用词内容/);
  await user.type(editor, '事情');
  api.saveWordList.mockResolvedValueOnce({ ok: false, error: '文件不可写' });
  await user.click(screen.getByRole('button', { name: '保存词表' }));
  await screen.findByText('文件不可写');
  expect((editor as HTMLTextAreaElement).value).toContain('事情');
  await user.click(screen.getByRole('button', { name: '保存词表' }));
  await screen.findByText('词表已保存。重新分析后应用到词频结果。');
});
it('资源初始化失败仍可进入设置修正路径', async () => {
  api.bootstrap.mockResolvedValueOnce({ ok: false, error: '资源不存在' });
  render(<App />);
  await screen.findByText('资源不存在');
  await act(async () => api.onMenuCommand.mock.calls.at(-1)?.[0]('settings'));
  await screen.findByLabelText('模型资源目录');
  expect(screen.getByLabelText('停用词文件')).toBeTruthy();
});

it('离开提示出现后直接保存，会清除过期的未保存提示', async () => {
  const user = await openSettings();
  const batch = screen.getByLabelText('分析批量');
  await user.clear(batch);
  await user.type(batch, '16');
  await user.click(screen.getByRole('button', { name: '返回工作区' }));
  await screen.findByText('当前页的修改尚未保存。');
  await user.click(screen.getByRole('button', { name: '保存设置' }));
  await screen.findByText('设置已保存。下次分析将使用新设置。');
  expect(screen.queryByText('当前页的修改尚未保存。')).toBeNull();
  await user.click(screen.getByRole('button', { name: '返回工作区' }));
  expect(screen.getByRole('heading', { name: '海边' })).toBeTruthy();
});

it('单页工作区同时展示明细和词云；导入前可配置排版，导入后可切换博文', async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByLabelText('字体');
  expect(screen.queryByRole('navigation', { name: '词云制作步骤' })).toBeNull();
  expect(screen.getAllByRole('button', { name: '导入博文…' })).toHaveLength(1);
  expect(screen.getByRole('heading', { name: '词云预览' })).toBeTruthy();
  await user.selectOptions(
    screen.getByLabelText('字体'),
    '/fonts/pingfang.ttc',
  );
  expect(
    (screen.getByRole('button', { name: '生成词云' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await user.click(screen.getByRole('button', { name: '导入博文…' }));
  await screen.findByRole('table');
  expect(screen.getByText('喜欢海边的夕阳。')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '分析词频' }));
  await screen.findByRole('heading', { name: '海边' });
  expect((screen.getByLabelText('字体') as HTMLSelectElement).value).toBe(
    '/fonts/pingfang.ttc',
  );
  await user.click(screen.getByRole('tab', { name: /博文/ }));
  expect(screen.getByText('海边很美。')).toBeTruthy();
  expect(screen.getByRole('heading', { name: '词云预览' })).toBeTruthy();
  await user.click(screen.getByRole('tab', { name: /词频/ }));
  expect(screen.getByRole('heading', { name: '海边' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '生成词云' }));
  await screen.findByRole('img');
  expect(screen.getByRole('table')).toBeTruthy();
});
it('搜索结果和原文保持一致，没有匹配词时不显示其他词的例句', async () => {
  const user = await importAndAnalyze();
  const query = screen.getByRole('searchbox', { name: '搜索词语' });
  await user.type(query, '喜欢');
  expect(screen.getByRole('heading', { name: '喜欢' })).toBeTruthy();
  await user.clear(query);
  await user.type(query, '不存在');
  expect(screen.queryByRole('heading', { name: '喜欢' })).toBeNull();
  expect(screen.getByText('没有匹配的词语。')).toBeTruthy();
});
it('新文件导入后清除旧分析和图片，保留排版参数', async () => {
  const user = await generate();
  await user.click(screen.getByRole('button', { name: '导入博文…' }));
  await screen.findByRole('table');
  expect(screen.queryByRole('img')).toBeNull();
  expect(
    (screen.getByRole('button', { name: '导出 PNG…' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect((screen.getByLabelText('字体') as HTMLSelectElement).value).toBe(
    '/fonts/pingfang.ttc',
  );
});

it('切换博文和设置再返回，保留词频搜索及当前选择', async () => {
  const user = await importAndAnalyze();
  await user.type(screen.getByRole('searchbox', { name: '搜索词语' }), '喜欢');
  await user.click(screen.getByRole('tab', { name: /博文/ }));
  await user.click(screen.getByRole('tab', { name: /词频/ }));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(
    '喜欢',
  );
  await act(async () => api.onMenuCommand.mock.calls.at(-1)?.[0]('settings'));
  await screen.findByLabelText('分析批量');
  await user.click(screen.getByRole('button', { name: '返回工作区' }));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(
    '喜欢',
  );
  expect(screen.getByRole('heading', { name: '喜欢' })).toBeTruthy();
});

it('原生菜单反映工作区状态，并阻止在设置中导入或切换明细', async () => {
  const user = await generate();
  expect(api.updateMenu).toHaveBeenLastCalledWith(
    expect.objectContaining({
      canExport: true,
      canGenerate: true,
      canCancel: false,
    }),
  );
  await act(async () => api.onMenuCommand.mock.calls.at(-1)?.[0]('settings'));
  await screen.findByLabelText('分析批量');
  expect(api.updateMenu).toHaveBeenLastCalledWith(
    expect.objectContaining({
      inSettings: true,
      canOpen: false,
      canExport: false,
      canView: false,
    }),
  );
  await act(async () => api.onMenuCommand.mock.calls.at(-1)?.[0]('open'));
  expect(api.openPosts).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: '返回工作区' }));
  await act(async () => api.onMenuCommand.mock.calls.at(-1)?.[0]('posts'));
  expect(
    screen.getByRole('tab', { name: /博文/ }).getAttribute('aria-selected'),
  ).toBe('true');
  expect(api.updateMenu).toHaveBeenLastCalledWith(
    expect.objectContaining({ details: 'posts', canExport: true }),
  );
});

it('设置可调整日志级别并清理缓存，不使词频和图片失效', async () => {
  const user = await generate();
  await act(async () => api.onMenuCommand.mock.calls.at(-1)?.[0]('settings'));
  await screen.findByLabelText('分析批量');
  await user.click(screen.getByRole('button', { name: '日志与缓存' }));
  const level = await screen.findByLabelText('日志级别');
  await waitFor(() =>
    expect((level as HTMLSelectElement).disabled).toBe(false),
  );
  await user.selectOptions(level, 'DEBUG');
  await user.click(screen.getByRole('button', { name: '保存设置' }));
  await screen.findByText('日志级别已保存并生效。');
  expect(api.saveRuntimeSettings).toHaveBeenCalledWith({ log_level: 'DEBUG' });
  await user.click(screen.getByRole('button', { name: '清理缓存' }));
  await screen.findByText('缓存已清理，下次使用时按需重建。');
  expect(api.clearCache).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: '返回工作区' }));
  expect(
    (screen.getByRole('button', { name: '导出 PNG…' }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});
