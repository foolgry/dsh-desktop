# 安装

DSH Desktop 是开箱即用的安装包——你的电脑上无需 Node.js、npm 或终端。

## 下载

到 [Releases](https://github.com/foolgry/dsh-desktop/releases) 页面下载最新构建。

### macOS（Apple Silicon / M 系列）

下载 `DSH-Desktop-*-mac-arm64.dmg`。

应用**未签名**，首次打开时：

- 如果提示"无法验证开发者"：**右键点应用 → 打开**。
- 如果提示 **"DSH Desktop 已损坏，无法打开"**：这是公证隔离属性导致的。在**终端**执行一次以下命令，之后即可正常打开：

  ```sh
  xattr -cr "/Applications/DSH Desktop.app"
  ```

### Windows（64 位）

下载 `DSH-Desktop-*-win-x64-setup.exe`。

SmartScreen 会提示风险——点 **更多信息 → 仍要运行**。

## 更新

应用启动后每 4 小时自动检查新版本。Windows 自动安装；macOS（未签名）弹窗提示并给下载链接。

::: tip
桌面版跟随上游 `@deepseek-ai/dsh` npm 包。版本号如 `0.1.0-rc.6.8` 表示"基于上游 `0.1.0-rc.6` 的第 8 个桌面构建"。
:::
