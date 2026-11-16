# 拾言 · Wordkeep 后端

提供中文粗分词、词性与实体识别、词表过滤、词频聚合和 PNG 词云生成。
功能 API 使用 Python 对象，接口层提供 JSON-RPC 传输。

## 安装与开发

使用 uv 管理的 Python 3.14.10，包名为 `wordkeep-backend`，导入名为 `wordkeep_backend`。
以下命令在 `wordkeep-backend/` 下执行：

```sh
uv sync --locked
uv run --no-project --managed-python data/download_models.py
uv run --locked pytest
uv run --locked ruff check src tests packaging data
uv run --locked ruff format --check src tests packaging data
uv run --locked mypy src
uv build
```

开发环境位于 `.venv/`，采用 `src` 布局和 editable 安装。
pytest 使用 `importlib` 模式导入已安装的包。真实模型测试使用本地资源；
`-m "not integration"` 仅运行单元测试。
测试按模块组织：`tests/core/` 对应功能模块，`tests/interfaces/` 对应接口模块，
`tests/packaging/` 与 `tests/data/` 分别验证构建和模型下载脚本；
`tests/test_package.py` 验证公共导入与 editable 安装。
依赖版本锁定于 `uv.lock`，默认索引为清华 PyPI 镜像。
`data/download_models.py` 依据同级清单补齐 `data/hanlp/`，复用校验通过的文件，
下载缓存位于 `build/downloads/`。脚本仅使用标准库，路径以脚本位置为准。

- 运行：HanLP、wordcloud、Matplotlib、NumPy、Pillow、Uvicorn。
- 开发：pytest、Ruff、mypy、pre-commit。
- 打包：PyInstaller 及其 hooks，安装于独立的 `build/venv/`。

## 独立构建

在 macOS arm64 或 Windows x64 本机构建：

```sh
uv run --no-project --managed-python packaging/build.py build
uv run --no-project --managed-python packaging/build.py build --force
uv run --no-project --managed-python packaging/build.py clean
uv run --no-project --managed-python packaging/build.py clean --all
```

构建脚本通过 uv 管理的 Python 3.14.10 创建 `build/venv/`，只安装运行与打包依赖。
使用 PyInstaller onedir，运行文件和模型均完全展开。输入未变化且产物完整时直接复用；
`--force` 清除 PyInstaller 中间产物并重新构建。构建成功后替换旧产物。

默认清理构建缓存、下载缓存和检查缓存，保留打包环境及产物。
`clean --all` 同时删除 `build/` 和 `dist/`。两者均保留开发环境 `.venv/` 和 `data/hanlp/`。

| 目录 | 内容 |
| --- | --- |
| `src/wordkeep_backend/` | 功能与接口模块 |
| `tests/` | pytest 回归测试 |
| `packaging/` | 构建脚本、spec、入口与许可证 |
| `data/model-manifest.json` | 模型下载地址和 SHA-256 校验值 |
| `data/download_models.py` | 开发与构建共用的模型下载脚本 |
| `data/hanlp/` | 本地模型资源，按清单校验 |
| `build/` | 独立打包环境和中间文件 |
| `dist/wordkeep-backend/` | 可分发后端及资源 |
| `dist/*.whl`、`dist/*.tar.gz` | `uv build` 生成的 Python 包 |

可分发目录包含 `wordkeep-backend`（Windows 为 `.exe`）、`_internal/`、`data/`、
`config.json` 和 `licenses/`。启动所需环境变量见通信接口。
模型清单及校验值位于 `data/model-manifest.json`；本地文件缺失时构建脚本下载对应资源。
词典和停用词由调用方传入，默认配置保留空路径。

## 分词与词频

`TextAnalyzer(config).analyze(posts)` 接收具有唯一 ID 和正文的 `Post` 序列。
调用方负责日期筛选。分析器按需加载模型，可顺序复用，每次分析独立计数。

