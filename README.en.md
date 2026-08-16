# DSH Desktop

English | [中文](README.md)

Download-and-run desktop build of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). No Node.js, no npm, no terminal required. Install the app, open it, paste your DeepSeek API key into the built-in web UI, and start letting the AI run tasks for you (read/write files, execute commands, write code, automate operations, etc.).

> ⚠️ **This is a community (unofficial) build.** The upstream [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) is open-sourced under the MIT license. This repository is only an Electron desktop shell plus automated packaging scripts — it is not an official DeepSeek product. The DeepSeek name and whale logo are trademarks of DeepSeek, used here only to identify the packaged upstream software.

📖 **Documentation**: [foolgry.github.io/dsh-desktop](https://foolgry.github.io/dsh-desktop/) — found a bug or have a suggestion? Please [open an issue](https://github.com/foolgry/dsh-desktop/issues).

## Download and install

Get the latest version from the [Releases](https://github.com/foolgry/dsh-desktop/releases) page:

- **macOS (Apple Silicon / M-series chips)**: download `DSH-Desktop-*-mac-arm64.dmg`
  - Unsigned: if macOS says it "cannot verify the developer" on first launch, **right-click the app → Open** to get past it
  - If it says **"DSH Desktop is damaged and can't be opened"**: this happens because the app is not notarized by Apple, so macOS adds a quarantine attribute on download. Run the following once in **Terminal**, then it opens normally:
    ```sh
    xattr -cr "/Applications/DSH Desktop.app"
    ```
- **Windows (64-bit)**: download `DSH-Desktop-*-win-x64-setup.exe`
  - SmartScreen will warn about risk: click **More info → Run anyway**

The app checks for updates automatically (every 4 hours) after launch. Windows installs updates automatically; macOS (unsigned) shows a dialog with a download link.

## Usage

1. Open **DSH Desktop** after installation
2. Enter your [DeepSeek API Key](https://platform.deepseek.com/) in the settings of the interface (same as the web version)
3. Start a conversation and let the AI complete tasks for you

Your data (conversations, configuration, sessions) is stored in the system application data directory and does not pollute your user directory. Logs are in `logs/dsh.log` under the same directory.

## How it works

- The app bundles the Node.js runtime that ships with Electron and the officially published [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh) package — **it installs nothing on your system**
- On startup it launches a `dsh web` service on the loopback address (port 3080 by default; if occupied, it automatically tries 3081, 3082…), listening only on `127.0.0.1` and never exposed externally
- A native window loads this interface, giving an experience consistent with a desktop app
- **Closing the window does not quit the app**: the × button minimizes to the system tray and running tasks continue in the background; click the tray icon (or "Show DSH Desktop" in its menu) to reopen the window, and use the tray menu's "Quit" (or Cmd+Q on macOS) to exit completely

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
