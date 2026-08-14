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
| 包管理 | **pnpm 11.7.0**（hoisted 模式） | 见下方关键约束，**禁止用 npm** |
| 任务运行 | **just**（`justfile`） | 所有命令优先走 just |
| 打包 | electron-builder 26 | dmg+zip（mac）、nsis（win） |
| 自动更新 | electron-updater | 每 4 小时检查；macOS 未签名时弹窗引导手动下载 |
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
   - `--expose-internals` 是 cordis-plugin-hmr 的 HMR 服务所需
3. **`waitReady()`** — 每 500ms 轮询 `http://127.0.0.1:PORT/`，最多等 60s；期间若子进程提前退出则直接报错。
4. **`createWindow()`** — 单个 BrowserWindow 加载本地 UI；导航守卫把任何非 `127.0.0.1` 的跳转交给系统浏览器。
5. **`setupAutoUpdate()`** — 仅在打包后运行；error 时弹窗指向 Releases 页（macOS 未签名无法自动应用）。

子进程的 stdout/stderr 全部追加到 `userData/logs/dsh.log`，这是排查「应用打不开 / UI 白屏」的首要入口。

单实例锁：`app.requestSingleInstanceLock()`，二次启动只聚焦已有窗口。

## 关键约束（改动前必读）

1. **依赖管理用 pnpm，不用 npm。** 仓库规定 pnpm。

2. **`node_modules` 必须保持 hoisted 模式。** `pnpm-workspace.yaml` 里 `nodeLinker: hoisted`，是为了让 electron-builder 能走扁平依赖树。**不要改成 pnpm 默认的 virtual-store symlink 布局**，否则打包会漏文件。

3. **peer-only 运行时依赖由脚本自动维护，不要手动删。** dsh 树里有些 `@deepseek-ai/*` 包只在 `peerDependencies` 中出现，而 electron-builder 的生产收集器（`nodeModulesCollector.isProdDependency`）**只读 `dependencies`/`optionalDependencies`**，会漏掉纯 peer 包。`sync-upstream.mjs` 的 `detectPeerOnlyRuntimeDeps()` 会在升版时把它们 pin 到 `dependencies`。设计上**只增不删**——即便某包后来变成真依赖，留着无害，删了反而可能因改名产生悬空引用。

4. **整个 `node_modules` 必须 `asarUnpack`。** `dsh web` 是子进程执行的入口路径，asar 归档内的路径无法被 spawn 执行，因此 `electron-builder.yml` 里 `asarUnpack: node_modules/**`。`dshBin()` 还会把 `app.asar` 路径重写为 `app.asar.unpacked`。

5. **版本号不要手动改。** 桌面版本由 `nextVersion()` 计算，规则：
   - 上游预发布版（如 `0.1.0-rc.6`）→ 追加构建号：`0.1.0-rc.6.1`、`0.1.0-rc.6.2`…
   - 上游稳定版（如 `0.1.0`）→ 独立 patch 线 `X.Y.(Z+1)`
   - 保证严格递增且合法 semver（electron-updater 要求）

6. **macOS 构建未签名 / 未公证。** CI 里 `CSC_IDENTITY_AUTO_DISCOVERY=false`。用户首次打开需右键 → 打开；若提示「已损坏」需 `xattr -cr "/Applications/DSH Desktop.app"`。

7. **ESM 项目，导入用 NodeNext 风格。** 例如 `.mjs` 脚本里用 `import.meta.url` + `createRequire`。`@deepseek-ai/dsh` 无 `exports` map，`dshBin()` 直接 `require.resolve('@deepseek-ai/dsh/lib/bin.js')`。

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

- [README.md](README.md) / [README.zh.md](README.zh.md) — 面向用户的说明（安装、使用、工作原理）
- 上游 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) — dsh 本体的业务逻辑与配置