`AnalysisConfig` 对应 JSON 配置中的 `analysis`：

| 字段 | 用途 |
| --- | --- |
| `hanlp_home` | 模型资源根目录 |
| `dictionary_path` | UTF-8 个人词典文件 |
| `stopwords_path` | UTF-8 停用词文件 |
| `batch_size` | 每批推理句数，默认 32 |

直接构造配置时路径使用绝对 `Path`。`AnalysisConfig.from_mapping(values, base_dir=...)`
按指定根目录解析路径；`load_config(path)` 以 JSON 文件所在目录为基准。
词表每行一个条目，支持空文件。调用方将空词表路径解析为用户选择或创建的文件路径。

```python
from pathlib import Path
from wordkeep_backend import AnalysisConfig, Post, TextAnalyzer

config = AnalysisConfig(
    hanlp_home=Path("data/hanlp").resolve(),
    dictionary_path=Path("/path/to/wordlists/dict.txt"),
    stopwords_path=Path("/path/to/wordlists/stopwords.txt"),
)
result = TextAnalyzer(config).analyze([
    Post("1", "喜欢咖啡，也喜欢上海图书馆。"),
    Post("2", "今天又喝了咖啡。"),
])
weights = result.frequencies
```

模型采用 Small 多任务模型，在 CPU 上执行 `tok/coarse`、`pos/ctb`、`ner/ontonotes`。
所需文件及校验值见 `data/model-manifest.json`，存放在 `hanlp_home` 下。
下载及构建时验证模型文件的 SHA-256。后端在导入 HanLP 前检查本地资源并设置
`HANLP_HOME`。更换模型目录时重启工作进程。

个人词典优先保护完整条目，停用词按完整条目排除。普通候选接纳名词、动词、形容词、
外文词和名称类实体，要求至少两个字符且出现两次；词典条目可豁免这些门槛。
词典与实体采用完整、互不重叠的跨度计数。

`AnalysisResult` 包含：

- `frequencies`：词语到总出现次数的映射。
- `terms`：词语、总次数、出现博文数、来源和原文例句，按总次数降序排列。
- `post_count`、`sentence_count`：处理的博文数与句子数。

## 词云生成

`generate_wordcloud(frequencies, config, *, mask=None)` 接收词频、`WordCloudConfig`
和可选的蒙版图片字节，返回 `WordCloudResult`：PNG 字节、实际宽高及已绘制词语。

`WordCloudConfig` 对应 JSON 配置中的 `wordcloud`：

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `font_path` | 必填 | 系统字体或自定义字体文件路径 |
| `width` | 1920 | 布局宽度 |
| `height` | 1080 | 布局高度 |
| `max_words` | 400 | 最多尝试绘制的词数 |
| `colormap` | `ocean` | 配色名称 |
| `scale` | 1 | 大于等于 1 的有限倍率，支持小数 |

```python
from pathlib import Path
from wordkeep_backend import WordCloudConfig, generate_wordcloud

cloud_config = WordCloudConfig(font_path=Path("/path/to/font.ttf"), scale=1.5)
cloud = generate_wordcloud(result.frequencies, cloud_config)
Path("cloud.png").write_bytes(cloud.png)

cloud = generate_wordcloud(
    result.frequencies, cloud_config, mask=Path("mask.png").read_bytes()
)
```

`list_system_fonts()` 返回包含 `name` 和 `path` 的字体选项；`list_colormaps()` 返回配色列表。
`WordCloudConfig.from_mapping(values, base_dir=...)` 可读取宿主提供的配置；
`load_wordcloud_config(path)` 可读取已包含字体路径的 JSON 配置文件。

词云统一横排、白底，字号采用 WordCloud 默认行为。布局按词频降序、同频按词语排序，
实际绘制数量取决于画布空间。蒙版尺寸替代布局宽高，白色及完全透明区域留空。
导出宽高为布局尺寸乘以 `scale` 后取整数。

## 通信接口

