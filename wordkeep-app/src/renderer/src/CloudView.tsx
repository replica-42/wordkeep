import { RiCloseLine, RiFolderOpenLine } from '@remixicon/react';
import { useState } from 'react';
import type {
  Bootstrap,
  CloudImage,
  CloudSettings,
  MaskImage,
} from '../../shared/api';
import { settingsError } from './model';
import { SplitPane } from './SplitPane';

interface Props {
  options: Bootstrap;
  settings: CloudSettings;
  image: CloudImage | null;
  mask: MaskImage | null;
  disabled: boolean;
  generating: boolean;
  stale: boolean;
  analysisStale: boolean;
  canExport: boolean;
  onSettings(settings: CloudSettings): void;
  onFont(): void;
  onMask(): void;
  onRemoveMask(): void;
  onGenerate(): void;
  onExport(): void;
}
export function CloudView({
  options,
  settings,
  image,
  mask,
  disabled,
  generating,
  stale,
  analysisStale,
  canExport,
  onSettings,
  onFont,
  onMask,
  onRemoveMask,
  onGenerate,
  onExport,
}: Props) {
  const [zoom, setZoom] = useState('fit');
  const canvasWidth = mask?.width ?? settings.width;
  const canvasHeight = mask?.height ?? settings.height;
  const error = settingsError(settings);
  const outputWidth = Math.floor(canvasWidth * settings.scale);
  const outputHeight = Math.floor(canvasHeight * settings.scale);
  const numeric = (
    key: 'width' | 'height' | 'max_words' | 'scale',
    value: number,
  ) => onSettings({ ...settings, [key]: value });
  return (
    <section className="cloud-view" aria-label="调整和导出词云">
      <SplitPane
        name="cloud"
        defaultSecondSize={240}
        direction="rows"
        label="预览与配置分隔线"
        defaultRatio={0.66}
        minimumFirst={150}
        minimumSecond={170}
        first={
          <div className="preview-pane">
            <div className="preview-toolbar">
              <h1>词云预览</h1>
              <label>
                <span className="sr-only">预览缩放</span>
                <select
                  value={zoom}
                  onChange={(event) => setZoom(event.target.value)}
                >
                  <option value="fit">适应窗口</option>
                  <option value="100">100%</option>
                  <option value="50">50%</option>
                </select>
              </label>
            </div>
            <div
              className={`cloud-stage ${zoom === 'fit' ? 'fit' : 'actual-size'}`}
            >
              {image ? (
                <img
                  className={stale ? 'stale-image' : ''}
                  src={`data:image/png;base64,${image.png_base64}`}
                  alt="根据博文词频生成的词云"
                  style={
                    zoom === 'fit'
                      ? undefined
                      : { width: `${(image.width * Number(zoom)) / 100}px` }
                  }
                />
              ) : (
                <div className="empty-canvas">
                  <p>
                    {generating
                      ? '正在生成词云…'
                      : analysisStale
                        ? '分析词频后，在下方生成词云。'
                        : '选择字体和排版参数，生成词云预览。'}
                  </p>
                </div>
              )}
            </div>
            <div className="preview-caption">
              <span>
                {image
                  ? `${stale ? '预览待更新' : '已生成'} · ${image.rendered_words.length.toLocaleString()} 个词`
                  : '尚未生成'}
              </span>
              <span>
                {image ? `${image.width} × ${image.height} px` : '横排 · 白底'}
              </span>
            </div>
            {image && stale && (
              <p className="preview-notice">
                {analysisStale
                  ? '词频待更新，重新分析后再生成。'
                  : '排版已变更，请重新生成后导出。'}
              </p>
            )}
          </div>
        }
        second={
          <section className="inspector" aria-label="排版设置">
            <div className="inspector-heading">
              <h2>排版</h2>
              <span>
                {Number.isFinite(outputWidth) && Number.isFinite(outputHeight)
                  ? `输出 ${outputWidth} × ${outputHeight} px`
                  : '请填写有效尺寸'}
              </span>
            </div>
            <div className="inspector-scroll">
              <fieldset className="layout-fields" disabled={disabled}>
                <div className="form-field">
                  <label htmlFor="font">字体</label>
                  <div className="control-row">
                    <select
                      id="font"
                      value={settings.font_path}
                      onChange={(event) =>
                        onSettings({
                          ...settings,
                          font_path: event.target.value,
                        })
                      }
                    >
                      <option value="">选择系统字体</option>
                      {options.fonts.map((font) => (
                        <option key={font.path} value={font.path}>
                          {font.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="secondary icon-button"
                      onClick={onFont}
                      aria-label="选择字体文件…"
                      title="选择字体文件…"
                    >
                      <RiFolderOpenLine size={17} aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <div className="form-field">
                  <label htmlFor="colormap">配色</label>
                  <select
                    id="colormap"
                    value={settings.colormap}
                    onChange={(event) =>
                      onSettings({ ...settings, colormap: event.target.value })
                    }
                  >
                    {options.colormaps.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-field">
                  <span className="form-label">蒙版</span>
                  <div className="control-row mask-controls">
                    <button
                      type="button"
                      className="secondary mask-picker"
                      onClick={onMask}
                      title={
                        mask
                          ? `${mask.name} · ${mask.width} × ${mask.height} px，白色和透明区域留空`
                          : '选择图片，白色和透明区域留空'
                      }
                      aria-label={mask ? '更换蒙版…' : '选择图片…'}
                    >
                      {mask?.name ?? '选择图片…'}
                    </button>
                    {mask && (
                      <button
                        type="button"
                        className="icon-button"
                        onClick={onRemoveMask}
                        aria-label="移除蒙版"
                        title="移除蒙版"
                      >
                        <RiCloseLine size={17} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="form-field">
                  <span className="form-label">
                    画布{mask && <span className="field-note">由蒙版确定</span>}
                  </span>
                  <div className="size-fields">
                    <input
                      aria-label="画布宽度"
                      type="number"
                      min="1"
                      step="1"
                      value={Number.isNaN(canvasWidth) ? '' : canvasWidth}
                      onChange={(event) =>
                        numeric('width', event.target.valueAsNumber)
                      }
                      disabled={Boolean(mask)}
                    />
                    <span>×</span>
                    <input
                      aria-label="画布高度"
                      type="number"
                      min="1"
                      step="1"
                      value={Number.isNaN(canvasHeight) ? '' : canvasHeight}
                      onChange={(event) =>
                        numeric('height', event.target.valueAsNumber)
                      }
                      disabled={Boolean(mask)}
                    />
                    <span>px</span>
                  </div>
                </div>
                <div className="form-field">
                  <label htmlFor="max-words">最多词数</label>
                  <input
                    id="max-words"
                    type="number"
                    min="1"
                    step="1"
                    value={
                      Number.isNaN(settings.max_words) ? '' : settings.max_words
                    }
                    onChange={(event) =>
                      numeric('max_words', event.target.valueAsNumber)
                    }
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="scale">导出倍率</label>
                  <input
                    id="scale"
                    type="number"
                    min="1"
                    step="0.5"
                    value={Number.isNaN(settings.scale) ? '' : settings.scale}
                    onChange={(event) =>
                      numeric('scale', event.target.valueAsNumber)
                    }
                  />
                </div>
              </fieldset>
            </div>
            <div className="generate-action">
              <span
                className={
                  error && settings.font_path ? 'field-error' : 'action-hint'
                }
              >
                {error ?? (analysisStale ? '请先分析词频' : '')}
              </span>
              <button
                type="button"
                className="primary"
                disabled={disabled || analysisStale || Boolean(error)}
                onClick={onGenerate}
              >
                {generating ? '正在生成…' : image ? '重新生成' : '生成词云'}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={disabled || !canExport}
                onClick={onExport}
              >
                导出 PNG…
              </button>
            </div>
          </section>
        }
      />
    </section>
  );
}
