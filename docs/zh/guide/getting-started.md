# 安装

DSH Desktop 是开箱即用的安装包——你的电脑上无需 Node.js、npm 或终端。

## 下载

到 [Releases](https://github.com/foolgry/dsh-desktop/releases) 页面下载最新构建。

### macOS（Apple Silicon / M 系列）

推荐用 Homebrew 安装，一条命令搞定：

```sh
brew install --cask foolgry/tap/dsh-desktop && xattr -cr "/Applications/DSH Desktop.app"
```

`xattr -cr` 清除未公证应用的隔离属性，避免首次打开提示「已损坏」。用 Homebrew 安装后，有新版本时可以直接在 App 弹窗里点「Update via Homebrew」一键升级（见下方「更新」）。

也可以到 Releases 下载 `DSH-Desktop-*-mac-arm64.dmg` 手动安装。应用**未签名**，首次打开时：

- 如果提示"无法验证开发者"：**右键点应用 → 打开**。
- 如果提示 **"DSH Desktop 已损坏，无法打开"**：在**终端**执行一次上面的 `xattr` 命令，之后即可正常打开。

### Windows（64 位）

下载 `DSH-Desktop-*-win-x64-setup.exe`。

SmartScreen 会提示风险——点 **更多信息 → 仍要运行**。

## 更新

应用启动后每 4 小时自动检查新版本：

- **Windows**：后台自动下载，弹窗点「Restart and update」重启完成更新；不点也会在下次退出应用时自动安装。
- **macOS**（未签名，无法自我更新）：弹窗提示新版本。用 Homebrew 安装的点「Update via Homebrew」，自动执行 `brew upgrade --cask dsh-desktop` + `xattr -cr` 并重启完成更新；否则点按钮跳转到 Releases 页手动下载。

::: tip
桌面版跟随上游 `@deepseek-ai/dsh` npm 包。版本号如 `0.1.0-rc.6.8` 表示"基于上游 `0.1.0-rc.6` 的第 8 个桌面构建"。
:::
