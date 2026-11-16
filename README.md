# 拾言 · Wordkeep

基于博文提取关注的事物与个人感受，生成词云。

- [wordkeep-backend](wordkeep-backend/README.md)：Python 分词、词频统计、词云生成与 HTTP JSON-RPC 接口。
- [wordkeep-app](wordkeep-app/README.md)：Electron 桌面应用，包含导入、词频检查、词云预览与设置。
- [整包构建](packaging/README.md)：在仓库根目录编排两个子项目，生成 macOS 和 Windows 安装包。

## 开发

使用 uv、Python 3.14.10、Node.js 26 和 npm 12。在仓库根目录执行：

```sh
uv sync --locked --project wordkeep-backend
uv run --no-project --managed-python wordkeep-backend/data/download_models.py
npm --prefix wordkeep-app ci
npm --prefix wordkeep-app run dev
```

根目录的 `npm ci` 安装整包构建工具；前端依赖安装在 `wordkeep-app/node_modules/`。
两处 npm 配置均使用 `https://registry.npmmirror.com`，Electron 下载默认使用
`https://npmmirror.com/mirrors/electron/`。

启用提交检查：

```sh
uv run --locked --project wordkeep-backend pre-commit install
```

项目代码使用 [MIT 许可证](LICENSE)。依赖和模型许可见
[桌面应用声明](packaging/THIRD_PARTY_NOTICES.md)与
[后端声明](wordkeep-backend/packaging/THIRD_PARTY_NOTICES.md)。
