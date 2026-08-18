# AGENTS.md

本文件为在此仓库工作的 AI 代理（及人类贡献者）提供上下文。项目源码极简，但打包链路有若干隐性约束，改动前请务必阅读「关键约束」一节。

## 项目是什么

**DSH Desktop** 是 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 的 Electron 桌面外壳——社区（非官方）构建。

核心价值：用户下载安装包即用，**无需系统 Node.js / npm / 终端**。打开 App，填入 DeepSeek API Key，即可让 AI 在本机执行任务（读写文件、运行命令、写代码等）。

它本身不含 dsh 的业务逻辑——只做三件事：① 用 Electron 内嵌的 Node 启动 `dsh web` 子进程；② 在原生窗口里加载这个本地 web UI；③ 跟踪上游 npm 版本并自动打包发布。

## 技术栈与工具链

| 维度 | 选择 | 备注 |
|------|------|------|
| 运行时 | Electron 43（内嵌 Node 22/24） | 不依赖系统 Node |
| 语言 | TypeScript，ESM（`"type": "module"`） | `target: ES2022`，`moduleResolution: NodeNext`，`strict` |
| 包管理 | **pnpm 11.22.0**（hoisted 模式） | 见下方关键约束，**禁止用 npm**；版本须与 `@pnpm/exe` 对齐（约束 9） |
| 任务运行 | **just**（`justfile`） | 所有命令优先走 just |
| 打包 | electron-builder 26 | dmg+zip（mac）、nsis（win） |
| 自动更新 | electron-updater | 每 4 小时检查；Windows 后台下载后弹「重启更新」，macOS 未签名走 Homebrew（brew 安装时）或 Releases 页手动下载 |
| 上游同步 | `scripts/sync-upstream.mjs` + GitHub Actions | 每天北京时间 09/13/17 点轮询 npm |

## 常用命令

```sh
just install    # 安装依赖（pnpm install）
just dev        # tsc 编译后从源码启动应用
just build      # 仅类型检查并编译主进程到 dist/
just sync       # 检查 npm 是否有新版 @deepseek-ai/dsh，有则升版本（不提交）
just dist-mac   # 构建 macOS 安装包到 dist-installer/（dmg + zip）
just dist-win   # 构建 Windows 安装包（nsis，需在 Windows / CI 上运行）
```

底层等价命令见 `package.json` 的 `scripts`：`build` / `dev` / `pack` / `dist:mac` / `dist:win`。

## 仓库结构

```
src/main.ts                 # 唯一的运行时源码——Electron 主进程（约 230 行）
scripts/sync-upstream.mjs   # 上游版本检测 + 桌面版本计算 + peer-only 依赖 pin
build/icon.{icns,ico,png}   # 应用图标
electron-builder.yml        # 打包配置（appId、target、asarUnpack、publish）
pnpm-workspace.yaml         # pnpm 配置（hoisted + allowBuilds 白名单）
.github/workflows/sync-and-release.yml  # 三阶段 CI：sync → build(mac/win) → release
dist/                       # tsc 输出（gitignore）
dist-installer/             # electron-builder 输出（gitignore）
```

## 核心架构：主进程启动流程（`src/main.ts`）

应用启动按序执行 `boot()`：

1. **`pickPort()`** — 在 `127.0.0.1` 上探测 3080→3099，取第一个可绑定端口。
2. **`startDsh(port)`** — `spawn(process.execPath, ['--expose-internals', dshBin(), 'web', '--port', N])`，带环境变量：
   - `ELECTRON_RUN_AS_NODE=1`（让 Electron 进程当 Node 用）
   - `DSH_HOME=userData/dsh-home`（状态隔离到应用数据目录，不污染用户目录）
   - `DSH_TELEMETRY_DISABLED=1`
   - `PATH` 前置 `toolingPathPrefix()`：`userData/tooling-bin`（POSIX 的 `node` shim，复用 Electron 内嵌 Node）+ `@pnpm/exe` 目录——插件市场 / `dsh plugin add` 按裸名 spawn `pnpm`/`node`，而 GUI 启动的 PATH 里都没有，缺了这步插件市场报「cannot find Node」
   - `--expose-internals` 是 cordis-plugin-hmr 的 HMR 服务所需
