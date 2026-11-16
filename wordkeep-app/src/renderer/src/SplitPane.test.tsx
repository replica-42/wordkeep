// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetPaneLayout, SplitPane } from './SplitPane';

let measure: (width: number, height: number) => void;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        measure = (width, height) =>
          callback(
            [{ contentRect: { width, height } } as ResizeObserverEntry],
            {} as ResizeObserver,
          );
      }
      observe() {
        measure(900, 600);
      }
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function pane(direction: 'columns' | 'rows' = 'columns') {
  return (
    <SplitPane
      name="workspace"
      direction={direction}
      label="测试分隔线"
      defaultRatio={0.43}
      minimumFirst={300}
      minimumSecond={360}
      first={<p>明细</p>}
      second={<p>预览</p>}
    />
  );
}
it('方向键调整并持久化，Home/End 遵守最小尺寸，重载恢复位置', () => {
  const view = render(pane());
  const handle = screen.getByRole('separator');
  fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
  const saved = Number(localStorage.getItem('wordkeep.pane.workspace'));
  expect(saved).toBeGreaterThan(0.43);
  view.unmount();
  render(pane());
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe(
    String(Math.round(saved * 100)),
  );
  fireEvent.keyDown(screen.getByRole('separator'), { key: 'Home' });
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe(
    '34',
  );
  fireEvent.keyDown(screen.getByRole('separator'), { key: 'End' });
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe(
    '60',
  );
  act(() => measure(700, 600));
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe(
    '48',
  );
});
it('双击与菜单重置恢复默认值，存储损坏时仍可操作', () => {
  localStorage.setItem('wordkeep.pane.workspace', 'bad-data');
  render(pane());
  const handle = screen.getByRole('separator');
  expect(handle.getAttribute('aria-valuenow')).toBe('43');
  fireEvent.keyDown(handle, { key: 'End' });
  fireEvent.doubleClick(handle);
  expect(handle.getAttribute('aria-valuenow')).toBe('43');
  expect(localStorage.getItem('wordkeep.pane.workspace')).toBeNull();
  fireEvent.keyDown(handle, { key: 'End' });
  act(() => resetPaneLayout());
  expect(handle.getAttribute('aria-valuenow')).toBe('43');
});
it('拖动捕获指针，释放后保存比例并恢复光标', () => {
  render(pane());
  const handle = screen.getByRole('separator');
  handle.setPointerCapture = vi.fn();
  handle.hasPointerCapture = vi.fn(() => true);
  handle.releasePointerCapture = vi.fn();
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 400 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 470 });
  expect(handle.getAttribute('aria-valuenow')).toBe('51');
  expect(document.body.classList.contains('resizing-columns')).toBe(true);
  fireEvent.pointerUp(handle, { pointerId: 1 });
  expect(document.body.classList.contains('resizing-columns')).toBe(false);
  expect(
    Number(localStorage.getItem('wordkeep.pane.workspace')),
  ).toBeGreaterThan(0.5);
});
