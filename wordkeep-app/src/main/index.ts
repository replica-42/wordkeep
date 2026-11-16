import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  session,
} from 'electron';
import type {
  AnalysisSettings,
  CloudSettings,
  DateRange,
  MaskImage,
  MenuState,
  Reply,
  ResourceSetting,
  RuntimeSettings,
  WordListKind,
} from '../shared/api';
import { APP_NAME, PROFILE_NAME } from '../shared/brand';
import { Application } from './application';
import { backendPaths } from './backend-paths';
import { FileLogger } from './logging';
import { commandStates, menuTemplate } from './menus';
import { uninstallMac } from './uninstall';

app.setName(PROFILE_NAME);
const userData = app.getPath('userData');
app.setPath('userData', userData);
app.setName(APP_NAME);
if (!app.requestSingleInstanceLock()) app.exit(0);
const iconPath = join(import.meta.dirname, '../../resources/icon.png');
for (const path of ['chromium', 'logs', 'cache/crashes', 'cache/chromium'])
  mkdirSync(join(userData, path), { recursive: true });
app.setPath('sessionData', join(userData, 'chromium'));
app.setPath('crashDumps', join(userData, 'cache/crashes'));
app.setAppLogsPath(join(userData, 'logs'));
app.commandLine.appendSwitch(
  'disk-cache-dir',
  join(userData, 'cache/chromium'),
);
const logger = new FileLogger(join(userData, 'logs', 'desktop.log'));
process.on('uncaughtException', (error) => {
  logger.write('ERROR', 'Uncaught exception', error);
  app.exit(1);
});
process.on('unhandledRejection', (error) =>
  logger.write('ERROR', 'Unhandled rejection', error),
);
let window: BrowserWindow | null = null;
let application: Application;
let documentName = '';
let documentPath = '';
app.on('second-instance', () => {
  if (window?.isMinimized()) window.restore();
  window?.show();
  window?.focus();
});

function handle<T, A extends unknown[]>(
  channel: string,
  action: (...args: A) => Promise<T> | T,
): void {
  ipcMain.handle(
    channel,
    async (event, ...args: unknown[]): Promise<Reply<T>> => {
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== event.sender.mainFrame
      )
        return { ok: false, error: '无法从这个窗口执行操作。' };
      try {
        return { ok: true, value: await action(...(args as A)) };
      } catch (error) {
        logger.write('ERROR', channel, error);
        return {
          ok: false,
          error:
            error instanceof Error ? error.message : '操作未完成，请重试。',
        };
      }
    },
  );
}

