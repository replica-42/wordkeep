import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

const storagePrefix = 'wordkeep.pane.';
const resetEvent = 'wordkeep:reset-layout';
const dividerSize = 6;
const names = ['workspace', 'review', 'cloud'] as const;
type PaneName = (typeof names)[number];

export function resetPaneLayout(): void {
  for (const name of names) {
    try {
      localStorage.removeItem(storagePrefix + name);
    } catch {
      /* Apply the reset to the active session. */
    }
  }
  window.dispatchEvent(new Event(resetEvent));
}
function readRatio(name: PaneName, fallback: number | null): number | null {
  try {
    const value = localStorage.getItem(storagePrefix + name);
    if (
      value !== null &&
      Number.isFinite(Number(value)) &&
      Number(value) > 0 &&
      Number(value) < 1
    )
      return Number(value);
  } catch {
    /* Use the active session layout when storage is unavailable. */
  }
  return fallback;
}
function saveRatio(name: PaneName, value: number): void {
  try {
    localStorage.setItem(storagePrefix + name, String(value));
  } catch {
    /* Use the active session layout when storage is unavailable. */
  }
}
export function SplitPane({
  name,
  direction,
  label,
  defaultRatio,
  minimumFirst,
  minimumSecond,
  defaultSecondSize,
  first,
  second,
}: {
  name: PaneName;
  direction: 'columns' | 'rows';
  label: string;
  defaultRatio: number;
  minimumFirst: number;
  minimumSecond: number;
  defaultSecondSize?: number;
  first: ReactNode;
  second: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const id = useId();
  const [extent, setExtent] = useState(0);
  const [ratio, setRatio] = useState(() => readRatio(name, null));
  const latest = useRef(defaultRatio);
  const drag = useRef<{ coordinate: number; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const available = Math.max(1, extent - dividerSize);
  const scale = Math.min(1, available / (minimumFirst + minimumSecond));
  const minimum = extent ? (minimumFirst * scale) / available : 0;
  const maximum = extent ? 1 - (minimumSecond * scale) / available : 1;
  const clamped = Math.min(
    maximum,
    Math.max(
      minimum,
      ratio ??
        (extent && defaultSecondSize
          ? 1 - defaultSecondSize / available
          : defaultRatio),
    ),
  );
  function change(value: number, persist = false) {
    const next = Math.min(maximum, Math.max(minimum, value));
    latest.current = next;
    setRatio(next);
    if (persist) saveRatio(name, next);
  }
  function reset() {
    setRatio(null);
    try {
      localStorage.removeItem(storagePrefix + name);
    } catch {
      /* Reset still applies for this session. */
    }
  }
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const size =
        direction === 'columns'
          ? entry.contentRect.width
          : entry.contentRect.height;
      if (size > dividerSize) setExtent(size);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [direction]);
  useEffect(() => {
    const restore = () => setRatio(null);
    window.addEventListener(resetEvent, restore);
    return () => window.removeEventListener(resetEvent, restore);
  }, []);
  useEffect(() => {
    if (!dragging) return;
    const className = `resizing-${direction}`;
    document.body.classList.add(className);
    return () => document.body.classList.remove(className);
  }, [direction, dragging]);
  const template = `minmax(0, ${clamped}fr) ${dividerSize}px minmax(0, ${1 - clamped}fr)`;
  const style: CSSProperties =
    direction === 'columns'
      ? { gridTemplateColumns: template }
      : { gridTemplateRows: template };
  function finish() {
    if (drag.current) saveRatio(name, latest.current);
    drag.current = null;
    setDragging(false);
  }
  return (
    <div
      ref={container}
      className={`split-pane split-${direction}`}
      data-pane={name}
      style={style}
    >
      <div className="split-content" id={id}>
        {first}
      </div>
      <hr
        tabIndex={0}
        className="pane-divider"
        aria-label={label}
        aria-orientation={direction === 'columns' ? 'vertical' : 'horizontal'}
        aria-controls={id}
        aria-valuemin={Math.round(minimum * 100)}
        aria-valuemax={Math.round(maximum * 100)}
        aria-valuenow={Math.round(clamped * 100)}
        aria-valuetext={`${direction === 'columns' ? '左侧' : '上方'} ${Math.round(clamped * 100)}%`}
        title="拖动调整大小，双击恢复默认；方向键微调，Shift 加快"
        onDoubleClick={reset}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          latest.current = clamped;
          drag.current = {
            coordinate: direction === 'columns' ? event.clientX : event.clientY,
            size: clamped * available,
          };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          const coordinate =
            direction === 'columns' ? event.clientX : event.clientY;
          change(
            (drag.current.size + coordinate - drag.current.coordinate) /
              available,
          );
        }}
        onPointerUp={(event) => {
          finish();
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
        onKeyDown={(event) => {
          const backward = direction === 'columns' ? 'ArrowLeft' : 'ArrowUp';
          const forward = direction === 'columns' ? 'ArrowRight' : 'ArrowDown';
          if (![backward, forward, 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const step = (event.shiftKey ? 50 : 10) / available;
          change(
            event.key === 'Home'
              ? minimum
              : event.key === 'End'
                ? maximum
                : clamped + (event.key === backward ? -step : step),
            true,
          );
        }}
      />
      <div className="split-content">{second}</div>
    </div>
  );
}