3. **`waitReady()`** — 每 500ms 轮询 `http://127.0.0.1:PORT/`，最多等 60s；期间若子进程提前退出则直接报错。
4. **`createWindow()`** — 单个 BrowserWindow 加载本地 UI；导航守卫把任何非 `127.0.0.1` 的跳转交给系统浏览器。**点 × 不退出**：`close` 事件被拦截改为隐藏窗口，真实退出只有托盘菜单「Quit」/ Cmd+Q（`before-quit` 置 `quitting=true` 放行 close），`window-all-closed` 是空操作（issue #3 托盘驻留）。
5. **`createTray()`** — 系统托盘图标（36px PNG 以 data URL 内嵌在 `main.ts`，因为 electron-builder 只打包 `dist/` 和 `node_modules/`；改图标需按 `TRAY_ICON_DATA_URL` 注释里的 magick 命令重新生成 base64，**不要手贴长 base64，容易丢字符导致图标空白**）。图标以 `addRepresentation({scaleFactor: 2})` 声明（36px = 18pt 逻辑尺寸），直接 `createFromDataURL` 的 1x 大图在 macOS 菜单栏会被裁剪显示为超大。macOS 上用 `setTemplateImage(true)` 渲染为自适应菜单栏明暗的单色剪影，Windows 保留彩色。左键/菜单「Show」恢复窗口，「Quit」才是真正退出，`will-quit` 里 kill dsh 子进程。
6. **`setupAutoUpdate()`** — 仅在打包后运行。Windows：`autoDownload` 后台下载，`update-downloaded` 弹「Restart and update / Later」，确认后 `quitAndInstall(true, true)` 静默安装并重启；不点则下次退出时自动安装。macOS：未签名无法自我更新，`autoDownload` 关闭，`update-available` 直接弹窗——`isBrewManaged()` 检测到 `brew list --cask dsh-desktop` 成功（brew 路径硬编码 `/opt/homebrew` 与 `/usr/local`，GUI 应用没有 shell PATH）时提供「Update via Homebrew」：跑 `brew upgrade --cask dsh-desktop` → `xattr -cr <bundle>` → 手动 kill dsh 子进程后 `app.relaunch()` + `app.exit(0)`（`app.exit` 不触发 `will-quit`，必须自己清理）；否则按钮打开 Releases 页。`error` 弹窗只在下载失败时出现（`downloadInFlight` 门控），网络抖动只记日志；`promptedVersion` 防止每 4 小时重复弹同一版本。

子进程的 stdout/stderr 全部追加到 `userData/logs/dsh.log`，这是排查「应用打不开 / UI 白屏」的首要入口。

单实例锁：`app.requestSingleInstanceLock()`，二次启动会显示并聚焦已有窗口（兼容窗口已隐藏到托盘的情况）。

## 关键约束（改动前必读）

1. **依赖管理用 pnpm，不用 npm。** 仓库规定 pnpm。

2. **`node_modules` 必须保持 hoisted 模式。** `pnpm-workspace.yaml` 里 `nodeLinker: hoisted`，是为了让 electron-builder 能走扁平依赖树。**不要改成 pnpm 默认的 virtual-store symlink 布局**，否则打包会漏文件。

3. **peer-only 运行时依赖由脚本自动维护，不要手动删。** dsh 树里有些 `@deepseek-ai/*` 包只在 `peerDependencies` 中出现，而 electron-builder 的生产收集器（`nodeModulesCollector.isProdDependency`）**只读 `dependencies`/`optionalDependencies`**，会漏掉纯 peer 包。`sync-upstream.mjs` 的 `detectPeerOnlyRuntimeDeps()` 会在升版时把它们 pin 到 `dependencies`。设计上**只增不删**——即便某包后来变成真依赖，留着无害，删了反而可能因改名产生悬空引用。

4. **`minimumReleaseAgeExclude` 必须保持 `'@deepseek-ai/*'` 通配，不要改成逐包 pin 版本。** pnpm 默认 24 小时最小发布龄检查，而本仓库就是要小时内跟进上游，所以整个第一方 scope 豁免。rc.6 时代这里曾是 ~190 行 `name@version` 列表，sync 升 rc.7 后列表过期、CI 的 `pnpm install --frozen-lockfile` 全部失败（ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION），且 **sync 已推 tag、build 失败后，后续定时 run 因上游无变化跳过 build，该 tag 永远不会出 release**——只能手动 `gh run rerun --failed` 或 force 重跑补救。

5. **整个 `node_modules` 必须 `asarUnpack`。** `dsh web` 是子进程执行的入口路径，asar 归档内的路径无法被 spawn 执行，因此 `electron-builder.yml` 里 `asarUnpack: node_modules/**`。`dshBin()` 还会把 `app.asar` 路径重写为 `app.asar.unpacked`。