async function chooseFile(
  title: string,
  extensions: string[],
): Promise<string | null> {
  if (!window) return null;
  const result = await dialog.showOpenDialog(window, {
    title,
    properties: ['openFile'],
    filters: [{ name: title, extensions }],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

function registerInterface(): void {
  handle('app:menu-state', (state: MenuState) => {
    if (
      !state ||
      Object.values(commandStates).some(
        (key) => typeof state[key] !== 'boolean',
      ) ||
      typeof state.inSettings !== 'boolean' ||
      !['terms', 'posts'].includes(state.details)
    )
      throw new Error('菜单状态无效。');
    const menu = Menu.getApplicationMenu();
    for (const [id, key] of Object.entries(commandStates)) {
      const item = menu?.getMenuItemById(id);
      if (item) item.enabled = state[key];
    }
    for (const id of ['terms', 'posts']) {
      const item = menu?.getMenuItemById(id);
      if (item) item.checked = state.details === id;
    }
    window?.setTitle(
      state.inSettings
        ? `设置 — ${APP_NAME}`
        : documentName
          ? `${documentName} — ${APP_NAME}`
          : APP_NAME,
    );
    if (process.platform === 'darwin')
      window?.setRepresentedFilename(state.inSettings ? '' : documentPath);
    return null;
  });
  handle('app:bootstrap', () => application.bootstrap());
  handle('posts:open', async () => {
    const path = await chooseFile('导入博文', ['jsonl', 'ndjson']);
    if (!path) return null;
    const document = await application.open(path);
    documentName = document.name;
    documentPath = path;
    window?.setTitle(`${documentName} — ${APP_NAME}`);
    if (process.platform === 'darwin') window?.setRepresentedFilename(path);
    return document;
  });
  handle('posts:analyze', (range: DateRange) => application.analyze(range));
  handle('cloud:generate', (settings: CloudSettings, mask: MaskImage | null) =>
    application.generate(settings, mask),
  );
  handle('font:choose', async () => {
    const path = await chooseFile('选择字体文件', ['ttf', 'otf', 'ttc']);
    return path ? application.registerFont(path) : null;
  });
  handle('mask:choose', async (): Promise<MaskImage | null> => {
    const path = await chooseFile('选择蒙版图片', [
      'png',
      'jpg',
      'jpeg',
      'webp',
      'bmp',
    ]);
    if (!path) return null;
    const bytes = await readFile(path);
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty())
      throw new Error(
        '无法读取这张蒙版图片，请选择有效的 PNG、JPEG、WebP 或 BMP 图片。',
      );
    return {
      name: basename(path),
      base64: bytes.toString('base64'),
      ...image.getSize(),
    };
  });
  handle('cloud:save', async () => {
    if (!window) return null;
    const image = application.exportImage();
    const result = await dialog.showSaveDialog(window, {
      title: '导出词云',
      defaultPath: image.name,
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, image.data);
    return result.filePath;
  });
  handle('runtime:read', () => application.readRuntimeSettings());
  handle('runtime:save', async (settings: RuntimeSettings) => {
    const value = await application.saveRuntimeSettings(settings);
    logger.setLevel(value.log_level);
    return value;
  });
  handle('runtime:clear-cache', () =>
    application.clearCache(async () => {
      await session.defaultSession.clearCache();
      await session.defaultSession.clearCodeCaches({});
      await session.defaultSession.clearStorageData({
        storages: ['shadercache', 'cachestorage'],
      });
    }),
  );
  handle('settings:read', () => application.readSettings());
  handle('settings:save', (settings: AnalysisSettings) =>
    application.saveSettings(settings),
  );
  handle('settings:choose-resource', async (setting: ResourceSetting) => {
    if (!window) return null;
    if (setting === 'hanlp_home') {
      const result = await dialog.showOpenDialog(window, {
        title: '选择 HanLP 资源目录',
        properties: ['openDirectory'],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    }
    if (setting !== 'stopwords_path' && setting !== 'dictionary_path')
      throw new Error('未知资源类型。');
    return chooseFile(
      setting === 'dictionary_path' ? '选择个人词典' : '选择停用词文件',
      ['txt'],
    );
  });
  handle('words:read', (kind: WordListKind) => application.readWordList(kind));
  handle('words:save', (kind: WordListKind, text: string) =>
    application.saveWordList(kind, text),
  );
  handle('app:cancel', () => {
    application.cancel();
    return null;
  });
}

function createWindow(): void {
  window = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 1000,
    minWidth: 900,
    minHeight: 660,
    show: false,
    backgroundColor: '#f7f9fa',
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const current = window;
  current.webContents.on('console-message', (details) => {
    const level =
      details.level === 'error'
        ? 'ERROR'
        : details.level === 'warning'
          ? 'WARNING'
          : details.level === 'info'
            ? 'INFO'
            : 'DEBUG';
    logger.write(level, `Renderer: ${details.message}`);
  });
  current.once('ready-to-show', () => current.show());
  current.on('closed', () => {
    window = null;
    application.cancel();
  });
  current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  current.webContents.on('will-navigate', (event) => event.preventDefault());
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  const loading =
    !app.isPackaged && devUrl
      ? current.loadURL(devUrl)
      : current.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  void loading.catch((error) => {
    logger.write('ERROR', 'Failed to open application', error);
    app.exit(1);
  });
}

void app
  .whenReady()
  .then(async () => {
    app.setAboutPanelOptions({ applicationName: APP_NAME, iconPath });
    if (process.platform === 'darwin' && !app.isPackaged)
      app.dock?.setIcon(iconPath);
    const backend = backendPaths(
      resolve(import.meta.dirname, '../..'),
      process.resourcesPath,
      app.isPackaged,
    );
    application = new Application(
      backend.root,
      userData,
      backend.python,
      backend.args,
    );
    try {
      logger.setLevel((await application.readRuntimeSettings()).log_level);
    } catch (error) {
      logger.write('ERROR', 'Failed to read settings', error);
    }
    registerInterface();
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        menuTemplate(
          process.platform,
          (command) => window?.webContents.send('menu:command', command),
          app.isPackaged && process.platform === 'darwin'
            ? () => {
                void uninstallMac(() => application.shutdown()).catch(
                  (error) => {
                    logger.write('ERROR', 'Uninstall failed', error);
                    dialog.showErrorBox(
                      '卸载未完成',
                      error instanceof Error ? error.message : '请重试。',
                    );
                  },
                );
              }
            : undefined,
        ),
      ),
    );
    createWindow();
    app.on('activate', () => {
      if (!window) createWindow();
    });
  })
  .catch((error) => {
    logger.write('ERROR', 'Application startup failed', error);
    app.exit(1);
  });
let quitting = false;
app.on('before-quit', (event) => {
  if (!application || quitting) return;
  event.preventDefault();
  quitting = true;
  void application
    .shutdown()
    .catch((error) => logger.write('ERROR', 'Backend shutdown failed', error))
    .finally(() => app.quit());
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
