# How It Works

DSH Desktop is a thin Electron shell around [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It does three things:

1. **Bundles a Node runtime.** It uses the Node.js that ships inside Electron, plus the officially published [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh) package — nothing is installed on your system. Online plugin installs from the marketplace are handled by a bundled standalone pnpm, so they need no system Node / npm / Homebrew either.

2. **Runs `dsh web` locally.** On startup it launches a `dsh web` service on the loopback address (port 3080 by default; if occupied it tries 3081, 3082…). It listens only on `127.0.0.1` and is never exposed externally.

3. **Loads it in a native window.** A BrowserWindow renders the local UI, giving you a desktop-app experience with a single-instance lock — launching it again just focuses the existing window.

::: warning Community build
This is an unofficial Electron shell plus automated packaging scripts. The DeepSeek name and whale logo are trademarks of DeepSeek, used here only to identify the packaged upstream software.
:::
