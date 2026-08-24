# DSH Desktop

English | [中文](README.md)

Download-and-run desktop build of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). No Node.js, no npm, no terminal required. Install the app, open it, paste your DeepSeek API key into the built-in web UI, and start letting the AI run tasks for you (read/write files, execute commands, write code, automate operations, etc.).

> ⚠️ **This is a community (unofficial) build.** The upstream [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) is open-sourced under the MIT license. This repository is only an Electron desktop shell plus automated packaging scripts — it is not an official DeepSeek product. The DeepSeek name and whale logo are trademarks of DeepSeek, used here only to identify the packaged upstream software.

📖 **Documentation**: [foolgry.github.io/dsh-desktop](https://foolgry.github.io/dsh-desktop/) — found a bug or have a suggestion? Please [open an issue](https://github.com/foolgry/dsh-desktop/issues).

## Download and install

Get the latest version from the [Releases](https://github.com/foolgry/dsh-desktop/releases) page:

- **macOS (Apple Silicon / M-series chips)**: Homebrew is the recommended install — one command does everything (the `xattr -cr` clears the quarantine attribute on the unnotarized app, preventing the "damaged" error; it also enables in-app one-click updates later, see below):
  ```sh
  brew install --cask foolgry/tap/dsh-desktop && xattr -cr "/Applications/DSH Desktop.app"
  ```
  Or download `DSH-Desktop-*-mac-arm64.dmg` and install manually: the app is unsigned, so if macOS says it "cannot verify the developer" on first launch, **right-click the app → Open**; if it says **"damaged and can't be opened"**, run the `xattr` command above once in Terminal.
- **Windows (64-bit)**: download `DSH-Desktop-*-win-x64-setup.exe`
  - SmartScreen will warn about risk: click **More info → Run anyway**

Every release ships a `SHA256SUMS` manifest for verifying installer integrity.

The app checks for updates automatically (every 4 hours) after launch, and you can trigger a check manually anytime: macOS menu bar "DSH Desktop → 检查更新…", Windows window menu (press Alt to reveal) "Help → Check for Updates…", or the tray icon's "Check for Updates…" item:

- **Windows**: the update downloads in the background; click "Restart and update" in the dialog to apply it, or it is installed automatically the next time the app quits
- **macOS** (unsigned, so it cannot update itself): a dialog announces the new version. If the app was installed via Homebrew, "Update via Homebrew" runs `brew upgrade --cask dsh-desktop` + `xattr -cr` for you and restarts the app; otherwise a button opens the Releases page for a manual download

## Usage

1. Open **DSH Desktop** after installation
2. Enter your [DeepSeek API Key](https://platform.deepseek.com/) in the settings of the interface (same as the web version)
3. Start a conversation and let the AI complete tasks for you

Your data (conversations, configuration, sessions) is stored in the system application data directory and does not pollute your user directory. Logs are in `logs/dsh.log` under the same directory; both the log and the data directory are reachable from the tray menu.

## How it works

- The app bundles the Node.js runtime that ships with Electron and the officially published [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh) package — **it installs nothing on your system**. Online plugin installs from the marketplace are handled by a bundled standalone pnpm, so they need no system Node / npm / Homebrew either
- On startup it launches a `dsh web` service on the loopback address (port 3080 by default; if occupied, it automatically tries 3081, 3082…), listening only on `127.0.0.1` and never exposed externally
- A native window loads this interface, giving an experience consistent with a desktop app
- **Closing the window does not quit the app**: the × button minimizes to the system tray and running tasks continue in the background; click the tray icon (or "Show DSH Desktop" in its menu) to reopen the window, and use the tray menu's "Quit" (or Cmd+Q on macOS) to exit completely

## What we deliberately don't do

Scope is a feature. This project stays a minimal desktop shell around the official UI:

- **No fork, no patched upstream**: it always runs the officially published `@deepseek-ai/dsh` and follows new releases daily — you get exactly the same, latest official capability that CLI users get, not a repackaged fork that slowly rots
- **No UI rework**: the window shows the official Web UI untouched. Skins, terminals, sidebars and other enhancements belong to the plugin ecosystem (a marketplace is built in) — you choose what to install; the shell doesn't decide for you
- **Nothing installed on your system**: no Node, no PATH edits, no system config; everything lives in the app's own data directory and is gone when you uninstall
- **No version pinning**: there is no "stay on an old release" option. If an upstream release misbehaves, a fixed build usually lands within a day; the CLI is the interim fallback

If you want a built-in terminal, skins, or multi-version management, heavier community clients exist (e.g. [EAC](https://github.com/zouyuxuan122/Deepseek-Harness-EAC), [anywhere-labs' DSH Desktop](https://github.com/anywhere-labs/deepseek-harness-desktop)) — different trade-offs, pick what fits.

## Automatic sync and packaging

[sync-and-release.yml](.github/workflows/sync-and-release.yml) runs automatically at **09:00 / 13:00 / 17:00 Beijing time every day**:

1. Checks whether npm has a new version of `@deepseek-ai/dsh`; skips if not
2. On a new version: updates the dependency, tags the commit, builds macOS (dmg + zip) and Windows (nsis) installers, and publishes them to Releases

The desktop version number tracks upstream: `0.1.0-rc.6.6` means "the 6th desktop build based on upstream `0.1.0-rc.6`".

## Local development

Requires Node.js `^22.19 || >=24`, [pnpm](https://pnpm.io), and [just](https://just.systems).

```sh
just install    # install dependencies
just dev        # compile and run the app from source
just sync       # check for a new upstream version and update
just dist-mac   # build the macOS installer into dist-installer/
just dist-win   # build the Windows installer (on Windows/CI)
```

## License

Desktop shell code: MIT. DeepSeek Harness itself is MIT © DeepSeek; third-party notices for bundled dependencies are in the upstream `THIRD_PARTY_NOTICES.md`.
