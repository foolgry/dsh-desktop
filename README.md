# DSH Desktop

Download-and-run desktop build of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). No Node.js, no npm, no terminal required: install the app, open it, paste your DeepSeek API key into the built-in web UI, and start running agent tasks.

> Community build, not an official DeepSeek product. The upstream harness is MIT-licensed; this repo is only the Electron shell and release automation.

## Install

Grab the latest installer from [Releases](https://github.com/foolgry/dsh-desktop/releases):

- **macOS (Apple Silicon)**: `DSH-Desktop-*-mac-arm64.dmg` — unsigned build: right-click the app → *Open* to pass Gatekeeper.
- **Windows (x64)**: `DSH-Desktop-*-win-x64-setup.exe` — SmartScreen will prompt; choose *More info → Run anyway*.

The app checks for updates on start and every 4 hours. On Windows updates install automatically; on macOS (unsigned) you get a prompt with a download link.

## How it works

- The app embeds Electron's own Node.js runtime and the published [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh) packages — nothing is installed on your system.
- On launch it spawns `dsh web` on the first free loopback port starting at **3080** (3081, 3082, … if occupied) and opens the UI in a native window. The server only listens on `127.0.0.1`.
- App data (profiles, sessions) lives in the OS app-data directory (`dsh-home` under Electron's `userData`), not in your home directory. Logs: `logs/dsh.log` in the same place.
- The API key is entered in the web UI's own settings, exactly as with `npx @deepseek-ai/dsh web`.

## Release automation

[`.github/workflows/sync-and-release.yml`](.github/workflows/sync-and-release.yml) runs at **09:00 / 13:00 / 17:00 Beijing time** (and on manual dispatch):

1. Polls npm for the latest `@deepseek-ai/dsh`; exits quietly when unchanged.
2. On a new upstream release: bumps the pinned version, tags `v<desktop-version>`, and pushes.
3. Builds macOS (dmg + zip) and Windows (nsis) installers and publishes them to GitHub Releases.

Desktop versions track upstream: `0.1.0-rc.6.1` means "upstream `0.1.0-rc.6`, desktop build 1".

## Development

Requires Node.js `^22.19 || >=24`, [pnpm](https://pnpm.io), and [just](https://just.systems).

```sh
just install   # pnpm install
just dev       # compile main process and launch the app from source
just sync      # check npm for a new upstream release and bump
just dist-mac  # build the macOS installer into dist-installer/
just dist-win  # build the Windows installer (on Windows/CI)
```

## License

MIT (shell code). DeepSeek Harness itself is MIT © DeepSeek; see upstream `THIRD_PARTY_NOTICES.md` for bundled dependencies.
