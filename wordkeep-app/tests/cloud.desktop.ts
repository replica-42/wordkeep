/// <reference lib="dom" />
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, type ElectronApplication, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';

let desktop: ElectronApplication;
let page: Page;
let profile: string;
const errors: string[] = [];
const screenshots = resolve('../doc/ui-qa/native-panels');

let savedRatios: Record<string, string | null> = {};
async function menuEnabled(id: string) {
  return desktop.evaluate(
    ({ Menu }, id) =>
      Menu.getApplicationMenu()?.getMenuItemById(id)?.enabled ?? false,
    id,
  );
}
async function invokeMenu(id: string) {
  await expect.poll(() => menuEnabled(id), { timeout: 15000 }).toBe(true);
  await desktop.evaluate(({ Menu }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (!item?.enabled) throw new Error(`Disabled menu: ${id}`);
    const click = item.click as () => void;
    click();
  }, id);
}
async function dragDivider(label: string, dx: number, dy: number) {
  const separator = page.getByRole('separator', { name: label, exact: true });
  const box = await separator.boundingBox();
  assert(box);
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
}
async function chooseFile(path: string) {
  await desktop.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filePath],
    });
  }, path);
}
async function resize(width: number, height: number) {
  const window = await desktop.browserWindow(page);
  await window.evaluate(
    (browserWindow, size) =>
      browserWindow.setContentSize(size.width, size.height),
    { width, height },
  );
  await expect
    .poll(() =>
      page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
    )
    .toEqual({ width, height });
}
async function checkLayout() {
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    scrollX,
    scrollY,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(viewport.scrollX).toBe(0);
  expect(viewport.scrollY).toBe(0);
  expect(viewport.scrollHeight).toBe(viewport.height);
  const main = await page.locator('.workspace').boundingBox();
  expect(await page.locator('.app-toolbar').count()).toBe(0);
  expect(await page.locator('.analysis-toolbar').count()).toBe(0);
  const footer = await page.locator('.status-bar').boundingBox();
  assert(footer && main);
  expect(footer.y + footer.height).toBeLessThanOrEqual(viewport.height + 1);
  for (const selector of ['.details-pane', '.preview-pane', '.inspector']) {
    const box = await page.locator(selector).boundingBox();
    assert(box);
    expect(
      box.y + box.height,
      `${selector} must stay above the footer`,
    ).toBeLessThanOrEqual(main.y + main.height + 1);
  }
  const left = await page.locator('.details-pane').boundingBox();
  const preview = await page.locator('.preview-pane').boundingBox();
  const config = await page.locator('.inspector').boundingBox();
  assert(left && preview && config);
  expect(left.x + left.width).toBeLessThanOrEqual(preview.x);
  expect(preview.y + preview.height).toBeLessThanOrEqual(config.y + 1);
  expect(preview.height).toBeGreaterThan(140);
  expect(
    await page.getByRole('navigation', { name: '词云制作步骤' }).count(),
  ).toBe(0);
  if (await page.locator('.cloud-stage.fit img').count()) {
    const stage = await page.locator('.cloud-stage.fit').boundingBox();
    const image = await page.locator('.cloud-stage.fit img').boundingBox();
    assert(stage && image);
    expect(image.y).toBeGreaterThanOrEqual(stage.y);
    expect(image.y + image.height).toBeLessThanOrEqual(
      stage.y + stage.height + 1,
    );
    expect(image.x + image.width).toBeLessThanOrEqual(
      stage.x + stage.width + 1,
    );
  }
  const button = await page
    .getByRole('button', { name: /^(生成词云|重新生成|正在生成…)$/ })
    .last()
    .boundingBox();
  assert(button);
  expect(
    button.y + button.height,
    'generation action must stay visible above the footer',
  ).toBeLessThanOrEqual(footer.y);
}

