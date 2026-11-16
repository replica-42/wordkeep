# 应用构建

支持在 macOS arm64、Windows x64 本机构建。使用 uv、Node.js 26 和 npm 12。
在仓库根目录安装构建依赖：

```sh
npm ci
npm --prefix wordkeep-app ci
```

按当前平台选择构建命令：

| 命令               | 产物                    |
| ------------------ | ----------------------- |
| `npm run package`  | 当前平台的应用目录      |
| `npm run dist:mac` | macOS arm64 DMG 安装包  |
| `npm run dist:win` | Windows x64 NSIS 安装包 |

后端由 `wordkeep-backend/packaging/build.py` 使用独立的 `wordkeep-backend/build/venv/` 构建；
前端调用 `wordkeep-app` 的 `npm run build`。前端、应用目录及安装包按阶段复用，
可传入 `-- --force` 强制重建。构建时自动下载并校验所需模型。

产物位于根目录 `release/`，名称为 `wordkeep-app-<版本>-<平台>-<架构>.<扩展名>`。
macOS 应用目录为 `release/mac-arm64/wordkeep-app.app`，Windows 为 `release/win-unpacked/`。
后端以 onedir 形式展开，安装包使用普通压缩，安装后直接读取展开的文件。
Windows 使用支持选择目录和查看详情的安装向导。

## 资源布局

macOS 的 `Contents/Resources/`、Windows 的 `resources/` 包含：

```text
app.asar                 前端代码
wordkeep-backend/        独立后端交付目录
  wordkeep-backend[.exe]  后端可执行文件
  _internal/             Python 运行库
  config.json            默认配置
  data/hanlp/            模型资源
  licenses/              Python 与模型许可
licenses/                Electron 与 JavaScript 依赖许可
```

个人词典和停用词由应用在用户目录创建，或由用户选择已有文件。
用户目录为 macOS 的 `~/Library/Application Support/Wordkeep/`，或 Windows 的 `%APPDATA%\Wordkeep\`。
卸载会删除应用与用户目录；外部词表、字体、博文和导出图片保留。
macOS 使用应用菜单中的卸载命令，Windows 使用系统卸载程序。

## 清理与验证

```sh
npm run clean -- --dry-run
npm run clean
npm run clean:all
npm run test:build
```

`clean` 清除后端缓存、前端输出、整包构建中间文件，保留后端交付目录及最终安装包。
`clean:all` 额外删除独立打包环境、后端产物和全部 `release/` 内容。
两种清理均保留开发 `.venv/`、`node_modules/`、模型源文件及用户数据。

## 签名

macOS 使用 `CSC_LINK` 提供 Developer ID Application 证书（包含私钥的 P12 文件路径、
HTTPS 地址或 Base64 内容），`CSC_KEY_PASSWORD` 提供证书密码。
构建入口先将证书导入临时钥匙串，再使用同一身份构建 Python 后端和 Electron 应用；
构建结束后恢复钥匙串列表并清理临时证书。单一有效身份自动选择，
`WORDKEEP_CODESIGN_IDENTITY` 可指定证书完整名称或 SHA-1 指纹。
本地也可通过该变量选择已安装在钥匙串中的证书。

公证使用 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD` 和 `APPLE_TEAM_ID`。
Windows 使用 `WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD` 提供 PFX/P12 证书和密码，
由 electron-builder 签署应用和安装包。

签名参数按平台隔离。空参数按未配置处理，默认生成未使用开发者证书签名的版本。
提供有效证书后自动签名，签名身份变化时重新构建相关产物。

## GitHub Actions

推送版本 tag 后，工作流自动构建 macOS arm64 和 Windows x64 安装包。
两个平台都成功后，安装包上传到该 tag 对应的 GitHub Release，并自动生成发布说明。
应用版本和安装包文件名使用 tag 去掉 `v` 前缀后的版本号；带预发布后缀的
版本（如 `v0.2.0-rc.1`）标记为 Pre-release。

```sh
git tag v0.2.0
git push origin v0.2.0
```

手动构建可在 Actions → Build installers → Run workflow 中启动，
或执行 `gh workflow run build.yml`。手动构建的产物保存在该次运行的 Artifacts；
推送版本 tag 触发的构建同时保留 Artifacts：`wordkeep-app-mac` 和 `wordkeep-app-win`。

Release 发布使用工作流内置的 `GITHUB_TOKEN`。需要签名时，在仓库的
Settings → Secrets and variables → Actions 添加上述同名签名变量。
