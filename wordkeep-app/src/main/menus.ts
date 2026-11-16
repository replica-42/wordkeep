import type { MenuItemConstructorOptions } from 'electron';
import type { MenuCommand, MenuState } from '../shared/api';
import { APP_NAME } from '../shared/brand';

export const commandStates: Record<
  MenuCommand,
  keyof Omit<MenuState, 'details' | 'inSettings'>
> = {
  open: 'canOpen',
  settings: 'canSettings',
  analyze: 'canAnalyze',
  generate: 'canGenerate',
  export: 'canExport',
  cancel: 'canCancel',
  terms: 'canView',
  posts: 'canView',
  'reset-layout': 'canView',
};
export function menuTemplate(
  platform: NodeJS.Platform,
  send: (command: MenuCommand) => void,
  uninstall?: () => void,
): MenuItemConstructorOptions[] {
  const mac = platform === 'darwin';
  const command = (
    id: MenuCommand,
    label: string,
    accelerator?: string,
  ): MenuItemConstructorOptions => ({
    id,
    label,
    ...(accelerator ? { accelerator } : {}),
    enabled: false,
    click: () => send(id),
  });
  const settings = command('settings', '设置…', 'CmdOrCtrl+,');
  return [
    ...(mac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              settings,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              ...(uninstall
                ? [
                    { label: `卸载 ${APP_NAME}…`, click: uninstall },
                    { type: 'separator' as const },
                  ]
                : []),
              { role: 'quit' },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: '文件',
      submenu: [
        command('open', '导入博文…', 'CmdOrCtrl+O'),
        command('export', '导出词云…', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        ...(!mac ? [settings, { type: 'separator' as const }] : []),
        { role: mac ? 'close' : 'quit' },
      ],
    },
    { label: '编辑', role: 'editMenu' },
    {
      label: '词云',
      submenu: [
        command('analyze', '分析词频', 'CmdOrCtrl+Return'),
        command('generate', '生成词云', 'CmdOrCtrl+Shift+Return'),
        { type: 'separator' },
        command('cancel', '取消当前操作', 'Escape'),
      ],
    },
    {
      label: '视图',
      submenu: [
        { ...command('terms', '词频明细'), type: 'radio' },
        { ...command('posts', '博文明细'), type: 'radio', checked: true },
        { type: 'separator' },
        command('reset-layout', '重置面板布局'),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { label: '窗口', role: 'windowMenu' },
  ];
}
