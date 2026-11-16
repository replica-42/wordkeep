# 拾言 · Wordkeep 桌面应用

Electron、React 和 TypeScript 桌面应用，通过本机 HTTP 上的 JSON-RPC 调用 Python 后端。

## 使用

1. 点击左侧「导入博文」，选择 JSONL 文件，设置日期范围并分析。
2. 在左侧查看词频、博文明细和原文例句，支持搜索与排序。
3. 在右侧选择字体、画布、蒙版、配色、最多词数及导出倍率，生成词云并保存 PNG。
4. 在设置页配置模型目录、词表和分析批量，编辑词典与停用词，调整日志级别或清理缓存。

分析和生成支持取消。调整博文范围或词表后重新分析，调整排版后重新生成。
词云为横排、白底，默认画布 1920 × 1080，倍率为大于等于 1 的有限数值。
蒙版尺寸作为画布尺寸，白色和完全透明区域留空。

三处分隔线可拖动并自动保存布局。双击恢复默认比例；选中后使用方向键微调、Shift 加快、
Home/End 移至边界。「视图 → 重置面板布局」恢复全部分栏。
设置入口位于 macOS 的应用菜单或 Windows 的「文件」菜单。

| 操作     | 快捷键                   |
| -------- | ------------------------ |
| 导入博文 | Cmd/Ctrl + O             |
| 设置     | Cmd/Ctrl + ,             |
| 分析词频 | Cmd/Ctrl + Enter         |
| 生成词云 | Cmd/Ctrl + Shift + Enter |
| 导出 PNG | Cmd/Ctrl + Shift + S     |
| 取消任务 | Esc                      |

## 输入与设置

博文采用 UTF-8 JSONL，每行一个对象：

```jsonl
{"id":"post-1","text":"喜欢海边的夕阳。","created_at":"2026-11-01T18:30:00"}
```

ID 唯一，日期支持 `YYYY-MM-DD` 或 ISO 日期时间，筛选范围包含起止日。
正文和日期也支持 `content`、`create_at` 字段。导入校验失败时报告行号。

个人词典和停用词为两个独立的 UTF-8 文件，每行一个条目；个人词典优先。
设置页保存会更新所选文件。空路径使用用户目录中的默认词表，模型空路径使用随包模型。
资源路径支持绝对路径、相对于后端资源目录的路径及 `~/`。
后端资源目录在开发时为 `wordkeep-backend/`，分发时为 `resources/wordkeep-backend/`。
字体可从系统列表选择，或指定 TTF、OTF、TTC 文件。

用户分析与日志设置保存在用户目录的 `config.json`，优先于应用默认配置。
日志级别支持 ERROR、WARNING、INFO、DEBUG，默认为 WARNING。
`desktop.log` 和 `backend.log` 各以 25,000,000 字节为上限轮转，保留 3 个备份。
清理缓存会停止后端并清除运行缓存，保留设置、词表、布局及词云结果。

## 开发与测试

使用 uv、Python 3.14.10、Node.js 26 和 npm 12。
在仓库根目录准备后端：

```sh
uv sync --locked --project wordkeep-backend
uv run --no-project --managed-python wordkeep-backend/data/download_models.py
```

然后在 `wordkeep-app/` 中执行：

```sh
npm ci
npm run dev
```

`.npmrc` 使用 `https://registry.npmmirror.com`。
安装脚本默认设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`，
也可通过同名环境变量指定其他镜像。

| 命令                   | 用途                         |
| ---------------------- | ---------------------------- |
| `npm run check`        | TypeScript 与 Biome 检查     |
| `npm run format`       | 格式化及自动修复             |
| `npm test`             | 单元及界面回归测试           |
| `npm run test:desktop` | 构建并运行 Electron 桌面测试 |
| `npm run build`        | 检查并生成 `out/`            |
| `npm start`            | 运行已有构建                 |

设置 `WORDKEEP_INTEGRATION=1` 后执行 `npm test` 可启用真实后端集成测试。
桌面测试使用独立的临时用户目录，需要本地后端、模型和中文字体。
截图输出至仓库根目录的 `doc/ui-qa/native-panels/`。

`src/main/` 管理文件、设置和 Python 工作进程，`src/preload/` 暴露桌面接口，
`src/renderer/` 提供工作区和设置页，`src/shared/` 定义共用类型。
渲染进程使用沙箱与上下文隔离；主进程按需启动后端，并负责取消与退出。
通信协议见[后端说明](../wordkeep-backend/README.md#通信接口)。

`npm run clean` 清理本项目的 `out/`、测试缓存和 TypeScript 中间文件。
保留 `node_modules/` 中已安装的依赖。

开发模式使用相邻 `wordkeep-backend/` 下的 `.venv`、`config.json` 和 `data/hanlp/`，
通过 `wordkeep_backend.interfaces.http` 启动后端；使用 `WORDKEEP_*` 环境变量握手。
分发模式从 Electron 的 `resources/wordkeep-backend/` 读取独立后端及资源。

## 用户数据

用户目录为 macOS 的 `~/Library/Application Support/Wordkeep/`，或 Windows 的 `%APPDATA%\Wordkeep\`。
其中 `config.json` 保存设置，`wordlists/` 保存默认词表，`logs/` 保存轮转日志，
`cache/` 保存运行缓存，`chromium/` 保存会话和布局，`runtime/` 保存后端握手文件。

安装包构建由仓库根目录统一管理，见[整包构建说明](../packaging/README.md)。
