import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { app, dialog, shell } from 'electron';
import { APP_NAME, PROFILE_NAME } from '../shared/brand';

// A temporary helper removes user data after Chromium exits.
export async function uninstallMac(
  shutdown: () => Promise<void>,
): Promise<void> {
  if (!app.isPackaged || process.platform !== 'darwin')
    throw new Error('仅安装后的 macOS 应用支持此操作。');
  const userData = app.getPath('userData');
  if (
    resolve(userData) !==
    join(homedir(), 'Library', 'Application Support', PROFILE_NAME)
  )
    throw new Error('用户数据目录异常，已取消卸载。');
  const confirmation = await dialog.showMessageBox({
    type: 'warning',
    title: `卸载 ${APP_NAME}`,
    message: `卸载 ${APP_NAME} 并删除本机数据？`,
    detail:
      '应用、设置、个人词典、停用词、日志和缓存将被移除。导入的博文、自选文件和导出图片会保留。',
    buttons: ['取消', '卸载'],
    defaultId: 0,
    cancelId: 0,
  });
  if (confirmation.response !== 1) return;
  await shutdown();
  const directory = await mkdtemp(join(tmpdir(), 'wordkeep-uninstall-'));
  const script = join(directory, 'cleanup.sh');
  await writeFile(
    script,
    `#!/bin/sh
set -eu
[ "$2" = "$HOME/Library/Application Support/${PROFILE_NAME}" ] || exit 1
while kill -0 "$1" 2>/dev/null; do sleep 1; done
# AppKit persists file-dialog state outside Electron userData.
/usr/bin/defaults delete com.replica42.wordkeep >/dev/null 2>&1 || true
/bin/rm -f -- "$HOME/Library/Preferences/com.replica42.wordkeep.plist"
/bin/rm -rf -- "$2"
/bin/rm -rf -- "$(dirname "$0")"
`,
    { mode: 0o700 },
  );
  try {
    await shell.trashItem(resolve(process.resourcesPath, '../..'));
    const helper = spawn('/bin/sh', [script, String(process.pid), userData], {
      detached: true,
      stdio: 'ignore',
    });
    await new Promise<void>((ok, fail) => {
      helper.once('spawn', ok);
      helper.once('error', fail);
    });
    helper.unref();
    app.quit();
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