beforeAll(async () => {
  profile = await mkdtemp(join(tmpdir(), 'wordkeep-desktop-'));
  await mkdir(screenshots, { recursive: true });
  const posts = join(profile, 'posts.jsonl');
  await writeFile(
    posts,
    [1, 2, 3]
      .map((id) =>
        JSON.stringify({
          id,
          content:
            '喜欢初音未来的演唱会。海边的夕阳令人幸福。周末去咖啡店，听音乐，读小说。',
          create_at: `2026-11-0${id}`,
        }),
      )
      .join('\n'),
  );
  desktop = await _electron.launch({
    args: [resolve('tests/electron-entry.mjs')],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: '',
      WORDKEEP_TEST_USER_DATA: profile,
    },
  });
  page = await desktop.firstWindow();
  expect(
    await desktop.evaluate(({ app }) => ({
      name: app.getName(),
      profile: app.getPath('userData'),
    })),
  ).toEqual({ name: '拾言 Wordkeep', profile });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: '导入博文…' }).waitFor();
  await page.screenshot({
    path: join(screenshots, 'initial.png'),
    scale: 'css',
  });
  await chooseFile(posts);
  await page.getByRole('button', { name: '导入博文…' }).click();
  await page.getByText('文件已读取', { exact: true }).waitFor();
  await page.screenshot({ path: join(screenshots, 'posts.png'), scale: 'css' });
  await page.getByRole('button', { name: '分析词频', exact: true }).click();
  await page.locator('.term-detail h1').waitFor({ timeout: 60000 });
  const fonts = await page.locator('#font option').evaluateAll((options) =>
    options.map((option) => ({
      name: option.textContent ?? '',
      path: option.getAttribute('value') ?? '',
    })),
  );
  const font = fonts.find((item) =>
    /KingHwaOldSong|PingFang|Songti|Noto.*CJK|Source Han/i.test(item.name),
  );
  expect(
    font,
    'a Chinese font is required for desktop integration',
  ).toBeDefined();
  assert(font);
  await page.getByLabel('字体', { exact: true }).selectOption(font.path);
  const mask = await desktop.evaluate(({ nativeImage }) => {
    const width = 800,
      height = 450;
    const bytes = Buffer.alloc(width * height * 4);
    for (let index = 3; index < bytes.length; index += 4) bytes[index] = 255;
    return nativeImage
      .createFromBitmap(bytes, { width, height })
      .toPNG()
      .toString('base64');
  });
  const maskPath = join(profile, 'mask.png');
  await writeFile(maskPath, Buffer.from(mask, 'base64'));
  await chooseFile(maskPath);
  await page.getByRole('button', { name: '选择图片…' }).click();
  await page.getByText('mask.png', { exact: true }).waitFor();
  expect(await page.getByLabel('画布宽度').inputValue()).toBe('800');
  expect(await page.getByLabel('画布高度').inputValue()).toBe('450');
});
afterEach(async (context) => {
  if (page && context.task.result?.state === 'fail')
    await page.screenshot({
      path: join(screenshots, 'failure.png'),
      scale: 'css',
    });
});
afterAll(async () => {
  await desktop?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
});

it('首次生成前，宽窗口和最小窗口的空预览不会撑出内容区', async () => {
  for (const [width, height] of [
    [1512, 827],
    [900, 660],
  ] as const) {
    await resize(width, height);
    await checkLayout();
    await page.screenshot({
      path: join(screenshots, `empty-${width}.png`),
      scale: 'css',
    });
  }
});
it('鼠标实际点击首次生成，成功显示图片并可导出', async () => {
  await resize(1512, 827);
  await page
    .getByRole('button', { name: '生成词云', exact: true })
    .last()
    .click();
  await page.getByRole('img', { name: '根据博文词频生成的词云' }).waitFor();
  await checkLayout();
  expect(
    await page.getByRole('button', { name: '导出 PNG…' }).isEnabled(),
  ).toBe(true);
  const destination = join(profile, 'wordcloud.png');
  await desktop.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, destination);
  await page.getByRole('button', { name: '导出 PNG…' }).click();
  await page
    .getByRole('status')
    .filter({ hasText: '已保存：wordcloud.png' })
    .waitFor();
  const png = await readFile(destination);
  expect(png.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([800, 450]);
  await page.screenshot({
    path: join(screenshots, 'generated.png'),
    scale: 'css',
  });
});
it('按实际大小查看大图后，操作栏和底栏仍可见且可重新生成', async () => {
  await resize(900, 660);
  await checkLayout();
  await page.screenshot({
    path: join(screenshots, 'generated-900.png'),
    scale: 'css',
  });
  await page.getByLabel('预览缩放').selectOption('100');
  await page.getByLabel('导出倍率').fill('2');
  await page.getByRole('button', { name: '重新生成', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '词云已生成' }).waitFor();
  await checkLayout();
  await page.screenshot({
    path: join(screenshots, 'actual-size-small.png'),
    scale: 'css',
  });
  expect(errors).toEqual([]);
});
it('生成失败时错误提示留在可视区，修正字体后能够重试', async () => {
  const font = await page.getByLabel('字体', { exact: true }).inputValue();
  const invalid = join(profile, 'invalid.ttf');
  await writeFile(invalid, 'not a font');
  await chooseFile(invalid);
  await page.getByRole('button', { name: '选择字体文件…' }).click();
  await page.getByRole('button', { name: '重新生成', exact: true }).click();
  const error = page.getByRole('alert');
  await error.waitFor();
  const bounds = await error.boundingBox();
  assert(bounds);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  const main = await page.locator('.workspace').boundingBox();
  assert(main);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(main.y);
  await checkLayout();
  expect(
    await page.getByRole('button', { name: '导出 PNG…' }).isEnabled(),
  ).toBe(false);
  await page.screenshot({
    path: join(screenshots, 'error-small.png'),
    scale: 'css',
  });
  await page.getByLabel('字体', { exact: true }).selectOption(font);
  await page.getByRole('button', { name: '重新生成', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '词云已生成' }).waitFor();
  expect(
    await page.getByRole('button', { name: '导出 PNG…' }).isEnabled(),
  ).toBe(true);
  expect(errors).toEqual([]);
});