6. **版本号不要手动改。** 桌面版本由 `nextVersion()` 计算，规则：
   - 上游预发布版（如 `0.1.0-rc.6`）→ 追加 UTC 构建时间戳：`0.1.0-rc.6.202508151030`。定宽 `YYYYMMDDHHMM`（12 位），保证 tag 的字母序 == 时间序——纯自增计数会在 9→10 进位处让 `rc.6.9` 字母序排在 `rc.6.11` 前面
   - 上游稳定版（如 `0.1.0`）→ 独立 patch 线 `X.Y.(Z+1)`
   - 保证严格递增且合法 semver（electron-updater 要求）

7. **macOS 构建未签名 / 未公证。** CI 里 `CSC_IDENTITY_AUTO_DISCOVERY=false`。用户首次打开需右键 → 打开；若提示「已损坏」需 `xattr -cr "/Applications/DSH Desktop.app"`。Homebrew 渠道由独立仓库 [foolgry/homebrew-tap](https://github.com/foolgry/homebrew-tap) 提供（cask `dsh-desktop`，仅 arm64），其 `sync-cask.yml` 每天跟踪本仓库最新 release 自动更新版本与 sha256——**发布产物文件名（`DSH.Desktop-<version>-mac-arm64.dmg`）变动时必须同步改 cask 的 `url`**。

8. **ESM 项目，导入用 NodeNext 风格。** 例如 `.mjs` 脚本里用 `import.meta.url` + `createRequire`。`@deepseek-ai/dsh` 无 `exports` map，`dshBin()` 直接 `require.resolve('@deepseek-ai/dsh/lib/bin.js')`。

9. **`@pnpm/exe`（插件市场的内置 pnpm）有三个坑，改动前必读。** ① 其 npm tarball 的 SEA 二进制**不带执行位**，setup.js 的 hardlink 也不补，`toolingPathPrefix()` 里的运行时 `chmodSync` 是必需的，别删；② SEA 二进制要求同目录有 `dist/pnpm.mjs`，所以 PATH 必须指 `@pnpm/exe` 包目录，不能直接指 `@pnpm/macos-arm64` 等平台包；③ 它的 `bin` 会在 `node_modules/.bin/pnpm` 遮蔽 corepack，electron-builder 的依赖收集器 spawn pnpm 时命中的就是它——**`packageManager` 字段必须与 `@pnpm/exe` 版本保持一致**（当前 11.22.0），否则收集器报版本不一致直接挂。另外它让 dmg 从 ~153MB 涨到 ~237MB，升版时留意体积。

## CI 流程（`.github/workflows/sync-and-release.yml`）

单 workflow 三阶段（刻意合并，避免 `GITHUB_TOKEN` 推 tag 触发第二个 workflow）：

1. **sync**（ubuntu）：跑 sync 脚本；若 `changed=true`，刷新 lockfile → commit + tag `v<version>` → 推到 master。`workflow_dispatch` 支持 `force` 强制重建。
2. **build**（macos-14 / windows-latest 并行）：checkout 对应 tag → `electron-builder --publish never` → 上传 artifact。
3. **release**（ubuntu）：汇总双平台产物，`gh release create` 一次性发布（避免并行构建竞争同一 release）。

**Release 说明（notes）约定**：release 阶段用 heredoc 生成 `notes.md` 再 `--notes-file` 发布，**必须中英双语**，且 macOS 部分必须包含「已损坏」的修复命令 `` xattr -cr "/Applications/DSH Desktop.app" ``，Windows 部分说明 SmartScreen → 更多信息 → 仍要运行。修改 notes 文案时不要删掉这两条用户指引。

## 修改时的检查清单

- 改了 `src/main.ts` → `just build`（tsc strict 通过），最好 `just dev` 实跑一次看 UI 能起来。
- 改了打包相关（依赖、electron-builder.yml、pnpm-workspace.yaml）→ 至少本地 `just dist-mac` 验证产物能装能开。
- 动了 `@deepseek-ai/*` 依赖范围 → 跑一次 `just sync` 确认 peer-only 依赖检测符合预期。
- 任何改动都不要手动提交版本号或 `pnpm-lock.yaml` 里的上游版本——交给 sync 流程。

## 进一步阅读

- [README.md](README.md)（中文，默认）/ [README.en.md](README.en.md) — 面向用户的说明（安装、使用、工作原理）；微信群二维码在 `assets/wechat-group.jpg`（7 天过期，用户反馈失效时需重新替换）
- 上游 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) — dsh 本体的业务逻辑与配置
