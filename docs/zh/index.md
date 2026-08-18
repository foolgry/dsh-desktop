---
layout: home

hero:
  name: DSH Desktop
  text: DeepSeek Harness 桌面版
  tagline: 下载即用——无需 Node.js、无需 npm、无需终端。安装后填入 API Key，让 AI 在你的电脑上干活。
  image:
    src: /icon.png
    alt: DSH Desktop
  actions:
    - theme: brand
      text: 下载
      link: https://github.com/foolgry/dsh-desktop/releases
    - theme: alt
      text: 快速开始
      link: /zh/guide/getting-started
    - theme: alt
      text: 在 GitHub 查看
      link: https://github.com/foolgry/dsh-desktop

features:
  - icon: ⚡
    title: 免配置
    details: 内置 Electron 自带的 Node 运行时和官方 @deepseek-ai/dsh 包，不会在你的系统里安装任何东西。
  - icon: 🔒
    title: 本地隔离
    details: 只在 127.0.0.1 起一个 dsh web 服务。数据存在系统应用数据目录，绝不污染你的用户目录。
  - icon: 🔄
    title: 自动更新
    details: 每 4 小时检查一次新版本。Windows 后台下载、点一下重启即更新；macOS 用 Homebrew 安装时可在 App 内一键升级。
  - icon: 🖥️
    title: 跨平台
    details: 提供 macOS（Apple Silicon）和 Windows 原生安装包，随上游发布自动构建发布。
---