async function checkSettingsLayout() {
  const size = await page.evaluate(() => ({
    height: innerHeight,
    width: innerWidth,
    scrollHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(size.scrollHeight).toBe(size.height);
  expect(size.scrollWidth).toBe(size.width);
  for (const selector of ['.settings-heading', '.settings-footer']) {
    const box = await page.locator(selector).boundingBox();
    assert(box);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
  }
}
it('三处分隔线支持拖动、键盘和边界限制，并记录布局', async () => {
  await resize(1512, 827);
  const width = (await page.locator('.details-pane').boundingBox())?.width ?? 0;
  await dragDivider('左右栏分隔线', 100, 0);
  expect(
    (await page.locator('.details-pane').boundingBox())?.width,
  ).toBeGreaterThan(width + 80);
  const tableHeight =
    (await page.locator('.word-table-pane').boundingBox())?.height ?? 0;
  await dragDivider('词频与原文分隔线', 0, -60);
  expect(
    (await page.locator('.word-table-pane').boundingBox())?.height,
  ).toBeLessThan(tableHeight - 45);
  const previewHeight =
    (await page.locator('.preview-pane').boundingBox())?.height ?? 0;
  await dragDivider('预览与配置分隔线', 0, -70);
  expect(
    (await page.locator('.preview-pane').boundingBox())?.height,
  ).toBeLessThan(previewHeight - 50);
  await checkLayout();
  await page.screenshot({
    path: join(screenshots, 'dragged-1512.png'),
    scale: 'css',
  });
  await resize(900, 660);
  await dragDivider('左右栏分隔线', 1000, 0);
  expect(
    (await page.locator('.cloud-view').boundingBox())?.width,
  ).toBeGreaterThanOrEqual(359);
  await dragDivider('左右栏分隔线', -1000, 0);
  expect(
    (await page.locator('.details-pane').boundingBox())?.width,
  ).toBeGreaterThanOrEqual(299);
  const handle = page.getByRole('separator', { name: '左右栏分隔线' });
  await handle.dblclick();
  await expect.poll(() => handle.getAttribute('aria-valuenow')).toBe('43');
  await handle.focus();
  await page.keyboard.press('Shift+ArrowRight');
  expect(Number(await handle.getAttribute('aria-valuenow'))).toBeGreaterThan(
    43,
  );
  await page.getByRole('separator', { name: '预览与配置分隔线' }).focus();
  await page.keyboard.press('End');
  await checkLayout();
  await page.screenshot({
    path: join(screenshots, 'dragged-900.png'),
    scale: 'css',
  });
  await invokeMenu('reset-layout');
  await checkLayout();
  await dragDivider('左右栏分隔线', 35, 0);
  await dragDivider('词频与原文分隔线', 0, -30);
  await dragDivider('预览与配置分隔线', 0, -25);
  savedRatios = await page.evaluate(() =>
    Object.fromEntries(
      ['workspace', 'review', 'cloud'].map((name) => [
        name,
        localStorage.getItem(`wordkeep.pane.${name}`),
      ]),
    ),
  );
  expect(Object.values(savedRatios).every(Boolean)).toBe(true);
  expect(
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.getTitle(),
    ),
  ).toBe('posts.jsonl — 拾言 Wordkeep');
});
it('原生视图菜单和导出状态跟随界面变化', async () => {
  await invokeMenu('posts');
  await expect
    .poll(() =>
      page.getByRole('tab', { name: /博文/ }).getAttribute('aria-selected'),
    )
    .toBe('true');
  await invokeMenu('terms');
  await expect
    .poll(() =>
      page.getByRole('tab', { name: /词频/ }).getAttribute('aria-selected'),
    )
    .toBe('true');
  expect(await menuEnabled('export')).toBe(true);
  await page.getByLabel('导出倍率').fill('3');
  await expect.poll(() => menuEnabled('export')).toBe(false);
  await page.getByLabel('导出倍率').fill('2');
  await expect.poll(() => menuEnabled('export')).toBe(true);
});
it('设置页在常规和最小窗口中保持可操作，保存配置使旧结果失效', async () => {
  await invokeMenu('settings');
  await page.getByLabel('分析批量', { exact: true }).waitFor();
  for (const [width, height] of [
    [1512, 827],
    [900, 660],
  ] as const) {
    await resize(width, height);
    await checkSettingsLayout();
    await page.screenshot({
      path: join(screenshots, `settings-${width}.png`),
      scale: 'css',
    });
  }
  const selected = join(profile, 'selected-dict.txt');
  await writeFile(selected, '初音未来\n海边\n');
  await chooseFile(selected);
  await page
    .locator('.setting-field')
    .filter({ has: page.getByLabel('个人词典文件', { exact: true }) })
    .getByRole('button', { name: '选择文件…' })
    .click();
  await page.getByLabel('分析批量', { exact: true }).fill('8');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page
    .getByText('设置已保存。下次分析将使用新设置。', { exact: true })
    .waitFor();
  expect(
    JSON.parse(await readFile(join(profile, 'config.json'), 'utf8')).analysis,
  ).toMatchObject({ batch_size: 8, dictionary_path: selected });
  await page.getByRole('button', { name: '个人词典', exact: true }).click();
  const words = page.getByLabel(/个人词典内容/);
  await words.fill('初音未来\n海边\n夕阳\n');
  await page.getByRole('button', { name: '返回工作区', exact: true }).click();
  await page.getByText('当前页的修改尚未保存。', { exact: true }).waitFor();
  await checkSettingsLayout();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await page.screenshot({
    path: join(screenshots, 'settings-dictionary-900.png'),
    scale: 'css',
  });
  await page.getByRole('button', { name: '保存词表', exact: true }).click();
  await page
    .getByText('词表已保存。重新分析后应用到词频结果。', { exact: true })
    .waitFor();
  expect(await readFile(selected, 'utf8')).toBe('初音未来\n海边\n夕阳\n');
  await page.getByRole('button', { name: '停用词', exact: true }).click();
  await page.getByLabel(/停用词内容/).waitFor();
  await resize(1512, 827);
  await checkSettingsLayout();
  await page.screenshot({
    path: join(screenshots, 'settings-stopwords.png'),
    scale: 'css',
  });
  await page.getByRole('button', { name: '返回工作区', exact: true }).click();
  await page
    .getByText('时间范围、分析设置或词表已变更，重新分析后再生成词云。', {
      exact: true,
    })
    .waitFor();
  expect(
    await page.getByRole('button', { name: '导出 PNG…' }).isEnabled(),
  ).toBe(false);
  await page.getByRole('button', { name: '重新分析', exact: true }).click();
  await page.locator('.term-detail h1').waitFor({ timeout: 60000 });
  expect(errors).toEqual([]);
});
it('退出并重新启动后恢复设置及用户选择的词典', async () => {
  await desktop.close();
  desktop = await _electron.launch({
    args: [resolve('tests/electron-entry.mjs')],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: '',
      WORDKEEP_TEST_USER_DATA: profile,
    },
  });
  page = await desktop.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await invokeMenu('settings');
  expect(
    await page.evaluate(() =>
      Object.fromEntries(
        ['workspace', 'review', 'cloud'].map((name) => [
          name,
          localStorage.getItem(`wordkeep.pane.${name}`),
        ]),
      ),
    ),
  ).toEqual(savedRatios);
  const batch = page.getByLabel('分析批量', { exact: true });
  await batch.waitFor();
  expect(await batch.inputValue()).toBe('8');
  expect(
    await page.getByLabel('个人词典文件', { exact: true }).inputValue(),
  ).toBe(join(profile, 'selected-dict.txt'));
  await page.getByRole('button', { name: '个人词典', exact: true }).click();
  const words = page.getByLabel(/个人词典内容/);
  await words.waitFor();
  expect(await words.inputValue()).toBe('初音未来\n海边\n夕阳\n');
  await page.getByRole('button', { name: '返回工作区', exact: true }).click();
  await invokeMenu('reset-layout');
  await expect
    .poll(() =>
      page
        .getByRole('separator', { name: '左右栏分隔线' })
        .getAttribute('aria-valuenow'),
    )
    .toBe('43');
  expect(
    await page.evaluate(() =>
      ['workspace', 'review', 'cloud'].every(
        (name) => localStorage.getItem(`wordkeep.pane.${name}`) === null,
      ),
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