```text
wordkeep_backend/
  core/         配置、词表、分析及词云功能
  interfaces/
    rpc.py      JSON-RPC 分发和数据转换
    http.py     桌面 HTTP 工作进程入口
    runtime.py  缓存路径与日志
    stdio.py    标准输入输出适配器
```

公共功能 API 从 `wordkeep_backend` 导入。宿主在开发时启动 `.venv/` 中的 Python，
运行 `-u -m wordkeep_backend.interfaces.http`；分发时启动
`dist/wordkeep-backend/wordkeep-backend`（Windows 为 `.exe`）。

`config.json` 提供宿主读取的默认值。宿主将分析配置传入 `initialize`、
将词云配置传入 `wordcloud.generate`，并将 `runtime.log_level` 转为 `WORDKEEP_LOG_LEVEL`。

宿主通过环境变量传入：

| 变量 | 用途 |
| --- | --- |
| `WORDKEEP_USER_DATA` | 用户数据目录的绝对路径 |
| `WORDKEEP_READY_FILE` | 启动握手文件的绝对路径 |
| `WORDKEEP_WORKER_TOKEN` | 宿主生成的随机认证令牌，至少 32 个字符 |
| `WORDKEEP_LOG_LEVEL` | `DEBUG`、`INFO`、`WARNING` 或 `ERROR`，默认 `WARNING` |

后端绑定 `127.0.0.1` 随机端口，就绪后将端口与 PID 写入握手文件。
请求携带 `Authorization: Bearer <token>`；`GET /health` 用于保活，
`POST /rpc` 接收 `application/json`，请求体上限为 128 MiB。
宿主应每 5 秒保活，后端在连接消失 60 秒后退出。任务、退出及缓存清理由宿主管理。

请求与响应遵循 JSON-RPC 2.0，支持命名参数、位置参数、通知和批量请求，串行执行。
HTTP 通知返回 204，其他协议响应返回 200。`interfaces.stdio` 按行接收 UTF-8 JSON，
通过标准输出返回协议响应、标准错误输出日志。

| 方法 | 命名参数 | 结果 |
| --- | --- | --- |
| `initialize` | `resource_root`、`analysis` | `{"initialized": true}` |
| `analysis.analyze` | `posts`：每项为字符串 `id`、`text` | `frequencies`、`terms`、`post_count`、`sentence_count` |
| `wordcloud.generate` | `frequencies`、`config`、可选 `mask_base64` | `png_base64`、`width`、`height`、`rendered_words` |
| `fonts.list` | 无 | 字体对象数组 |
| `colormaps.list` | 无 | 配色名称数组 |

分析及生成前调用 `initialize`，提供绝对 `resource_root` 和已解析词表路径的 `analysis`。
相同配置的初始化复用分析器；更改分析配置或重新读取词表时重启工作进程。
字体和配色查询可直接调用。

```json
{"jsonrpc":"2.0","id":1,"method":"analysis.analyze","params":{"posts":[{"id":"a","text":"喜欢咖啡。"}]}}
```

词云 `config` 包含所选 `font_path`，相对路径以 `resource_root` 为基准。
蒙版和 PNG 使用标准 Base64 字符串传输，`mask_base64` 省略或为 `null` 表示使用矩形画布。

| 错误码 | 含义 |
| --- | --- |
| `-32700` | JSON 或 UTF-8 解析错误 |
| `-32600` | 请求结构错误 |
| `-32601` | 方法不存在 |
| `-32602` | 参数、配置或输入数据错误 |
| `-32603` | 内部错误，详情写入日志 |
| `-32000` | 资源读取或执行失败，详情位于 `error.data` |
| `-32001` | 需要初始化 |
| `-32002` | 更改配置需要重启工作进程 |

后端日志位于 `logs/backend.log`，单文件上限 25,000,000 字节，保留 3 个备份。
Python 及模型库的运行缓存集中于用户目录的 `cache/python/`。
