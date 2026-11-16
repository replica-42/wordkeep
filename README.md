# 拾言 · Wordkeep

基于博文提取关注的事物与个人感受，生成词云。

[Python 后端](wordkeep-backend/README.md)提供文本分析、词频统计和词云生成，以及 HTTP JSON-RPC 接口。
开发、构建和清理命令见后端说明。

在仓库根目录安装开发依赖并启用提交检查：

```sh
uv sync --locked --project wordkeep-backend
uv run --locked --project wordkeep-backend pre-commit install
```

项目代码使用 [MIT 许可证](LICENSE)。随应用分发的依赖与模型许可见
[第三方声明](wordkeep-backend/packaging/THIRD_PARTY_NOTICES.md)。
