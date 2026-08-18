---
layout: home

hero:
  name: DSH Desktop
  text: DeepSeek Harness, desktop build
  tagline: Download and run — no Node.js, no npm, no terminal. Install the app, paste your API key, and let the AI work on your machine.
  image:
    src: /icon.png
    alt: DSH Desktop
  actions:
    - theme: brand
      text: Download
      link: https://github.com/foolgry/dsh-desktop/releases
    - theme: alt
      text: Quick Start
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/foolgry/dsh-desktop

features:
  - icon: ⚡
    title: Zero setup
    details: Bundles Electron's Node runtime and the official @deepseek-ai/dsh package — nothing is installed on your system.
  - icon: 🔒
    title: Local & isolated
    details: Runs a dsh web service on 127.0.0.1 only. Your data stays in the app data directory and never touches your user home.
  - icon: 🔄
    title: Auto-update
    details: Checks for new releases every 4 hours. Windows downloads in the background and updates on one click; macOS upgrades in-app when installed via Homebrew.
  - icon: 🖥️
    title: Cross-platform
    details: Native macOS (Apple Silicon) and Windows installers, built and published automatically as upstream releases.
---
