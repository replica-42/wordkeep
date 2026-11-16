import type { MenuItemConstructorOptions } from 'electron';
import { expect, it, vi } from 'vitest';
import { menuTemplate } from '../src/main/menus';

function flatten(
  items: MenuItemConstructorOptions[],
): MenuItemConstructorOptions[] {
  return items.flatMap((item) => [
    item,
    ...(Array.isArray(item.submenu) ? flatten(item.submenu) : []),
  ]);
}
it('macOS 设置位于应用菜单，常用命令有快捷键且初始禁用', () => {
  const send = vi.fn();
  const template = menuTemplate('darwin', send);
  const items = flatten(template);
  expect(template[0]?.label).toBe('拾言 Wordkeep');
  expect(
    flatten(template.slice(0, 1)).find((item) => item.id === 'settings')
      ?.accelerator,
  ).toBe('CmdOrCtrl+,');
  expect(items.find((item) => item.id === 'open')?.accelerator).toBe(
    'CmdOrCtrl+O',
  );
  expect(items.find((item) => item.id === 'export')?.enabled).toBe(false);
  expect(items.find((item) => item.id === 'reset-layout')).toBeDefined();
});
it('Windows/Linux 通过可见的文件菜单访问设置，保留编辑和窗口菜单', () => {
  const template = menuTemplate('win32', vi.fn());
  expect(template[0]?.label).toBe('文件');
  expect(
    flatten(template.slice(0, 1)).find((item) => item.id === 'settings'),
  ).toBeDefined();
  expect(template.some((item) => item.role === 'editMenu')).toBe(true);
  expect(template.some((item) => item.role === 'windowMenu')).toBe(true);
});
