# DSH Desktop

[English](README.en.md) | 中文

DeepSeek Harness 的**桌面安装版**——下载安装即用，无需安装 Node.js、无需使用 npm、无需打开终端。安装后打开应用，在界面里填入你的 DeepSeek API Key，就能开始让 AI 帮你跑任务（读写文件、执行命令、写代码、自动化操作等）。

如果你在找「DeepSeek 桌面版」「DeepSeek 客户端下载」「DeepSeek Agent 电脑版」，这就是为你准备的。支持 macOS（Apple Silicon）和 Windows，安装包见下方 Releases。

> ⚠️ **这是社区（非官方）构建**。上游 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 采用 MIT 协议开源，本仓库只是 Electron 桌面外壳和自动打包脚本，不是 DeepSeek 官方产品。DeepSeek 的名称和鲸鱼 Logo 为 DeepSeek 的商标，此处仅用于标识所打包的上游软件。

📖 **文档站**：[foolgry.github.io/dsh-desktop/zh](https://foolgry.github.io/dsh-desktop/zh/) —— 遇到问题或有建议？欢迎到 [Issues](https://github.com/foolgry/dsh-desktop/issues) 反馈。

## 下载安装

到 [Releases](https://github.com/foolgry/dsh-desktop/releases) 页面下载最新版本：

- **macOS（Apple Silicon / M 系列芯片）**：下载 `DSH-Desktop-*-mac-arm64.dmg`
  - 未签名：首次打开如果提示"无法验证开发者"，**右键点应用 → 打开** 即可通过
  - 如果提示 **"DSH Desktop 已损坏，无法打开"**：这是因为应用未做 Apple 公证，下载时被系统加了隔离属性。打开**终端**执行一次以下命令，然后即可正常打开：
    ```sh
    xattr -cr "/Applications/DSH Desktop.app"
    ```
- **Windows（64 位）**：下载 `DSH-Desktop-*-win-x64-setup.exe`
  - SmartScreen 会提示风险：点 **更多信息 → 仍要运行**

应用启动时会自动检查更新（每 4 小时一次）。Windows 自动安装；macOS（未签名）会弹窗提示并给下载链接。

## 使用

1. 安装后打开 **DSH Desktop**
2. 在界面的设置里填入你的 [DeepSeek API Key](https://platform.deepseek.com/)（和网页版操作一样）
3. 开始对话，让 AI 帮你完成任务

你的数据（对话、配置、会话）存在系统应用数据目录，不会污染你的用户目录。日志在同目录的 `logs/dsh.log`。

## 它是怎么工作的

- 应用内置了 Electron 自带的 Node.js 运行时和官方发布的 [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh) 包，**不会在你的系统里安装任何东西**
- 启动时在本机回环地址起一个 `dsh web` 服务（默认 3080 端口，被占用则自动用 3081、3082…），只监听 `127.0.0.1`，不对外暴露
- 用原生窗口加载这个界面，体验和桌面软件一致
- **关闭窗口不会退出应用**：点 × 只是最小化到系统托盘，正在运行的任务继续在后台执行；点托盘图标（或菜单里的「Show DSH Desktop」）可重新打开窗口，彻底退出请用托盘菜单的「Quit」（或 macOS 的 Cmd+Q）

## 自动同步与打包

[sync-and-release.yml](.github/workflows/sync-and-release.yml) 在**北京时间每天 9:00 / 13:00 / 17:00** 自动运行：

1. 检查 npm 上 `@deepseek-ai/dsh` 是否有新版本；没有则跳过
2. 有新版本就更新依赖、打 tag、构建 macOS（dmg + zip）和 Windows（nsis）安装包，发布到 Releases

桌面版版本号跟随上游：`0.1.0-rc.6.6` 表示"基于上游 `0.1.0-rc.6` 的第 6 个桌面构建"。

## 微信交流群

使用上有问题、想提建议，欢迎扫码进群交流：

<img src="assets/wechat-group.jpg" alt="dsh desktop 微信交流群二维码" width="260" />

> 微信群二维码 7 天内有效。如果扫码提示已过期，请到 [Issues](https://github.com/foolgry/dsh-desktop/issues) 留言，我们会更新二维码。

## 本地开发

需要 Node.js `^22.19 || >=24`、[pnpm](https://pnpm.io)、[just](https://just.systems)。

```sh
just install    # 安装依赖
just dev        # 编译并以源码方式启动应用
just sync       # 检查上游新版本并更新
just dist-mac   # 构建 macOS 安装包到 dist-installer/
just dist-win   # 构建 Windows 安装包（在 Windows/CI 上）
```

## 许可证

桌面外壳代码：MIT。DeepSeek Harness 本体为 MIT © DeepSeek；打包的第三方依赖见上游 `THIRD_PARTY_NOTICES.md`。
